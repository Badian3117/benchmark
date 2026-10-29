import { useState } from 'react';
import { KPIS, KPI_BY_KEY, type KpiKey, type KpiTarget } from '../../engine/kpis.ts';
import { useI18n } from '../../i18n/index.ts';
import { newId } from '../../io/ids.ts';
import { useApp } from '../context.ts';
import { Modal, kpiName, targetRule } from '../components/common.tsx';

export function Targets() {
  const { ds, store } = useApp();
  const i = useI18n();
  const d = i.d;
  const [editing, setEditing] = useState<KpiKey | null>(null);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{d.targets.title}</h1>
          <p className="muted">{d.targets.intro}</p>
        </div>
      </div>
      <div className="table-wrap auto" style={{ marginBottom: 20 }}>
        <table className="def-table">
          <thead>
            <tr>
              <th>#</th><th>KPI</th><th>{d.targets.calc}</th><th>{d.targets.rule}</th><th className="num">{d.targets.green}</th>
              <th className="num">{d.targets.amber}</th><th>{d.targets.owner}</th><th>{d.targets.source}</th><th />
            </tr>
          </thead>
          <tbody>
            {KPIS.map((k) => {
              const t = ds.targets[k.key];
              return (
                <tr key={k.key}>
                  <td className="kpi-num">{k.num}</td>
                  <td style={{ minWidth: 200 }}>
                    <div className="kpi-name">{d.kpi[k.key].name}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{d.kpi[k.key].what}</div>
                  </td>
                  <td className="wrap" style={{ fontSize: 12 }}>
                    {d.kpi[k.key].calc}
                    <div className="faint" style={{ marginTop: 4 }}>⚑ {d.kpi[k.key].notes}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{d.direction[t.direction]}<div className="faint" style={{ fontSize: 11 }}>{d.basis[k.basis]} · {d.units[k.unit]}</div></td>
                  <td className="num">{targetRule(t, k.unit, i)}</td>
                  <td className="num">{targetRule(t, k.unit, i, 'amber')}</td>
                  <td>
                    <select value={t.owner} onChange={(e) => store.setTargetOwner(k.key, e.target.value)}>
                      <option value="">—</option>
                      {[...new Set([...ds.settings.lists.owners, t.owner].filter(Boolean))].map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className="faint" style={{ fontSize: 12 }}>{k.sources.map((s) => d.logs[s].title).join(' + ')}</td>
                  <td><button className="btn small" onClick={() => setEditing(k.key)}>{d.targets.edit}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>{d.targets.revisions}</h2>
      <div className="table-wrap auto">
        <table>
          <thead><tr><th>{d.fields.date}</th><th>KPI</th><th>{d.fields.before}</th><th>{d.fields.after}</th><th>{d.fields.reason}</th><th>{d.fields.proposedBy}</th><th>{d.fields.approvedBy}</th></tr></thead>
          <tbody>
            {[...ds.logs.targetRevisions].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((r) => (
              <tr key={r.id}>
                <td>{i.date(r.date)}</td><td>{kpiName(i, String(r.kpi))}</td><td>{String(r.before ?? '')}</td><td>{String(r.after ?? '')}</td>
                <td className="wrap">{String(r.reason ?? '')}</td><td>{String(r.proposedBy ?? '')}</td><td>{String(r.approvedBy ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ds.logs.targetRevisions.length === 0 && <div className="empty">{d.common.noData}</div>}
      </div>
      {editing && <TargetDialog k={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TargetDialog({ k, onClose }: { k: KpiKey; onClose: () => void }) {
  const { ds, store, today } = useApp();
  const i = useI18n();
  const d = i.d;
  const def = KPI_BY_KEY[k];
  const cur = ds.targets[k];
  // percent KPIs are edited in % for readability and stored as decimals
  const sc = def.unit === 'pct' ? 100 : 1;
  const [t, setT] = useState<KpiTarget>({ ...cur });
  const [reason, setReason] = useState('');
  const [proposedBy, setProposedBy] = useState(ds.settings.userName || '');
  const [approvedBy, setApprovedBy] = useState('');
  const [err, setErr] = useState('');

  const numInput = (key: keyof KpiTarget, label: string) => (
    <div className="field">
      <label>{label}{sc === 100 ? ' (%)' : ''}</label>
      <input type="number" step="any" value={typeof t[key] === 'number' ? +((t[key] as number) * sc).toFixed(6) : ''}
        onChange={(e) => setT({ ...t, [key]: e.target.value === '' ? undefined : Number(e.target.value) / sc })} />
    </div>
  );

  const consistent = () => {
    if (t.direction === 'Band') {
      const { greenLo: gl, greenHi: gh, amberLo: al, amberHi: ah } = t;
      return [gl, gh, al, ah].every((x) => typeof x === 'number') && al! <= gl! && gl! <= gh! && gh! <= ah!;
    }
    if (typeof t.target !== 'number' || typeof t.amber !== 'number') return false;
    return t.direction === 'Higher' ? t.amber <= t.target : t.amber >= t.target;
  };

  const save = () => {
    if (!consistent()) return setErr(d.targets.inconsistent);
    if (!reason.trim() || !proposedBy || !approvedBy) return setErr(d.targets.reasonRequired);
    const describe = (x: KpiTarget) => `${d.direction[x.direction]}: ${targetRule(x, def.unit, i)} / ${targetRule(x, def.unit, i, 'amber')}`;
    store.setTarget(t, { id: newId(), date: today, kpi: k, before: describe(cur), after: describe(t), reason: reason.trim(), proposedBy, approvedBy });
    onClose();
  };
  const owners = ds.settings.lists.owners;

  return (
    <Modal onClose={onClose}>
      <h2>{d.targets.edit} – {d.kpi[k].name}</h2>
      <p className="faint" style={{ fontSize: 12 }}>{d.targets.unitHint}</p>
      <div className="form-grid">
        <div className="field full">
          <label>{d.targets.rule}</label>
          <select value={t.direction} onChange={(e) => {
            const dir = e.target.value as KpiTarget['direction'];
            setT(dir === 'Band' && t.greenLo === undefined
              ? { ...t, direction: dir, greenLo: t.target, greenHi: t.target, amberLo: t.target, amberHi: t.target }
              : { ...t, direction: dir });
          }}>
            {(['Higher', 'Lower', 'Band'] as const).map((x) => <option key={x} value={x}>{d.direction[x]}</option>)}
          </select>
        </div>
        {t.direction === 'Band' ? (
          <>
            {numInput('greenLo', d.targets.greenLo)}{numInput('greenHi', d.targets.greenHi)}
            {numInput('amberLo', d.targets.amberLo)}{numInput('amberHi', d.targets.amberHi)}
          </>
        ) : (
          <>{numInput('target', d.targets.targetV)}{numInput('amber', d.targets.amberV)}</>
        )}
        <div className="field full">
          <label>{d.targets.reason}<span className="req">*</span></label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="field">
          <label>{d.targets.proposedBy}<span className="req">*</span></label>
          <select value={proposedBy} onChange={(e) => setProposedBy(e.target.value)}>
            <option value="">{d.form.select}</option>
            {[...new Set([...owners, proposedBy].filter(Boolean))].map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{d.targets.approvedBy}<span className="req">*</span></label>
          <select value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)}>
            <option value="">{d.form.select}</option>
            {owners.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>
      {err && <div className="notice err" style={{ marginTop: 12 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={onClose}>{d.common.cancel}</button>
        <button className="btn primary" onClick={save}>{d.common.save}</button>
      </div>
    </Modal>
  );
}
