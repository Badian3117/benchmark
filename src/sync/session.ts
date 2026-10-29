// Server connection, sign-in (email + password, or Microsoft 365) and the signed-in
// user's profile. The profile is cached so a PM can open the app and keep working
// with no network; sync resumes when the connection comes back.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Role, Who } from '../engine/permissions.ts';
import { desktop } from '../data/persistence.ts';

export interface ServerConfig {
  url: string;
  anonKey: string;
}

const CFG_KEY = 'bm.server';
const safe = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* unavailable */ } },
};

/** Configured in Settings › Server, or baked into the build (VITE_BM_SUPABASE_URL / VITE_BM_SUPABASE_ANON_KEY). */
export function serverConfig(): ServerConfig | null {
  const saved = safe.get(CFG_KEY);
  if (saved) {
    try {
      const c = JSON.parse(saved) as ServerConfig;
      if (c.url && c.anonKey) return c;
    } catch { /* ignore */ }
  }
  const env = import.meta.env;
  if (env?.VITE_BM_SUPABASE_URL && env?.VITE_BM_SUPABASE_ANON_KEY) return { url: env.VITE_BM_SUPABASE_URL, anonKey: env.VITE_BM_SUPABASE_ANON_KEY };
  return null;
}
export function builtInServer(): boolean {
  return !!import.meta.env?.VITE_BM_SUPABASE_URL;
}
export function saveServerConfig(c: ServerConfig | null) {
  safe.set(CFG_KEY, c ? JSON.stringify({ url: c.url.trim().replace(/\/$/, ''), anonKey: c.anonKey.trim() }) : null);
}

let client: SupabaseClient | null = null;
export function supabase(cfg: ServerConfig): SupabaseClient {
  if (!client) {
    client = createClient(cfg.url, cfg.anonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'bm.auth' },
    });
  }
  return client;
}

const REDIRECT_DESKTOP = 'benchmark://auth/callback';

export async function signInWithPassword(sb: SupabaseClient, email: string, password: string) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

/** Microsoft 365 (Azure / Entra ID) single sign-on through the system browser. */
export async function signInWithMicrosoft(sb: SupabaseClient) {
  const redirectTo = desktop ? REDIRECT_DESKTOP : location.origin + location.pathname;
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'azure',
    options: { redirectTo, scopes: 'openid email profile', skipBrowserRedirect: !!desktop },
  });
  if (error) throw error;
  if (desktop && data.url) await desktop.openExternal(data.url);
}

/** Finish a Microsoft sign-in: the desktop app receives benchmark://auth/callback?code=…, the preview gets ?code= */
export function listenForOAuthCallback(sb: SupabaseClient, onError: (e: string) => void) {
  const finish = async (url: string) => {
    const u = new URL(url);
    const code = u.searchParams.get('code');
    const err = u.searchParams.get('error_description') ?? u.searchParams.get('error');
    if (err) return onError(err);
    if (!code) return;
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) onError(error.message);
  };
  if (desktop) desktop.onAuthCallback((url) => void finish(url));
  else if (new URLSearchParams(location.search).has('code')) {
    void finish(location.href).then(() => history.replaceState(null, '', location.pathname));
  }
}

export async function currentSession(sb: SupabaseClient): Promise<Session | null> {
  return (await sb.auth.getSession()).data.session;
}

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  owner_name: string | null;
  role: Role;
  active: boolean;
  site_members: { site_code: string }[];
}

/** The signed-in user's role and sites – from the server, or the cached copy when offline. */
export async function loadProfile(cfg: ServerConfig, session: Session): Promise<{ who: Who; offline: boolean }> {
  const cacheKey = 'bm.profile.' + session.user.id;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/profiles?id=eq.${session.user.id}&select=*,site_members(site_code)`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) throw new Error(String(res.status));
    const [p] = (await res.json()) as ProfileRow[];
    const who: Who = {
      userId: session.user.id,
      email: p?.email ?? session.user.email ?? '',
      fullName: p?.full_name ?? '',
      owner: p?.owner_name ?? '',
      role: p && p.active ? p.role : 'pending',
      sites: (p?.site_members ?? []).map((m) => m.site_code).sort(),
    };
    safe.set(cacheKey, JSON.stringify(who));
    return { who, offline: false };
  } catch (e) {
    const cached = safe.get(cacheKey);
    if (cached) return { who: JSON.parse(cached) as Who, offline: true };
    throw e;
  }
}

export async function signOut(sb: SupabaseClient) {
  await sb.auth.signOut({ scope: 'local' });
}
