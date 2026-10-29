import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Who } from '../../engine/permissions.ts';
import { useI18n } from '../../i18n/index.ts';
import { builtInServer, saveServerConfig, signInWithMicrosoft, signInWithPassword, type ServerConfig } from '../../sync/session.ts';
import { Logo } from '../components/common.tsx';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--bg)' }}>
      <div className="card" style={{ width: 'min(420px, 100%)', padding: 28 }}>
        <div className="brand" style={{ padding: '0 0 18px' }}>
          <Logo size={40} />
          <div style={{ fontWeight: 700, fontSize: 22 }}>BenchMark</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Login({ sb, cfg, initialError }: { sb: SupabaseClient; cfg: ServerConfig; initialError?: string }) {
  const i = useI18n();
  const d = i.d.auth;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'err' | 'info'; text: string } | null>(initialError ? { kind: 'err', text: i.t(d.failed, { s: initialError }) } : null);

  const run = async (fn: () => Promise<void>, info?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (info) setMsg({ kind: 'info', text: info });
    } catch (e) {
      setMsg({ kind: 'err', text: i.t(d.failed, { s: String((e as Error)?.message ?? e) }) });
    }
    setBusy(false);
  };

  return (
    <Frame>
      <h2>{d.title}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => signInWithPassword(sb, email, password));
        }}
        style={{ display: 'grid', gap: 12 }}
      >
        <div className="field">
          <label htmlFor="email">{d.email}</label>
          <input id="email" type="text" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">{d.password}</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '7px 9px', minHeight: 36 }} />
        </div>
        <button className="btn primary" type="submit" disabled={busy || !email || !password}>{busy ? d.working : d.signIn}</button>
      </form>
      <div className="faint" style={{ textAlign: 'center', margin: '12px 0' }}>{d.or}</div>
      <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={busy} onClick={() => void run(() => signInWithMicrosoft(sb), d.browserOpened)}>
        <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden><rect width="10" height="10" fill="#f25022" /><rect x="11" width="10" height="10" fill="#7fba00" /><rect y="11" width="10" height="10" fill="#00a4ef" /><rect x="11" y="11" width="10" height="10" fill="#ffb900" /></svg>
        {d.microsoft}
      </button>
      {msg && <div className={`notice ${msg.kind === 'err' ? 'err' : 'info'}`} style={{ marginTop: 14 }}>{msg.text}</div>}
      <p className="faint" style={{ fontSize: 12, marginTop: 18 }}>
        {d.server}: {cfg.url}
        {!builtInServer() && (
          <>
            {' · '}
            <a href="#" onClick={(e) => { e.preventDefault(); if (confirm(i.d.server.confirmDisconnect)) { saveServerConfig(null); location.reload(); } }}>{d.standalone}</a>
          </>
        )}
      </p>
    </Frame>
  );
}

export function Pending({ who, onRetry, onSignOut }: { who: Who; onRetry: () => void; onSignOut: () => void }) {
  const i = useI18n();
  const d = i.d.auth;
  return (
    <Frame>
      <h2>{d.pendingTitle}</h2>
      <p className="muted">{i.t(d.pendingText, { email: who.email })}</p>
      <div className="toolbar" style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={onRetry}>{d.retry}</button>
        <button className="btn" onClick={onSignOut}>{d.signOut}</button>
      </div>
    </Frame>
  );
}
