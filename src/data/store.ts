// Local database: SQLite (sql.js / WebAssembly) holding one table per log with typed
// columns, a meta table (settings, targets) and an audit trail of every change.
// Every row carries a UUID, a soft-delete flag and sync bookkeeping:
//   sync_rev   – the server revision this local copy is based on (0 = never synced)
//   sync_dirty – > 0: local edits not yet pushed (a counter, so an edit made while a
//                push is in flight is not lost); -1: rejected by the server
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { todayISO } from '../engine/dates.ts';
import { DEFAULT_TARGETS, type Dataset, type KpiKey, type KpiTarget } from '../engine/kpis.ts';
import { LOGS, LOG_BY_KEY, DEFAULT_LISTS, defaultSettings, type LogKey, type Row, type Settings } from '../engine/schema.ts';
import { getPersistence, type Persistence } from './persistence.ts';
import { fromWire, type WireRow } from '../engine/wire.ts';

const NUMERIC = new Set(['number', 'money', 'percent', 'score']);
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** settings that stay on this laptop and are never sent to the server */
const LOCAL_SETTINGS = ['userName'] as const;

export interface AuditEntry {
  ts: string;
  user: string;
  log: string;
  rowId: string;
  action: 'create' | 'update' | 'delete' | 'import' | 'target' | 'settings' | 'sync';
  summary: string;
}

export type { WireRow } from '../engine/wire.ts';

export interface SyncIssue {
  seq: number;
  ts: string;
  kind: 'conflict' | 'rejected';
  log: string;
  rowId: string;
  local: Row | null;
  server: Row | null;
  reason: string;
}

export interface OpenOptions {
  /** database name: 'benchmark' (standalone) or one per signed-in user */
  name?: string;
  persistence?: Persistence;
  locateFile?: (file: string) => string;
}

export class Store {
  private db: Database;
  private persistence: Persistence;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  ds: Dataset;
  version = 0;
  /** bumps on data AND save-state changes (what the UI subscribes to) */
  private tick = 0;
  lastSaved: Date | null = null;
  saveError: string | null = null;
  /** connected to the central server: destructive bulk operations are refused */
  connected = false;
  /** name written to the audit trail (the signed-in user), falls back to settings.userName */
  actor = '';
  /** called after every local change (the sync engine schedules a push) */
  onLocalChange: (() => void) | null = null;

  private constructor(db: Database, persistence: Persistence) {
    this.db = db;
    this.persistence = persistence;
    this.migrate();
    this.ds = this.read();
  }

  static async open(o: OpenOptions = {}): Promise<Store> {
    const SQL = await initSqlJs({ locateFile: o.locateFile ?? (() => wasmUrl) });
    const persistence = o.persistence ?? getPersistence(o.name ?? 'benchmark');
    const bytes = await persistence.load();
    const store = new Store(bytes ? new SQL.Database(bytes) : new SQL.Database(), persistence);
    if (!bytes) store.flush();
    return store;
  }

  /** Read a backup file into a dataset (does not touch the open database). */
  static async fromBytes(bytes: Uint8Array, locateFile?: (f: string) => string): Promise<Dataset> {
    const SQL = await initSqlJs({ locateFile: locateFile ?? (() => wasmUrl) });
    const db = new SQL.Database(bytes);
    const ok = db.exec("SELECT value FROM meta WHERE key = 'schemaVersion'");
    if (!ok.length) throw new Error('Not a BenchMark database');
    const tmp = new Store(db, { kind: 'browser', load: async () => null, save: async () => {} });
    return tmp.ds;
  }

