import { LOG_BY_KEY } from '../../engine/schema.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';
import { StatusIcon } from '../components/common.tsx';

export function DataQuality() {
  const { ds, findings, edit } = useApp();
  const i = useI18n();
  const d = i.d;
  const errors = findings.filter((f) => f.severity === 'error').length;
  const label = (k: string) => (d.fields as Record<string, string>)[k] ?? k;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{d.quality.title}</h1>
          <p className="muted">{d.quality.intro}</p>
        </div>
        <div className="tiles" style={{ gridTemplateColumns: 'repeat(2, 140px)' }}>
          <div className={`tile ${errors ? 'RED' : 'GREEN'}`}><div className="lbl">{d.quality.errors}</div><div className="big">{errors}</div></div>
          <div className={`tile ${findings.length - errors ? 'AMBER' : 'GREEN'}`}><div className="lbl">{d.quality.warnings}</div><div className="big">{findings.length - errors}</div></div>
        </div>
      </div>
      {findings.length === 0 ? (
        <div className="notice ok">{d.quality.clean}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th /><th>{d.audit.where}</th><th>{d.quality.record}</th><th>{d.quality.field}</th><th>{d.quality.problem}</th></tr></thead>
            <tbody>
              {[...findings].sort((a, b) => (a.severity === b.severity ? a.log.localeCompare(b.log) : a.severity === 'error' ? -1 : 1)).map((f, k) => {
                const def = LOG_BY_KEY[f.log];
                const row = ds.logs[f.log].find((r) => r.id === f.rowId);
                const name = row ? String((def.codeField && row[def.codeField]) || [row[def.dateField], row.project ?? row.team].filter(Boolean).join(' · ')) : f.rowId;
                const params = { ...f.params, ...(f.params?.a ? { a: label(String(f.params.a)) } : {}), ...(f.params?.date ? { date: i.date(f.params.date) } : {}) };
                return (
                  <tr key={k} className="clickable" onClick={() => edit(f.log, f.rowId)}>
                    <td><StatusIcon rag={f.severity === 'error' ? 'RED' : 'AMBER'} /></td>
                    <td>{d.logs[f.log].title}</td>
                    <td><b>{name}</b></td>
                    <td>{f.field ? label(f.field) : ''}</td>
                    <td>{i.t((d.validation as Record<string, string>)[f.code] ?? f.code, params)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
