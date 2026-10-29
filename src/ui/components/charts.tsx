import { useState, type ReactNode } from 'react';
import type { KpiCell, KpiTarget, Rag, Unit } from '../../engine/kpis.ts';
import { useI18n } from '../../i18n/index.ts';
import { StatusIcon } from './common.tsx';

const W = 360;

function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** Bar with 4px rounded data-end, square at the baseline. */
function barPath(x: number, w: number, y0: number, y1: number) {
  const r = Math.min(4, w / 2, Math.abs(y1 - y0));
  if (y1 <= y0) {
    // grows upward
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
}

function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return <div className="chart-tip" style={{ left: `${(x / W) * 100}%`, top: y }}>{children}</div>;
}

function MiniStatus({ rag, cx, cy }: { rag: Rag; cx: number; cy: number }) {
  if (rag === 'GREEN') return <circle cx={cx} cy={cy} r={3.6} fill="var(--good)" />;
  if (rag === 'AMBER') return <path d={`M${cx},${cy - 4} L${cx + 4.2},${cy + 3.4} L${cx - 4.2},${cy + 3.4} Z`} fill="var(--warning)" />;
  return <rect x={cx - 3.4} y={cy - 3.4} width={6.8} height={6.8} rx={1.4} fill="var(--critical)" />;
}

export function KpiChart({ months, cells, target, unit, reportIdx, height = 170 }: {
  months: string[]; cells: (KpiCell | null)[]; target: KpiTarget; unit: Unit; reportIdx: number; height?: number;
}) {
  const i = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const top = 10, bottom = 36, left = 44, right = 6;
  const plotH = height - top - bottom;
  const vals = cells.map((c) => c?.value ?? null);
  const refs = target.direction === 'Band'
    ? [target.greenLo, target.greenHi].filter((x): x is number => x !== undefined)
    : [target.target];
  const all = [0, ...vals.filter((v): v is number => v !== null), ...refs];
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
  hi += pad;
  if (lo < 0) lo -= pad;
  const ticks = niceTicks(lo, hi);
  lo = Math.min(lo, ticks[0]);
  hi = Math.max(hi, ticks[ticks.length - 1]);
  const y = (v: number) => top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const step = (W - left - right) / months.length;
  const bw = Math.max(4, step * 0.56);
  const y0 = y(0);

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="chart">
        <g className="grid">
          {ticks.map((t) => <line key={t} x1={left} x2={W - right} y1={y(t)} y2={y(t)} />)}
        </g>
        <g className="axis">
          {ticks.map((t) => <text key={t} x={left - 6} y={y(t) + 3} textAnchor="end">{i.kpi(t, unit)}</text>)}
          {months.map((m, k) => (
            <text key={m} x={left + step * k + step / 2} y={height - 22} textAnchor="middle" fontWeight={k === reportIdx ? 700 : 400}>
              {i.monthLabel(m).slice(0, 3)}
            </text>
          ))}
        </g>
        {target.direction === 'Band' && target.greenLo !== undefined && target.greenHi !== undefined && (
          <rect x={left} width={W - left - right} y={y(target.greenHi)} height={Math.max(1, y(target.greenLo) - y(target.greenHi))} fill="var(--band)" />
        )}
        <line x1={left} x2={W - right} y1={y0} y2={y0} stroke="var(--border-strong)" strokeWidth={1} />
        {vals.map((v, k) =>
          v === null ? null : (
            <path key={k} d={barPath(left + step * k + (step - bw) / 2, bw, y0, y(v))} fill="var(--series-1)" opacity={hover === null || hover === k ? 1 : 0.55} />
          ),
        )}
        {target.direction !== 'Band' && (
          <line x1={left} x2={W - right} y1={y(target.target)} y2={y(target.target)} stroke="var(--text-2)" strokeWidth={1.5} strokeDasharray="5 3" />
        )}
        {cells.map((c, k) => c?.rag ? <MiniStatus key={k} rag={c.rag} cx={left + step * k + step / 2} cy={height - 8} /> : null)}
        {months.map((_, k) => (
          <rect key={k} x={left + step * k} y={top} width={step} height={height - top} fill="transparent" onMouseEnter={() => setHover(k)} />
        ))}
      </svg>
      {hover !== null && (
        <Tip x={left + step * hover + step / 2} y={Math.min(y(vals[hover] ?? 0), y0) - 4}>
          <div className="faint">{i.monthLabel(months[hover], true)}</div>
          {cells[hover] ? (
            <>
              <b>{i.kpi(cells[hover]!.value, unit)}</b>
              {cells[hover]!.rag && <> · {i.d.rag[cells[hover]!.rag!]}</>}
              <div className="faint">n = {cells[hover]!.n}</div>
            </>
          ) : (
            <span className="faint">—</span>
          )}
        </Tip>
      )}
    </div>
  );
}

