import { hoursBetween, inRange, isISODate, isISODateTime, makePeriod, yearMonths, todayISO, type ISODate, type Period } from './dates.ts';
import {
  milestoneOnTime,
  projectOnTime,
  recordables,
  projectSuccessful,
  surveyOverall,
  type LogKey,
  type Row,
  type Settings,
} from './schema.ts';

export type KpiKey =
  | 'sv' | 'cv' | 'budgetUtil' | 'onTime' | 'scopeFreq' | 'riskEff' | 'issueTime' | 'satisfaction'
  | 'resourceUtil' | 'successRate' | 'milestoneRate' | 'quality' | 'crTime' | 'productivity'
  | 'benefits' | 'ci' | 'cumSpi' | 'cumCpi'
  // contractor operations & safety (Phase 3)
  | 'gateLag' | 'verbalOpen' | 'variationRecovery' | 'drillPlan' | 'blastPlan' | 'reblastRate' | 'explosivesVar'
  | 'trifr' | 'ltifr' | 'blastCompliance' | 'handoverCompliance';

export type Unit = 'pct' | 'ratio' | 'days' | 'score' | 'count' | 'perProject' | 'hours' | 'rate';
export type KpiGroup = 'safety' | 'ops' | 'pm';
export type Direction = 'Higher' | 'Lower' | 'Band';
export type Rag = 'GREEN' | 'AMBER' | 'RED';

export interface KpiTarget {
  key: KpiKey;
  direction: Direction;
  /** Higher/Lower: green threshold */
  target: number;
  /** Higher/Lower: amber threshold (below target for Higher, above for Lower) */
  amber: number;
  /** Band: green when greenLo ≤ v ≤ greenHi, amber when amberLo ≤ v ≤ amberHi */
  greenLo?: number;
  greenHi?: number;
  amberLo?: number;
  amberHi?: number;
  owner: string;
}

export interface Dataset {
  settings: Settings;
  targets: Record<KpiKey, KpiTarget>;
  logs: Record<LogKey, Row[]>;
}

/** Project codes in scope; null = whole portfolio. */
export type Scope = Set<string> | null;

export interface KpiValue {
  value: number | null;
  /** sample size behind the value (records, projects, teams…) */
  n: number;
}

export interface KpiDef {
  key: KpiKey;
  num: number;
  /** dashboard section: safety first, then contractor operations, then project management */
  group: KpiGroup;
  unit: Unit;
  basis: 'month' | 'ytd';
  sources: LogKey[];
  /** false = no project dimension in the source log; a project filter does not apply */
  projectScoped: boolean;
  /** YTD KPIs where a handful of records swing the value */
  smallSample?: number;
  compute: (ds: Dataset, p: Period, scope: Scope) => KpiValue;
}

// ---------- helpers ----------
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inScope = (scope: Scope, project: unknown) => scope === null || (typeof project === 'string' && scope.has(project));
const ratio = (a: number, b: number, n: number): KpiValue => ({ value: b === 0 ? null : a / b, n });
const avg = (xs: number[]): KpiValue => ({ value: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length });

function costRows(ds: Dataset, scope: Scope, start: ISODate, end: ISODate) {
  return ds.logs.costSchedule.filter((r) => inRange(r.month, start, end) && inScope(scope, r.project));
}
function sum(rows: Row[], f: string) {
  return rows.reduce((a, r) => a + (isNum(r[f]) ? (r[f] as number) : 0), 0);
}
function completedYtd(ds: Dataset, p: Period, scope: Scope) {
  return ds.logs.projects.filter(
    (r) => r.status === 'Completed' && inRange(r.actualFinish, p.yearStart, p.end) && inScope(scope, r.code),
  );
}

