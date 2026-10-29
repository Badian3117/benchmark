import { isISODate, monthEnd, todayISO, type ISODate } from './dates.ts';
import { KPI_BY_KEY, type Dataset } from './kpis.ts';
import { LOGS, LOG_BY_KEY, type LogKey, type Row } from './schema.ts';

export interface Finding {
  severity: 'error' | 'warning';
  log: LogKey;
  rowId: string;
  field?: string;
  code: string; // i18n key under validation.*
  params?: Record<string, string | number>;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const empty = (v: unknown) => v === null || v === undefined || v === '';

/** Field-level checks for one row – used both by the form (before save) and the data-quality page. */
export function validateRow(ds: Dataset, log: LogKey, row: Row, today: ISODate = todayISO()): Finding[] {
  const def = LOG_BY_KEY[log];
  const out: Finding[] = [];
  const f = (severity: Finding['severity'], code: string, field?: string, params?: Finding['params']) =>
    out.push({ severity, log, rowId: row.id, field, code, params });

  for (const fd of def.fields) {
    const v = row[fd.key];
    if (fd.required && empty(v)) { f('error', 'required', fd.key); continue; }
    if (empty(v)) continue;
    switch (fd.type) {
      case 'date': case 'month':
        if (!isISODate(v)) f('error', 'badDate', fd.key);
        break;
      case 'number': case 'money': case 'percent': case 'score':
        if (!isNum(v)) f('error', 'badNumber', fd.key);
        else if ((fd.min !== undefined && v < fd.min) || (fd.max !== undefined && v > fd.max))
          f('error', 'outOfRange', fd.key, { min: fd.min ?? '', max: fd.max ?? '' });
        break;
      case 'yesno':
        if (v !== 'Yes' && v !== 'No') f('error', 'badYesNo', fd.key);
        break;
      case 'project':
        if (!ds.logs.projects.some((p) => p.code === v)) f('error', 'unknownProject', fd.key, { value: String(v) });
        break;
      case 'kpi':
        if (!(String(v) in KPI_BY_KEY)) f('error', 'unknownKpi', fd.key, { value: String(v) });
        break;
    }
  }

  // ---- unique human ids ----
  if (def.codeField && !def.repeatCode && !empty(row[def.codeField])) {
    const dup = ds.logs[log].some((r) => r.id !== row.id && r[def.codeField!] === row[def.codeField!]);
    if (dup) f('error', 'duplicateId', def.codeField, { value: String(row[def.codeField]) });
  }

  // ---- chronology ----
  const before = (a: string, b: string) => {
    if (isISODate(row[a]) && isISODate(row[b]) && (row[b] as string) < (row[a] as string)) f('error', 'dateOrder', b, { a, b });
  };
  const notFuture = (k: string) => {
    if (isISODate(row[k]) && (row[k] as string) > today) f('warning', 'futureActual', k);
  };

  switch (log) {
    case 'projects':
      before('start', 'baselineFinish');
      before('start', 'actualFinish');
      if (row.status === 'Completed') {
        if (!isISODate(row.actualFinish)) f('error', 'completedNeeds', 'actualFinish');
        else notFuture('actualFinish');
        if (!isNum(row.eac)) f('error', 'completedNeeds', 'eac');
        if (empty(row.scopeDelivered)) f('error', 'completedNeeds', 'scopeDelivered');
        if (empty(row.deliverablesAccepted)) f('error', 'completedNeeds', 'deliverablesAccepted');
      }
      break;
    case 'costSchedule':
      if (isNum(row.ev) && isNum(row.ac) && row.ev > 0 && (row.ac as number) > 2 * (row.ev as number)) f('warning', 'acVsEv', 'ac');
      break;
    case 'changes':
      before('submitted', 'decisionDate');
      notFuture('decisionDate');
      if ((row.decision === 'Approved' || row.decision === 'Rejected') && !isISODate(row.decisionDate)) f('error', 'decisionNeedsDate', 'decisionDate');
      if (row.decision === 'Pending' && isISODate(row.decisionDate)) f('warning', 'pendingHasDate', 'decisionDate');
      if (row.implemented === 'Yes' && row.decision !== 'Approved') f('error', 'implementedNotApproved', 'implemented');
      break;
    case 'risks':
      before('identified', 'closureDate');
      notFuture('closureDate');
      if (row.status !== 'Open' && !isISODate(row.closureDate)) f('error', 'closedNeedsDate', 'closureDate');
      if (row.status === 'Open' && isISODate(row.closureDate)) f('warning', 'openHasClosure', 'closureDate');
      if (isISODate(row.closureDate) && empty(row.materialised)) f('error', 'closedNeedsMaterialised', 'materialised');
      if (row.status === 'Occurred' && row.materialised === 'No') f('error', 'occurredNotMaterialised', 'materialised');
      break;
    case 'issues':
      before('raised', 'resolved');
      notFuture('resolved');
      if (row.status === 'Resolved' && !isISODate(row.resolved)) f('error', 'resolvedNeedsDate', 'resolved');
      if (row.status !== 'Resolved' && isISODate(row.resolved)) f('warning', 'openHasResolved', 'resolved');
      break;
    case 'milestones':
      notFuture('actualDate');
      if (row.status === 'Completed' && !isISODate(row.actualDate)) f('error', 'completedNeeds', 'actualDate');
      break;
    case 'actions':
      before('raised', 'due');
      before('raised', 'implemented');
      notFuture('implemented');
      if (row.status === 'Implemented' && !isISODate(row.implemented)) f('error', 'completedNeeds', 'implemented');
      if (row.status === 'Implemented' && !isNum(row.after)) f('warning', 'implementedNeedsAfter', 'after');
      break;
    case 'ci':
      before('proposed', 'implDate');
      if (row.status === 'Implemented' && !isISODate(row.implDate)) f('error', 'completedNeeds', 'implDate');
      if (row.status === 'Implemented' && empty(row.verified)) f('warning', 'ciNotVerified', 'verified');
      break;
    case 'surveys':
      if (!['communication', 'delivery', 'quality', 'responsiveness'].some((k) => isNum(row[k]))) f('error', 'noScores', 'communication');
      break;
    case 'resources':
      if (isNum(row.allocated) && isNum(row.available) && row.allocated > row.available) f('warning', 'overAllocated', 'allocated');
      break;
  }

  // ---- activity on a project after it was closed ----
  if (def.projectField && log !== 'costSchedule') {
    const p = ds.logs.projects.find((x) => x.code === row[def.projectField!]);
    const d = row[def.dateField];
    if (p && (p.status === 'Completed' || p.status === 'Cancelled') && isISODate(p.actualFinish) && isISODate(d) && d > p.actualFinish) {
      const stillOpen =
        (log === 'milestones' && row.status !== 'Completed') ||
        (log === 'issues' && row.status !== 'Resolved') ||
        log === 'changes' || log === 'quality' || log === 'risks';
      if (stillOpen) f('warning', 'afterClosure', def.dateField, { project: String(p.code), date: p.actualFinish });
    }
  }
  if (log === 'costSchedule') {
    const p = ds.logs.projects.find((x) => x.code === row.project);
    if (p && isISODate(p.actualFinish) && p.status === 'Completed' && isISODate(row.month) && row.month > monthEnd(p.actualFinish))
      f('warning', 'afterClosure', 'month', { project: String(p.code), date: p.actualFinish });
  }
  return out;
}

export function validateAll(ds: Dataset, today?: ISODate): Finding[] {
  const out: Finding[] = [];
  for (const def of LOGS) for (const r of ds.logs[def.key]) out.push(...validateRow(ds, def.key, r, today));
  // one cost row per project per month – duplicates double-count PV/EV/AC
  const seen = new Map<string, string>();
  for (const r of ds.logs.costSchedule) {
    const k = `${r.project}|${r.month}`;
    if (seen.has(k)) out.push({ severity: 'error', log: 'costSchedule', rowId: r.id, field: 'month', code: 'duplicateMonth', params: { project: String(r.project), month: String(r.month) } });
    else seen.set(k, r.id);
  }
  const seenB = new Set<string>();
  for (const r of ds.logs.benefits) {
    const k = `${r.code}|${r.date}`;
    if (seenB.has(k)) out.push({ severity: 'error', log: 'benefits', rowId: r.id, field: 'date', code: 'duplicateMonth', params: { project: String(r.code), month: String(r.date) } });
    else seenB.add(k);
  }
  return out;
}

/** true when the record's period is locked (Settings › Lock periods through). */
export function isLocked(ds: Dataset, log: LogKey, row: Row): boolean {
  const lock = ds.settings.lockedThrough;
  const d = row[LOG_BY_KEY[log].dateField];
  return !!lock && isISODate(d) && d <= monthEnd(lock);
}