  get storageKind() {
    return this.persistence.kind;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.tick;
  notify() {
    this.tick++;
    for (const fn of this.listeners) fn();
  }

  // ---------- schema ----------
  private migrate() {
    const d = this.db;
    d.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    d.run(`CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user TEXT,
           log TEXT, row_id TEXT, action TEXT NOT NULL, summary TEXT, before TEXT, after TEXT)`);
    this.addColumns('audit', { pushed: 'INTEGER NOT NULL DEFAULT 0' });
    d.run(`CREATE TABLE IF NOT EXISTS sync_issues (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kind TEXT NOT NULL,
           log TEXT NOT NULL, row_id TEXT NOT NULL, local TEXT, server TEXT, reason TEXT)`);
    for (const def of LOGS) {
      d.run(`CREATE TABLE IF NOT EXISTS ${q(def.key)} (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`);
      const cols: Record<string, string> = { sync_rev: 'INTEGER NOT NULL DEFAULT 0', sync_dirty: 'INTEGER NOT NULL DEFAULT 0' };
      for (const f of def.fields) cols[f.key] = NUMERIC.has(f.type) ? 'REAL' : 'TEXT';
      this.addColumns(def.key, cols);
    }
    d.run(`INSERT OR IGNORE INTO meta (key, value) VALUES ('schemaVersion', '2')`);
    d.run(`UPDATE meta SET value = '2' WHERE key = 'schemaVersion'`);
    if (!this.getMeta('deviceId')) this.setMeta('deviceId', globalThis.crypto.randomUUID());
  }

  private addColumns(table: string, cols: Record<string, string>) {
    const have = new Set(this.all(`PRAGMA table_info(${q(table)})`).map((r) => String(r.name)));
    for (const [c, type] of Object.entries(cols)) if (!have.has(c)) this.db.run(`ALTER TABLE ${q(table)} ADD COLUMN ${q(c)} ${type}`);
  }

  private all(sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
    const st = this.db.prepare(sql);
    st.bind(params);
    const out: Record<string, SqlValue>[] = [];
    while (st.step()) out.push(st.getAsObject());
    st.free();
    return out;
  }

  getMeta<T>(key: string): T | null {
    const r = this.all('SELECT value FROM meta WHERE key = ?', [key])[0];
    return r ? (JSON.parse(String(r.value)) as T) : null;
  }
  setMeta(key: string, value: unknown) {
    this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
  }

  private read(): Dataset {
    const base = defaultSettings(todayISO());
    const saved = this.getMeta<Partial<Settings>>('settings') ?? {};
    const settings: Settings = { ...base, ...saved, lists: { ...DEFAULT_LISTS, ...base.lists, ...(saved.lists ?? {}) } };
    const targets = { ...structuredClone(DEFAULT_TARGETS), ...(this.getMeta<Record<KpiKey, KpiTarget>>('targets') ?? {}) };
    const logs = {} as Record<LogKey, Row[]>;
    for (const def of LOGS) {
      logs[def.key] = this.all(`SELECT * FROM ${q(def.key)} WHERE deleted = 0`).map((r) => toRow(def.key, r));
      sortLog(def.key, logs[def.key]);
    }
    return { settings, targets, logs };
  }

  // ---------- local mutations ----------
  private changed(local = true) {
    this.version++;
    this.ds = { ...this.ds }; // new identity for React memo dependencies
    this.notify();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
    if (local) this.onLocalChange?.();
  }

  private audit(e: Omit<AuditEntry, 'ts' | 'user'>, before?: unknown, after?: unknown) {
    this.db.run('INSERT INTO audit (ts, user, log, row_id, action, summary, before, after) VALUES (?,?,?,?,?,?,?,?)', [
      new Date().toISOString(), this.actor || this.ds?.settings.userName || '', e.log, e.rowId, e.action, e.summary,
      before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after),
    ]);
  }

  /** write a row; local edits bump sync_dirty, rows from the server set sync_rev and clear it */
  private writeRow(log: LogKey, row: Row, o: { remote?: { rev: number; deleted: boolean; updatedAt: string | null } } = {}) {
    const def = LOG_BY_KEY[log];
    const fields = def.fields.map((f) => f.key);
    const cols = ['id', 'updated_at', 'deleted', ...fields];
    const vals: SqlValue[] = [row.id, o.remote?.updatedAt ?? new Date().toISOString(), o.remote?.deleted ? 1 : 0, ...fields.map((k) => toSql(row[k]))];
    const sync = o.remote ? `sync_rev = ${Math.trunc(o.remote.rev)}, sync_dirty = 0` : 'sync_dirty = CASE WHEN sync_dirty < 0 THEN 1 ELSE sync_dirty + 1 END';
    this.db.run(
      `INSERT INTO ${q(log)} (${cols.map(q).join(',')}, sync_rev, sync_dirty) VALUES (${cols.map(() => '?').join(',')}, ${o.remote ? Math.trunc(o.remote.rev) : 0}, ${o.remote ? 0 : 1})
       ON CONFLICT(id) DO UPDATE SET ${cols.slice(1).map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}, ${sync}`,
      vals,
    );
  }

