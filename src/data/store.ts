// Local database: SQLite (sql.js / WebAssembly) holding one table per log with typed
// columns, a meta table (settings, targets) and an audit trail of every change.
// Rows carry a UUID, updated_at and a soft-delete flag so Phase 2 can sync them.
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { todayISO } from '../engine/dates.ts';
import { DEFAULT_TARGETS, type Dataset, type KpiKey, type KpiTarget } from '../engine/kpis.ts';
import { LOGS, LOG_BY_KEY, DEFAULT_LISTS, defaultSettings, type LogKey, type Row, type Settings } from '../engine/schema.ts';
import { getPersistence, type Persistence } from './persistence.ts';

const NUMERIC = new Set(['number', 'money', 'percent', 'score']);
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

export interface AuditEntry {
  ts: string;
  user: string;
  log: string;
  rowId: string;
  action: 'create' | 'update' | 'delete' | 'import' | 'target' | 'settings';
  summary: string;
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

  private constructor(db: Database, persistence: Persistence) {
    this.db = db;
    this.persistence = persistence;
    this.migrate();
    this.ds = this.read();
  }

  static async open(): Promise<Store> {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const persistence = getPersistence();
    const bytes = await persistence.load();
    const store = new Store(bytes ? new SQL.Database(bytes) : new SQL.Database(), persistence);
    if (!bytes) store.flush();
    return store;
  }

  /** Read a backup file into a dataset (does not touch the open database). */
  static async fromBytes(bytes: Uint8Array): Promise<Dataset> {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
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
  private notify() {
    this.tick++;
    for (const fn of this.listeners) fn();
  }

  // ---------- schema ----------
  private migrate() {
    const d = this.db;
    d.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    d.run(`CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user TEXT,
           log TEXT, row_id TEXT, action TEXT NOT NULL, summary TEXT, before TEXT, after TEXT)`);
    for (const def of LOGS) {
      d.run(`CREATE TABLE IF NOT EXISTS ${q(def.key)} (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`);
      const have = new Set(this.all(`PRAGMA table_info(${q(def.key)})`).map((r) => String(r.name)));
      for (const f of def.fields)
        if (!have.has(f.key)) d.run(`ALTER TABLE ${q(def.key)} ADD COLUMN ${q(f.key)} ${NUMERIC.has(f.type) ? 'REAL' : 'TEXT'}`);
    }
    d.run(`INSERT OR IGNORE INTO meta (key, value) VALUES ('schemaVersion', '1')`);
  }

  private all(sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
    const st = this.db.prepare(sql);
    st.bind(params);
    const out: Record<string, SqlValue>[] = [];
    while (st.step()) out.push(st.getAsObject());
    st.free();
    return out;
  }

  private getMeta<T>(key: string): T | null {
    const r = this.all('SELECT value FROM meta WHERE key = ?', [key])[0];
    return r ? (JSON.parse(String(r.value)) as T) : null;
  }
  private setMeta(key: string, value: unknown) {
    this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
  }

  private read(): Dataset {
    const base = defaultSettings(todayISO());
    const saved = this.getMeta<Partial<Settings>>('settings') ?? {};
    const settings: Settings = { ...base, ...saved, lists: { ...DEFAULT_LISTS, ...base.lists, ...(saved.lists ?? {}) } };
    const targets = { ...structuredClone(DEFAULT_TARGETS), ...(this.getMeta<Record<KpiKey, KpiTarget>>('targets') ?? {}) };
    const logs = {} as Record<LogKey, Row[]>;
    for (const def of LOGS) {
      logs[def.key] = this.all(`SELECT * FROM ${q(def.key)} WHERE deleted = 0`).map((r) => {
        const row: Row = { id: String(r.id) };
        for (const f of def.fields) row[f.key] = r[f.key] ?? null;
        return row;
      });
      sortLog(def.key, logs[def.key]);
    }
    return { settings, targets, logs };
  }

  // ---------- mutations ----------
  private changed() {
    this.version++;
    this.ds = { ...this.ds }; // new identity for React memo dependencies
    this.notify();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  private audit(e: Omit<AuditEntry, 'ts' | 'user'>, before?: unknown, after?: unknown) {
    this.db.run('INSERT INTO audit (ts, user, log, row_id, action, summary, before, after) VALUES (?,?,?,?,?,?,?,?)', [
      new Date().toISOString(), this.ds?.settings.userName || '', e.log, e.rowId, e.action, e.summary,
      before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after),
    ]);
  }

  private writeRow(log: LogKey, row: Row) {
    const def = LOG_BY_KEY[log];
    const cols = ['id', 'updated_at', 'deleted', ...def.fields.map((f) => f.key)];
    const vals: SqlValue[] = [row.id, new Date().toISOString(), 0, ...def.fields.map((f) => toSql(row[f.key]))];
    this.db.run(
      `INSERT INTO ${q(log)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})
       ON CONFLICT(id) DO UPDATE SET ${cols.slice(1).map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`,
      vals,
    );
  }

  upsert(log: LogKey, row: Row) {
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
    this.db.run(`UPDATE ${q(log)} SET deleted = 1, updated_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
    const code = LOG_BY_KEY[log].codeField;
    this.audit({ log, rowId: id, action: 'delete', summary: String((code && before[code]) || id) }, before);
    this.ds.logs = { ...this.ds.logs, [log]: this.ds.logs[log].filter((r) => r.id !== id) };
    this.changed();
  }

  setSettings(s: Settings) {
    const before = this.ds.settings;
    this.setMeta('settings', s);
    this.audit({ log: 'settings', rowId: '', action: 'settings', summary: 'settings' }, before, s);
    this.ds.settings = s;
    this.changed();
  }

  /** Target changes always go together with a Target_Revisions entry (audit trail). */
  setTarget(t: KpiTarget, revision: Row) {
    const before = this.ds.targets[t.key];
    const targets = { ...this.ds.targets, [t.key]: t };
    this.setMeta('targets', targets);
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
    this.ds.targets = targets;
    this.changed();
  }

  /** Replace everything (Excel import, sample data, reset). */
  replaceAll(ds: Dataset, summary: string) {
    this.db.run('BEGIN');
    try {
      for (const def of LOGS) {
        this.db.run(`UPDATE ${q(def.key)} SET deleted = 1, updated_at = ? WHERE deleted = 0`, [new Date().toISOString()]);
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
    const da = String(a[def.dateField] ?? ''), db = String(b[def.dateField] ?? '');
    if (k) return String(a[k] ?? '').localeCompare(String(b[k] ?? ''), undefined, { numeric: true });
    return da.localeCompare(db) || String(a.project ?? a.team ?? '').localeCompare(String(b.project ?? b.team ?? ''));
  });
}
