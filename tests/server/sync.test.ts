// End-to-end sync: several "laptops" (real Store instances) syncing through the real
// Postgres schema, each signed in as a different user.
//   eval "$(scripts/test-db.sh start)" && npm run test:server
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeTracking, type Dataset } from '../../src/engine/kpis.ts';
import { Store, type WireRow } from '../../src/data/store.ts';
import { SyncEngine } from '../../src/sync/engine.ts';
import { TransportError, type AuditRow, type PushResult, type Transport } from '../../src/sync/transport.ts';
import sample from '../../src/data/sample.json';

const URL = process.env.PGURL;
const d = URL ? describe : describe.skip;
const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const TODAY = '2026-10-29';

const U = {
  admin: '10000000-0000-0000-0000-00000000000a',
  coo: '10000000-0000-0000-0000-00000000000e',
  camara: '10000000-0000-0000-0000-0000000000c1',
  diallo: '10000000-0000-0000-0000-0000000000d1',
};
const KGM = 'KGM – Kouroussa', SIG = 'Siguiri Services';

let db: pg.Client;

/** Transport that runs exactly the SQL PostgREST would, as the given user. */
class PgTransport implements Transport {
  offline = false;
  private user: string;
  constructor(user: string) {
    this.user = user;
  }
  private async as<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (this.offline) throw new TransportError('network down', 'offline');
    await db.query('begin');
    try {
      await db.query('set local role authenticated');
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: this.user, role: 'authenticated' })]);
      const r = await db.query(sql, params);
      await db.query('commit');
      return r.rows as T[];
    } catch (e) {
      await db.query('rollback');
      throw e;
    }
  }
  async push(table: string, rows: WireRow[]) {
    return (await this.as<{ r: PushResult[] }>('select bm_push($1, $2::jsonb) as r', [table, JSON.stringify(rows)]))[0].r;
  }
  async pull(table: string, since: string | null, offset: number, limit: number) {
    const rows = await this.as<{ j: WireRow & { server_updated_at: string } }>(
      `select to_jsonb(t) as j from "${table}" t where ($1::timestamptz is null or server_updated_at >= $1) order by server_updated_at, id limit $2 offset $3`,
      [since, limit, offset],
    );
    return rows.map((r) => r.j);
  }
  async fetchRow(table: string, id: string) {
    return (await this.as<{ j: WireRow }>(`select to_jsonb(t) as j from "${table}" t where id = $1`, [id]))[0]?.j ?? null;
  }
  async sites() {
    return this.as<{ code: string; name: string | null; active: boolean }>('select code, name, active from sites order by code');
  }
  async pushAudit(rows: AuditRow[]) {
    for (const a of rows)
      await this.as(`insert into audit (id, ts, user_name, log, row_id, action, summary, before, after) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
        [a.id, a.ts, a.user_name, a.log, a.row_id, a.action, a.summary, JSON.stringify(a.before), JSON.stringify(a.after)]);
  }
}

async function laptop(user: string) {
  const store = await Store.open({ persistence: { kind: 'browser', load: async () => null, save: async () => {} }, locateFile: () => wasm });
  store.connected = true;
  const transport = new PgTransport(user);
  const sync = new SyncEngine(store, transport, { overlapMs: 120_000 });
  return { store, transport, sync };
}
const codes = (s: Store) => s.ds.logs.projects.map((p) => p.code).sort();
const project = (s: Store, code: string) => s.ds.logs.projects.find((p) => p.code === code)!;

d('BenchMark sync', () => {
  let admin: Awaited<ReturnType<typeof laptop>>;
  beforeAll(async () => {
    execSync('tests/server/reset.sh', { stdio: 'ignore' }); // each file starts from an empty database
    db = new pg.Client({ connectionString: URL });
    await db.connect();
    await db.query(`insert into auth.users (id, email) values ('${U.admin}','pc@x'),('${U.coo}','coo@x'),('${U.camara}','ac@x'),('${U.diallo}','md@x') on conflict do nothing`);
    await db.query(`update profiles set role='admin', owner_name='Project Controls' where id='${U.admin}'`);
    await db.query(`update profiles set role='executive', owner_name='COO' where id='${U.coo}'`);
    await db.query(`update profiles set role='pm', owner_name='A. Camara' where id='${U.camara}'`);
    await db.query(`update profiles set role='pm', owner_name='M. Diallo' where id='${U.diallo}'`);
    await db.query(`insert into sites (code) values ($1), ($2) on conflict do nothing`, [KGM, SIG]);
    await db.query(`insert into site_members values ('${U.camara}', $1), ('${U.diallo}', $2) on conflict do nothing`, [KGM, SIG]);
    admin = await laptop(U.admin);
  });
  afterAll(async () => db?.end());

  it('admin uploads the whole portfolio; every record is accepted', async () => {
    const ds = structuredClone(sample) as unknown as Dataset;
    admin.store.mergeRows(ds.logs, 'initial upload');
    admin.store.setSettings({ ...admin.store.ds.settings, orgName: ds.settings.orgName, yearStart: ds.settings.yearStart, lists: ds.settings.lists });
    const rep = await admin.sync.run();
    const total = Object.values(ds.logs).reduce((a, r) => a + r.length, 0);
    expect(admin.sync.status.state).toBe('idle');
    expect(rep).toMatchObject({ rejected: 0, conflicts: 0 });
    expect(rep.pushed).toBe(total + 1); // + org settings
    expect(admin.store.pendingCount()).toBe(0);
  });

  it('a PM receives only their site; an executive receives everything', async () => {
    const camara = await laptop(U.camara);
    await camara.sync.run();
    expect(codes(camara.store)).toEqual(['P01', 'P04', 'P07', 'P09']);
    expect(camara.store.ds.logs.costSchedule.every((r) => ['P01', 'P04', 'P07', 'P09'].includes(String(r.project)))).toBe(true);
    expect(camara.store.ds.settings.lists.sites).toEqual([KGM, SIG].sort());
    expect(camara.store.ds.settings.orgName).toBe(sample.settings.orgName);

    const coo = await laptop(U.coo);
    await coo.sync.run();
    expect(codes(coo.store)).toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09']);
  });

  it('the executive sees exactly the same KPI numbers as the source data', async () => {
    const coo = await laptop(U.coo);
    await coo.sync.run();
    const a = computeTracking(admin.store.ds, '2026-10-01', null, TODAY);
    const b = computeTracking(coo.store.ds, '2026-10-01', null, TODAY);
    expect(b.rows).toEqual(a.rows);
  });

  it('concurrent edits on two laptops: second one gets a conflict, nothing is lost', async () => {
    const lap1 = await laptop(U.camara), lap2 = await laptop(U.camara);
    await lap1.sync.run();
    await lap2.sync.run();
    lap1.store.upsert('projects', { ...project(lap1.store, 'P07'), eac: 970000 });
    lap2.store.upsert('projects', { ...project(lap2.store, 'P07'), eac: 990000 });
    await lap1.sync.run();
    const rep = await lap2.sync.run();
    expect(rep.conflicts).toBe(1);
    // the server value wins locally until the user decides …
    expect(project(lap2.store, 'P07').eac).toBe(970000);
    const [issue] = lap2.store.issues();
    expect(issue).toMatchObject({ kind: 'conflict', log: 'projects' });
    expect(issue.local?.eac).toBe(990000);
    // … the user keeps their own version, it reaches the other laptop
    lap2.store.keepMine(issue.seq);
    expect((await lap2.sync.run()).pushed).toBe(1);
    await lap1.sync.run();
    expect(project(lap1.store, 'P07').eac).toBe(990000);
    expect(lap2.store.issues()).toEqual([]);
  });

  it('an edit to another PM’s project is rejected and can be discarded', async () => {
    const camara = await laptop(U.camara);
    await camara.sync.run();
    const before = project(camara.store, 'P04').eac;
    camara.store.upsert('projects', { ...project(camara.store, 'P04'), eac: 1 });
    const rep = await camara.sync.run();
    expect(rep.rejected).toBe(1);
    const [issue] = camara.store.issues();
    expect(issue.kind).toBe('rejected');
    camara.store.dropIssue(issue.seq);
    await camara.sync.refetch('projects', project(camara.store, 'P04').id);
    expect(project(camara.store, 'P04').eac).toBe(before);
    expect(camara.store.pendingCount()).toBe(0);
  });

  it('works offline and catches up when the network returns', async () => {
    const camara = await laptop(U.camara);
    await camara.sync.run();
    camara.transport.offline = true;
    const p = project(camara.store, 'P01');
    camara.store.upsert('issues', { id: crypto.randomUUID(), code: 'I-900', project: 'P01', raised: '2026-10-28', description: 'Offline entry', status: 'Open' });
    await camara.sync.run();
    expect(camara.sync.status.state).toBe('offline');
    expect(camara.sync.status.pending).toBe(1);
    camara.transport.offline = false;
    expect((await camara.sync.run()).pushed).toBe(1);
    const coo = await laptop(U.coo);
    await coo.sync.run();
    expect(coo.store.ds.logs.issues.some((i) => i.code === 'I-900')).toBe(true);
    expect(p.code).toBe('P01');
  });

  it('target changes and the period lock come from the admin to everyone', async () => {
    const t = { ...admin.store.ds.targets.issueTime, target: 6 };
    admin.store.setTarget(t, { id: crypto.randomUUID(), date: TODAY, kpi: 'issueTime', before: '7', after: '6', reason: 'test', proposedBy: 'X', approvedBy: 'Y' });
    admin.store.setSettings({ ...admin.store.ds.settings, lockedThrough: '2026-09-01' });
    await admin.sync.run();
    const camara = await laptop(U.camara);
    await camara.sync.run();
    expect(camara.store.ds.targets.issueTime.target).toBe(6);
    expect(camara.store.ds.settings.lockedThrough).toBe('2026-09-01');
    // a PM cannot push a target or write into the locked month
    camara.store.setTarget({ ...camara.store.ds.targets.issueTime, target: 99 }, { id: crypto.randomUUID(), date: TODAY, kpi: 'issueTime', before: '6', after: '99', reason: 'x', proposedBy: 'X', approvedBy: 'Y' });
    const sep = camara.store.ds.logs.costSchedule.find((r) => r.project === 'P07' && r.month === '2026-09-01')!;
    camara.store.upsert('costSchedule', { ...sep, ac: 1 });
    const rep = await camara.sync.run();
    expect(rep.rejected).toBe(2); // the revision row + the locked cost row
    expect(camara.store.ds.targets.issueTime.target).toBe(6); // server target restored
    expect(camara.store.issues().map((i) => i.reason).join(' ')).toMatch(/BM_LOCKED/);
  });

  it('deletions sync as soft deletes', async () => {
    const camara = await laptop(U.camara);
    await camara.sync.run();
    const iss = camara.store.ds.logs.issues.find((i) => i.code === 'I-900')!;
    camara.store.remove('issues', iss.id);
    await camara.sync.run();
    const coo = await laptop(U.coo);
    await coo.sync.run();
    expect(coo.store.ds.logs.issues.some((i) => i.code === 'I-900')).toBe(false);
    const r = await db.query(`select deleted from issues where id = $1`, [iss.id]);
    expect(r.rows[0].deleted).toBe(true);
  });

  it('the audit trail reaches the server with the author', async () => {
    const r = await db.query(`select count(*)::int as n, count(distinct user_id)::int as users from audit`);
    expect(r.rows[0].n).toBeGreaterThan(5);
    expect(r.rows[0].users).toBeGreaterThanOrEqual(2);
  });

  it('refuses to wipe everything while connected', async () => {
    expect(() => admin.store.replaceAll(structuredClone(sample) as unknown as Dataset, 'x')).toThrow(/not allowed/);
  });
});
