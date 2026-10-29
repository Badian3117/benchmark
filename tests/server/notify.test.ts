// The bm-notify server function, end to end: real handler, real schema and data in
// PostgreSQL behind the PostgREST stand-in, and a fake e-mail API capturing what is sent.
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sample from '../../src/data/sample.json';
import { handle, type Env } from '../../supabase/functions/bm-notify/handler.ts';

const URL_ = process.env.PGURL;
const d = URL_ ? describe : describe.skip;
const TODAY = '2026-10-29';
const KGM = 'KGM – Kouroussa', SIG = 'Siguiri Services';
const U = {
  admin: '30000000-0000-0000-0000-00000000000a', coo: '30000000-0000-0000-0000-00000000000e',
  camara: '30000000-0000-0000-0000-0000000000c1', diallo: '30000000-0000-0000-0000-0000000000d1', quiet: '30000000-0000-0000-0000-0000000000f1',
};

let db: pg.Client;
let fake: ChildProcess;
let mail: http.Server;
let mailUrl = '';
const inbox: { to: string[]; subject: string; html: string; text: string }[] = [];
const env = (): Env => ({
  SUPABASE_URL: 'http://localhost:54331', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test', BM_CRON_SECRET: 'cron-secret',
  RESEND_API_KEY: 're_test', BM_MAIL_FROM: 'BenchMark <alerts@corica.test>', RESEND_URL: mailUrl,
});
const call = (mode: string, e: Partial<Env> = {}, secret = 'cron-secret') =>
  handle(new Request(`http://fn/bm-notify?mode=${mode}`, { method: 'POST', headers: { 'x-bm-secret': secret } }), { ...env(), ...e }, fetch, TODAY);

d('bm-notify (server e-mail notifications)', () => {
  beforeAll(async () => {
    execSync('tests/server/reset.sh', { stdio: 'ignore' });
    db = new pg.Client({ connectionString: URL_ });
    await db.connect();
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values
      ('${U.admin}', 'pc@corica.test', '{"full_name":"Project Controls"}'), ('${U.coo}', 'coo@corica.test', '{"full_name":"COO"}'),
      ('${U.camara}', 'camara@corica.test', '{"full_name":"A. Camara"}'), ('${U.diallo}', 'diallo@corica.test', '{"full_name":"M. Diallo"}'),
      ('${U.quiet}', 'quiet@corica.test', '{"full_name":"Quiet"}')`);
    await db.query(`update profiles set role = 'admin' where id = '${U.admin}'`);
    await db.query(`update profiles set role = 'executive' where id = '${U.coo}'`);
    await db.query(`update profiles set role = 'pm' where id in ('${U.camara}', '${U.diallo}', '${U.quiet}')`);
    await db.query(`update profiles set lang = 'fr' where id = '${U.diallo}'`);
    await db.query(`update profiles set notify_critical = false, notify_digest = false where id = '${U.quiet}'`);
    await db.query(`insert into sites (code) values ($1), ($2)`, [KGM, SIG]);
    await db.query(`insert into site_members values ('${U.camara}', $1), ('${U.quiet}', $1), ('${U.diallo}', $2)`, [KGM, SIG]);
    // load the sample portfolio exactly as a sync would (admin, bm_push), projects first
    const logs = (sample as unknown as { logs: Record<string, Record<string, unknown>[]> }).logs;
    for (const t of ['projects', ...Object.keys(logs).filter((k) => k !== 'projects')]) {
      await db.query('begin');
      await db.query('set local role authenticated');
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.admin })]);
      const r = await db.query('select bm_push($1, $2::jsonb) as r', [t, JSON.stringify(logs[t].map((x) => ({ ...x, base_rev: 0 })))]);
      await db.query('commit');
      expect((r.rows[0].r as { status: string }[]).every((x) => x.status === 'ok')).toBe(true);
    }
    fake = spawn('node', ['tests/server/fake-supabase.mjs', '54331'], { env: { ...process.env }, stdio: 'ignore' });
    mail = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        inbox.push(JSON.parse(b));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"id":"x"}');
      });
    }).listen(0);
    mailUrl = `http://localhost:${(mail.address() as AddressInfo).port}/emails`;
    for (let i = 0; i < 40; i++) {
      try { await fetch('http://localhost:54331/rest/v1/x'); break; } catch { await new Promise((r) => setTimeout(r, 150)); }
    }
  });
  afterAll(async () => {
    fake?.kill();
    mail?.close();
    await db?.end();
  });

  it('refuses calls without the scheduler secret', async () => {
    expect((await call('critical', {}, 'wrong')).status).toBe(401);
  });

  it('dry run previews the e-mails without sending anything', async () => {
    const r = await (await call('critical', { BM_DRY_RUN: '1' })).json();
    expect(r.emails).toBeGreaterThan(0);
    expect(inbox).toHaveLength(0);
  });

  it('hourly run: new critical alerts go to the people allowed to see them', async () => {
    const r = await (await call('critical')).json();
    expect(r.failures).toEqual([]);
    const to = inbox.map((m) => m.to[0]).sort();
    // the critical gate delays are on the KGM contract: admin, COO and the KGM PM are told;
    // the Siguiri PM is not, and nor is the PM who switched e-mails off
    expect(to).toEqual(['camara@corica.test', 'coo@corica.test', 'pc@corica.test']);
    const m = inbox.find((x) => x.to[0] === 'camara@corica.test')!;
    expect(m.subject).toMatch(/critical/);
    expect(m.text).toContain('G-0125');
    expect(m.html).toContain(KGM);
  });

  it('the next hourly run does not repeat what was already sent', async () => {
    inbox.length = 0;
    const r = await (await call('critical')).json();
    expect(r.emails).toBe(0);
    expect(inbox).toHaveLength(0);
  });

  it('a new critical alert is sent once, then remembered', async () => {
    // a lost-time injury is recorded on the KGM contract for this month
    await db.query(`update safety set lti = 1 where project = 'P09' and month = '2026-10-01'`);
    const r = await (await call('critical')).json();
    expect(r.emails).toBe(3);
    expect(inbox.every((m) => /lost-time/.test(m.text))).toBe(true);
    inbox.length = 0;
    expect((await (await call('critical')).json()).emails).toBe(0);
  });

  it('daily digest: per site, in the person’s language, critical + serious', async () => {
    inbox.length = 0;
    const r = await (await call('digest')).json();
    expect(r.failures).toEqual([]);
    const dia = inbox.find((m) => m.to[0] === 'diallo@corica.test')!;
    expect(dia.subject).toMatch(/synthèse/);
    expect(dia.html).toContain(SIG);
    expect(dia.html).not.toContain(KGM);
    const coo = inbox.find((m) => m.to[0] === 'coo@corica.test')!;
    expect(coo.html).toContain(KGM);
    expect(coo.html).toContain(SIG);
    expect(inbox.some((m) => m.to[0] === 'quiet@corica.test')).toBe(false);
  });
});
