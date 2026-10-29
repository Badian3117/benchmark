import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { alerts as buildAlerts, periodFor, resolveScope } from '../engine/analysis.ts';
import { todayISO, yearMonths, type ISODate } from '../engine/dates.ts';
import { computeTracking, effectiveReportingMonth } from '../engine/kpis.ts';
import { LOGS, type LogKey, type Row } from '../engine/schema.ts';
import { validateAll } from '../engine/validate.ts';
import type { Store } from '../data/store.ts';
import { I18nContext, makeI18n, useI18n, type Lang } from '../i18n/index.ts';
import { AppContext, prefs, type AppState, type Filter, type Page } from './context.ts';
import { Logo } from './components/common.tsx';
import { RecordEditor } from './components/RecordEditor.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Tracking } from './pages/Tracking.tsx';
import { Trends } from './pages/Trends.tsx';
import { Health } from './pages/Health.tsx';
import { LogPage } from './pages/LogPage.tsx';
import { Targets } from './pages/Targets.tsx';
import { DataQuality } from './pages/DataQuality.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { DataPage } from './pages/Data.tsx';
import { AuditPage } from './pages/Audit.tsx';
import { Guide } from './pages/Guide.tsx';
import { desktop } from '../data/persistence.ts';

type Theme = 'system' | 'light' | 'dark';

