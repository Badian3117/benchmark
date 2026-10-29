// Permission & sync tests against a real PostgreSQL running the Supabase migration.
// Run with:  eval "$(scripts/test-db.sh start)" && tests/server/reset.sh && npm run test:server
import { execSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.PGURL;
const d = URL ? describe : describe.skip;

const U = {
  admin: '00000000-0000-0000-0000-00000000000a',
  exec: '00000000-0000-0000-0000-00000000000e',
  camara: '00000000-0000-0000-0000-0000000000c1', // PM on KGM
  diallo: '00000000-0000-0000-0000-0000000000d1', // PM on SIG
  pending: '00000000-0000-0000-0000-0000000000f1',
};

let db: pg.Client;

/** run SQL as a signed-in user, exactly as PostgREST would (role + JWT claims, one transaction) */
async function as<T = unknown>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.query('begin');
  try {
    await db.query(`set local role authenticated`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })]);
    const r = await db.query(sql, params);
    await db.query('commit');
    return r.rows as T[];
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
type Res = { id: string; status: 'ok' | 'conflict' | 'denied'; rev?: number; reason?: string; server?: Record<string, unknown> };
async function push(user: string, table: string, rows: Record<string, unknown>[]): Promise<Res[]> {
  const r = await as<{ bm_push: Res[] }>(user, 'select bm_push($1, $2::jsonb)', [table, JSON.stringify(rows)]);
  return r[0].bm_push;
}
const visible = async (user: string, table: string) =>
  (await as<{ id: string }>(user, `select id from "${table}" where not deleted order by id`)).map((r) => r.id);

const project = (id: string, code: string, site: string, pm: string, extra: Record<string, unknown> = {}) => ({
  id, base_rev: 0, code, name: code + ' name', site, pm, start: '2026-01-01', baselineFinish: '2026-12-31', status: 'Active', bac: 1000, ...extra,
});
const cost = (id: string, project: string, month: string, base_rev = 0) => ({ id, base_rev, month, project, budget: 100, pv: 100, ev: 95, ac: 98 });

