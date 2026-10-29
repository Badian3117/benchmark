// GENERATED from src/engine/wire.ts by scripts/gen-functions.mjs – do not edit.
// Conversion between rows as stored by the server (PostgreSQL / PostgREST JSON) and the
// app's rows. Shared by the laptops (sync) and the server-side notification function.
import { todayISO } from './dates.ts';
import { DEFAULT_TARGETS, type Dataset, type KpiKey, type KpiTarget } from './kpis.ts';
import { DEFAULT_LISTS, LOGS, LOG_BY_KEY, defaultSettings, type LogKey, type Row, type Settings } from './schema.ts';

/** A row as exchanged with the server */
export interface WireRow {
  id: string;
  deleted: boolean;
  updated_at: string | null;
  base_rev?: number;
  rev?: number;
  [field: string]: unknown;
}

/** server row → app row (only the log's fields; dates normalised) */
export function fromWire(log: LogKey, w: WireRow): Row {
  const row: Row = { id: w.id };
  for (const f of LOG_BY_KEY[log].fields) {
    let v = w[f.key] ?? null;
    if ((f.type === 'date' || f.type === 'month') && typeof v === 'string') v = v.slice(0, 10);
    if (f.type === 'datetime' && typeof v === 'string') v = v.slice(0, 16);
    row[f.key] = v;
  }
  return row;
}

/** Build a dataset from full server tables (what the notification function reads). */
export function datasetFromServer(input: {
  tables: Partial<Record<LogKey, WireRow[]>>;
  orgSettings?: Partial<Settings> | null;
  targets?: { id: string; data: KpiTarget }[];
  sites?: string[];
  today?: string;
}): Dataset {
  const base = defaultSettings(input.today ?? todayISO());
  const org = input.orgSettings ?? {};
  const settings: Settings = { ...base, ...org, lists: { ...DEFAULT_LISTS, ...base.lists, ...(org.lists ?? {}) } };
  if (input.sites) settings.lists.sites = input.sites;
  const targets = structuredClone(DEFAULT_TARGETS);
  for (const t of input.targets ?? []) if (t.id in targets) targets[t.id as KpiKey] = { ...t.data, key: t.id as KpiKey };
  const logs = {} as Record<LogKey, Row[]>;
  for (const def of LOGS) logs[def.key] = (input.tables[def.key] ?? []).filter((r) => !r.deleted).map((r) => fromWire(def.key, r));
  return { settings, targets, logs };
}