// ---------- the 18 KPIs ----------
export const KPIS: KpiDef[] = [
  {
    key: 'sv', num: 1, group: 'pm', unit: 'pct', basis: 'month', sources: ['costSchedule'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = costRows(ds, s, p.start, p.end);
      const pv = sum(rows, 'pv');
      return ratio(sum(rows, 'ev') - pv, pv, rows.length);
    },
  },
  {
    key: 'cv', num: 2, group: 'pm', unit: 'pct', basis: 'month', sources: ['costSchedule'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = costRows(ds, s, p.start, p.end);
      const ev = sum(rows, 'ev');
      return ratio(ev - sum(rows, 'ac'), ev, rows.length);
    },
  },
  {
    key: 'budgetUtil', num: 3, group: 'pm', unit: 'pct', basis: 'month', sources: ['costSchedule'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = costRows(ds, s, p.start, p.end);
      return ratio(sum(rows, 'ac'), sum(rows, 'budget'), rows.length);
    },
  },
  {
    key: 'onTime', num: 4, group: 'pm', unit: 'pct', basis: 'ytd', sources: ['projects'], projectScoped: true, smallSample: 5,
    compute: (ds, p, s) => {
      const done = completedYtd(ds, p, s);
      return ratio(done.filter((r) => projectOnTime(r) === true).length, done.length, done.length);
    },
  },
  {
    key: 'scopeFreq', num: 5, group: 'pm', unit: 'perProject', basis: 'month', sources: ['changes', 'projects'], projectScoped: true,
    compute: (ds, p, s) => {
      const scopeCrs = ds.logs.changes.filter(
        (r) => r.type === 'Scope' && inRange(r.submitted, p.start, p.end) && inScope(s, r.project),
      ).length;
      // active in the month: started by month end, (forecast) finish not before month start, not cancelled
      const active = ds.logs.projects.filter(
        (r) =>
          inScope(s, r.code) && r.status !== 'Cancelled' &&
          isISODate(r.start) && r.start <= p.end &&
          (!isISODate(r.actualFinish) || r.actualFinish >= p.start),
      ).length;
      return ratio(scopeCrs, active, active);
    },
  },
  {
    key: 'riskEff', num: 6, group: 'pm', unit: 'pct', basis: 'ytd', sources: ['risks'], projectScoped: true, smallSample: 5,
    compute: (ds, p, s) => {
      const closed = ds.logs.risks.filter((r) => inRange(r.closureDate, p.yearStart, p.end) && inScope(s, r.project));
      return ratio(closed.filter((r) => r.materialised === 'No').length, closed.length, closed.length);
    },
  },
  {
    key: 'issueTime', num: 7, group: 'pm', unit: 'days', basis: 'month', sources: ['issues'], projectScoped: true,
    compute: (ds, p, s) =>
      avg(
        ds.logs.issues
          .filter((r) => inRange(r.resolved, p.start, p.end) && isISODate(r.raised) && inScope(s, r.project))
          .map((r) => daysDiff(r.raised as string, r.resolved as string)),
      ),
  },
  {
    key: 'satisfaction', num: 8, group: 'pm', unit: 'score', basis: 'month', sources: ['surveys'], projectScoped: true,
    compute: (ds, p, s) =>
      avg(
        ds.logs.surveys
          .filter((r) => inRange(r.date, p.start, p.end) && inScope(s, r.project))
          .map(surveyOverall)
          .filter(isNum),
      ),
  },
  {
    key: 'resourceUtil', num: 9, group: 'pm', unit: 'pct', basis: 'month', sources: ['resources'], projectScoped: false,
    compute: (ds, p) => {
      const rows = ds.logs.resources.filter((r) => inRange(r.month, p.start, p.end));
      return ratio(sum(rows, 'allocated'), sum(rows, 'available'), rows.length);
    },
  },
  {
    key: 'successRate', num: 10, group: 'pm', unit: 'pct', basis: 'ytd', sources: ['projects'], projectScoped: true, smallSample: 5,
    compute: (ds, p, s) => {
      const done = completedYtd(ds, p, s);
      const tol = ds.settings.budgetTolerance;
      return ratio(done.filter((r) => projectSuccessful(r, tol) === true).length, done.length, done.length);
    },
  },
  {
    key: 'milestoneRate', num: 11, group: 'pm', unit: 'pct', basis: 'month', sources: ['milestones'], projectScoped: true,
    compute: (ds, p, s) => {
      // only milestones already due at the evaluation date – a running month is not penalised for the days still to come
      const due = ds.logs.milestones.filter((r) => inRange(r.baselineDue, p.start, p.asOf) && inScope(s, r.project));
      return ratio(due.filter((r) => milestoneOnTime(r, p.asOf) === 'Yes').length, due.length, due.length);
    },
  },
  {
    key: 'quality', num: 12, group: 'pm', unit: 'pct', basis: 'month', sources: ['quality'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.quality.filter((r) => inRange(r.date, p.start, p.end) && inScope(s, r.project));
      return ratio(rows.filter((r) => r.firstTime === 'Yes').length, rows.length, rows.length);
    },
  },
  {
    key: 'crTime', num: 13, group: 'pm', unit: 'days', basis: 'month', sources: ['changes'], projectScoped: true,
    compute: (ds, p, s) =>
      avg(
        ds.logs.changes
          .filter((r) => inRange(r.decisionDate, p.start, p.end) && isISODate(r.submitted) && inScope(s, r.project))
          .map((r) => daysDiff(r.submitted as string, r.decisionDate as string)),
      ),
  },
  {
    key: 'productivity', num: 14, group: 'pm', unit: 'pct', basis: 'month', sources: ['resources'], projectScoped: false,
    compute: (ds, p) =>
      avg(
        ds.logs.resources
          .filter((r) => inRange(r.month, p.start, p.end) && isNum(r.plannedOutput) && r.plannedOutput !== 0 && isNum(r.actualOutput))
          .map((r) => (r.actualOutput as number) / (r.plannedOutput as number)),
      ),
  },
  {
    key: 'benefits', num: 15, group: 'pm', unit: 'pct', basis: 'month', sources: ['benefits'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.benefits.filter((r) => inRange(r.date, p.start, p.end) && inScope(s, r.project));
      return ratio(sum(rows, 'realised'), sum(rows, 'planned'), rows.length);
    },
  },
  {
    key: 'ci', num: 16, group: 'pm', unit: 'count', basis: 'month', sources: ['ci'], projectScoped: false,
    compute: (ds, p) => {
      const n = ds.logs.ci.filter((r) => r.status === 'Implemented' && inRange(r.implDate, p.start, p.end)).length;
      return { value: n, n };
    },
  },
  {
    key: 'cumSpi', num: 17, group: 'pm', unit: 'ratio', basis: 'ytd', sources: ['costSchedule'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = costRows(ds, s, p.yearStart, p.end);
      return ratio(sum(rows, 'ev'), sum(rows, 'pv'), rows.length);
    },
  },
  {
    key: 'cumCpi', num: 18, group: 'pm', unit: 'ratio', basis: 'ytd', sources: ['costSchedule'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = costRows(ds, s, p.yearStart, p.end);
      return ratio(sum(rows, 'ev'), sum(rows, 'ac'), rows.length);
    },
  },
  // ================= safety =================
  {
    // total recordable injury frequency rate, per million hours worked, year to date
    key: 'trifr', num: 26, group: 'safety', unit: 'rate', basis: 'ytd', sources: ['safety'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.safety.filter((r) => inRange(r.month, p.yearStart, p.end) && inScope(s, r.project));
      const h = sum(rows, 'hoursWorked');
      return { value: h ? (rows.reduce((a, r) => a + recordables(r), 0) * 1e6) / h : null, n: rows.length };
    },
  },
  {
    key: 'ltifr', num: 27, group: 'safety', unit: 'rate', basis: 'ytd', sources: ['safety'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.safety.filter((r) => inRange(r.month, p.yearStart, p.end) && inScope(s, r.project));
      const h = sum(rows, 'hoursWorked');
      return { value: h ? (sum(rows, 'lti') * 1e6) / h : null, n: rows.length };
    },
  },
  {
    // share of monitored blasts within the PPV and airblast limits
    key: 'blastCompliance', num: 28, group: 'safety', unit: 'pct', basis: 'month', sources: ['safety'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.safety.filter((r) => inRange(r.month, p.start, p.end) && inScope(s, r.project));
      const n = sum(rows, 'blastsMonitored');
      const exc = sum(rows, 'ppvExceedances') + sum(rows, 'airblastExceedances');
      return { value: n ? Math.max(0, 1 - exc / n) : null, n };
    },
  },
  // ================= contractor operations =================
  {
    // average hours from submission to client authorisation, gates decided in the month
    key: 'gateLag', num: 19, group: 'ops', unit: 'hours', basis: 'month', sources: ['gates'], projectScoped: true,
    compute: (ds, p, s) =>
      avg(
        ds.logs.gates
          .filter((g) => isISODateTime(g.submittedAt) && isISODateTime(g.approvedAt) && inRange(g.approvedAt, p.start, p.end) && inScope(s, g.project))
          .map((g) => hoursBetween(g.submittedAt as string, g.approvedAt as string)),
      ),
  },
  {
    // verbal instructions still not confirmed in writing at the evaluation date (contractual exposure)
    key: 'verbalOpen', num: 20, group: 'ops', unit: 'count', basis: 'month', sources: ['variations'], projectScoped: true,
    compute: (ds, p, s) => {
      const open = ds.logs.variations.filter(
        (v) => v.instructionType === 'Verbal' && isISODate(v.instructed) && v.instructed <= p.asOf && inScope(s, v.project) &&
          !(v.confirmedInWriting === 'Yes' && isISODate(v.confirmationDate) && v.confirmationDate <= p.asOf),
      ).length;
      return { value: open, n: open };
    },
  },
  {
    // value approved ÷ value claimed, variations decided year to date
    key: 'variationRecovery', num: 21, group: 'ops', unit: 'pct', basis: 'ytd', sources: ['variations'], projectScoped: true, smallSample: 5,
    compute: (ds, p, s) => {
      const rows = ds.logs.variations.filter((v) => (v.status === 'Approved' || v.status === 'Rejected') && inRange(v.decisionDate, p.yearStart, p.end) && inScope(s, v.project));
      return ratio(sum(rows, 'valueApproved'), sum(rows, 'valueClaimed'), rows.length);
    },
  },
  {
    key: 'drillPlan', num: 22, group: 'ops', unit: 'pct', basis: 'month', sources: ['production'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.production.filter((r) => inRange(r.date, p.start, p.end) && inScope(s, r.project));
      return ratio(sum(rows, 'actualMetres'), sum(rows, 'plannedMetres'), rows.length);
    },
  },
  {
    key: 'blastPlan', num: 23, group: 'ops', unit: 'pct', basis: 'month', sources: ['production'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.production.filter((r) => inRange(r.date, p.start, p.end) && inScope(s, r.project));
      return ratio(sum(rows, 'actualBlasts'), sum(rows, 'plannedBlasts'), rows.length);
    },
  },
  {
    // blasts that had to be re-blasted ÷ blasts fired: a design or execution quality signal
    key: 'reblastRate', num: 24, group: 'ops', unit: 'pct', basis: 'month', sources: ['production'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.production.filter((r) => inRange(r.date, p.start, p.end) && inScope(s, r.project));
      const fired = sum(rows, 'actualBlasts');
      return ratio(sum(rows, 'reblasts'), fired, fired);
    },
  },
  {
    // bulk explosives (kg) issued vs blast designs; over-use is a cost leak, under-use a fragmentation risk
    key: 'explosivesVar', num: 25, group: 'ops', unit: 'pct', basis: 'month', sources: ['explosives'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.explosives.filter((r) => inRange(r.month, p.start, p.end) && inScope(s, r.project) && String(r.unit).toLowerCase() === 'kg' && isNum(r.designed));
      const designed = sum(rows, 'designed');
      return ratio(sum(rows, 'issued') - designed, designed, rows.length);
    },
  },
  {
    key: 'handoverCompliance', num: 29, group: 'ops', unit: 'pct', basis: 'month', sources: ['handovers'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.handovers.filter((r) => inRange(r.date, p.start, p.end) && inScope(s, r.project));
      return ratio(rows.filter((r) => r.overlapBriefing === 'Yes' && r.signedOff === 'Yes').length, rows.length, rows.length);
    },
  },
];

