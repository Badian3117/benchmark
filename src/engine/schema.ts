import { daysBetween, hoursBetween, isISODate, isISODateTime, type ISODate } from './dates.ts';

export type LogKey =
  | 'projects'
  | 'costSchedule'
  | 'changes'
  | 'risks'
  | 'issues'
  | 'surveys'
  | 'resources'
  | 'milestones'
  | 'quality'
  | 'benefits'
  | 'ci'
  | 'actions'
  | 'targetRevisions'
  // contractor operations (Phase 3)
  | 'gates'
  | 'variations'
  | 'production'
  | 'explosives'
  | 'safety'
  | 'handovers';

export type ListKey =
  | 'projectStatus'
  | 'priority'
  | 'changeType'
  | 'crDecision'
  | 'riskStatus'
  | 'riskCategory'
  | 'issueStatus'
  | 'milestoneStatus'
  | 'actionStatus'
  | 'ciStatus'
  | 'owners'
  | 'sites'
  | 'stakeholderGroups'
  | 'disciplines'
  | 'gateTypes'
  | 'gateStatus'
  | 'instructionTypes'
  | 'variationStatus'
  | 'explosiveProducts';

export type FieldType =
  | 'text'
  | 'longtext'
  | 'date'
  | 'month' // stored as 1st of month
  | 'number'
  | 'money'
  | 'percent' // stored as decimal (0.82 = 82 %)
  | 'score' // 1..5
  | 'yesno'
  | 'list'
  | 'project' // reference to projects.code
  | 'kpi' // reference to a KPI key
  | 'datetime'; // 'YYYY-MM-DDTHH:MM' local site time

export interface FieldDef {
  key: string;
  type: FieldType;
  list?: ListKey;
  required?: boolean;
  min?: number;
  max?: number;
  /** column hidden in the table view (still in the form) */
  formOnly?: boolean;
}

export type ComputedType = 'number' | 'money' | 'percent' | 'ratio' | 'days' | 'hours' | 'text' | 'yesno';

export interface Ctx {
  asOf: ISODate;
  /** evaluation moment for hour-based ages: now when asOf is today, else end of the asOf day */
  now: string;
  budgetTolerance: number;
  projectsByCode: Map<string, Row>;
  /** direction of each KPI, for direction-aware 'Result' in the action log */
  kpiDirection: (kpi: string) => 'Higher' | 'Lower' | 'Band';
  kpiTarget: (kpi: string) => { green: (v: number) => boolean } | null;
}

export interface ComputedDef {
  key: string;
  type: ComputedType;
  fn: (r: Row, ctx: Ctx) => number | string | null;
}

export interface LogDef {
  key: LogKey;
  /** human-readable record id field (e.g. 'code'), auto-numbered with idPrefix */
  codeField?: string;
  idPrefix?: string;
  /** the code identifies an entity measured repeatedly (e.g. a benefit re-measured monthly) – not unique per row */
  repeatCode?: boolean;
  /** main date: sorting, period lock and 'record after project closed' checks */
  dateField: string;
  projectField?: string;
  fields: FieldDef[];
  computed: ComputedDef[];
  /** KPI numbers this log feeds (for the sheet map) */
  feeds: number[];
  /** navigation group: project management logs, or contractor operations */
  group?: 'pm' | 'ops';
}

export interface Row {
  id: string;
  [field: string]: unknown;
}

// ---------- helpers ----------
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const div = (a: unknown, b: unknown): number | null => {
  const x = num(a), y = num(b);
  return x === null || y === null || y === 0 ? null : x / y;
};
const diffDays = (a: unknown, b: unknown): number | null =>
  isISODate(a) && isISODate(b) ? daysBetween(a, b) : null;

export function projectOnTime(p: Row): boolean | null {
  if (p.status !== 'Completed' || !isISODate(p.actualFinish) || !isISODate(p.baselineFinish)) return null;
  return p.actualFinish <= p.baselineFinish;
}
export function projectWithinBudget(p: Row, tol: number): boolean | null {
  const bac = num(p.bac), eac = num(p.eac);
  if (p.status !== 'Completed' || bac === null || eac === null) return null;
  return eac <= bac * (1 + tol);
}
/** Successful = on time AND within budget AND scope delivered AND deliverables accepted.
 *  (The original workbook ignored 'Deliverables accepted?' – fixed here.) */
