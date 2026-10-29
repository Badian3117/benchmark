import { useMemo } from 'react';
import { projectHealth } from '../../engine/analysis.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';
import { RagChip } from '../components/common.tsx';

export function Health() {
  const { ds, period, scope, edit } = useApp();
  const i = useI18n();
  const d = i.d.health;
  const rows = useMemo(() => projectHealth(ds, period, scope), [ds, period, scope]);
  const ratio = (v: number | null, rag: 'cumCpi' | 'cumSpi') => {
    if (v === null) return <span className="faint">—</span>;
    const t = ds.targets[rag];
    const bad = v < t.amber, warn = v < t.target;
    return <span style={{ color: bad ? 'var(--critical-ink)' : warn ? 'var(--warning-ink)' : undefined, fontWeight: 600 }}>{i.num(v, 2)}</span>;
  };
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{d.title}</h1>
          <p className="muted">{d.intro}</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{d.health}</th><th>{d.code}</th><th>{d.name}</th><th>{d.site}</th><th>{d.pm}</th><th>{d.status}</th>
              <th className="num">{d.cpi}</th><th className="num">{d.spi}</th><th className="num">{d.bac}</th><th className="num">{d.eac}</th>
              <th className="num">{d.vac}</th><th className="num">{d.daysLate}</th><th className="num">{d.overdue}</th>
              <th className="num">{d.issues}</th><th className="num">{d.risks}</th><th className="num">{d.crs}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const p = ds.logs.projects.find((x) => x.code === h.code)!;
              return (
                <tr key={h.code} className="clickable" onClick={() => edit('projects', p.id)}>
                  <td><RagChip rag={h.health} /></td>
                  <td><b>{h.code}</b></td>
                  <td className="ellipsis">{h.name}</td>
                  <td>{h.site}</td>
                  <td>{h.pm}</td>
                  <td>{i.v(h.status)}</td>
                  <td className="num">{ratio(h.cumCpi, 'cumCpi')}</td>
                  <td className="num">{ratio(h.cumSpi, 'cumSpi')}</td>
                  <td className="num">{h.bac === null ? '' : i.money(h.bac)}</td>
                  <td className="num">{h.eac === null ? '' : i.money(h.eac)}</td>
                  <td className="num" style={{ color: (h.vacPct ?? 0) < -ds.settings.budgetTolerance ? 'var(--critical-ink)' : undefined }}>{h.vacPct === null ? '' : i.pct(h.vacPct)}</td>
                  <td className="num">{h.forecastDaysLate === null ? '' : i.t(d.days, { n: (h.forecastDaysLate > 0 ? '+' : '') + h.forecastDaysLate })}</td>
                  <td className="num">{h.overdueMilestones || ''}</td>
                  <td className="num">{h.openIssues || ''}</td>
                  <td className="num">{h.highRisks || ''}</td>
                  <td className="num">{h.pendingCrs || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">{i.d.common.noData}</div>}
      </div>
    </>
  );
}
