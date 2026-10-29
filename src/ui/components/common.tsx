import { useEffect, type ReactNode } from 'react';
import { KPI_BY_KEY, type KpiKey, type KpiTarget, type Rag, type Trend, type Unit } from '../../engine/kpis.ts';
import type { ComputedType, FieldType } from '../../engine/schema.ts';
import { useI18n, type I18n } from '../../i18n/index.ts';
import type { Severity } from '../../engine/analysis.ts';

/** Status never relies on colour alone: every chip has an icon and a word. */
export function StatusIcon({ rag, size = 12 }: { rag: Rag | 'NODATA'; size?: number }) {
  const s = size;
  if (rag === 'GREEN')
    return (
      <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden>
        <circle cx="6" cy="6" r="6" fill="var(--good)" />
        <path d="M3.3 6.2l1.8 1.8 3.6-3.8" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (rag === 'AMBER')
    return (
      <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden>
        <path d="M6 .6l5.6 10.2H.4z" fill="var(--warning)" />
        <path d="M6 4.2v3.2M6 9.1v.1" stroke="#3a2a00" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  if (rag === 'RED')
    return (
      <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden>
        <rect x=".5" y=".5" width="11" height="11" rx="2.5" fill="var(--critical)" />
        <path d="M3.8 3.8l4.4 4.4M8.2 3.8L3.8 8.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden>
      <circle cx="6" cy="6" r="5" fill="none" stroke="var(--text-3)" strokeWidth="1.4" strokeDasharray="2 2" />
    </svg>
  );
}

export function RagChip({ rag }: { rag: Rag | null }) {
  const { d } = useI18n();
  const r = rag ?? 'NODATA';
  return (
    <span className={`chip ${r}`}>
      <StatusIcon rag={r} />
      {d.rag[r]}
    </span>
  );
}

export function SeverityChip({ s }: { s: Severity }) {
  const { d } = useI18n();
  const map: Record<Severity, Rag> = { critical: 'RED', serious: 'RED', warning: 'AMBER' };
  return (
    <span className={`chip ${s}`}>
      <StatusIcon rag={map[s]} />
      {d.severity[s]}
    </span>
  );
}

export function TrendText({ t }: { t: Trend | null }) {
  const { d } = useI18n();
  if (!t) return <span className="faint">—</span>;
  const arrow = t === 'better' ? '▲' : t === 'worse' ? '▼' : '►';
  return <span className={`trend ${t}`}>{arrow} {d.trend[t]}</span>;
}

/** "≥ 90.0 %", "≤ 7.0 d", "95.0–102.0 %" */
export function targetRule(t: KpiTarget, unit: Unit, i: I18n, which: 'green' | 'amber' = 'green') {
  const f = (x: number | undefined) => (x === undefined ? '?' : i.kpi(x, unit));
  if (t.direction === 'Band') {
    return which === 'green' ? `${f(t.greenLo)} – ${f(t.greenHi)}` : `${f(t.amberLo)} – ${f(t.amberHi)}`;
  }
  const op = t.direction === 'Higher' ? '≥' : '≤';
  return `${op} ${f(which === 'green' ? t.target : t.amber)}`;
}

export function kpiName(i: I18n, key: string) {
  return key in KPI_BY_KEY ? i.d.kpi[key as KpiKey].name : key;
}

export function formatValue(i: I18n, v: unknown, type: FieldType | ComputedType): string {
  if (v === null || v === undefined || v === '') return '';
  switch (type) {
    case 'date': return i.date(v);
    case 'datetime': return typeof v === 'string' ? `${i.date(v.slice(0, 10))} ${v.slice(11, 16)}` : '';
    case 'hours': return typeof v === 'number' ? i.num(v, 1) + ' h' : String(v);
    case 'month': return typeof v === 'string' ? i.monthLabel(v, true) : '';
    case 'money': return typeof v === 'number' ? i.num(v) : String(v);
    case 'percent': return typeof v === 'number' ? i.pct(v) : String(v);
    case 'ratio': return typeof v === 'number' ? i.num(v, 2) : String(v);
    case 'number': return typeof v === 'number' ? (Number.isInteger(v) ? i.num(v) : i.num(v, 2)) : String(v);
    case 'days': return typeof v === 'number' ? i.num(v) : String(v);
    case 'yesno': case 'list': case 'text': return i.v(v);
    case 'kpi': return kpiName(i, String(v));
    default: return String(v);
  }
}

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn small" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

function useEscape(fn: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && fn();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fn]);
}

export function Logo({ size = 34 }: { size?: number }) {
  // a stepped pit bench rising to a target marker – "BenchMark"
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 34 34" aria-hidden>
      <rect width="34" height="34" rx="8" fill="#2a78d6" />
      <path d="M5 27h7v-5h6v-5h6v-5h5" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="27.5" cy="8.5" r="3" fill="#fab219" />
    </svg>
  );
}