export function projectSuccessful(p: Row, tol: number): boolean | null {
  const t = projectOnTime(p), b = projectWithinBudget(p, tol);
  if (t === null || b === null) return null;
  return t && b && p.scopeDelivered === 'Yes' && p.deliverablesAccepted === 'Yes';
}
const yn = (b: boolean | null) => (b === null ? null : b ? 'Yes' : 'No');

export function riskScore(p: unknown, i: unknown): number | null {
  const a = num(p), b = num(i);
  return a === null || b === null ? null : a * b;
}
export function riskRating(score: number | null): 'High' | 'Medium' | 'Low' | null {
  if (score === null) return null;
  return score >= 15 ? 'High' : score >= 8 ? 'Medium' : 'Low';
}

/** Milestone 'On time?' evaluated at the reporting date – not TODAY() – so closed periods stay frozen. */
export function milestoneOnTime(m: Row, asOf: ISODate): 'Yes' | 'No' | 'Overdue' | null {
  if (!isISODate(m.baselineDue)) return null;
  const done = m.status === 'Completed' && isISODate(m.actualDate) && m.actualDate <= asOf;
  if (done) return (m.actualDate as string) <= m.baselineDue ? 'Yes' : 'No';
  return m.baselineDue < asOf ? 'Overdue' : null;
}

export function actionDueStatus(a: Row, asOf: ISODate): 'Closed' | 'OVERDUE' | 'On track' | null {
  if (!isISODate(a.raised)) return null;
  if (a.status === 'Implemented' || a.status === 'Cancelled') return 'Closed';
  return isISODate(a.due) && a.due < asOf ? 'OVERDUE' : 'On track';
}

export function actionResult(a: Row, ctx: Ctx): 'Improved' | 'No change' | 'Worse' | null {
  const before = num(a.before), after = num(a.after);
  if (!a.kpi || before === null || after === null) return null;
  if (after === before) return 'No change';
  const dir = ctx.kpiDirection(String(a.kpi));
  if (dir === 'Band') return null; // judged by 'Target reached?' instead
  return (after > before) === (dir === 'Higher') ? 'Improved' : 'Worse';
}

/** hours between a gate's submission and its decision (or now, while pending) */
export function gateWaitHours(g: Row, now: string): number | null {
  if (!isISODateTime(g.submittedAt)) return null;
  const end = isISODateTime(g.approvedAt) ? g.approvedAt : g.status === 'Pending' ? now : null;
  return end && end >= g.submittedAt ? hoursBetween(g.submittedAt, end) : null;
}
/** counted closing stock minus book stock (opening + received − issued); ≠ 0 means unaccounted product */
export function stockDiscrepancy(e: Row): number | null {
  const n = [e.opening, e.received, e.issued, e.closingCounted].map((v) => num(v));
  return n.some((v) => v === null) ? null : n[3]! - (n[0]! + n[1]! - n[2]!);
}
export function recordables(s: Row): number {
  return ['lti', 'mti', 'rwi'].reduce((a, k) => a + (num(s[k]) ?? 0), 0);
}

