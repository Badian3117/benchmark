import { useState } from 'react';
import { monthStart, yearMonths } from '../../engine/dates.ts';
import { LOGS, type ListKey, type Settings } from '../../engine/schema.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';

const LIST_LABEL: Record<ListKey, string> = {
  projectStatus: 'status', priority: 'priority', changeType: 'type', crDecision: 'decision', riskStatus: 'status', riskCategory: 'category',
  issueStatus: 'status', milestoneStatus: 'status', actionStatus: 'status', ciStatus: 'status', owners: 'owner', sites: 'site',
  stakeholderGroups: 'group', disciplines: 'discipline',
};
const LIST_LOG: Partial<Record<ListKey, string>> = {
  projectStatus: 'projects', riskStatus: 'risks', issueStatus: 'issues', milestoneStatus: 'milestones', actionStatus: 'actions', ciStatus: 'ci',
};

export function SettingsPage() {
  const { ds, store } = useApp();
  const i = useI18n();
  const d = i.d;
  const s = ds.settings;
  const [notes, setNotes] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<ListKey, string>>>({});
  const update = (patch: Partial<Settings>) => store.setSettings({ ...s, ...patch });
  const months = yearMonths(s.yearStart);

  /** values of a list currently used by any record */
  const used = (lk: ListKey) => {
    const out = new Set<string>();
    for (const def of LOGS) for (const f of def.fields) if (f.list === lk) for (const r of ds.logs[def.key]) if (typeof r[f.key] === 'string') out.add(r[f.key] as string);
    return out;
  };
  const commitList = (lk: ListKey) => {
    const text = drafts[lk];
    if (text === undefined) return;
    const items = [...new Set(text.split('\n').map((x) => x.trim()).filter(Boolean))];
    const inUse = used(lk);
    const kept = [...inUse].filter((v) => !items.includes(v));
    setNotes(kept.map((v) => i.t(d.settings.inUse, { v })));
    update({ lists: { ...s.lists, [lk]: [...items, ...kept] } });
    setDrafts({ ...drafts, [lk]: undefined });
  };

  const listTitle = (lk: ListKey) => {
    const f = (d.fields as Record<string, string>)[LIST_LABEL[lk]] ?? lk;
    const log = LIST_LOG[lk];
    return log ? `${f} – ${d.logs[log as keyof typeof d.logs].title}` : f;
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>{d.settings.title}</h1>
      <div className="card" style={{ margin: '16px 0' }}>
        <h2>{d.settings.general}</h2>
        <div className="kv">
          <label>{d.settings.orgName}</label>
          <input type="text" defaultValue={s.orgName} onBlur={(e) => e.target.value !== s.orgName && update({ orgName: e.target.value })} />
          <label>{d.settings.preparedBy}</label>
          <input type="text" defaultValue={s.preparedBy} onBlur={(e) => e.target.value !== s.preparedBy && update({ preparedBy: e.target.value })} />
          <label>{d.settings.userName}</label>
          <input type="text" defaultValue={s.userName} onBlur={(e) => e.target.value !== s.userName && update({ userName: e.target.value })} />
          <label>{d.settings.currency}</label>
          <input type="text" defaultValue={s.currency} onBlur={(e) => e.target.value !== s.currency && update({ currency: e.target.value.toUpperCase() })} />
          <label>{d.settings.yearStart}</label>
          <input type="month" value={s.yearStart.slice(0, 7)} onChange={(e) => e.target.value && update({ yearStart: monthStart(e.target.value + '-01') })} />
          <label>{d.settings.reportingMonth}</label>
          <select value={s.reportingMonth ?? ''} onChange={(e) => update({ reportingMonth: e.target.value || null })}>
            <option value="">{d.settings.followToday}</option>
            {months.map((m) => <option key={m} value={m}>{i.monthLabel(m, true)}</option>)}
          </select>
          <label>{d.settings.budgetTolerance}</label>
          <input type="number" step="0.5" defaultValue={+(s.budgetTolerance * 100).toFixed(4)} onBlur={(e) => update({ budgetTolerance: Number(e.target.value) / 100 })} />
          <label>{d.settings.daysLateTolerance}</label>
          <input type="number" step="1" defaultValue={s.daysLateTolerance} onBlur={(e) => update({ daysLateTolerance: Number(e.target.value) })} />
          <label>{d.settings.lock}<div className="faint" style={{ fontSize: 12, fontWeight: 400 }}>{d.settings.lockHint}</div></label>
          <select value={s.lockedThrough ?? ''} onChange={(e) => update({ lockedThrough: e.target.value || null })}>
            <option value="">{d.settings.noLock}</option>
            {months.map((m) => <option key={m} value={m}>{i.monthLabel(m, true)}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <h2>{d.settings.lists}</h2>
        <p className="faint">{d.settings.listsHint}</p>
        {notes.map((n) => <div key={n} className="notice warn">{n}</div>)}
        <div className="list-editors">
          {(Object.keys(s.lists) as ListKey[]).map((lk) => (
            <div key={lk} className="field">
              <label>{listTitle(lk)}</label>
              <textarea value={drafts[lk] ?? s.lists[lk].join('\n')} onChange={(e) => setDrafts({ ...drafts, [lk]: e.target.value })} onBlur={() => commitList(lk)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