  upsert(log: LogKey, row: Row) {
    if (!row?.id) throw new Error(`upsert(${log}): record has no id`);
    const rows = this.ds.logs[log];
    const i = rows.findIndex((r) => r.id === row.id);
    const before = i >= 0 ? rows[i] : undefined;
    this.writeRow(log, row);
    const code = LOG_BY_KEY[log].codeField;
    this.audit({ log, rowId: row.id, action: before ? 'update' : 'create', summary: String((code && row[code]) || row.id) }, before, row);
    const next = i >= 0 ? rows.map((r) => (r.id === row.id ? { ...row } : r)) : [...rows, { ...row }];
    sortLog(log, next);
    this.ds.logs = { ...this.ds.logs, [log]: next };
    this.changed();
  }

  remove(log: LogKey, id: string) {
    const before = this.ds.logs[log].find((r) => r.id === id);
    if (!before) return;
    // soft delete: the row is kept (deleted = 1) so the deletion can be synced and audited
    this.db.run(`UPDATE ${q(log)} SET deleted = 1, updated_at = ?, sync_dirty = CASE WHEN sync_dirty < 0 THEN 1 ELSE sync_dirty + 1 END WHERE id = ?`, [new Date().toISOString(), id]);
    const code = LOG_BY_KEY[log].codeField;
    this.audit({ log, rowId: id, action: 'delete', summary: String((code && before[code]) || id) }, before);
    this.ds.logs = { ...this.ds.logs, [log]: this.ds.logs[log].filter((r) => r.id !== id) };
    this.changed();
  }

  setSettings(s: Settings) {
    const before = this.ds.settings;
    this.setMeta('settings', s);
    // only org-wide settings need to reach the server
    const shared = (x: Settings) => JSON.stringify({ ...x, userName: '' });
    if (shared(before) !== shared(s)) this.setMeta('sync.settings', { ...this.settingsSync(), dirty: true });
    this.audit({ log: 'settings', rowId: '', action: 'settings', summary: 'settings' }, before, s);
    this.ds.settings = s;
    this.changed();
  }

  /** Target changes always go together with a Target_Revisions entry (audit trail). */
  setTarget(t: KpiTarget, revision: Row) {
    const before = this.ds.targets[t.key];
    const targets = { ...this.ds.targets, [t.key]: t };
    this.setMeta('targets', targets);
    this.markTargetDirty(t.key);
    this.audit({ log: 'targets', rowId: t.key, action: 'target', summary: t.key }, before, t);
    this.ds.targets = targets;
    this.writeRow('targetRevisions', revision);
    this.ds.logs = { ...this.ds.logs, targetRevisions: [...this.ds.logs.targetRevisions, revision] };
    this.changed();
  }

  /** Owner change only (no threshold change → no revision needed). */
  setTargetOwner(key: KpiKey, owner: string) {
    const targets = { ...this.ds.targets, [key]: { ...this.ds.targets[key], owner } };
    this.setMeta('targets', targets);
    this.markTargetDirty(key);
    this.ds.targets = targets;
    this.changed();
  }

