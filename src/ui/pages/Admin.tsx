import { useEffect, useState } from 'react';
import type { Role } from '../../engine/permissions.ts';
import type { Site, UserRow } from '../../sync/admin.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';
import { useSession } from '../session.ts';

const ROLES: Role[] = ['pending', 'pm', 'executive', 'admin'];

export function AdminPage() {
  const { ds } = useApp();
  const { admin, sync, who } = useSession();
  const i = useI18n();
  const d = i.d.admin;
  const [users, setUsers] = useState<UserRow[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [newSite, setNewSite] = useState({ code: '', name: '' });

  const load = async () => {
    try {
      setError('');
      const [u, s] = await Promise.all([admin!.users(), admin!.sites()]);
      setUsers(u);
      setSites(s);
    } catch (e) {
      setError(i.t(d.loadFailed, { s: String((e as Error)?.message ?? e) }));
    }
  };
  useEffect(() => { void load(); }, []);

  if (!admin) return <div className="notice warn">{d.notAdmin}</div>;

  const patch = (id: string, p: Partial<UserRow>) => setUsers((us) => us.map((u) => (u.id === id ? { ...u, ...p } : u)));
  const saveUser = async (u: UserRow) => {
    try {
      await admin.updateUser(u.id, { full_name: u.full_name, owner_name: u.owner_name, role: u.role, active: u.active });
      await admin.setUserSites(u.id, u.site_members.map((m) => m.site_code));
      setSaved(u.id);
      setTimeout(() => setSaved(null), 2000);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  };
  const addSite = async () => {
    if (!newSite.code.trim()) return;
    try {
      await admin.addSite({ code: newSite.code.trim(), name: newSite.name.trim() || null, active: true });
      setNewSite({ code: '', name: '' });
      await load();
      void sync?.run();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  };
  const toggleSite = async (s: Site) => {
    await admin.updateSite(s.code, { active: !s.active });
    await load();
    void sync?.run();
  };
  // owner names already used as project managers / owners in the data
  const owners = [...new Set([...ds.settings.lists.owners, ...ds.logs.projects.map((p) => String(p.pm ?? ''))].filter(Boolean))].sort();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{d.title}</h1>
          <p className="muted" style={{ maxWidth: 900 }}>{d.intro}</p>
        </div>
      </div>
      {error && <div className="notice err">{error}</div>}
      <div className="notice info">{d.invite}</div>

      <h2>{d.users} <span className="faint">({users.length})</span></h2>
      <div className="table-wrap auto" style={{ marginBottom: 24 }}>
        <table>
          <thead>
            <tr><th>{i.d.auth.email}</th><th>{d.name}</th><th>{d.ownerName}</th><th>{d.role}</th><th>{d.userSites}</th><th>{d.active}</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td><input type="text" value={u.full_name ?? ''} onChange={(e) => patch(u.id, { full_name: e.target.value })} /></td>
                <td>
                  <input type="text" list="bm-owners" value={u.owner_name ?? ''} title={d.ownerHint} onChange={(e) => patch(u.id, { owner_name: e.target.value })} />
                </td>
                <td>
                  <select value={u.role} disabled={u.id === who?.userId} onChange={(e) => patch(u.id, { role: e.target.value as Role })}>
                    {ROLES.map((r) => <option key={r} value={r}>{i.d.roles[r]}</option>)}
                  </select>
                </td>
                <td style={{ minWidth: 220 }}>
                  {u.role === 'pm' ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', maxHeight: 110, overflow: 'auto' }}>
                      {sites.filter((s) => s.active).map((s) => {
                        const on = u.site_members.some((m) => m.site_code === s.code);
                        return (
                          <label key={s.code} style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                            <input type="checkbox" checked={on} onChange={() => patch(u.id, { site_members: on ? u.site_members.filter((m) => m.site_code !== s.code) : [...u.site_members, { site_code: s.code }] })} />{' '}
                            {s.code}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="faint">{u.role === 'pending' ? '—' : i.d.sync.allSites}</span>
                  )}
                </td>
                <td><input type="checkbox" checked={u.active} disabled={u.id === who?.userId} onChange={(e) => patch(u.id, { active: e.target.checked })} /></td>
                <td><button className="btn small primary" onClick={() => void saveUser(u)}>{saved === u.id ? '✓ ' + d.saved : d.save}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="bm-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
      </div>

      <h2>{d.sites} <span className="faint">({sites.filter((s) => s.active).length})</span></h2>
      <div className="toolbar">
        <input type="text" placeholder={d.siteCode} value={newSite.code} onChange={(e) => setNewSite({ ...newSite, code: e.target.value })} />
        <input type="text" placeholder={d.siteName} value={newSite.name} onChange={(e) => setNewSite({ ...newSite, name: e.target.value })} />
        <button className="btn primary" onClick={() => void addSite()}>+ {d.addSite}</button>
      </div>
      <div className="table-wrap auto" style={{ maxWidth: 700 }}>
        <table>
          <thead><tr><th>{d.siteCode}</th><th>{d.siteName}</th><th>{d.active}</th></tr></thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.code}>
                <td><b>{s.code}</b></td>
                <td>{s.name}</td>
                <td><input type="checkbox" checked={s.active} onChange={() => void toggleSite(s)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