d('BenchMark server permissions', () => {
  beforeAll(async () => {
    execSync('tests/server/reset.sh', { stdio: 'ignore' }); // each file starts from an empty database
    db = new pg.Client({ connectionString: URL });
    await db.connect();
    await db.query(`insert into auth.users (id, email) values
      ('${U.admin}', 'pc@corica.test'), ('${U.exec}', 'coo@corica.test'), ('${U.camara}', 'a.camara@corica.test'),
      ('${U.diallo}', 'm.diallo@corica.test'), ('${U.pending}', 'new@corica.test')`);
    await db.query(`update profiles set role = 'admin', owner_name = 'Project Controls' where id = '${U.admin}'`);
    await db.query(`update profiles set role = 'executive', owner_name = 'COO' where id = '${U.exec}'`);
    await db.query(`update profiles set role = 'pm', owner_name = 'A. Camara' where id = '${U.camara}'`);
    await db.query(`update profiles set role = 'pm', owner_name = 'M. Diallo' where id = '${U.diallo}'`);
    await db.query(`insert into sites (code, name) values ('KGM', 'Kouroussa'), ('SIG', 'Siguiri')`);
    await db.query(`insert into site_members values ('${U.camara}', 'KGM'), ('${U.diallo}', 'SIG')`);
  });
  afterAll(async () => db?.end());

  it('creates a pending profile for every new auth user', async () => {
    const r = await db.query(`select role from profiles where id = '${U.pending}'`);
    expect(r.rows[0].role).toBe('pending');
  });

  it('admin creates projects on any site; rev and site are stamped by the server', async () => {
    const r = await push(U.admin, 'projects', [project('p1', 'P01', 'KGM', 'A. Camara'), project('p2', 'P02', 'SIG', 'M. Diallo')]);
    expect(r.map((x) => [x.status, x.rev])).toEqual([['ok', 1], ['ok', 1]]);
    const row = (await db.query(`select site_id, updated_by from projects where id = 'p1'`)).rows[0];
    expect(row).toEqual({ site_id: 'KGM', updated_by: U.admin });
  });

  it('a pending user sees nothing and can write nothing', async () => {
    expect(await visible(U.pending, 'projects')).toEqual([]);
    expect((await push(U.pending, 'projects', [project('px', 'PX', 'KGM', 'A. Camara')]))[0].status).toBe('denied');
  });

  it('PMs read only their own sites; executives read everything', async () => {
    expect(await visible(U.camara, 'projects')).toEqual(['p1']);
    expect(await visible(U.diallo, 'projects')).toEqual(['p2']);
    expect(await visible(U.exec, 'projects')).toEqual(['p1', 'p2']);
  });

  it('executives (MD, CEO, COO, group managers) cannot write', async () => {
    expect((await push(U.exec, 'costSchedule', [cost('c0', 'P01', '2026-10-01')]))[0].status).toBe('denied');
  });

  it('a PM writes records of their own projects only', async () => {
    const r = await push(U.camara, 'costSchedule', [cost('c1', 'P01', '2026-10-01'), cost('c2', 'P02', '2026-10-01')]);
    expect(r.map((x) => x.status)).toEqual(['ok', 'denied']);
    expect(await visible(U.diallo, 'costSchedule')).toEqual([]); // other site: invisible
  });

  it('a PM cannot create a project for someone else, on another site, or hand theirs over', async () => {
    const r = await push(U.camara, 'projects', [
      project('p3', 'P03', 'SIG', 'A. Camara'),
      project('p4', 'P04', 'KGM', 'M. Diallo'),
      { ...project('p1', 'P01', 'KGM', 'M. Diallo'), base_rev: 1 },
    ]);
    expect(r.map((x) => x.status)).toEqual(['denied', 'denied', 'denied']);
  });

  it('detects concurrent edits instead of overwriting (optimistic concurrency)', async () => {
    const first = await push(U.camara, 'projects', [{ ...project('p1', 'P01', 'KGM', 'A. Camara', { eac: 1100 }), base_rev: 1 }]);
    expect(first[0]).toMatchObject({ status: 'ok', rev: 2 });
    // a second laptop still based on rev 1
    const stale = await push(U.camara, 'projects', [{ ...project('p1', 'P01', 'KGM', 'A. Camara', { eac: 1200 }), base_rev: 1 }]);
    expect(stale[0].status).toBe('conflict');
    expect(stale[0].server).toMatchObject({ rev: 2, eac: 1100 });
  });

  it('site-scoped logs (resources, CI) require a site the PM belongs to', async () => {
    const res = (id: string, site: string | null) => ({ id, base_rev: 0, month: '2026-10-01', site, team: 'Drill crew', available: 100, allocated: 80 });
    const r = await push(U.camara, 'resources', [res('r1', 'KGM'), res('r2', 'SIG'), res('r3', null)]);
    expect(r.map((x) => x.status)).toEqual(['ok', 'denied', 'denied']);
    expect(r[2].reason).toMatch(/BM_NO_SITE/);
  });

  it('corrective actions without a project are attached to the PM’s site', async () => {
    const a = (id: string, project: string | null, site: string | null) => ({ id, base_rev: 0, code: id, raised: '2026-10-05', kpi: 'sv', project, site, rootCause: 'x', action: 'y', owner: 'A. Camara', due: '2026-11-01', status: 'Open' });
    const r = await push(U.camara, 'actions', [a('a1', 'P01', null), a('a2', null, 'KGM'), a('a3', 'P02', null)]);
    expect(r.map((x) => x.status)).toEqual(['ok', 'ok', 'denied']);
  });

  it('a locked period is read-only for everyone except admins', async () => {
    expect((await push(U.admin, 'org_settings', [{ id: 'org', base_rev: 0, data: { lockedThrough: '2026-09-01' } }]))[0].status).toBe('ok');
    const r = await push(U.camara, 'costSchedule', [cost('c3', 'P01', '2026-09-01'), cost('c4', 'P01', '2026-11-01')]);
    expect(r.map((x) => x.status)).toEqual(['denied', 'ok']);
    expect(r[0].reason).toMatch(/BM_LOCKED/);
    // moving an October record back into September is also blocked
    expect((await push(U.camara, 'costSchedule', [{ ...cost('c1', 'P01', '2026-09-01'), base_rev: 1 }]))[0].status).toBe('denied');
    expect((await push(U.admin, 'costSchedule', [cost('c5', 'P01', '2026-09-01')]))[0].status).toBe('ok');
  });

  it('rows cannot be hard-deleted; soft delete syncs as an update', async () => {
    await expect(as(U.camara, `delete from "costSchedule" where id = 'c4'`)).rejects.toThrow(/permission denied/);
    await expect(as(U.admin, `delete from "costSchedule" where id = 'c4'`)).rejects.toThrow(/permission denied/);
    expect((await db.query(`select count(*)::int as n from "costSchedule" where id = 'c4'`)).rows[0].n).toBe(1);
    const r = await push(U.camara, 'costSchedule', [{ ...cost('c4', 'P01', '2026-11-01', 1), deleted: true }]);
    expect(r[0]).toMatchObject({ status: 'ok', rev: 2 });
  });

  it('nobody can promote themselves or change their sites', async () => {
    await as(U.camara, `update profiles set role = 'admin' where id = '${U.camara}'`);
    await expect(as(U.camara, `insert into site_members values ('${U.camara}', 'SIG')`)).rejects.toThrow();
    expect((await db.query(`select role from profiles where id = '${U.camara}'`)).rows[0].role).toBe('pm');
  });

  it('only an admin re-assigns sites', async () => {
    await as(U.camara, `delete from site_members where user_id = '${U.diallo}'`);
    expect((await db.query(`select count(*)::int as n from site_members where user_id = '${U.diallo}'`)).rows[0].n).toBe(1);
    await as(U.admin, `delete from site_members where user_id = '${U.diallo}'`);
    await as(U.admin, `insert into site_members values ('${U.diallo}', 'SIG')`);
    expect((await db.query(`select count(*)::int as n from site_members where user_id = '${U.diallo}'`)).rows[0].n).toBe(1);
  });

  it('KPI targets: admin writes, everyone signed in reads', async () => {
    const t = { id: 'onTime', base_rev: 0, data: { key: 'onTime', direction: 'Higher', target: 0.9, amber: 0.8, owner: '' } };
    expect((await push(U.camara, 'kpi_targets', [t]))[0].status).toBe('denied');
    expect((await push(U.admin, 'kpi_targets', [t]))[0].status).toBe('ok');
    expect(await visible(U.diallo, 'kpi_targets')).toEqual(['onTime']);
  });

  it('the Power BI reporting role reads every site and cannot write', async () => {
    await db.query(`do $$ begin if not exists (select from pg_roles where rolname = 'powerbi_test') then create role powerbi_test login in role bm_reporting; end if; end $$`);
    await db.query('begin');
    try {
      await db.query('set local role powerbi_test');
      const r = await db.query(`select id from projects order by id`);
      expect(r.rows.map((x) => x.id)).toEqual(['p1', 'p2']);
      await expect(db.query(`update projects set eac = 0`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.query('rollback');
    }
  });

  it('the audit trail accepts only the caller’s own entries', async () => {
    const ins = (id: string, user: string) =>
      as(U.camara, `insert into audit (id, ts, user_id, action, summary) values ($1, now(), $2, 'update', 'x')`, [id, user]);
    await ins('dev1-1', U.camara);
    await expect(ins('dev1-2', U.diallo)).rejects.toThrow();
  });

  it('server timestamps support incremental pull', async () => {
    const before = (await db.query(`select now() as t`)).rows[0].t as Date;
    await push(U.camara, 'costSchedule', [cost('c6', 'P01', '2026-12-01')]);
    const rows = await as<{ id: string }>(U.camara, `select id from "costSchedule" where server_updated_at >= $1 order by server_updated_at`, [before]);
    expect(rows.map((r) => r.id)).toEqual(['c6']);
  });
});
