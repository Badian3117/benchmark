import { useMemo, useState } from 'react';
import { makeCtx } from '../../engine/analysis.ts';
import { KPI_BY_KEY } from '../../engine/kpis.ts';
import { LOG_BY_KEY, type LogKey, type Row } from '../../engine/schema.ts';
import { isLocked } from '../../engine/validate.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';
import { StatusIcon, formatValue } from '../components/common.tsx';

const LONG = new Set(['description', 'rootCause', 'action', 'mitigation', 'initiative', 'reason', 'name', 'milestone', 'deliverable']);

export function LogPage({ log }: { log: LogKey }) {
  const { ds, scope, findings, edit, period } = useApp();
  const i = useI18n();
  const d = i.d;
  const def = LOG_BY_KEY[log];
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const ctx = makeCtx(ds, period.asOf);
  const fields = def.fields.filter((f) => !f.formOnly);
  const flags = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const f of findings) if (f.log === log && m.get(f.rowId) !== 'error') m.set(f.rowId, f.severity);
    return m;
  }, [findings, log]);

  const cell = (r: Row, key: string) => {
    const c = def.computed.find((x) => x.key === key);
    if (c) return c.fn(r, ctx);
    return r[key];
  };
  const display = (r: Row, key: string) => {
    const f = def.fields.find((x) => x.key === key);
    const c = def.computed.find((x) => x.key === key);
    let v = cell(r, key);
    // corrective-action values are shown in the KPI's unit
    if (log === 'actions' && (key === 'before' || key === 'after') && typeof v === 'number') {
      const k = KPI_BY_KEY[r.kpi as keyof typeof KPI_BY_KEY];
      return k ? i.kpi(v, k.unit) : String(v);
    }
    if (c) return formatValue(i, v, c.type);
    if (f?.type === 'project') return String(v ?? '');
    return formatValue(i, v, f!.type);
  };

  let rows = ds.logs[log];
  // the site / PM / project filter applies to logs that have a project
  if (scope && (def.projectField || log === 'projects'))
    rows = rows.filter((r) => scope.has(String(log === 'projects' ? r.code : r[def.projectField!])));
  if (q) {
    const s = q.toLowerCase();
    rows = rows.filter((r) => [...def.fields.map((f) => display(r, f.key))].some((x) => x.toLowerCase().includes(s)));
  }
  if (sort) {
    rows = [...rows].sort((a, b) => {
      const x = cell(a, sort.key), y = cell(b, sort.key);
      if (x === y) return 0;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
    });
  }

  const head = (key: string, computed = false) => (
    <th key={key} className={`sortable ${computed ? 'computed' : ''}`} onClick={() => setSort(sort?.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: 1 })}>
      {(d.fields as Record<string, string>)[key] ?? key}
      {sort?.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const numeric = (key: string) => {
    const t = def.fields.find((f) => f.key === key)?.type ?? def.computed.find((c) => c.key === key)?.type;
    return t === 'number' || t === 'money' || t === 'percent' || t === 'ratio' || t === 'days' || t === 'score';
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{d.logs[log].title}</h1>
          <p className="muted">{d.logs[log].desc}</p>
        </div>
        {log !== 'targetRevisions' && <button className="btn primary" onClick={() => edit(log, null)}>+ {d.common.new}</button>}
      </div>
      <div className="toolbar">
        <input type="search" placeholder={d.common.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="faint">{i.t(d.common.rows, { n: rows.length })}{rows.length !== ds.logs[log].length ? ` ${d.common.of} ${ds.logs[log].length}` : ''}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              {fields.map((f) => head(f.key))}
              {def.computed.map((c) => head(c.key, true))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const flag = flags.get(r.id);
              return (
                <tr key={r.id} className="clickable" onClick={() => log !== 'targetRevisions' && edit(log, r.id)}>
                  <td className="row-flag" title={isLocked(ds, log, r) ? d.common.locked : ''}>
                    {flag ? <StatusIcon rag={flag === 'error' ? 'RED' : 'AMBER'} /> : isLocked(ds, log, r) ? '🔒' : ''}
                  </td>
                  {fields.map((f) => (
                    <td key={f.key} className={`${numeric(f.key) ? 'num' : ''} ${LONG.has(f.key) ? 'ellipsis' : ''}`} title={LONG.has(f.key) ? String(r[f.key] ?? '') : undefined}>
                      {display(r, f.key)}
                    </td>
                  ))}
                  {def.computed.map((c) => (
                    <td key={c.key} className={`computed ${numeric(c.key) ? 'num' : ''}`}>{display(r, c.key)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">{d.common.noData}</div>}
      </div>
    </>
  );
}
