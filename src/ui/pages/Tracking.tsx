import { KPIS } from '../../engine/kpis.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';
import { RagChip, targetRule } from '../components/common.tsx';

export function Tracking() {
  const { ds, tracking, setMonth } = useApp();
  const i = useI18n();
  const d = i.d;
  const idx = tracking.reportIdx;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{d.tracking.title}</h1>
          <p className="muted">{d.tracking.intro}</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>KPI</th><th className="num">{d.dashboard.target}</th>
              {tracking.months.map((m, k) => (
                <th key={m} className="num sortable" onClick={() => setMonth(m)} style={k === idx ? { color: 'var(--accent-ink)' } : undefined}>{i.monthLabel(m)}</th>
              ))}
              <th>{d.tracking.latest}</th><th className="num">{d.tracking.green}</th><th className="num">{d.tracking.red}</th>
            </tr>
          </thead>
          <tbody>
            {KPIS.map((k) => {
              const cells = tracking.rows[k.key];
              const latest = [...cells.slice(0, idx + 1)].reverse().find((c) => c && c.value !== null) ?? null;
              return (
                <tr key={k.key}>
                  <td className="kpi-num">{k.num}</td>
                  <td className="kpi-name" style={{ whiteSpace: 'nowrap' }}>{d.kpi[k.key].name}</td>
                  <td className="num faint">{targetRule(ds.targets[k.key], k.unit, i)}</td>
                  {cells.map((c, m) => (
                    <td key={m} className={`rag-cell ${c?.rag ?? ''} ${m === idx ? 'current' : ''}`} title={c ? `n = ${c.n}${c.rag ? ' · ' + d.rag[c.rag] : ''}` : ''}>
                      {c && c.value !== null ? i.kpi(c.value, k.unit) : ''}
                      {c?.rag && <span className="letter">{c.rag[0]}</span>}
                    </td>
                  ))}
                  <td><RagChip rag={latest?.rag ?? null} /></td>
                  <td className="num">{cells.filter((c) => c?.rag === 'GREEN').length}</td>
                  <td className="num">{cells.filter((c) => c?.rag === 'RED').length}</td>
                </tr>
              );
            })}
            <tr>
              <td /><td className="faint">{d.tracking.counts}</td><td />
              {tracking.months.map((m, k) => {
                if (k > idx) return <td key={m} />;
                const c = (r: string) => KPIS.filter((x) => tracking.rows[x.key][k]?.rag === r).length;
                return <td key={m} className="num faint" style={{ fontSize: 12 }}>{c('GREEN')}/{c('AMBER')}/{c('RED')}</td>;
              })}
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
