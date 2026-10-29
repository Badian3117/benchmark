import { KPI_GROUPS, KPIS_ORDERED } from '../../engine/kpis.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';
import { KpiChart } from '../components/charts.tsx';
import { RagChip, targetRule } from '../components/common.tsx';

export function Trends() {
  const { ds, tracking } = useApp();
  const i = useI18n();
  const d = i.d;
  const idx = tracking.reportIdx;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{d.trends.title}</h1>
          <p className="muted">{d.trends.intro}</p>
          <div className="legend">
            <span><i style={{ background: 'var(--series-1)' }} />{d.trends.actual}</span>
            <span><i style={{ background: 'none', borderTop: '2px dashed var(--text-2)', borderRadius: 0, height: 0, width: 16 }} />{d.trends.target}</span>
            <span><i style={{ background: 'var(--band)', border: '1px solid var(--border-strong)' }} />{d.trends.band}</span>
          </div>
        </div>
      </div>
      {KPI_GROUPS.map((g) => (
      <section key={g} style={{ marginBottom: 20 }}>
      <h2>{d.kpiGroups[g]}</h2>
      <div className="grid cards">
        {KPIS_ORDERED.filter((k) => k.group === g).map((k) => {
          const c = tracking.rows[k.key][idx];
          const t = ds.targets[k.key];
          return (
            <div key={k.key} className="card chart-card">
              <h3>
                <span>#{k.num} {d.kpi[k.key].name}</span>
                <span className="now">{i.kpi(c?.value ?? null, k.unit)}</span>
              </h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span className="faint" style={{ fontSize: 12 }}>{d.dashboard.target}: {targetRule(t, k.unit, i)} · {d.basis[k.basis]}</span>
                <RagChip rag={c?.rag ?? null} />
              </div>
              <KpiChart months={tracking.months} cells={tracking.rows[k.key]} target={t} unit={k.unit} reportIdx={idx} />
            </div>
          );
        })}
      </div>
      </section>
      ))}
    </>
  );
}
