// Two-way sync between the local SQLite store and the central database.
//   1. push  – local edits, with the revision they were based on. The server answers
//              ok / conflict (someone else changed it first) / denied (permissions, lock).
//   2. pull  – everything changed on the server since the last pull (with a safety
//              overlap; applying is idempotent because every row carries a revision).
//   3. audit – the local audit trail is uploaded so management sees who changed what.
// Nothing is ever silently overwritten: conflicts and rejections are kept for the user.
import type { KpiKey, KpiTarget } from '../engine/kpis.ts';
import { LOGS, type LogKey } from '../engine/schema.ts';
import type { Store, WireRow } from '../data/store.ts';
import { TransportError, type Transport } from './transport.ts';

/** projects first: other records derive their site from their project */
const LOG_ORDER: LogKey[] = ['projects', ...LOGS.map((l) => l.key).filter((k) => k !== 'projects')];
const PAGE = 1000;
const BATCH = 200;

export type SyncState = 'idle' | 'syncing' | 'offline' | 'auth' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSync: Date | null;
  lastError: string | null;
  pending: number;
  issues: number;
  lastReport: SyncReport | null;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  rejected: number;
}

export class SyncEngine {
  status: SyncStatus;
  private running: Promise<SyncReport> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  private store: Store;
  private transport: Transport;
  private opts: { overlapMs?: number; intervalMs?: number; debounceMs?: number };

  constructor(store: Store, transport: Transport, opts: { overlapMs?: number; intervalMs?: number; debounceMs?: number } = {}) {
    this.store = store;
    this.transport = transport;
    this.opts = opts;
    this.status = { state: 'idle', lastSync: null, lastError: null, pending: store.pendingCount(), issues: store.issues().length, lastReport: null };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(p: Partial<SyncStatus>) {
    this.status = { ...this.status, ...p };
    for (const fn of this.listeners) fn();
  }

  /** sync now, every intervalMs, and a few seconds after each local edit */
  start() {
    this.store.onLocalChange = () => {
      this.set({ pending: this.store.pendingCount() });
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => void this.run(), this.opts.debounceMs ?? 4000);
    };
    this.timer = setInterval(() => void this.run(), this.opts.intervalMs ?? 60_000);
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
    void this.run();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
    this.store.onLocalChange = null;
  }

  private onOnline = () => void this.run();