// ---------- log definitions ----------
export const LOGS: LogDef[] = [
  {
    key: 'projects',
    codeField: 'code',
    idPrefix: 'P',
    dateField: 'start',
    feeds: [4, 5, 10],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
      { key: 'site', type: 'list', list: 'sites' },
      { key: 'area', type: 'text' },
      { key: 'pm', type: 'list', list: 'owners', required: true },
      { key: 'sponsor', type: 'list', list: 'owners' },
      { key: 'start', type: 'date', required: true },
      { key: 'baselineFinish', type: 'date', required: true },
      { key: 'actualFinish', type: 'date' },
      { key: 'status', type: 'list', list: 'projectStatus', required: true },
      { key: 'bac', type: 'money', required: true },
      { key: 'eac', type: 'money' },
      { key: 'scopeDelivered', type: 'yesno' },
      { key: 'deliverablesAccepted', type: 'yesno' },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [
      { key: 'onTime', type: 'yesno', fn: (r) => yn(projectOnTime(r)) },
      { key: 'withinBudget', type: 'yesno', fn: (r, c) => yn(projectWithinBudget(r, c.budgetTolerance)) },
      { key: 'successful', type: 'yesno', fn: (r, c) => yn(projectSuccessful(r, c.budgetTolerance)) },
      { key: 'daysLate', type: 'days', fn: (r) => diffDays(r.baselineFinish, r.actualFinish) },
      { key: 'vac', type: 'money', fn: (r) => (num(r.bac) !== null && num(r.eac) !== null ? (r.bac as number) - (r.eac as number) : null) },
    ],
  },
  {
    key: 'costSchedule',
    dateField: 'month',
    projectField: 'project',
    feeds: [1, 2, 3, 17, 18],
    fields: [
      { key: 'month', type: 'month', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'budget', type: 'money', required: true },
      { key: 'pv', type: 'money', required: true },
      { key: 'ev', type: 'money', required: true },
      { key: 'ac', type: 'money', required: true },
      { key: 'comment', type: 'longtext', formOnly: true },
    ],
    computed: [
      { key: 'sv', type: 'money', fn: (r) => (num(r.ev) !== null && num(r.pv) !== null ? (r.ev as number) - (r.pv as number) : null) },
      { key: 'cv', type: 'money', fn: (r) => (num(r.ev) !== null && num(r.ac) !== null ? (r.ev as number) - (r.ac as number) : null) },
      { key: 'spi', type: 'ratio', fn: (r) => div(r.ev, r.pv) },
      { key: 'cpi', type: 'ratio', fn: (r) => div(r.ev, r.ac) },
      { key: 'budgetUsed', type: 'percent', fn: (r) => div(r.ac, r.budget) },
    ],
  },
  {
    key: 'changes',
    codeField: 'code',
    idPrefix: 'CR-',
    dateField: 'submitted',
    projectField: 'project',
    feeds: [5, 13],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'submitted', type: 'date', required: true },
      { key: 'description', type: 'longtext', required: true },
      { key: 'type', type: 'list', list: 'changeType', required: true },
      { key: 'requestedBy', type: 'list', list: 'owners' },
      { key: 'costImpact', type: 'money' },
      { key: 'scheduleImpact', type: 'number' },
      { key: 'decision', type: 'list', list: 'crDecision', required: true },
      { key: 'decisionDate', type: 'date' },
      { key: 'implemented', type: 'yesno' },
      { key: 'implementationDate', type: 'date', formOnly: true },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [{ key: 'approvalDays', type: 'days', fn: (r) => diffDays(r.submitted, r.decisionDate) }],
  },
  {
    key: 'risks',
    codeField: 'code',
    idPrefix: 'R-',
    dateField: 'identified',
    projectField: 'project',
    feeds: [6],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'identified', type: 'date', required: true },
      { key: 'description', type: 'longtext', required: true },
      { key: 'category', type: 'list', list: 'riskCategory' },
      { key: 'probability', type: 'score', min: 1, max: 5, required: true },
      { key: 'impact', type: 'score', min: 1, max: 5, required: true },
      { key: 'mitigation', type: 'longtext', formOnly: true },
      { key: 'owner', type: 'list', list: 'owners' },
      { key: 'status', type: 'list', list: 'riskStatus', required: true },
      { key: 'closureDate', type: 'date' },
      { key: 'materialised', type: 'yesno' },
      { key: 'residualP', type: 'score', min: 1, max: 5, formOnly: true },
      { key: 'residualI', type: 'score', min: 1, max: 5, formOnly: true },
    ],
    computed: [
      { key: 'score', type: 'number', fn: (r) => riskScore(r.probability, r.impact) },
      { key: 'rating', type: 'text', fn: (r) => riskRating(riskScore(r.probability, r.impact)) },
      { key: 'residualScore', type: 'number', fn: (r) => riskScore(r.residualP, r.residualI) },
      {
        key: 'reduction',
        type: 'percent',
        fn: (r) => {
          const a = riskScore(r.probability, r.impact), b = riskScore(r.residualP, r.residualI);
          return a && b !== null ? 1 - b / a : null;
        },
      },
    ],
  },
  {
    key: 'issues',
    codeField: 'code',
    idPrefix: 'I-',
    dateField: 'raised',
    projectField: 'project',
    feeds: [7],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'raised', type: 'date', required: true },
      { key: 'description', type: 'longtext', required: true },
      { key: 'priority', type: 'list', list: 'priority' },
      { key: 'owner', type: 'list', list: 'owners' },
      { key: 'status', type: 'list', list: 'issueStatus', required: true },
      { key: 'resolved', type: 'date' },
      { key: 'rootCause', type: 'longtext', formOnly: true },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [
      { key: 'daysToResolve', type: 'days', fn: (r) => diffDays(r.raised, r.resolved) },
      {
        key: 'daysOpen',
        type: 'days',
        fn: (r, c) => (isISODate(r.raised) && !isISODate(r.resolved) && r.raised <= c.asOf ? daysBetween(r.raised, c.asOf) : null),
      },
    ],
  },
  {
    key: 'surveys',
    dateField: 'date',
    projectField: 'project',
    feeds: [8],
    fields: [
      { key: 'date', type: 'date', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'stakeholder', type: 'text' },
      { key: 'group', type: 'list', list: 'stakeholderGroups' },
      { key: 'communication', type: 'score', min: 1, max: 5 },
      { key: 'delivery', type: 'score', min: 1, max: 5 },
      { key: 'quality', type: 'score', min: 1, max: 5 },
      { key: 'responsiveness', type: 'score', min: 1, max: 5 },
      { key: 'comments', type: 'longtext', formOnly: true },
    ],
    computed: [{ key: 'overall', type: 'number', fn: (r) => surveyOverall(r) }],
  },
  {
    key: 'resources',
    dateField: 'month',
    feeds: [9, 14],
    fields: [
      { key: 'month', type: 'month', required: true },
      { key: 'site', type: 'list', list: 'sites' },
      { key: 'team', type: 'text', required: true },
      { key: 'discipline', type: 'list', list: 'disciplines' },
      { key: 'available', type: 'number', required: true },
      { key: 'allocated', type: 'number', required: true },
      { key: 'unit', type: 'text' },
      { key: 'plannedOutput', type: 'number' },
      { key: 'actualOutput', type: 'number' },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [
      { key: 'utilisation', type: 'percent', fn: (r) => div(r.allocated, r.available) },
      { key: 'productivity', type: 'percent', fn: (r) => div(r.actualOutput, r.plannedOutput) },
    ],
  },
  {
    key: 'milestones',
    codeField: 'code',
    idPrefix: 'M-',
    dateField: 'baselineDue',
    projectField: 'project',
    feeds: [11],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'milestone', type: 'text', required: true },
      { key: 'owner', type: 'list', list: 'owners' },
      { key: 'baselineDue', type: 'date', required: true },
      { key: 'actualDate', type: 'date' },
      { key: 'status', type: 'list', list: 'milestoneStatus', required: true },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [
      { key: 'onTime', type: 'text', fn: (r, c) => milestoneOnTime(r, c.asOf) },
      { key: 'daysLate', type: 'days', fn: (r) => diffDays(r.baselineDue, r.actualDate) },
    ],
  },
  {
    key: 'quality',
    codeField: 'code',
    idPrefix: 'Q-',
    dateField: 'date',
    projectField: 'project',
    feeds: [12],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'deliverable', type: 'text', required: true },
      { key: 'date', type: 'date', required: true },
      { key: 'inspector', type: 'list', list: 'owners' },
      { key: 'defects', type: 'number', min: 0 },
      { key: 'firstTime', type: 'yesno', required: true },
      { key: 'reworkHours', type: 'number', min: 0 },
      { key: 'reworkCost', type: 'money', min: 0 },
      { key: 'description', type: 'longtext', formOnly: true },
    ],
    computed: [],
  },
  {
    key: 'benefits',
    codeField: 'code',
    idPrefix: 'B',
    repeatCode: true,
    dateField: 'date',
    projectField: 'project',
    feeds: [15],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'description', type: 'text', required: true },
      { key: 'unit', type: 'text' },
      { key: 'date', type: 'date', required: true },
      { key: 'planned', type: 'number', required: true },
      { key: 'realised', type: 'number', required: true },
      { key: 'owner', type: 'list', list: 'owners' },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [{ key: 'pct', type: 'percent', fn: (r) => div(r.realised, r.planned) }],
  },
  {
    key: 'ci',
    codeField: 'code',
    idPrefix: 'CI-',
    dateField: 'proposed',
    feeds: [16],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'proposed', type: 'date', required: true },
      { key: 'site', type: 'list', list: 'sites' },
      { key: 'initiative', type: 'text', required: true },
      { key: 'kpi', type: 'kpi' },
      { key: 'owner', type: 'list', list: 'owners' },
      { key: 'status', type: 'list', list: 'ciStatus', required: true },
      { key: 'implDate', type: 'date' },
      { key: 'expected', type: 'text' },
      { key: 'verified', type: 'yesno' },
      { key: 'verifiedResult', type: 'longtext', formOnly: true },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [],
  },
  {
    key: 'actions',
    codeField: 'code',
    idPrefix: 'A-',
    dateField: 'raised',
    projectField: 'project',
    feeds: [],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'raised', type: 'date', required: true },
      { key: 'kpi', type: 'kpi', required: true },
      { key: 'project', type: 'project' },
      { key: 'site', type: 'list', list: 'sites', formOnly: true },
      { key: 'before', type: 'number' },
      { key: 'rootCause', type: 'longtext', required: true },
      { key: 'action', type: 'longtext', required: true },
      { key: 'owner', type: 'list', list: 'owners', required: true },
      { key: 'due', type: 'date', required: true },
      { key: 'status', type: 'list', list: 'actionStatus', required: true },
      { key: 'implemented', type: 'date' },
      { key: 'after', type: 'number' },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [
      { key: 'result', type: 'text', fn: (r, c) => actionResult(r, c) },
      {
        key: 'targetReached',
        type: 'yesno',
        fn: (r, c) => {
          const after = num(r.after), t = r.kpi ? c.kpiTarget(String(r.kpi)) : null;
          return after === null || !t ? null : t.green(after) ? 'Yes' : 'No';
        },
      },
      { key: 'dueStatus', type: 'text', fn: (r, c) => actionDueStatus(r, c.asOf) },
    ],
  },
  {
    key: 'targetRevisions',
    dateField: 'date',
    feeds: [],
    fields: [
      { key: 'date', type: 'date', required: true },
      { key: 'kpi', type: 'kpi', required: true },
      { key: 'before', type: 'text' },
      { key: 'after', type: 'text' },
      { key: 'reason', type: 'longtext', required: true },
      { key: 'proposedBy', type: 'list', list: 'owners', required: true },
      { key: 'approvedBy', type: 'list', list: 'owners', required: true },
    ],
    computed: [],
  },
  // ================= contractor operations =================
  {
    key: 'gates',
    group: 'ops',
    codeField: 'code',
    idPrefix: 'G-',
    dateField: 'submittedAt',
    projectField: 'project',
    feeds: [19],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'block', type: 'text', required: true },
      { key: 'gate', type: 'list', list: 'gateTypes', required: true },
      { key: 'submittedAt', type: 'datetime', required: true },
      { key: 'status', type: 'list', list: 'gateStatus', required: true },
      { key: 'approvedAt', type: 'datetime' },
      { key: 'approver', type: 'text' },
      { key: 'verbalOnly', type: 'yesno' },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [{ key: 'waitHours', type: 'hours', fn: (r, c) => gateWaitHours(r, c.now) }],
  },
  {
    key: 'variations',
    group: 'ops',
    codeField: 'code',
    idPrefix: 'VO-',
    dateField: 'instructed',
    projectField: 'project',
    feeds: [20, 21],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'instructed', type: 'date', required: true },
      { key: 'instructedBy', type: 'text', required: true },
      { key: 'instructionType', type: 'list', list: 'instructionTypes', required: true },
      { key: 'confirmedInWriting', type: 'yesno' },
      { key: 'confirmationDate', type: 'date' },
      { key: 'description', type: 'longtext', required: true },
      { key: 'valueClaimed', type: 'money', min: 0 },
      { key: 'status', type: 'list', list: 'variationStatus', required: true },
      { key: 'submittedDate', type: 'date' },
      { key: 'decisionDate', type: 'date' },
      { key: 'valueApproved', type: 'money', min: 0 },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [
      { key: 'daysToDecision', type: 'days', fn: (r) => diffDays(r.submittedDate, r.decisionDate) },
      { key: 'recovery', type: 'percent', fn: (r) => (r.status === 'Approved' || r.status === 'Rejected' ? div(r.valueApproved ?? 0, r.valueClaimed) : null) },
    ],
  },
  {
    key: 'production',
    group: 'ops',
    dateField: 'date',
    projectField: 'project',
    feeds: [22, 23, 24],
    fields: [
      { key: 'date', type: 'date', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'location', type: 'text' },
      { key: 'plannedMetres', type: 'number', min: 0 },
      { key: 'actualMetres', type: 'number', min: 0 },
      { key: 'plannedBlasts', type: 'number', min: 0 },
      { key: 'actualBlasts', type: 'number', min: 0 },
      { key: 'reblasts', type: 'number', min: 0 },
      { key: 'misfires', type: 'number', min: 0 },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [
      { key: 'metresPct', type: 'percent', fn: (r) => div(r.actualMetres, r.plannedMetres) },
      { key: 'blastsPct', type: 'percent', fn: (r) => div(r.actualBlasts, r.plannedBlasts) },
    ],
  },
  {
    key: 'explosives',
    group: 'ops',
    dateField: 'month',
    projectField: 'project',
    feeds: [25],
    fields: [
      { key: 'month', type: 'month', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'product', type: 'list', list: 'explosiveProducts', required: true },
      { key: 'unit', type: 'text', required: true },
      { key: 'opening', type: 'number', min: 0, required: true },
      { key: 'received', type: 'number', min: 0, required: true },
      { key: 'issued', type: 'number', min: 0, required: true },
      { key: 'designed', type: 'number', min: 0 },
      { key: 'closingCounted', type: 'number', min: 0, required: true },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [
      { key: 'bookClosing', type: 'number', fn: (r) => (num(r.opening) !== null && num(r.received) !== null && num(r.issued) !== null ? (r.opening as number) + (r.received as number) - (r.issued as number) : null) },
      { key: 'discrepancy', type: 'number', fn: (r) => stockDiscrepancy(r) },
      { key: 'designVar', type: 'percent', fn: (r) => (num(r.issued) !== null && num(r.designed) ? ((r.issued as number) - (r.designed as number)) / (r.designed as number) : null) },
    ],
  },
  {
    key: 'safety',
    group: 'ops',
    dateField: 'month',
    projectField: 'project',
    feeds: [26, 27, 28],
    fields: [
      { key: 'month', type: 'month', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'hoursWorked', type: 'number', min: 0, required: true },
      { key: 'lti', type: 'number', min: 0 },
      { key: 'mti', type: 'number', min: 0 },
      { key: 'rwi', type: 'number', min: 0 },
      { key: 'fai', type: 'number', min: 0 },
      { key: 'nearMisses', type: 'number', min: 0 },
      { key: 'blastsMonitored', type: 'number', min: 0 },
      { key: 'ppvExceedances', type: 'number', min: 0 },
      { key: 'airblastExceedances', type: 'number', min: 0 },
      { key: 'envIncidents', type: 'number', min: 0 },
      { key: 'remarks', type: 'longtext', formOnly: true },
    ],
    computed: [{ key: 'recordables', type: 'number', fn: (r) => recordables(r) }],
  },
  {
    key: 'handovers',
    group: 'ops',
    codeField: 'code',
    idPrefix: 'H-',
    dateField: 'date',
    projectField: 'project',
    feeds: [29],
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'project', type: 'project', required: true },
      { key: 'date', type: 'date', required: true },
      { key: 'outgoing', type: 'list', list: 'owners', required: true },
      { key: 'incoming', type: 'list', list: 'owners', required: true },
      { key: 'overlapBriefing', type: 'yesno', required: true },
      { key: 'openItems', type: 'longtext' },
      { key: 'keyRisks', type: 'longtext' },
      { key: 'pendingAuthorisations', type: 'longtext' },
      { key: 'signedOff', type: 'yesno' },
    ],
    computed: [],
  },
];

