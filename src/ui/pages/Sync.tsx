import { useState } from 'react';
import type { LogKey } from '../../engine/schema.ts';
import { LOG_BY_KEY } from '../../engine/schema.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';
import { useSession } from '../session.ts';
import { useSyncStatus } from '../components/SyncChip.tsx';
import { formatValue } from '../components/common.tsx';
import type { Row } from '../../engine/schema.ts';

export function SyncPage() {
  const { store } = useApp();
  const session = useSession();
  const sync = session.sync!;
  const status = useSyncStatus(sync);
  const i = useI18n();
  const d = i.d.sync;
  const [busy, setBusy] = useState(false);
  const issues = store.issues();
  const who = session.who!;

  const act = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try { await fn(); await sync.run(); } finally { setBusy(false); }
  };

  /** fields that differ between my version and the server's */
  const diff = (log: LogKey, a: Row | null, b: Row | null) =>
    LOG_BY_KEY[log].fields.filter((f) => JSON.stringify(a?.[f.key] ?? null) !== JSON.stringify(b?.[f.key] ?? null));

  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1>{d.title}</h1>
          <p className="muted">{d.intro}</p>
        </div>
        <button className="btn primary" disabled={busy || status.state === 'syncing'} onClick={() => void act(() => {})}>{d.now}</button>
      </div>

      <div className="grid halves" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>{d.last}</h2>
          <p><b>{status.lastSync ? status.lastSync.toLocaleString(i.locale) : d.never}</b></p>
          {status.lastReport && <p className="muted">{i.t(d.lastReport, { ...status.lastReport })}</p>}
          {status.pending > 0 && <p className="muted">{i.t(d.pending, { n: status.pending })}</p>}
          {status.lastError && <div className="notice err">{status.lastError}</div>}
        </div>
        <div className="card">
          <h2>{d.account}</h2>
          <div className="snap">
            <span className="k">{i.d.admin.name}</span><span className="v">{who.fullName || '—'}</span>
            <span className="k">{i.d.auth.email}</span><span className="v">{who.email}</span>
            <span className="k">{i.d.admin.ownerName}</span><span className="v">{who.owner || '—'}</span>
            <span className="k">{d.role}</span><span className="v">{i.d.roles[who.role]}</span>
            <span className="k">{d.sites}</span><span className="v">{who.role === 'pm' ? who.sites.join(', ') || '—' : d.allSites}</span>
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>{i.t(i.d.server.connected, { url: session.cfg?.url ?? '' })}</p>
          <div className="toolbar" style={{ marginTop: 6 }}>
            <button className="btn" onClick={() => void session.signOut()}>{i.d.auth.signOut}</button>
            {session.changePassword && <ChangePassword change={session.changePassword} />}
          </div>
        </div>
      </div>

      <h2>{d.issuesTitle}</h2>
      {issues.length === 0 ? (
        <div className="notice ok">{d.noIssues}</div>
      ) : (
        <div className="grid">
          {issues.map((it) => {
            const log = it.log as LogKey;
            const def = LOG_BY_KEY[log];
            const label = String((def.codeField && (it.local?.[def.codeField] ?? it.server?.[def.codeField])) || it.rowId);
            const changed = diff(log, it.local, it.server);
            return (
              <div key={it.seq} className="card">
                <h3>
                  <span>{i.d.logs[log].title} · {label}</span>
                  <span className={`chip ${it.kind === 'conflict' ? 'AMBER' : 'RED'}`}>{it.kind === 'conflict' ? d.conflict : d.rejected}</span>
                </h3>
                {it.reason && <p className="muted">{it.reason.replace(/^BM_[A-Z_]+:\s*/, '')}</p>}
                {it.kind === 'conflict' && changed.length > 0 && (
                  <table style={{ marginBottom: 10 }}>
                    <thead><tr><th /><th>{d.mine}</th><th>{d.theirs}</th></tr></thead>
                    <tbody>
                      {changed.map((f) => (
                        <tr key={f.key}>
                          <td>{(i.d.fields as Record<string, string>)[f.key] ?? f.key}</td>
                          <td><b>{formatValue(i, it.local?.[f.key], f.type) || '—'}</b></td>
                          <td>{formatValue(i, it.server?.[f.key], f.type) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="toolbar" style={{ margin: 0 }}>
                  {it.kind === 'conflict' ? (
                    <>
                      <button className="btn primary" disabled={busy} onClick={() => void act(() => store.keepMine(it.seq))}>{d.keepMine}</button>
                      <button className="btn" disabled={busy} onClick={() => void act(() => store.dropIssue(it.seq))}>{d.keepServer}</button>
                    </>
                  ) : (
                    <>
                      <button className="btn" disabled={busy} onClick={() => void act(async () => { store.dropIssue(it.seq); await sync.refetch(log, it.rowId); })}>{d.discard}</button>
                      <button className="btn" disabled={busy} onClick={() => void act(() => store.retryRejected(it.seq))}>{d.retry}</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChangePassword({ change }: { change: (pw: string) => Promise<void> }) {
  const i = useI18n();
  const d = i.d.auth;
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>{d.changePassword}</button>;
  const save = async () => {
    if (pw.length < 10) return setMsg({ ok: false, text: d.passwordShort });
    if (pw !== pw2) return setMsg({ ok: false, text: d.passwordMismatch });
    try {
      await change(pw);
      setMsg({ ok: true, text: d.passwordChanged });
      setPw('');
      setPw2('');
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error)?.message ?? e) });
    }
  };
  const box = { background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '7px 9px', minHeight: 36 };
  return (
    <div style={{ display: 'grid', gap: 6, width: '100%' }}>
      <input type="password" placeholder={d.newPassword} value={pw} onChange={(e) => setPw(e.target.value)} style={box} autoComplete="new-password" />
      <input type="password" placeholder={d.repeatPassword} value={pw2} onChange={(e) => setPw2(e.target.value)} style={box} autoComplete="new-password" />
      <button className="btn primary" onClick={() => void save()}>{d.changePassword}</button>
      {msg && <div className={`notice ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
    </div>
  );
}
