// Test-only stand-in for Supabase: the auth endpoints BenchMark calls and the subset of
// PostgREST it uses, executed against the real BenchMark schema in Postgres with the
// caller's identity (role authenticated + JWT claims), exactly as PostgREST does.
//   PGURL=… node tests/server/fake-supabase.mjs 54321
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.argv[2] ?? 54321);
const SECRET = 'test-secret';
/** the service role key bypasses row-level security, as in Supabase */
const SERVICE_KEY = 'service-role-test';
const pool = new pg.Pool({ connectionString: process.env.PGURL, max: 4 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub, email) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now })}`;
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
function verify(token) {
  const [h, p, s] = String(token).split('.');
  if (!s || crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  return JSON.parse(Buffer.from(p, 'base64url').toString());
}
async function as(claims, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (claims !== 'service') {
      await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    }
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const ident = (s) => {
  if (!/^[A-Za-z_]+$/.test(s)) throw new Error('bad identifier');
  return `"${s}"`;
};
/** PostgREST filters used by BenchMark: col=eq.x / gte.x */
function where(params, values) {
  const out = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    const m = /^(eq|gte)\.(.*)$/.exec(v);
    if (!m) throw new Error('unsupported filter ' + v);
    values.push(m[2]);
    out.push(`${ident(k)} ${m[1] === 'eq' ? '=' : '>='} $${values.length}`);
  }
  return out.length ? 'where ' + out.join(' and ') : '';
}
function orderBy(o) {
  if (!o) return '';
  return 'order by ' + o.split(',').map((x) => { const [c, dir] = x.split('.'); return `${ident(c)} ${dir === 'desc' ? 'desc' : 'asc'}`; }).join(', ');
}
const read = (req) => new Promise((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => res(b ? JSON.parse(b) : null)); });

http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204);
  const url = new URL(req.url, 'http://x');
  try {
    // ---------- auth ----------
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = await read(req);
      const r = await pool.query('select id, email from auth.users where email = $1', [email]);
      if (!r.rows[0] || password !== 'pass') return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      const u = r.rows[0];
      const now = Math.floor(Date.now() / 1000);
      return send(200, { access_token: jwt(u.id, u.email), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r-' + u.id,
        user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
    }
    if (url.pathname === '/auth/v1/logout') return send(204);
    if (url.pathname === '/auth/v1/user') {
      const c = verify((req.headers.authorization ?? '').replace('Bearer ', ''));
      return c ? send(200, { id: c.sub, email: c.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }) : send(401, { msg: 'bad jwt' });
    }
    // ---------- rest ----------
    if (!url.pathname.startsWith('/rest/v1/')) return send(404, { message: 'not found' });
    const bearer = (req.headers.authorization ?? '').replace('Bearer ', '');
    const claims = bearer === SERVICE_KEY ? 'service' : verify(bearer);
    if (!claims) return send(401, { message: 'JWT invalid' });
    const path = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
    if (path === 'rpc/bm_push') {
      const { p_table, p_rows } = await read(req);
      const r = await as(claims, 'select bm_push($1, $2::jsonb) as r', [p_table, JSON.stringify(p_rows)]);
      return send(200, r[0].r);
    }
    const table = ident(path);
    const values = [];
    if (req.method === 'GET') {
      const sel = url.searchParams.get('select') ?? '*';
      const w = where(url.searchParams, values);
      const lim = url.searchParams.get('limit'), off = url.searchParams.get('offset');
      let cols = 't.*';
      if (path === 'profiles' && sel.includes('site_members')) cols = `t.*, coalesce((select json_agg(json_build_object('site_code', m.site_code)) from site_members m where m.user_id = t.id), '[]') as site_members`;
      else if (sel !== '*') cols = sel.split(',').map((c) => 't.' + ident(c)).join(', ');
      const rows = await as(claims, `select ${cols} from ${table} t ${w} ${orderBy(url.searchParams.get('order'))} ${lim ? 'limit ' + Number(lim) : ''} ${off ? 'offset ' + Number(off) : ''}`, values);
      return send(200, rows.map((r) => JSON.parse(JSON.stringify(r, (_k, v) => (v instanceof Date ? v.toISOString() : v)))));
    }
    if (req.method === 'POST') {
      const body = await read(req);
      const rows = Array.isArray(body) ? body : [body];
      const ignore = String(req.headers.prefer ?? '').includes('ignore-duplicates');
      for (const r of rows) {
        const keys = Object.keys(r);
        await as(claims, `insert into ${table} (${keys.map(ident).join(', ')}) select ${keys.map((k) => ident(k)).join(', ')} from json_populate_record(null::${table}, $1) ${ignore ? 'on conflict do nothing' : ''}`, [JSON.stringify(r)]);
      }
      return send(201);
    }
    if (req.method === 'PATCH') {
      const body = await read(req);
      const keys = Object.keys(body);
      const w = where(url.searchParams, values);
      const offset = values.length;
      await as(claims, `update ${table} set ${keys.map((k, i) => `${ident(k)} = (json_populate_record(null::${table}, $${offset + 1})).${ident(k)}`).join(', ')} ${w}`, [...values, JSON.stringify(body)]);
      return send(204);
    }
    if (req.method === 'DELETE') {
      await as(claims, `delete from ${table} ${where(url.searchParams, values)}`, values);
      return send(204);
    }
    send(405, { message: 'method' });
  } catch (e) {
    send(e.code === '42501' ? 403 : 400, { message: String(e.message), code: e.code });
  }
}).listen(PORT, () => console.log('fake supabase on', PORT));
