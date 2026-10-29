import { useMemo, useState } from 'react';
import { makeCtx, nowLocal } from '../../engine/analysis.ts';
import { monthStart } from '../../engine/dates.ts';
import { KPIS, KPI_BY_KEY } from '../../engine/kpis.ts';
import { LOG_BY_KEY, type FieldDef, type LogKey, type Row } from '../../engine/schema.ts';
import { isLocked, validateRow, type Finding } from '../../engine/validate.ts';
import { useI18n } from '../../i18n/index.ts';
import { newId, nextCode } from '../../io/ids.ts';
import { useApp } from '../context.ts';
import { Drawer, formatValue } from './common.tsx';
import { useSession } from '../session.ts';
import { canCreate, canEdit, presetFor, writableProjects } from '../../engine/permissions.ts';

/** For corrective actions the before/after values are entered in the KPI's own unit (82 for 82 %). */
function scaleFor(log: LogKey, field: string, row: Row) {
  if (log !== 'actions' || (field !== 'before' && field !== 'after')) return 1;
  const k = KPI_BY_KEY[row.kpi as keyof typeof KPI_BY_KEY];
  return k?.unit === 'pct' ? 100 : 1;
}

export function RecordEditor({ log, rowId, preset, onClose }: { log: LogKey; rowId: string | null; preset?: Partial<Row>; onClose: () => void }) {
  const { store, ds, today, period } = useApp();
  const { who } = useSession();
  const i = useI18n();
  const d = i.d;
  const def = LOG_BY_KEY[log];
  const existing = rowId ? ds.logs[log].find((r) => r.id === rowId) : undefined;

  const [row, setRow] = useState<Row>(() => {
    if (existing) return { ...existing };
    const r: Row = { id: newId() };
    for (const f of def.fields) r[f.key] = null;
    if (def.codeField && def.idPrefix) r[def.codeField] = nextCode(def.idPrefix, ds.logs[log].map((x) => x[def.codeField!]));
    const dateF = def.fields.find((f) => f.key === def.dateField);
    if (dateF?.type === 'month') r[def.dateField] = period.month;
    else if (dateF?.type === 'date') r[def.dateField] = today;
    else if (dateF?.type === 'datetime') r[def.dateField] = nowLocal();
    if (log === 'actions' || log === 'risks' || log === 'issues') r.status = 'Open';
    if (log === 'changes') r.decision = 'Pending';
    if (log === 'projects') r.status = 'Active';
    if (log === 'milestones') r.status = 'Not started';
    if (log === 'ci') r.status = 'Proposed';
    if (log === 'gates') r.status = 'Pending';
    if (log === 'variations') { r.status = 'Instructed'; r.instructionType = 'Written'; }
    if (log === 'explosives') r.unit = 'kg';
    return { ...r, ...presetFor(log, who), ...preset };
  });
  const [touched, setTouched] = useState(false);

  const findings = useMemo(() => validateRow(ds, log, row, today), [ds, log, row, today]);
  const byField = new Map<string, Finding[]>();
  for (const f of findings) byField.set(f.field ?? '', [...(byField.get(f.field ?? '') ?? []), f]);
  const errors = findings.filter((f) => f.severity === 'error');
  const lockedNow = isLocked(ds, log, row) || (existing ? isLocked(ds, log, existing) : false);
  // the server enforces the same rule; here it decides whether the form is editable
  const allowed = existing ? canEdit(ds, log, existing, who) : canCreate(log, who);
  const readOnly = lockedNow || !allowed;
  const ctx = makeCtx(ds, period.asOf);

  const set = (k: string, v: unknown) => setRow((r) => ({ ...r, [k]: v }));

  const save = () => {
    setTouched(true);
    if (errors.length || readOnly) return;
    store.upsert(log, row);
    onClose();
  };
  const remove = () => {
    if (!existing || readOnly) return;
    if (confirm(d.common.deleteConfirm)) {
      store.remove(log, existing.id);
      onClose();
    }
  };

  const msg = (f: Finding) => i.t((d.validation as Record<string, string>)[f.code] ?? f.code, {
    ...f.params,
    ...(f.params?.a ? { a: (d.fields as Record<string, string>)[String(f.params.a)] ?? String(f.params.a) } : {}),
    ...(f.params?.date ? { date: i.date(f.params.date) } : {}),
  });

  const input = (f: FieldDef) => {
    const v = row[f.key];
    const common = { id: `f-${f.key}`, disabled: readOnly, onBlur: () => setTouched(true) };
    switch (f.type) {
      case 'longtext':
        return <textarea {...common} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value || null)} />;
      case 'date':
        return <input {...common} type="date" value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value || null)} />;
      case 'datetime':
        return <input {...common} type="datetime-local" value={typeof v === 'string' ? v.slice(0, 16) : ''} onChange={(e) => set(f.key, e.target.value ? e.target.value.slice(0, 16) : null)} />;
      case 'month':
        return <input {...common} type="month" value={typeof v === 'string' ? v.slice(0, 7) : ''} onChange={(e) => set(f.key, e.target.value ? monthStart(e.target.value + '-01') : null)} />;
      case 'number': case 'money': case 'percent': {
        const sc = scaleFor(log, f.key, row);
        const shown = typeof v === 'number' ? +(v * sc).toFixed(6) : '';
        return <input {...common} type="number" step="any" value={shown} onChange={(e) => set(f.key, e.target.value === '' ? null : Number(e.target.value) / sc)} />;
      }
      case 'score':
        return (
          <select {...common} value={v === null || v === undefined ? '' : String(v)} onChange={(e) => set(f.key, e.target.value ? Number(e.target.value) : null)}>
            <option value="">{d.form.select}</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        );
      case 'yesno':
        return (
          <select {...common} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value || null)}>
            <option value="">{d.form.select}</option>
            <option value="Yes">{d.common.yes}</option>
            <option value="No">{d.common.no}</option>
          </select>
        );
      case 'list': {
        const items = ds.settings.lists[f.list!] ?? [];
        const opts = typeof v === 'string' && v && !items.includes(v) ? [...items, v] : items;
        return (
          <select {...common} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value || null)}>
            <option value="">{d.form.select}</option>
            {opts.map((o) => <option key={o} value={o}>{i.v(o)}</option>)}
          </select>
        );
      }
      case 'project':
        return (
          <select {...common} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value || null)}>
            <option value="">{d.form.select}</option>
            {(readOnly ? ds.logs.projects : writableProjects(ds, who)).map((p) => <option key={p.id} value={String(p.code)}>{String(p.code)} – {String(p.name ?? '')}</option>)}
          </select>
        );
      case 'kpi':
        return (
          <select {...common} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value || null)}>
            <option value="">{d.form.select}</option>
            {KPIS.map((k) => <option key={k.key} value={k.key}>#{k.num} {d.kpi[k.key].name}</option>)}
          </select>
        );
      default:
        return <input {...common} type="text" value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value || null)} />;
    }
  };

  const unitHint = (f: FieldDef) => {
    const sc = scaleFor(log, f.key, row);
    if (log === 'actions' && (f.key === 'before' || f.key === 'after') && row.kpi) {
      const k = KPI_BY_KEY[row.kpi as keyof typeof KPI_BY_KEY];
      return k ? ` (${sc === 100 ? '%' : d.units[k.unit]})` : '';
    }
    return '';
  };

  return (
    <Drawer
      title={existing ? i.t(d.form.editTitle, { id: String((def.codeField && row[def.codeField]) || d.logs[log].title) }) : i.t(d.form.newTitle, { log: d.logs[log].title })}
      onClose={onClose}
      footer={
        <>
          {existing && !readOnly && <button className="btn danger left" onClick={remove}>{d.common.delete}</button>}
          {touched && errors.length > 0 && <span className="save-state err">{d.common.fixFirst}</span>}
          <button className="btn" onClick={onClose}>{d.common.cancel}</button>
          {!readOnly && <button className="btn primary" onClick={save}>{d.common.save}</button>}
        </>
      }
    >
      <p className="muted">{d.logs[log].desc}</p>
      {lockedNow && <div className="notice warn">{d.form.lockedHint}</div>}
      {!lockedNow && !allowed && <div className="notice info">{who?.role === 'executive' ? d.sync.readOnly : d.sync.notYours}</div>}
      <div className="form-grid">
        {def.fields.map((f) => {
          const fs = byField.get(f.key) ?? [];
          const showErr = touched || !existing ? fs : fs.filter((x) => x.severity === 'warning');
          const hasErr = touched && fs.some((x) => x.severity === 'error');
          return (
            <div key={f.key} className={`field ${f.type === 'longtext' ? 'full' : ''} ${hasErr ? 'has-error' : ''}`}>
              <label htmlFor={`f-${f.key}`}>
                {(d.fields as Record<string, string>)[f.key] ?? f.key}{unitHint(f)}
                {f.required && <span className="req">*</span>}
              </label>
              {input(f)}
              {(touched ? showErr : showErr.filter((x) => x.code !== 'required')).map((x, k) => (
                <span key={k} className={`msg ${x.severity}`}>{msg(x)}</span>
              ))}
            </div>
          );
        })}
      </div>
      {def.computed.length > 0 && (
        <div className="computed-box" title={d.form.computedHint}>
          {def.computed.map((c) => (
            <div key={c.key}>
              <span>{(d.fields as Record<string, string>)[c.key] ?? c.key}</span>
              <b>{formatValue(i, c.fn(row, ctx), c.type) || '—'}</b>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
