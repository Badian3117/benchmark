import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';

export function AuditPage() {
  const { store, ds } = useApp();
  const i = useI18n();
  const d = i.d;
  void ds; // re-render on every change
  const rows = store.auditTrail(500);
  const where = (log: string) => (log in d.logs ? d.logs[log as keyof typeof d.logs].title : log);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{d.audit.title}</h1>
          <p className="muted">{d.audit.intro}</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{d.audit.when}</th><th>{d.audit.who}</th><th>{d.audit.what}</th><th>{d.audit.where}</th><th>{d.audit.item}</th></tr></thead>
          <tbody>
            {rows.map((r, k) => (
              <tr key={k}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.ts).toLocaleString(i.locale)}</td>
                <td>{r.user || '—'}</td>
                <td><span className="tag">{r.action}</span></td>
                <td>{where(r.log)}</td>
                <td>{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">{d.common.noData}</div>}
      </div>
    </>
  );
}