/** How a log's rows are attached to a site on the server (drives permissions). */
export type SiteScope = 'project' | 'site' | 'projectOrSite' | 'self' | 'global';
export const SITE_SCOPE: Record<LogKey, SiteScope> = {
  projects: 'self', costSchedule: 'project', changes: 'project', risks: 'project', issues: 'project', surveys: 'project',
  resources: 'site', milestones: 'project', quality: 'project', benefits: 'project', ci: 'site', actions: 'projectOrSite',
  targetRevisions: 'global',
  gates: 'project', variations: 'project', production: 'project', explosives: 'project', safety: 'project', handovers: 'project',
};

export const LOG_BY_KEY = Object.fromEntries(LOGS.map((l) => [l.key, l])) as Record<LogKey, LogDef>;

export function surveyOverall(r: Row): number | null {
  const xs = [r.communication, r.delivery, r.quality, r.responsiveness].filter((v): v is number => num(v) !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// ---------- settings ----------
export interface Settings {
  orgName: string;
  preparedBy: string;
  currency: string;
  yearStart: ISODate;
  /** null = follow today's month */
  reportingMonth: ISODate | null;
  budgetTolerance: number;
  /** forecast days late tolerated before a project turns RED in Project health */
  daysLateTolerance: number;
  /** periods up to and including this month are locked for editing; null = none */
  lockedThrough: ISODate | null;
  userName: string;
  lists: Record<ListKey, string[]>;
}

export const DEFAULT_LISTS: Record<ListKey, string[]> = {
  projectStatus: ['Not started', 'Active', 'On hold', 'Completed', 'Cancelled'],
  priority: ['Critical', 'High', 'Medium', 'Low'],
  changeType: ['Scope', 'Schedule', 'Cost', 'Quality', 'Resource'],
  crDecision: ['Pending', 'Approved', 'Rejected'],
  riskStatus: ['Open', 'Mitigated', 'Closed', 'Occurred'],
  riskCategory: ['Safety', 'Technical', 'Commercial', 'Schedule', 'Environmental', 'Community', 'Supply chain'],
  issueStatus: ['Open', 'In progress', 'Resolved'],
  milestoneStatus: ['Not started', 'In progress', 'Completed'],
  actionStatus: ['Open', 'In progress', 'Implemented', 'Cancelled'],
  ciStatus: ['Proposed', 'Approved', 'In progress', 'Implemented', 'Rejected'],
  owners: [],
  sites: [],
  stakeholderGroups: ['Client', 'Internal – Management', 'Subcontractor', 'Community', 'Regulator'],
  disciplines: ['Drill & Blast', 'Mining', 'Maintenance', 'Engineering', 'Projects'],
  // contractor–owner approval gates (drill & blast cycle)
  gateTypes: ['Pattern design', 'Bench release', 'As-drilled sign-off', 'Loading authorisation', 'Pre-blast inspection', 'All-clear', 'Post-blast inspection', 'Blast closeout'],
  gateStatus: ['Pending', 'Approved', 'Rejected'],
  instructionTypes: ['Written', 'Verbal'],
  variationStatus: ['Instructed', 'Submitted', 'Approved', 'Rejected', 'Disputed'],
  explosiveProducts: ['Bulk emulsion', 'ANFO', 'Packaged emulsion', 'Boosters', 'Electronic detonators', 'Non-electric detonators', 'Surface connectors'],
};

export function defaultSettings(today: ISODate): Settings {
  return {
    orgName: 'CORICA Mining Services – Project Portfolio',
    preparedBy: 'Project Controls',
    currency: 'USD',
    yearStart: today.slice(0, 4) + '-01-01',
    reportingMonth: null,
    budgetTolerance: 0.05,
    daysLateTolerance: 14,
    lockedThrough: null,
    userName: '',
    lists: structuredClone(DEFAULT_LISTS),
  };
}
