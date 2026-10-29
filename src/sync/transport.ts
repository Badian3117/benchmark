// HTTP transport to the Supabase REST API (PostgREST). The sync engine only talks to
// this interface, so tests can substitute a transport backed directly by Postgres.
import type { WireRow } from '../data/store.ts';

export interface PushResult {
  id: string;
  status: 'ok' | 'conflict' | 'denied';
  rev?: number;
  reason?: string;
  server?: WireRow;
}

export interface SiteRow {
  code: string;
  name: string | null;
  active: boolean;
}

export interface AuditRow {
  id: string;
  ts: string;
  user_name: string;
  log: string | null;
  row_id: string | null;
  action: string;
  summary: string | null;
  before: unknown;
  after: unknown;
}

export interface Transport {
  push(table: string, rows: WireRow[]): Promise<PushResult[]>;
  /** rows changed at or after `since` (server time), oldest first */
  pull(table: string, since: string | null, offset: number, limit: number): Promise<(WireRow & { server_updated_at: string })[]>;
  fetchRow(table: string, id: string): Promise<WireRow | null>;
  sites(): Promise<SiteRow[]>;
  pushAudit(rows: AuditRow[]): Promise<void>;
}

export class TransportError extends Error {
  readonly kind: 'offline' | 'auth' | 'server';
  readonly status: number;
  constructor(message: string, kind: 'offline' | 'auth' | 'server', status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface RestConfig {
  url: string; // https://<project>.supabase.co
  anonKey: string;
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export class RestTransport implements Transport {
  private cfg: RestConfig;
  constructor(cfg: RestConfig) {
    this.cfg = cfg;
  }

  private async req(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.cfg.token();
    if (!token) throw new TransportError('Not signed in', 'auth', 401);
    let res: Response;
    try {
      res = await (this.cfg.fetch ?? fetch)(`${this.cfg.url.replace(/\/$/, '')}/rest/v1/${path}`, {
        ...init,
        headers: {
          apikey: this.cfg.anonKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (e) {
      throw new TransportError(String((e as Error)?.message ?? e), 'offline');
    }
    if (res.status === 401 || res.status === 403) throw new TransportError(await res.text(), 'auth', res.status);
    if (!res.ok) throw new TransportError(`${res.status} ${await res.text()}`, 'server', res.status);
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async push(table: string, rows: WireRow[]) {
    return (await this.req('rpc/bm_push', { method: 'POST', body: JSON.stringify({ p_table: table, p_rows: rows }) })) as PushResult[];
  }

  async pull(table: string, since: string | null, offset: number, limit: number) {
    const p = new URLSearchParams({ select: '*', order: 'server_updated_at.asc,id.asc', limit: String(limit), offset: String(offset) });
    if (since) p.set('server_updated_at', `gte.${since}`);
    return (await this.req(`${encodeURIComponent(table)}?${p}`)) as (WireRow & { server_updated_at: string })[];
  }

  async fetchRow(table: string, id: string) {
    const rows = (await this.req(`${encodeURIComponent(table)}?select=*&id=eq.${encodeURIComponent(id)}`)) as WireRow[];
    return rows[0] ?? null;
  }

  async sites() {
    return (await this.req('sites?select=code,name,active&order=code.asc')) as SiteRow[];
  }

  async pushAudit(rows: AuditRow[]) {
    if (!rows.length) return;
    await this.req('audit', { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } });
  }
}
