// Admin API: users (profiles), their sites, and the site list. Row-level security only
// lets admins through; everyone else gets an empty list or a 403.
import type { Role } from '../engine/permissions.ts';
import type { ServerConfig } from './session.ts';

export interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  owner_name: string | null;
  role: Role;
  active: boolean;
  created_at: string;
  site_members: { site_code: string }[];
}
export interface Site {
  code: string;
  name: string | null;
  active: boolean;
}

export class AdminApi {
  private cfg: ServerConfig;
  private token: () => Promise<string | null>;
  constructor(cfg: ServerConfig, token: () => Promise<string | null>) {
    this.cfg = cfg;
    this.token = token;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.cfg.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.cfg.anonKey,
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  users() {
    return this.req<UserRow[]>('profiles?select=*,site_members(site_code)&order=created_at.asc');
  }
  updateUser(id: string, patch: Partial<Pick<UserRow, 'full_name' | 'owner_name' | 'role' | 'active'>>) {
    return this.req<null>(`profiles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }
  async setUserSites(id: string, sites: string[]) {
    await this.req<null>(`site_members?user_id=eq.${id}`, { method: 'DELETE' });
    if (sites.length)
      await this.req<null>('site_members', { method: 'POST', body: JSON.stringify(sites.map((s) => ({ user_id: id, site_code: s }))) });
  }
  sites() {
    return this.req<Site[]>('sites?select=code,name,active&order=code.asc');
  }
  addSite(s: Site) {
    return this.req<null>('sites', { method: 'POST', body: JSON.stringify(s) });
  }
  updateSite(code: string, patch: Partial<Site>) {
    return this.req<null>(`sites?code=eq.${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }
}
