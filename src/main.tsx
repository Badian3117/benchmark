import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Store } from './data/store.ts';
import { App } from './ui/App.tsx';
import type { Dataset } from './engine/kpis.ts';
import type { Who } from './engine/permissions.ts';
import { I18nContext, makeI18n } from './i18n/index.ts';
import { prefs } from './ui/context.ts';
import { STANDALONE, type SessionState } from './ui/session.ts';
import { Login, Pending } from './ui/pages/Login.tsx';
import { SyncEngine } from './sync/engine.ts';
import { RestTransport } from './sync/transport.ts';
import { AdminApi } from './sync/admin.ts';
import {
  currentSession, listenForOAuthCallback, loadProfile, serverConfig, signOut, supabase, type ServerConfig,
} from './sync/session.ts';
import './ui/styles.css';

declare global {
  interface Window {
    benchmarkFlush?: () => Promise<void>;
  }
}

function Fatal({ error }: { error: unknown }) {
  return <pre style={{ padding: 24, color: '#a32626', whiteSpace: 'pre-wrap' }}>BenchMark could not start:{'\n'}{String((error as Error)?.stack ?? error)}</pre>;
}

/** No server configured: Phase 1 behaviour, one local database. */
function Standalone() {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    Store.open({ name: 'benchmark' })
      .then(async (s) => {
        // first start: show the sample portfolio so the dashboard is not empty
        const empty = Object.values(s.ds.logs).every((rows) => rows.length === 0);
        if (empty && new URLSearchParams(location.search).get('empty') === null) {
          const data = (await import('./data/sample.json')).default as unknown as Dataset;
          s.replaceAll(structuredClone(data), 'sample data (first start)');
        }
        window.benchmarkFlush = () => s.flush();
        setStore(s);
      })
      .catch(setError);
  }, []);
  if (error) return <Fatal error={error} />;
  return store ? <App store={store} session={STANDALONE} /> : null;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'login'; error?: string }
  | { kind: 'pending'; who: Who }
  | { kind: 'ready'; store: Store; session: SessionState }
  | { kind: 'fatal'; error: unknown };

/** Server configured: sign in → approved profile → this user's local database → sync. */
function Connected({ cfg }: { cfg: ServerConfig }) {
  const sb = useMemo(() => supabase(cfg), [cfg]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let active: { store: Store; sync: SyncEngine } | null = null;
    const token = async () => (await sb.auth.getSession()).data.session?.access_token ?? null;

    const stopActive = async () => {
      if (!active) return;
      active.sync.stop();
      await active.store.flush();
      active = null;
    };

    const proceed = async () => {
      const session = await currentSession(sb);
      if (cancelled) return;
      if (!session) return setPhase({ kind: 'login' });
      let who: Who, offline: boolean;
      try {
        ({ who, offline } = await loadProfile(cfg, session));
      } catch (e) {
        return setPhase({ kind: 'login', error: String((e as Error)?.message ?? e) });
      }
      if (who.role === 'pending') return setPhase({ kind: 'pending', who });
      await stopActive();
      const store = await Store.open({ name: 'user-' + who.userId });
      store.connected = true;
      store.actor = who.fullName || who.owner || who.email;
      if (store.ds.settings.userName !== store.actor) store.setSettings({ ...store.ds.settings, userName: store.actor });
      const sync = new SyncEngine(store, new RestTransport({ url: cfg.url, anonKey: cfg.anonKey, token }));
      active = { store, sync };
      window.benchmarkFlush = () => store.flush();
      sync.start();
      if (cancelled) return;
      setPhase({
        kind: 'ready',
        store,
        session: {
          mode: 'connected', who, sync, cfg, offlineProfile: offline,
          admin: who.role === 'admin' ? new AdminApi(cfg, token) : null,
          signOut: async () => {
            await stopActive();
            await signOut(sb);
            setPhase({ kind: 'login' });
          },
          // Microsoft accounts have no BenchMark password
          changePassword: session.user.app_metadata?.provider === 'azure' ? null : async (password: string) => {
            const { error } = await sb.auth.updateUser({ password });
            if (error) throw error;
          },
        },
      });
    };

    listenForOAuthCallback(sb, (err) => setPhase({ kind: 'login', error: err }));
    const { data } = sb.auth.onAuthStateChange((event) => {
      // run outside the auth callback (supabase-js holds a lock while it runs)
      if (event === 'SIGNED_IN') setTimeout(() => void proceed().catch((e) => setPhase({ kind: 'fatal', error: e })), 0);
      if (event === 'SIGNED_OUT') setTimeout(() => void stopActive().then(() => setPhase({ kind: 'login' })), 0);
    });
    proceed().catch((e) => setPhase({ kind: 'fatal', error: e }));
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
      void stopActive();
    };
  }, [sb, cfg]);

  if (phase.kind === 'fatal') return <Fatal error={phase.error} />;
  if (phase.kind === 'login') return <Login sb={sb} cfg={cfg} initialError={phase.error} />;
  if (phase.kind === 'pending')
    return <Pending who={phase.who} onRetry={() => location.reload()} onSignOut={async () => { await signOut(sb); setPhase({ kind: 'login' }); }} />;
  if (phase.kind === 'ready') return <App store={phase.store} session={phase.session} />;
  return null;
}

function Boot() {
  const cfg = serverConfig();
  const i18n = useMemo(() => makeI18n(prefs.get('lang') === 'fr' ? 'fr' : 'en'), []);
  return <I18nContext.Provider value={i18n}>{cfg ? <Connected cfg={cfg} /> : <Standalone />}</I18nContext.Provider>;
}

createRoot(document.getElementById('root')!).render(<Boot />);