  /** Replace everything (Excel import, sample data, reset). Refused when connected: it would delete everyone's data. */
  replaceAll(ds: Dataset, summary: string) {
    if (this.connected) throw new Error('Replacing all data is not allowed while connected to the server – use “Add to existing data”.');
    this.db.run('BEGIN');
    try {
      for (const def of LOGS) {
        this.db.run(`UPDATE ${q(def.key)} SET deleted = 1, updated_at = ?, sync_dirty = sync_dirty + 1 WHERE deleted = 0`, [new Date().toISOString()]);
        for (const r of ds.logs[def.key] ?? []) this.writeRow(def.key, r);
      }
      this.setMeta('settings', ds.settings);
      this.setMeta('targets', ds.targets);
      this.audit({ log: '*', rowId: '', action: 'import', summary });
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
    this.ds = this.read();
    this.changed();
  }

  /** Merge rows by id (used by import in 'merge' mode). */
  mergeRows(logs: Partial<Record<LogKey, Row[]>>, summary: string) {
    this.db.run('BEGIN');
    try {
      for (const [k, rows] of Object.entries(logs)) for (const r of rows ?? []) this.writeRow(k as LogKey, r);
      this.audit({ log: '*', rowId: '', action: 'import', summary });
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
    this.ds = this.read();
    this.changed();
  }

  auditTrail(limit = 300): AuditEntry[] {
    return this.all('SELECT ts, user, log, row_id, action, summary FROM audit ORDER BY seq DESC LIMIT ?', [limit]).map((r) => ({
      ts: String(r.ts), user: String(r.user ?? ''), log: String(r.log ?? ''), rowId: String(r.row_id ?? ''),
      action: r.action as AuditEntry['action'], summary: String(r.summary ?? ''),
    }));
  }

  // ---------- sync bookkeeping (used by src/sync/engine.ts) ----------
  get deviceId(): string {
    return this.getMeta<string>('deviceId')!;
  }

  /** local rows waiting to be pushed, with the revision they are based on */
  dirtyRows(log: LogKey, limit = 200): (WireRow & { _dirty: number })[] {
    return this.all(`SELECT * FROM ${q(log)} WHERE sync_dirty > 0 LIMIT ?`, [limit]).map((r) => ({
      ...toRow(log, r),
      deleted: r.deleted === 1,
      updated_at: r.updated_at === null ? null : String(r.updated_at),
      base_rev: Number(r.sync_rev),
      _dirty: Number(r.sync_dirty),
    }));
  }

  pendingCount(): number {
    let n = 0;
    for (const def of LOGS) n += Number(this.all(`SELECT COUNT(*) AS n FROM ${q(def.key)} WHERE sync_dirty > 0`)[0].n);
    if (this.settingsSync().dirty) n++;
    n += this.targetsSync().dirty.length;
    return n;
  }

  /** the server accepted our row: remember its revision (keep it dirty if edited again meanwhile) */
  markPushed(log: LogKey, id: string, rev: number, dirtyAtPush: number) {
    this.db.run(`UPDATE ${q(log)} SET sync_rev = ?, sync_dirty = CASE WHEN sync_dirty = ? THEN 0 ELSE sync_dirty END WHERE id = ?`, [rev, dirtyAtPush, id]);
  }

  private localRow(log: LogKey, id: string) {
    const r = this.all(`SELECT * FROM ${q(log)} WHERE id = ?`, [id])[0];
    return r ? { row: toRow(log, r), rev: Number(r.sync_rev), dirty: Number(r.sync_dirty), deleted: r.deleted === 1 } : null;
  }

  /**
   * Apply a row received from the server. Returns what happened:
   *  applied   – stored locally
   *  skipped   – we already have this revision (or newer)
   *  conflict  – we had unpushed edits on an older revision: the server version wins
   *              locally, our version is kept in sync_issues for the user to decide
   */
  applyRemote(log: LogKey, srv: WireRow, force = false): 'applied' | 'skipped' | 'conflict' {
    const rev = Number(srv.rev ?? 0);
    const local = this.localRow(log, srv.id);
    const remote = { rev, deleted: !!srv.deleted, updatedAt: srv.updated_at ?? null };
    const serverRow = fromWire(log, srv);
    if (local && !force && rev <= local.rev) return 'skipped';
    let result: 'applied' | 'conflict' = 'applied';
    if (local && local.dirty > 0 && !force) {
      this.addIssue('conflict', log, srv.id, local.deleted ? null : local.row, serverRow, '');
      result = 'conflict';
    }
    this.writeRow(log, serverRow, { remote });
    this.patchMemory(log, serverRow, remote.deleted);
    return result;
  }

  /** the server refused our row (permissions, lock, missing site …) */
  markRejected(log: LogKey, id: string, reason: string) {
    const local = this.localRow(log, id);
    this.db.run(`UPDATE ${q(log)} SET sync_dirty = -1 WHERE id = ?`, [id]);
    this.addIssue('rejected', log, id, local && !local.deleted ? local.row : null, null, reason);
  }

  private addIssue(kind: SyncIssue['kind'], log: string, rowId: string, local: Row | null, server: Row | null, reason: string) {
    // one open issue per record
    this.db.run('DELETE FROM sync_issues WHERE log = ? AND row_id = ?', [log, rowId]);
    this.db.run('INSERT INTO sync_issues (ts, kind, log, row_id, local, server, reason) VALUES (?,?,?,?,?,?,?)', [
      new Date().toISOString(), kind, log, rowId, local ? JSON.stringify(local) : null, server ? JSON.stringify(server) : null, reason,
    ]);
  }

  issues(): SyncIssue[] {
    return this.all('SELECT * FROM sync_issues ORDER BY seq DESC').map((r) => ({
      seq: Number(r.seq), ts: String(r.ts), kind: r.kind as SyncIssue['kind'], log: String(r.log), rowId: String(r.row_id),
      local: r.local ? JSON.parse(String(r.local)) : null, server: r.server ? JSON.parse(String(r.server)) : null, reason: String(r.reason ?? ''),
    }));
  }

  /** conflict: re-apply my version on top of the server's revision (pushed on next sync) */
  keepMine(seq: number) {
    const it = this.issues().find((x) => x.seq === seq);
    if (!it) return;
    const log = it.log as LogKey;
    if (it.local) {
      this.writeRow(log, it.local);
      this.patchMemory(log, it.local, false);
    } else {
      this.db.run(`UPDATE ${q(log)} SET deleted = 1, sync_dirty = sync_dirty + 1 WHERE id = ?`, [it.rowId]);
      this.patchMemory(log, { id: it.rowId }, true);
    }
    this.db.run('DELETE FROM sync_issues WHERE seq = ?', [seq]);
    this.audit({ log, rowId: it.rowId, action: 'sync', summary: 'conflict resolved: kept my version' });
    this.changed();
  }

  /** conflict / rejection: drop my version. For a rejection the engine re-fetches the server copy. */
  dropIssue(seq: number) {
    const it = this.issues().find((x) => x.seq === seq);
    if (!it) return;
    const log = it.log as LogKey;
    if (it.kind === 'rejected') {
      const l = this.localRow(log, it.rowId);
      if (l && l.rev === 0) {
        // never existed on the server: remove the local-only record
        this.db.run(`UPDATE ${q(log)} SET deleted = 1, sync_dirty = 0 WHERE id = ?`, [it.rowId]);
        this.patchMemory(log, { id: it.rowId }, true);
      } else {
        this.db.run(`UPDATE ${q(log)} SET sync_dirty = 0 WHERE id = ?`, [it.rowId]);
      }
    }
    this.db.run('DELETE FROM sync_issues WHERE seq = ?', [seq]);
    this.audit({ log, rowId: it.rowId, action: 'sync', summary: `${it.kind}: discarded my version` });
    this.changed(false);
  }

  /** retry a rejected row (e.g. after an admin fixed the permission) */
  retryRejected(seq: number) {
    const it = this.issues().find((x) => x.seq === seq);
    if (!it) return;
    this.db.run(`UPDATE ${q(it.log)} SET sync_dirty = 1 WHERE id = ? AND sync_dirty < 0`, [it.rowId]);
    this.db.run('DELETE FROM sync_issues WHERE seq = ?', [seq]);
    this.changed();
  }

  private patchMemory(log: LogKey, row: Row, deleted: boolean) {
    const rows = this.ds.logs[log].filter((r) => r.id !== row.id);
    if (!deleted) rows.push({ ...row });
    sortLog(log, rows);
    this.ds.logs = { ...this.ds.logs, [log]: rows };
  }

  /** call after a batch of applyRemote()/settings changes */
  remoteBatchDone() {
    this.changed(false);
  }

  cursor(table: string): string | null {
    return this.getMeta<string>('cursor.' + table);
  }
  setCursor(table: string, ts: string) {
    this.setMeta('cursor.' + table, ts);
  }

  // org settings
  settingsSync(): { rev: number; dirty: boolean } {
    return this.getMeta('sync.settings') ?? { rev: 0, dirty: false };
  }
  sharedSettings(): Record<string, unknown> {
    const s: Record<string, unknown> = { ...this.ds.settings };
    for (const k of LOCAL_SETTINGS) delete s[k];
    return s;
  }
  markSettingsPushed(rev: number) {
    this.setMeta('sync.settings', { rev, dirty: false });
  }
  applyRemoteSettings(data: Partial<Settings>, rev: number) {
    const st = this.settingsSync();
    if (rev <= st.rev) return;
    const cur = this.ds.settings;
    // sites are managed in the server's sites table, the local name stays local
    const next: Settings = { ...cur, ...data, userName: cur.userName, lists: { ...cur.lists, ...(data.lists ?? {}), sites: cur.lists.sites } };
    this.setMeta('settings', next);
    this.setMeta('sync.settings', { rev, dirty: false });
    this.ds.settings = next;
  }
  setSites(codes: string[]) {
    const cur = this.ds.settings;
    if (JSON.stringify(cur.lists.sites) === JSON.stringify(codes)) return;
    const next = { ...cur, lists: { ...cur.lists, sites: codes } };
    this.setMeta('settings', next);
    this.ds.settings = next;
  }

  // KPI targets
  targetsSync(): { revs: Record<string, number>; dirty: string[] } {
    return this.getMeta('sync.targets') ?? { revs: {}, dirty: [] };
  }
  private markTargetDirty(key: string) {
    const st = this.targetsSync();
    if (!st.dirty.includes(key)) st.dirty.push(key);
    this.setMeta('sync.targets', st);
  }
  markTargetPushed(key: string, rev: number) {
    const st = this.targetsSync();
    st.revs[key] = rev;
    st.dirty = st.dirty.filter((k) => k !== key);
    this.setMeta('sync.targets', st);
  }
  applyRemoteTarget(key: KpiKey, data: KpiTarget, rev: number) {
    const st = this.targetsSync();
    if (rev <= (st.revs[key] ?? 0)) return;
    const targets = { ...this.ds.targets, [key]: { ...data, key } };
    this.setMeta('targets', targets);
    st.revs[key] = rev;
    st.dirty = st.dirty.filter((k) => k !== key);
    this.setMeta('sync.targets', st);
    this.ds.targets = targets;
  }

  // audit upload
  unpushedAudit(limit = 500) {
    return this.all('SELECT * FROM audit WHERE pushed = 0 ORDER BY seq LIMIT ?', [limit]).map((r) => ({
      seq: Number(r.seq), ts: String(r.ts), user: String(r.user ?? ''), log: r.log === null ? null : String(r.log),
      rowId: r.row_id === null ? null : String(r.row_id), action: String(r.action), summary: r.summary === null ? null : String(r.summary),
      before: r.before ? JSON.parse(String(r.before)) : null, after: r.after ? JSON.parse(String(r.after)) : null,
    }));
  }
  markAuditPushed(maxSeq: number) {
    this.db.run('UPDATE audit SET pushed = 1 WHERE seq <= ?', [maxSeq]);
  }

  exportBytes(): Uint8Array {
    return this.db.export();
  }

  /** Write now (debounced writes call this); serialised so two saves never interleave. */
  flush(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const bytes = this.db.export();
    this.saving = this.saving.then(() =>
      this.persistence.save(bytes).then(
        () => { this.lastSaved = new Date(); this.saveError = null; },
        (e) => { this.saveError = String(e?.message ?? e); },
      ).finally(() => this.notify()),
    );
    return this.saving;
  }

  get pendingSave() {
    return this.saveTimer !== null;
  }
}

function toRow(log: LogKey, r: Record<string, SqlValue>): Row {
  const row: Row = { id: String(r.id) };
  for (const f of LOG_BY_KEY[log].fields) row[f.key] = r[f.key] ?? null;
  return row;
}

function toSql(v: unknown): SqlValue {
  if (v === undefined || v === '') return null;
  if (typeof v === 'number' || typeof v === 'string' || v === null) return v as SqlValue;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return JSON.stringify(v);
}

function sortLog(log: LogKey, rows: Row[]) {
  const def = LOG_BY_KEY[log];
  const k = def.codeField;
  rows.sort((a, b) => {
    if (k) return String(a[k] ?? '').localeCompare(String(b[k] ?? ''), undefined, { numeric: true });
    const da = String(a[def.dateField] ?? ''), db = String(b[def.dateField] ?? '');
    return da.localeCompare(db) || String(a.project ?? a.team ?? '').localeCompare(String(b.project ?? b.team ?? ''));
  });
}
