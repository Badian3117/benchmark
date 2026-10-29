import { inRange, isISODate, makePeriod, yearMonths, todayISO, type ISODate, type Period } from './dates.ts';
import {
  milestoneOnTime,
  projectOnTime,
  projectSuccessful,
  surveyOverall,
  type LogKey,
  type Row,
  type Settings,
} from './schema.ts';

export type KpiKey =
  | 'sv' | 'cv' | 'budgetUtil' | 'onTime' | 'scopeFreq' | 'riskEff' | 'issueTime' | 'satisfaction'
  | 'resourceUtil' | 'successRate' | 'milestoneRate' | 'quality' | 'crTime' | 'productivity'
  | 'benefits' | 'ci' | 'cumSpi' | 'cumCpi';

export type Unit = 'pct' | 'ratio' | 'days' | 'score' | 'count' | 'perProject';
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
    key: 'sv', num: 1, unit: 'pct', basis: 'month', sources: ['costSchedule'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = costRows(ds, s, p.start, p.end);
      const pv = sum(rows, 'pv');
      return ratio(sum(rows, 'ev') - pv, pv, rows.length);
    },
  },
  {
    key: 'cv', num: 2, unit: 'pct', basis: 'month', sources: ['costSchedule'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = costRows(ds, s, p.start, p.end);
      const ev = sum(rows, 'ev');
      return ratio(ev - sum(rows, 'ac'), ev, rows.length);
    },
  },
  {
    key: 'budgetUtil', num: 3, unit: 'pct', basis: 'month', sources: ['costSchedule'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = costRows(ds, s, p.start, p.end);
      return ratio(sum(rows, 'ac'), sum(rows, 'budget'), rows.length);
    },
  },
  {
    key: 'onTime', num: 4, unit: 'pct', basis: 'ytd', sources: ['projects'], projectScoped: true, smallSample: 5,
    compute: (ds, p, s) => {
      const done = completedYtd(ds, p, s);
      return ratio(done.filter((r) => projectOnTime(r) === true).length, done.length, done.length);
    },
  },
  {
    key: 'scopeFreq', num: 5, unit: 'perProject', basis: 'month', sources: ['changes', 'projects'], projectScoped: true,
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
    key: 'riskEff', num: 6, unit: 'pct', basis: 'ytd', sources: ['risks'], projectScoped: true, smallSample: 5,
    compute: (ds, p, s) => {
      const closed = ds.logs.risks.filter((r) => inRange(r.closureDate, p.yearStart, p.end) && inScope(s, r.project));
      return ratio(closed.filter((r) => r.materialised === 'No').length, closed.length, closed.length);
    },
  },
  {
    key: 'issueTime', num: 7, unit: 'days', basis: 'month', sources: ['issues'], projectScoped: true,
    compute: (ds, p, s) =>
      avg(
        ds.logs.issues
          .filter((r) => inRange(r.resolved, p.start, p.end) && isISODate(r.raised) && inScope(s, r.project))
          .map((r) => daysDiff(r.raised as string, r.resolved as string)),
      ),
  },
  {
    key: 'satisfaction', num: 8, unit: 'score', basis: 'month', sources: ['surveys'], projectScoped: true,
    compute: (ds, p, s) =>
      avg(
        ds.logs.surveys
          .filter((r) => inRange(r.date, p.start, p.end) && inScope(s, r.project))
          .map(surveyOverall)
          .filter(isNum),
      ),
  },
  {
    key: 'resourceUtil', num: 9, unit: 'pct', basis: 'month', sources: ['resources'], projectScoped: false,
    compute: (ds, p) => {
      const rows = ds.logs.resources.filter((r) => inRange(r.month, p.start, p.end));
      return ratio(sum(rows, 'allocated'), sum(rows, 'available'), rows.length);
    },
  },
  {
    key: 'successRate', num: 10, unit: 'pct', basis: 'ytd', sources: ['projects'], projectScoped: true, smallSample: 5,
    compute: (ds, p, s) => {
      const done = completedYtd(ds, p, s);
      const tol = ds.settings.budgetTolerance;
      return ratio(done.filter((r) => projectSuccessful(r, tol) === true).length, done.length, done.length);
    },
  },
  {
    key: 'milestoneRate', num: 11, unit: 'pct', basis: 'month', sources: ['milestones'], projectScoped: true,
    compute: (ds, p, s) => {
      // only milestones already due at the evaluation date – a running month is not penalised for the days still to come
      const due = ds.logs.milestones.filter((r) => inRange(r.baselineDue, p.start, p.asOf) && inScope(s, r.project));
      return ratio(due.filter((r) => milestoneOnTime(r, p.asOf) === 'Yes').length, due.length, due.length);
    },
  },
  {
    key: 'quality', num: 12, unit: 'pct', basis: 'month', sources: ['quality'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.quality.filter((r) => inRange(r.date, p.start, p.end) && inScope(s, r.project));
      return ratio(rows.filter((r) => r.firstTime === 'Yes').length, rows.length, rows.length);
    },
  },
  {
    key: 'crTime', num: 13, unit: 'days', basis: 'month', sources: ['changes'], projectScoped: true,
    compute: (ds, p, s) =>
      avg(
        ds.logs.changes
          .filter((r) => inRange(r.decisionDate, p.start, p.end) && isISODate(r.submitted) && inScope(s, r.project))
          .map((r) => daysDiff(r.submitted as string, r.decisionDate as string)),
      ),
  },
  {
    key: 'productivity', num: 14, unit: 'pct', basis: 'month', sources: ['resources'], projectScoped: false,
    compute: (ds, p) =>
      avg(
        ds.logs.resources
          .filter((r) => inRange(r.month, p.start, p.end) && isNum(r.plannedOutput) && r.plannedOutput !== 0 && isNum(r.actualOutput))
          .map((r) => (r.actualOutput as number) / (r.plannedOutput as number)),
      ),
  },
  {
    key: 'benefits', num: 15, unit: 'pct', basis: 'month', sources: ['benefits'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = ds.logs.benefits.filter((r) => inRange(r.date, p.start, p.end) && inScope(s, r.project));
      return ratio(sum(rows, 'realised'), sum(rows, 'planned'), rows.length);
    },
  },
  {
    key: 'ci', num: 16, unit: 'count', basis: 'month', sources: ['ci'], projectScoped: false,
    compute: (ds, p) => {
      const n = ds.logs.ci.filter((r) => r.status === 'Implemented' && inRange(r.implDate, p.start, p.end)).length;
      return { value: n, n };
    },
  },
  {
    key: 'cumSpi', num: 17, unit: 'ratio', basis: 'ytd', sources: ['costSchedule'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = costRows(ds, s, p.yearStart, p.end);
      return ratio(sum(rows, 'ev'), sum(rows, 'pv'), rows.length);
    },
  },
  {
    key: 'cumCpi', num: 18, unit: 'ratio', basis: 'ytd', sources: ['costSchedule'], projectScoped: true,
    compute: (ds, p, s) => {
      const rows = costRows(ds, s, p.yearStart, p.end);
      return ratio(sum(rows, 'ev'), sum(rows, 'ac'), rows.length);
    },
  },
];

export const KPI_BY_KEY = Object.fromEntries(KPIS.map((k) => [k.key, k])) as Record<KpiKey, KpiDef>;

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