export const KPI_BY_KEY = Object.fromEntries(KPIS.map((k) => [k.key, k])) as Record<KpiKey, KpiDef>;

export const KPI_GROUPS: KpiGroup[] = ['safety', 'ops', 'pm'];
/** display order: safety first, then contractor operations, then project management */
export const KPIS_ORDERED: KpiDef[] = KPI_GROUPS.flatMap((g) => KPIS.filter((k) => k.group === g).sort((a, b) => a.num - b.num));

function daysDiff(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export const DEFAULT_TARGETS: Record<KpiKey, KpiTarget> = {
  sv: { key: 'sv', direction: 'Higher', target: 0, amber: -0.05, owner: '' },
  cv: { key: 'cv', direction: 'Higher', target: 0, amber: -0.05, owner: '' },
  // Band: under-spend usually means slippage, over-spend is overrun – both are off target
  budgetUtil: { key: 'budgetUtil', direction: 'Band', target: 1, amber: 1.05, greenLo: 0.95, greenHi: 1.02, amberLo: 0.9, amberHi: 1.05, owner: '' },
  onTime: { key: 'onTime', direction: 'Higher', target: 0.9, amber: 0.8, owner: '' },
  scopeFreq: { key: 'scopeFreq', direction: 'Lower', target: 0.5, amber: 1, owner: '' },
  riskEff: { key: 'riskEff', direction: 'Higher', target: 0.85, amber: 0.7, owner: '' },
  issueTime: { key: 'issueTime', direction: 'Lower', target: 7, amber: 14, owner: '' },
  satisfaction: { key: 'satisfaction', direction: 'Higher', target: 4, amber: 3.5, owner: '' },
  // Band: sustained > 95 % leaves no slack for breakdowns, training, or leave
  resourceUtil: { key: 'resourceUtil', direction: 'Band', target: 0.85, amber: 0.95, greenLo: 0.8, greenHi: 0.92, amberLo: 0.7, amberHi: 0.95, owner: '' },
  successRate: { key: 'successRate', direction: 'Higher', target: 0.8, amber: 0.65, owner: '' },
  milestoneRate: { key: 'milestoneRate', direction: 'Higher', target: 0.9, amber: 0.8, owner: '' },
  quality: { key: 'quality', direction: 'Higher', target: 0.95, amber: 0.85, owner: '' },
  crTime: { key: 'crTime', direction: 'Lower', target: 5, amber: 10, owner: '' },
  productivity: { key: 'productivity', direction: 'Higher', target: 1, amber: 0.9, owner: '' },
  benefits: { key: 'benefits', direction: 'Higher', target: 0.9, amber: 0.75, owner: '' },
  ci: { key: 'ci', direction: 'Higher', target: 2, amber: 1, owner: '' },
  // Contractor escalation rules: SPI < 0.90 → formal schedule notice; CPI < 0.95 → escalate
  cumSpi: { key: 'cumSpi', direction: 'Higher', target: 1, amber: 0.9, owner: '' },
  cumCpi: { key: 'cumCpi', direction: 'Higher', target: 1, amber: 0.95, owner: '' },
  // contractor operations – escalate client authorisation delays beyond 48 h
  gateLag: { key: 'gateLag', direction: 'Lower', target: 24, amber: 48, owner: '' },
  // every verbal instruction must be confirmed in writing (variation claims depend on it)
  verbalOpen: { key: 'verbalOpen', direction: 'Lower', target: 0, amber: 2, owner: '' },
  variationRecovery: { key: 'variationRecovery', direction: 'Higher', target: 0.9, amber: 0.75, owner: '' },
  drillPlan: { key: 'drillPlan', direction: 'Higher', target: 1, amber: 0.9, owner: '' },
  blastPlan: { key: 'blastPlan', direction: 'Higher', target: 1, amber: 0.9, owner: '' },
  reblastRate: { key: 'reblastRate', direction: 'Lower', target: 0.02, amber: 0.05, owner: '' },
  // Band: over-use is a cost leak, under-use (under-charging) hurts fragmentation
  explosivesVar: { key: 'explosivesVar', direction: 'Band', target: 0, amber: 0.05, greenLo: -0.03, greenHi: 0.03, amberLo: -0.05, amberHi: 0.05, owner: '' },
  // per million hours worked, year to date – set these from your own baseline and client requirements
  trifr: { key: 'trifr', direction: 'Lower', target: 2, amber: 4, owner: '' },
  ltifr: { key: 'ltifr', direction: 'Lower', target: 0.5, amber: 1, owner: '' },
  blastCompliance: { key: 'blastCompliance', direction: 'Higher', target: 1, amber: 0.98, owner: '' },
  handoverCompliance: { key: 'handoverCompliance', direction: 'Higher', target: 1, amber: 0.9, owner: '' },
};

// ---------- RAG & trend ----------
const EPS = 1e-9;

export function rag(v: number | null, t: KpiTarget): Rag | null {
  if (v === null) return null;
  if (t.direction === 'Band') {
    const gl = t.greenLo ?? -Infinity, gh = t.greenHi ?? Infinity;
    const al = t.amberLo ?? gl, ah = t.amberHi ?? gh;
    if (v >= gl - EPS && v <= gh + EPS) return 'GREEN';
    if (v >= al - EPS && v <= ah + EPS) return 'AMBER';
    return 'RED';
  }
  if (t.direction === 'Higher') return v >= t.target - EPS ? 'GREEN' : v >= t.amber - EPS ? 'AMBER' : 'RED';
  return v <= t.target + EPS ? 'GREEN' : v <= t.amber + EPS ? 'AMBER' : 'RED';
}

/** distance from the green zone (0 = inside); used to judge 'better/worse' for band KPIs */
function bandDistance(v: number, t: KpiTarget) {
  const lo = t.greenLo ?? -Infinity, hi = t.greenHi ?? Infinity;
  return v < lo ? lo - v : v > hi ? v - hi : 0;
}

export type Trend = 'better' | 'worse' | 'stable';

export function trend(cur: number | null, prev: number | null, t: KpiTarget): Trend | null {
  if (cur === null || prev === null) return null;
  if (Math.abs(cur - prev) < 1e-9) return 'stable';
  if (t.direction === 'Band') {
    const d0 = bandDistance(prev, t), d1 = bandDistance(cur, t);
    return Math.abs(d1 - d0) < 1e-9 ? 'stable' : d1 < d0 ? 'better' : 'worse';
  }
  return (cur > prev) === (t.direction === 'Higher') ? 'better' : 'worse';
}

// ---------- tracking grid ----------
export interface KpiCell extends KpiValue {
  rag: Rag | null;
}

export interface Tracking {
  months: ISODate[];
  /** index of the reporting month inside months */
  reportIdx: number;
  rows: Record<KpiKey, (KpiCell | null)[]>; // null = month after the reporting month
}

export function effectiveReportingMonth(s: Settings, today: ISODate = todayISO()): ISODate {
  const months = yearMonths(s.yearStart);
  const wanted = s.reportingMonth ?? today.slice(0, 7) + '-01';
  if (wanted < months[0]) return months[0];
  if (wanted > months[11]) return months[11];
  return wanted;
}

export function computeTracking(ds: Dataset, reportMonth: ISODate, scope: Scope, today: ISODate = todayISO()): Tracking {
  const months = yearMonths(ds.settings.yearStart);
  const reportIdx = Math.max(0, months.indexOf(reportMonth));
  const rows = {} as Tracking['rows'];
  for (const k of KPIS) {
    rows[k.key] = months.map((m, i) => {
      if (i > reportIdx) return null;
      const v = k.compute(ds, makePeriod(m, ds.settings.yearStart, today), k.projectScoped ? scope : null);
      return { ...v, rag: rag(v.value, ds.targets[k.key]) };
    });
  }
  return { months, reportIdx, rows };
}

export function targetFor(ds: Dataset, kpi: string): KpiTarget | null {
  return (ds.targets as Record<string, KpiTarget>)[kpi] ?? null;
}