export function RagHistory({ months, counts, reportIdx }: {
  months: string[]; counts: ({ GREEN: number; AMBER: number; RED: number; NODATA: number } | null)[]; reportIdx: number;
}) {
  const i = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const height = 190, top = 8, bottom = 22, left = 26, right = 4;
  const total = Math.max(1, ...counts.map((c) => (c ? c.GREEN + c.AMBER + c.RED + c.NODATA : 0)));
  const plotH = height - top - bottom;
  const step = (W - left - right) / months.length;
  const bw = Math.max(6, step * 0.6);
  const order: (keyof NonNullable<(typeof counts)[number]>)[] = ['GREEN', 'AMBER', 'RED', 'NODATA'];
  const color = { GREEN: 'var(--good)', AMBER: 'var(--warning)', RED: 'var(--critical)', NODATA: 'var(--surface-2)' };
  const ticks = niceTicks(0, total, 3);
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="RAG history">
        <g className="grid">{ticks.map((t) => <line key={t} x1={left} x2={W - right} y1={top + plotH - (t / total) * plotH} y2={top + plotH - (t / total) * plotH} />)}</g>
        <g className="axis">
          {ticks.map((t) => <text key={t} x={left - 5} y={top + plotH - (t / total) * plotH + 3} textAnchor="end">{t}</text>)}
          {months.map((m, k) => (
            <text key={m} x={left + step * k + step / 2} y={height - 6} textAnchor="middle" fontWeight={k === reportIdx ? 700 : 400}>{i.monthLabel(m).slice(0, 3)}</text>
          ))}
        </g>
        {counts.map((c, k) => {
          if (!c) return null;
          let acc = 0;
          const x = left + step * k + (step - bw) / 2;
          return order.map((key) => {
            const v = c[key];
            if (!v) return null;
            const yTop = top + plotH - ((acc + v) / total) * plotH;
            const h = (v / total) * plotH;
            acc += v;
            // 2px surface gap between stacked segments
            return <rect key={key} x={x} y={yTop + 1} width={bw} height={Math.max(0, h - 2)} rx={2} fill={color[key]} stroke={key === 'NODATA' ? 'var(--border-strong)' : 'none'} opacity={hover === null || hover === k ? 1 : 0.6} />;
          });
        })}
        {months.map((_, k) => <rect key={k} x={left + step * k} y={top} width={step} height={plotH} fill="transparent" onMouseEnter={() => setHover(k)} />)}
      </svg>
      {hover !== null && counts[hover] && (
        <Tip x={left + step * hover + step / 2} y={top + 10}>
          <div className="faint">{i.monthLabel(months[hover], true)}</div>
          {order.map((k) => <div key={k}><StatusIcon rag={k} size={10} /> {i.d.rag[k]}: <b>{counts[hover]![k]}</b></div>)}
        </Tip>
      )}
      <div className="legend">
        {order.map((k) => <span key={k}><StatusIcon rag={k} size={10} /> {i.d.rag[k]}</span>)}
      </div>
    </div>
  );
}
