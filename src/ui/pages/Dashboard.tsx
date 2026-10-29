import { Fragment, useMemo } from 'react';
import { actionCounts, snapshot, type Alert } from '../../engine/analysis.ts';
import { KPIS, KPIS_ORDERED, trend, type KpiKey } from '../../engine/kpis.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';
import { useSession } from '../session.ts';
import { canWriteAnything } from '../../engine/permissions.ts';
import { RagHistory } from '../components/charts.tsx';
import { RagChip, SeverityChip, StatusIcon, TrendText, targetRule } from '../components/common.tsx';

export function useAlertText() {
  const i = useI18n();
  return (a: Alert) => {
    const p = { ...a.params };
    if (typeof p.kpi === 'string') p.kpi = i.d.kpi[p.kpi as KpiKey]?.name ?? p.kpi;
    return i.t(i.d.alerts[a.code as keyof typeof i.d.alerts] ?? a.code, p);
  };
}

export function Dashboard() {
  const { ds, tracking, period, scope, alerts, edit, go, filter } = useApp();
  const i = useI18n();
  const d = i.d;
  const idx = tracking.reportIdx;
  const alertText = useAlertText();
  const { who } = useSession();
  const snap = useMemo(() => snapshot(ds, period, scope), [ds, period, scope]);

  const rows = KPIS_ORDERED.map((k) => {
    const cur = tracking.rows[k.key][idx];
    const prev = idx > 0 ? tracking.rows[k.key][idx - 1] : null;
    const t = ds.targets[k.key];
    let tr = trend(cur?.value ?? null, prev?.value ?? null, t);
    // a change too small to show is no trend
    if (tr && cur?.value != null && prev?.value != null && i.kpiDelta(cur.value - prev.value, k.unit).startsWith('±')) tr = 'stable';
    return { k, cur, prev, t, tr, acts: actionCounts(ds, k.key) };
  });
  const count = (r: string) => rows.filter((x) => (x.cur?.rag ?? 'NODATA') === r).length;
  const measured = count('GREEN') + count('AMBER') + count('RED');
  const counts = tracking.months.map((_, m) =>
    m > idx ? null : {
      GREEN: KPIS.filter((k) => tracking.rows[k.key][m]?.rag === 'GREEN').length,
      AMBER: KPIS.filter((k) => tracking.rows[k.key][m]?.rag === 'AMBER').length,
      RED: KPIS.filter((k) => tracking.rows[k.key][m]?.rag === 'RED').length,
      NODATA: KPIS.filter((k) => !tracking.rows[k.key][m]?.rag).length,
    },
  );
  const cur = ds.settings.currency;
  const scoped = !!(filter.site || filter.pm || filter.project);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{d.dashboard.title} – {i.monthLabel(period.month, true)}</h1>
          <p className="muted">{ds.settings.orgName} · {i.t(d.dashboard.asOf, { d: i.date(period.asOf) })}</p>
        </div>
      </div>

      <div className="tiles" style={{ marginBottom: 16 }}>
        {(['GREEN', 'AMBER', 'RED', 'NODATA'] as const).map((r) => (
          <div key={r} className={`tile ${r}`}>
            <div className="lbl"><StatusIcon rag={r} /> {d.rag[r]}</div>
            <div className="big">{count(r)}</div>
            {r === 'GREEN' && measured > 0 && <div className="faint">{i.t(d.dashboard.onTarget, { p: i.pct(count('GREEN') / measured, 0) })}</div>}
          </div>
        ))}
      </div>

      <div className="grid halves" style={{ marginBottom: 16 }}>
          <div className="card">
            <h2>{d.dashboard.watch} <span className="faint">({alerts.length})</span></h2>
            {alerts.length === 0 ? (
              <p className="faint">{d.dashboard.watchEmpty}</p>
            ) : (
              <div className="watch">
                {alerts.map((a, k) => (
                  <button key={k} className="watch-item" onClick={() => (a.log && a.rowId ? edit(a.log as never, a.rowId) : a.log ? go('log', a.log as never) : go('tracking'))}>
                    <SeverityChip s={a.severity} />
                    <span>{alertText(a)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <h2>{d.dashboard.ragHistory}</h2>
            <RagHistory months={tracking.months} counts={counts} reportIdx={idx} />
          </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap auto" style={{ border: 0, borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>#</th><th>{d.dashboard.kpi}</th><th className="num">{d.dashboard.target}</th><th className="num">{d.dashboard.actual}</th>
                  <th className="num">n</th><th className="num">{d.dashboard.prev}</th><th className="num">{d.dashboard.change}</th>
                  <th>{d.dashboard.trend}</th><th>{d.dashboard.status}</th><th>{d.dashboard.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ k, cur: c, prev, t, tr, acts }, idx) => (
                  <Fragment key={k.key}>
                  {(idx === 0 || rows[idx - 1].k.group !== k.group) && (
                    <tr className="group-row"><td colSpan={10}>{d.kpiGroups[k.group]}</td></tr>
                  )}
                  <tr>
                    <td className="kpi-num">{k.num}</td>
                    <td>
                      <div className="kpi-name">{d.kpi[k.key].name}</div>
                      <div className="faint" style={{ fontSize: 11 }}>
                        {d.basis[k.basis]}
                        {scoped && !k.projectScoped && <> · <span title={d.common.portfolioOnly}>{d.common.portfolio}</span></>}
                      </div>
                    </td>
                    <td className="num">{targetRule(t, k.unit, i)}</td>
                    <td className="num"><b>{i.kpi(c?.value ?? null, k.unit)}</b></td>
                    <td className="num faint">
                      {c ? c.n : ''}
                      {k.smallSample && c && c.n < k.smallSample && c.n > 0 && <span title={d.dashboard.smallN}> ⚠</span>}
                    </td>
                    <td className="num">{i.kpi(prev?.value ?? null, k.unit)}</td>
                    <td className="num">{c?.value != null && prev?.value != null ? i.kpiDelta(c.value - prev.value, k.unit) : ''}</td>
                    <td><TrendText t={tr} /></td>
                    <td><RagChip rag={c?.rag ?? null} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="faint" style={{ fontSize: 12 }}>{acts.live} {d.dashboard.openActions} · {acts.done} {d.dashboard.doneActions}</span>
                      {(c?.rag === 'RED' || c?.rag === 'AMBER') && canWriteAnything(who) && (
                        <button className="btn small" style={{ marginLeft: 6 }} onClick={() => edit('actions', null, { kpi: k.key, before: c.value, project: filter.project ?? null })}>
                          + {d.dashboard.raiseAction}
                        </button>
                      )}
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        <h2>{d.dashboard.snapshot}</h2>
        <div className="snap">
          <span className="k">{d.dashboard.projects}</span><span className="v">{snap.projects}</span>
          <span className="k sub">{d.dashboard.active}</span><span className="v">{snap.active}</span>
          <span className="k sub">{d.dashboard.completed}</span><span className="v">{snap.completed}</span>
          <span className="k">{d.dashboard.bac}</span><span className="v">{i.money(snap.bac, cur)}</span>
          <span className="k">{d.dashboard.eac}</span><span className="v">{i.money(snap.eac, cur)}</span>
          <span className="k">{d.dashboard.vac}</span><span className="v" style={{ color: snap.vac < 0 ? 'var(--critical-ink)' : undefined }}>{i.money(snap.vac, cur)}</span>
          <hr />
          <span className="k">{d.dashboard.openRisks}</span><span className="v">{snap.openRisks}</span>
          <span className="k sub">{d.dashboard.highRisks}</span><span className="v">{snap.highRisks}</span>
          <span className="k">{d.dashboard.openIssues}</span><span className="v">{snap.openIssues}</span>
          <span className="k sub">{d.dashboard.agedIssues}</span><span className="v">{snap.agedIssues}</span>
          <span className="k">{d.dashboard.pendingCrs}</span><span className="v">{snap.pendingCrs}</span>
          <span className="k">{d.dashboard.approvedCrCost}</span><span className="v">{i.money(snap.approvedCrCost, cur)}</span>
          <span className="k">{d.dashboard.overdueMilestones}</span><span className="v">{snap.overdueMilestones}</span>
          <hr />
          <span className="k">{d.dashboard.liveActions}</span><span className="v">{snap.liveActions}</span>
          <span className="k sub">{d.dashboard.overdueActions}</span><span className="v">{snap.overdueActions}</span>
          <span className="k">{d.dashboard.improvedShare}</span><span className="v">{snap.improvedShare === null ? '—' : i.pct(snap.improvedShare, 0)}</span>
          <span className="k">{d.dashboard.ciImplemented}</span><span className="v">{snap.ciImplemented}</span>
          <span className="k sub">{d.dashboard.ciVerified}</span><span className="v">{snap.ciVerified}</span>
          <span className="k">{d.dashboard.targetRevisions}</span><span className="v">{snap.targetRevisions}</span>
          <hr />
          <span className="k">{d.dashboard.hoursYtd}</span><span className="v">{i.num(snap.hoursYtd)}</span>
          <span className="k sub">{d.dashboard.ltiYtd}</span><span className="v" style={{ color: snap.ltiYtd ? 'var(--critical-ink)' : undefined }}>{snap.ltiYtd}</span>
          <span className="k">{d.dashboard.pendingGates}</span><span className="v">{snap.pendingGates}</span>
          <span className="k">{d.dashboard.openVerbal}</span><span className="v" style={{ color: snap.openVerbal ? 'var(--critical-ink)' : undefined }}>{snap.openVerbal}</span>
          <span className="k">{d.dashboard.vosPendingValue}</span><span className="v">{i.money(snap.variationsPendingValue, cur)}</span>
          <span className="k">{d.dashboard.vosApprovedValue}</span><span className="v">{i.money(snap.variationsApprovedValue, cur)}</span>
        </div>
      </div>
    </>
  );
}