  /** run one sync; concurrent calls share the running sync and schedule one more pass */
  run(): Promise<SyncReport> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.pass().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.run();
      }
    });
    return this.running;
  }

  private async pass(): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, rejected: 0 };
    this.set({ state: 'syncing' });
    try {
      await this.pushSettings(report);
      await this.pushLogs(report);
      await this.pullAll(report);
      await this.pushAudit();
      this.store.remoteBatchDone();
      await this.store.flush();
      this.set({ state: 'idle', lastSync: new Date(), lastError: null, pending: this.store.pendingCount(), issues: this.store.issues().length, lastReport: report });
    } catch (e) {
      // whatever was applied before the failure is kept and saved
      this.store.remoteBatchDone();
      void this.store.flush();
      const kind = e instanceof TransportError ? e.kind : 'server';
      this.set({ state: kind === 'offline' ? 'offline' : kind === 'auth' ? 'auth' : 'error', lastError: String((e as Error)?.message ?? e), pending: this.store.pendingCount(), issues: this.store.issues().length });
    }
    return report;
  }

  // ---------- push ----------
  private async pushSettings(report: SyncReport) {
    const st = this.store.settingsSync();
    if (st.dirty) {
      const [r] = await this.transport.push('org_settings', [{ id: 'org', base_rev: st.rev, deleted: false, updated_at: new Date().toISOString(), data: this.store.sharedSettings() }]);
      if (r.status === 'ok') { this.store.markSettingsPushed(r.rev!); report.pushed++; }
      // not allowed or out of date: the server's settings win (re-read below)
      else this.store.markSettingsPushed(-1);
    }
    const tg = this.store.targetsSync();
    if (tg.dirty.length) {
      const rows = tg.dirty.map((k) => ({ id: k, base_rev: tg.revs[k] ?? 0, deleted: false, updated_at: new Date().toISOString(), data: this.store.ds.targets[k as KpiKey] }));
      for (const r of await this.transport.push('kpi_targets', rows)) {
        if (r.status === 'ok') { this.store.markTargetPushed(r.id, r.rev!); report.pushed++; }
        else this.store.markTargetPushed(r.id, -1);
      }
    }
  }

  private async pushLogs(report: SyncReport) {
    for (const log of LOG_ORDER) {
      for (let guard = 0; guard < 1000; guard++) {
        const rows = this.store.dirtyRows(log, BATCH);
        if (!rows.length) break;
        const dirtyAt = new Map(rows.map((r) => [r.id, r._dirty]));
        const wire: WireRow[] = rows.map(({ _dirty: _d, ...r }) => r);
        const results = await this.transport.push(log, wire);
        let progress = 0;
        for (const r of results) {
          if (r.status === 'ok') {
            this.store.markPushed(log, r.id, r.rev!, dirtyAt.get(r.id)!);
            report.pushed++;
            progress++;
          } else if (r.status === 'conflict' && r.server) {
            this.store.applyRemote(log, r.server);
            report.conflicts++;
            progress++;
          } else {
            this.store.markRejected(log, r.id, r.reason ?? 'denied');
            report.rejected++;
            progress++;
          }
        }
        if (!progress) break;
      }
    }
  }

  // ---------- pull ----------
  private async pullAll(report: SyncReport) {
    // small, admin-managed tables: always read in full
    const sites = await this.transport.sites();
    this.store.setSites(sites.filter((s) => s.active).map((s) => s.code));
    for (const r of await this.transport.pull('org_settings', null, 0, PAGE))
      if (r.id === 'org') this.store.applyRemoteSettings((r as unknown as { data: object }).data, Number(r.rev));
    for (const r of await this.transport.pull('kpi_targets', null, 0, PAGE))
      this.store.applyRemoteTarget(r.id as KpiKey, (r as unknown as { data: KpiTarget }).data, Number(r.rev));

    const overlap = this.opts.overlapMs ?? 120_000;
    for (const log of LOG_ORDER) {
      const cursor = this.store.cursor(log);
      const since = cursor ? new Date(Date.parse(cursor) - overlap).toISOString() : null;
      let max = cursor;
      for (let offset = 0; ; offset += PAGE) {
        const rows = await this.transport.pull(log, since, offset, PAGE);
        for (const r of rows) {
          const res = this.store.applyRemote(log, r);
          if (res === 'applied') report.pulled++;
          if (res === 'conflict') report.conflicts++;
          if (!max || r.server_updated_at > max) max = r.server_updated_at;
        }
        if (rows.length < PAGE) break;
      }
      if (max) this.store.setCursor(log, max);
    }
  }

  /** re-read one record from the server (after discarding a rejected change) */
  async refetch(log: LogKey, id: string) {
    const r = await this.transport.fetchRow(log, id);
    if (r) this.store.applyRemote(log, r, true);
    this.store.remoteBatchDone();
  }

  // ---------- audit ----------
  private async pushAudit() {
    for (let guard = 0; guard < 100; guard++) {
      const rows = this.store.unpushedAudit(500);
      if (!rows.length) return;
      const dev = this.store.deviceId;
      await this.transport.pushAudit(rows.map((a) => ({
        id: `${dev}-${a.seq}`, ts: a.ts, user_name: a.user, log: a.log, row_id: a.rowId, action: a.action, summary: a.summary, before: a.before, after: a.after,
      })));
      this.store.markAuditPushed(rows[rows.length - 1].seq);
    }
  }
}