export function App({ store }: { store: Store }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const ds = store.ds;
  const today = todayISO();

  const [lang, setLang] = useState<Lang>(() => (prefs.get('lang') === 'fr' ? 'fr' : 'en'));
  const [theme, setTheme] = useState<Theme>(() => (prefs.get('theme') as Theme) || 'system');
  const [page, setPage] = useState<Page>(() => (prefs.get('page') as Page) || 'dashboard');
  const [log, setLog] = useState<LogKey>(() => (prefs.get('log') as LogKey) || 'projects');
  const [monthSel, setMonthSel] = useState<ISODate | null>(null);
  const [filter, setFilter] = useState<Filter>({});
  const [editing, setEditing] = useState<{ log: LogKey; rowId: string | null; preset?: Partial<Row> } | null>(null);

  const i18n = useMemo(() => makeI18n(lang), [lang]);
  useEffect(() => { prefs.set('lang', lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    prefs.set('theme', theme);
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  useEffect(() => { prefs.set('page', page); prefs.set('log', log); }, [page, log]);

  const months = yearMonths(ds.settings.yearStart);
  const month = monthSel && months.includes(monthSel) ? monthSel : effectiveReportingMonth(ds.settings, today);
  const scope = useMemo(() => resolveScope(ds, filter), [ds, filter]);
  const period = useMemo(() => periodFor(ds, month, today), [ds, month, today]);
  const tracking = useMemo(() => computeTracking(ds, month, scope, today), [ds, month, scope, today]);
  const alerts = useMemo(() => buildAlerts(ds, tracking, period, scope), [ds, tracking, period, scope]);
  const findings = useMemo(() => validateAll(ds, today), [ds, today]);

  const go = useCallback((p: Page, l?: LogKey) => { setPage(p); if (l) setLog(l); }, []);
  const edit = useCallback((l: LogKey, rowId: string | null, preset?: Partial<Row>) => setEditing({ log: l, rowId, preset }), []);

  const state: AppState = {
    store, ds, today, month, setMonth: setMonthSel, filter, setFilter, scope, period, tracking, alerts, findings, go, edit,
  };
  const d = i18n.d;
  const errorsByLog = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of findings) if (f.severity === 'error') m.set(f.log, (m.get(f.log) ?? 0) + 1);
    return m;
  }, [findings]);
  const errorCount = findings.filter((f) => f.severity === 'error').length;

  const projects = ds.logs.projects.filter((p) => (!filter.site || p.site === filter.site) && (!filter.pm || p.pm === filter.pm));
  const pms = [...new Set(ds.logs.projects.map((p) => String(p.pm ?? '')).filter(Boolean))].sort();

  const NavItem = ({ p, l, label, badge, err }: { p: Page; l?: LogKey; label: string; badge?: number; err?: boolean }) => (
    <button className={`nav-item ${page === p && (!l || l === log) ? 'active' : ''}`} onClick={() => go(p, l)}>
      <span>{label}</span>
      {badge ? <span className={`nav-badge ${err ? 'err' : ''}`}>{badge}</span> : null}
    </button>
  );

  return (
    <I18nContext.Provider value={i18n}>
      <AppContext.Provider value={state}>
        <div className="app">
          <aside className="sidebar">
            <div className="brand">
              <Logo />
              <div>
                <div className="brand-name">BenchMark</div>
                <div className="brand-tag">{d.app.tagline}</div>
              </div>
            </div>
            <div className="nav-group">
              <div className="nav-title">{d.nav.overview}</div>
              <NavItem p="dashboard" label={d.nav.dashboard} badge={alerts.filter((a) => a.severity !== 'warning').length} />
              <NavItem p="health" label={d.nav.health} />
              <NavItem p="tracking" label={d.nav.tracking} />
              <NavItem p="trends" label={d.nav.trends} />
            </div>
            <div className="nav-group">
              <div className="nav-title">{d.nav.capture}</div>
              {LOGS.filter((l) => l.key !== 'targetRevisions' && l.key !== 'actions').map((l) => (
                <NavItem key={l.key} p="log" l={l.key} label={d.logs[l.key].title} badge={errorsByLog.get(l.key)} err />
              ))}
            </div>
            <div className="nav-group">
              <div className="nav-title">{d.nav.control}</div>
              <NavItem p="log" l="actions" label={d.logs.actions.title} badge={errorsByLog.get('actions')} err />
              <NavItem p="targets" label={d.nav.targets} />
              <NavItem p="quality" label={d.nav.quality} badge={errorCount} err />
              <NavItem p="audit" label={d.nav.audit} />
            </div>
            <div className="nav-group">
              <NavItem p="data" label={d.nav.data} />
              <NavItem p="settings" label={d.nav.settings} />
              <NavItem p="guide" label={d.nav.guide} />
            </div>
            <div className="sidebar-foot">
              BenchMark {desktop?.version ?? 'preview'} · {ds.settings.orgName}
            </div>
          </aside>

          <div className="main">
            <header className="topbar">
              <label className="ctl">
                <span>{d.common.month}</span>
                <select value={month} onChange={(e) => setMonthSel(e.target.value)}>
                  {months.map((m) => <option key={m} value={m}>{i18n.monthLabel(m, true)}</option>)}
                </select>
              </label>
              <label className="ctl">
                <span>{d.common.site}</span>
                <select value={filter.site ?? ''} onChange={(e) => setFilter({ ...filter, site: e.target.value || undefined, project: undefined })}>
                  <option value="">{d.common.all}</option>
                  {ds.settings.lists.sites.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="ctl">
                <span>{d.common.pm}</span>
                <select value={filter.pm ?? ''} onChange={(e) => setFilter({ ...filter, pm: e.target.value || undefined, project: undefined })}>
                  <option value="">{d.common.all}</option>
                  {pms.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="ctl">
                <span>{d.common.project}</span>
                <select value={filter.project ?? ''} onChange={(e) => setFilter({ ...filter, project: e.target.value || undefined })}>
                  <option value="">{d.common.portfolio}</option>
                  {projects.map((p) => <option key={p.id} value={String(p.code)}>{String(p.code)} – {String(p.name ?? '')}</option>)}
                </select>
              </label>
              <div className="spacer" />
              <SaveState store={store} />
              <div className="seg" aria-label={d.common.language}>
                <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
                <button className={lang === 'fr' ? 'on' : ''} onClick={() => setLang('fr')}>FR</button>
              </div>
              <select aria-label={d.common.theme} value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                <option value="system">{d.common.system}</option>
                <option value="light">{d.common.light}</option>
                <option value="dark">{d.common.dark}</option>
              </select>
            </header>
            <main className="content">
              {store.storageKind === 'browser' && <div className="notice warn">{d.common.previewMode}</div>}
              {page === 'dashboard' && <Dashboard />}
              {page === 'health' && <Health />}
              {page === 'tracking' && <Tracking />}
              {page === 'trends' && <Trends />}
              {page === 'log' && <LogPage key={log} log={log} />}
              {page === 'targets' && <Targets />}
              {page === 'quality' && <DataQuality />}
              {page === 'settings' && <SettingsPage />}
              {page === 'data' && <DataPage />}
              {page === 'audit' && <AuditPage />}
              {page === 'guide' && <Guide />}
            </main>
          </div>
        </div>
        {editing && <RecordEditor {...editing} onClose={() => setEditing(null)} />}
      </AppContext.Provider>
    </I18nContext.Provider>
  );
}

function SaveState({ store }: { store: Store }) {
  const { d } = useI18n();
  if (store.saveError) return <span className="save-state err" title={store.saveError}>{d.common.saveFailed}</span>;
  if (store.pendingSave) return <span className="save-state">{d.common.saving}</span>;
  return <span className="save-state">{store.lastSaved ? `✓ ${d.common.saved} ${store.lastSaved.toLocaleTimeString()}` : ''}</span>;
}
