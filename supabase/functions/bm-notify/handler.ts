// BenchMark notification function (Supabase Edge Function).
//   POST /functions/v1/bm-notify?mode=critical   – hourly: new critical alerts only
//   POST /functions/v1/bm-notify?mode=digest     – daily: critical + serious per site
// Runs the app's own KPI/alert engine on the central data (service role: sees every
// site) and e-mails each person what their role and sites allow. No Deno globals here,
// so the tests run it in Node against a real PostgreSQL.
import { datasetFromServer, type WireRow } from '../_shared/benchmark/engine/wire.ts';
import { LOGS, type LogKey } from '../_shared/benchmark/engine/schema.ts';
import { buildEmails, type Recipient } from '../_shared/benchmark/notify/core.ts';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** shared secret sent by the scheduler in the x-bm-secret header */
  BM_CRON_SECRET?: string;
  RESEND_API_KEY?: string;
  /** e.g. "BenchMark <alerts@corica.com>" (a domain verified in Resend) */
  BM_MAIL_FROM?: string;
  RESEND_URL?: string;
  /** "1": build the e-mails but do not send them */
  BM_DRY_RUN?: string;
}

type Fetch = typeof fetch;

async function rest<T>(env: Env, f: Fetch, path: string, init: RequestInit = {}): Promise<T> {
  const res = await f(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

async function all<T>(env: Env, f: Fetch, table: string, query = ''): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest<T[]>(env, f, `${encodeURIComponent(table)}?select=*${query}&order=id.asc&limit=1000&offset=${offset}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  active: boolean;
  lang: string | null;
  notify_digest: boolean | null;
  notify_critical: boolean | null;
  site_members: { site_code: string }[];
}

export async function handle(req: Request, env: Env, f: Fetch = fetch, today = new Date().toISOString().slice(0, 10)): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (env.BM_CRON_SECRET && req.headers.get('x-bm-secret') !== env.BM_CRON_SECRET) return json(401, { error: 'unauthorized' });
  const mode = new URL(req.url).searchParams.get('mode') === 'digest' ? 'digest' : 'critical';
  try {
    const tables: Partial<Record<LogKey, WireRow[]>> = {};
    for (const def of LOGS) tables[def.key] = await all<WireRow>(env, f, def.key, '&deleted=eq.false');
    const [org] = await rest<{ data: object }[]>(env, f, 'org_settings?select=data&id=eq.org');
    const targets = await rest<{ id: string; data: never }[]>(env, f, 'kpi_targets?select=id,data');
    const sites = (await rest<{ code: string }[]>(env, f, 'sites?select=code&active=eq.true&order=code.asc')).map((s) => s.code);
    const ds = datasetFromServer({ tables, orgSettings: org?.data ?? null, targets, sites, today });

    const profiles = await rest<ProfileRow[]>(env, f, 'profiles?select=*,site_members(site_code)&active=eq.true');
    const recipients: Recipient[] = profiles
      .filter((p) => p.email && (p.role === 'admin' || p.role === 'executive' || p.role === 'pm'))
      .map((p) => ({
        userId: p.id, email: p.email!, name: p.full_name || p.email!, role: p.role as Recipient['role'],
        sites: (p.site_members ?? []).map((m) => m.site_code), lang: p.lang === 'fr' ? 'fr' : 'en',
        digest: p.notify_digest !== false, critical: p.notify_critical !== false,
      }));

    const sent = new Map<string, Set<string>>();
    if (mode === 'critical') {
      const since = new Date(Date.parse(today) - 62 * 86_400_000).toISOString();
      for (const s of await rest<{ user_id: string; key: string }[]>(env, f, `notifications_sent?select=user_id,key&sent_at=gte.${since}`)) {
        if (!sent.has(s.user_id)) sent.set(s.user_id, new Set());
        sent.get(s.user_id)!.add(s.key);
      }
    }

    const emails = buildEmails(ds, recipients, mode, today, sent);
    let delivered = 0;
    const failures: string[] = [];
    for (const e of emails) {
      if (env.BM_DRY_RUN !== '1') {
        if (!env.RESEND_API_KEY || !env.BM_MAIL_FROM) throw new Error('RESEND_API_KEY and BM_MAIL_FROM must be set');
        const res = await f(env.RESEND_URL ?? 'https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: env.BM_MAIL_FROM, to: [e.to], subject: e.subject, html: e.html, text: e.text }),
        });
        if (!res.ok) { failures.push(`${e.to}: ${res.status} ${await res.text()}`); continue; }
      }
      delivered++;
      // remember what was reported, so the hourly run does not repeat it
      if (e.keys.length && env.BM_DRY_RUN !== '1')
        await rest(env, f, 'notifications_sent', {
          method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(e.keys.map((key) => ({ user_id: e.userId, key }))),
        });
    }
    return json(failures.length ? 207 : 200, { mode, today, recipients: recipients.length, emails: emails.length, delivered, failures, preview: env.BM_DRY_RUN === '1' ? emails.map((e) => ({ to: e.to, subject: e.subject })) : undefined });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
}
