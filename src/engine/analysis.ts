import { addMonths, daysBetween, inRange, isISODate, makePeriod, monthEnd, type ISODate, type Period } from './dates.ts';
import { KPIS, rag, targetFor, type Dataset, type KpiKey, type Rag, type Scope, type Tracking } from './kpis.ts';
import { actionDueStatus, milestoneOnTime, riskScore, type Ctx, type Row } from './schema.ts';

export function makeCtx(ds: Dataset, asOf: ISODate): Ctx {
  return {
    asOf,
    budgetTolerance: ds.settings.budgetTolerance,
    projectsByCode: new Map(ds.logs.projects.map((p) => [String(p.code), p])),
    kpiDirection: (k) => targetFor(ds, k)?.direction ?? 'Higher',
    kpiTarget: (k) => {
      const t = targetFor(ds, k);
      return t ? { green: (v: number) => rag(v, t) === 'GREEN' } : null;
    },
  };
}

/** Project codes matching the site / PM / project filters (null = everything). */
export function resolveScope(ds: Dataset, f: { site?: string; pm?: string; project?: string }): Scope {
  if (!f.site && !f.pm && !f.project) return null;
  return new Set(
    ds.logs.projects
      .filter((p) => (!f.site || p.site === f.site) && (!f.pm || p.pm === f.pm) && (!f.project || p.code === f.project))
      .map((p) => String(p.code)),
  );
}

const inScope = (scope: Scope, project: unknown) => scope === null || (typeof project === 'string' && scope.has(project));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ---------- project EVM & health ----------
export interface ProjectHealth {
  code: string;
  name: string;
  pm: string;
  site: string;
  status: string;
  bac: number | null;
  eac: number | null;
  vacPct: number | null;
  cumCpi: number | null;
  cumSpi: number | null;
  /** SPI of the reporting month and the month before */
  spiNow: number | null;
  spiPrev: number | null;
  forecastDaysLate: number | null;
  overdueMilestones: number;
  openIssues: number;
  highRisks: number;
  pendingCrs: number;
  health: Rag;
}

function evm(ds: Dataset, code: string, start: ISODate, end: ISODate) {
  const rows = ds.logs.costSchedule.filter((r) => r.project === code && inRange(r.month, start, end));
  const s = (f: string) => rows.reduce((a, r) => a + (isNum(r[f]) ? (r[f] as number) : 0), 0);
  const pv = s('pv'), ev = s('ev'), ac = s('ac');
  return { n: rows.length, spi: rows.length && pv ? ev / pv : null, cpi: rows.length && ac ? ev / ac : null };
}

const worst = (xs: Rag[]): Rag => (xs.includes('RED') ? 'RED' : xs.includes('AMBER') ? 'AMBER' : 'GREEN');

export function projectHealth(ds: Dataset, p: Period, scope: Scope): ProjectHealth[] {
  const tol = ds.settings.budgetTolerance;
  return ds.logs.projects
    .filter((r) => inScope(scope, r.code))
    // active projects, plus those completed this year (so the year's story stays visible)
    .filter((r) => r.status === 'Active' || r.status === 'On hold' || (r.status === 'Completed' && inRange(r.actualFinish, p.yearStart, p.end)))
    .filter((r) => !isISODate(r.start) || r.start <= p.end)
    .map((r) => {
      const code = String(r.code);
      const cum = evm(ds, code, p.yearStart, p.end);
      const now = evm(ds, code, p.start, p.end);
      const prevM = addMonths(p.month, -1);
      const prev = evm(ds, code, prevM, monthEnd(prevM));
      const bac = isNum(r.bac) ? r.bac : null, eac = isNum(r.eac) ? r.eac : null;
      const vacPct = bac && eac !== null ? (bac - eac) / bac : null;
      const forecastDaysLate =
        isISODate(r.baselineFinish) && isISODate(r.actualFinish) ? daysBetween(r.baselineFinish, r.actualFinish) : null;
      const ms = ds.logs.milestones.filter((m) => m.project === code);
      const overdueMilestones = ms.filter((m) => milestoneOnTime(m, p.asOf) === 'Overdue').length;
      const openIssues = ds.logs.issues.filter((i) => i.project === code && isOpenIssue(i, p.asOf)).length;
      const highRisks = ds.logs.risks.filter((k) => k.project === code && isOpenRisk(k, p.asOf) && (riskScore(k.probability, k.impact) ?? 0) >= 15).length;
      const pendingCrs = ds.logs.changes.filter((c) => c.project === code && isPendingCr(c, p.asOf)).length;

      const parts: Rag[] = [];
      if (cum.cpi !== null) parts.push(rag(cum.cpi, ds.targets.cumCpi) ?? 'GREEN');
      if (cum.spi !== null) parts.push(rag(cum.spi, ds.targets.cumSpi) ?? 'GREEN');
      if (vacPct !== null) parts.push(vacPct >= -tol ? 'GREEN' : vacPct >= -2 * tol ? 'AMBER' : 'RED');
      if (forecastDaysLate !== null)
        parts.push(forecastDaysLate <= 0 ? 'GREEN' : forecastDaysLate <= ds.settings.daysLateTolerance ? 'AMBER' : 'RED');
      if (overdueMilestones > 0) parts.push('AMBER');
      if (highRisks > 0) parts.push('AMBER');

      return {
        code, name: String(r.name ?? ''), pm: String(r.pm ?? ''), site: String(r.site ?? ''), status: String(r.status ?? ''),
        bac, eac, vacPct, cumCpi: cum.cpi, cumSpi: cum.spi, spiNow: now.spi, spiPrev: prev.spi,
        forecastDaysLate, overdueMilestones, openIssues, highRisks, pendingCrs, health: worst(parts),
      };
    })
    .sort((a, b) => sev(b.health) - sev(a.health) || a.code.localeCompare(b.code));
}

const sev = (r: Rag) => (r === 'RED' ? 2 : r === 'AMBER' ? 1 : 0);

export function isOpenIssue(i: Row, asOf: ISODate) {
  return isISODate(i.raised) && i.raised <= asOf && !(isISODate(i.resolved) && i.resolved <= asOf);
}
export function isOpenRisk(k: Row, asOf: ISODate) {
  return isISODate(k.identified) && k.identified <= asOf && !(isISODate(k.closureDate) && k.closureDate <= asOf) && k.status === 'Open';
}
export function isPendingCr(c: Row, asOf: ISODate) {
  return isISODate(c.submitted) && c.submitted <= asOf && !(isISODate(c.decisionDate) && c.decisionDate <= asOf);
}

// ---------- watch list (alerts) ----------
export type Severity = 'critical' | 'serious' | 'warning';

export interface Alert {
  severity: Severity;
  code: string; // i18n key under alerts.*
  params: Record<string, string | number>;
  log?: string;
  rowId?: string;
  project?: string;
}

export function alerts(ds: Dataset, tracking: Tracking, p: Period, scope: Scope): Alert[] {
  const out: Alert[] = [];
  const crTarget = ds.targets.crTime.target;

  for (const h of projectHealth(ds, p, scope)) {
    if (h.status === 'Completed') continue;
    if (h.cumCpi !== null && h.cumCpi < 0.9)
      out.push({ severity: 'critical', code: 'cpiReview', params: { project: h.code, cpi: h.cumCpi.toFixed(2) }, project: h.code });
    else if (h.cumCpi !== null && h.cumCpi < 0.95)
      out.push({ severity: 'serious', code: 'cpiEscalate', params: { project: h.code, cpi: h.cumCpi.toFixed(2) }, project: h.code });
    if (h.spiNow !== null && h.spiPrev !== null && h.spiNow < 0.9 && h.spiPrev < 0.9)
      out.push({ severity: 'critical', code: 'spiTwice', params: { project: h.code, spi: h.spiNow.toFixed(2) }, project: h.code });
    if (h.forecastDaysLate !== null && h.forecastDaysLate > 0)
      out.push({ severity: h.forecastDaysLate > ds.settings.daysLateTolerance ? 'serious' : 'warning', code: 'forecastLate', params: { project: h.code, days: h.forecastDaysLate }, project: h.code });
  }

  for (const m of ds.logs.milestones)
    if (inScope(scope, m.project) && milestoneOnTime(m, p.asOf) === 'Overdue')
      out.push({ severity: 'serious', code: 'milestoneOverdue', params: { id: String(m.code), name: String(m.milestone ?? ''), project: String(m.project), days: daysBetween(m.baselineDue as string, p.asOf) }, log: 'milestones', rowId: m.id, project: String(m.project) });

  for (const a of ds.logs.actions)
    if (inScope(scope, a.project))
      if (isISODate(a.raised) && a.raised <= p.asOf && actionDueStatus(a, p.asOf) === 'OVERDUE')
        out.push({ severity: 'serious', code: 'actionOverdue', params: { id: String(a.code), owner: String(a.owner ?? ''), days: daysBetween(a.due as string, p.asOf) }, log: 'actions', rowId: a.id });

  for (const i of ds.logs.issues)
    if (inScope(scope, i.project) && isOpenIssue(i, p.asOf)) {
      const d = daysBetween(i.raised as string, p.asOf);
      if (d > ds.targets.issueTime.amber)
        out.push({ severity: 'warning', code: 'issueAged', params: { id: String(i.code), days: d, project: String(i.project) }, log: 'issues', rowId: i.id, project: String(i.project) });
    }

  for (const k of ds.logs.risks)
    if (inScope(scope, k.project) && isOpenRisk(k, p.asOf) && (riskScore(k.probability, k.impact) ?? 0) >= 15)
      out.push({ severity: 'warning', code: 'highRisk', params: { id: String(k.code), name: String(k.description ?? ''), project: String(k.project) }, log: 'risks', rowId: k.id, project: String(k.project) });

  for (const c of ds.logs.changes)
    if (inScope(scope, c.project) && isPendingCr(c, p.asOf)) {
      const d = daysBetween(c.submitted as string, p.asOf);
      if (d > crTarget)
        out.push({ severity: 'warning', code: 'crPending', params: { id: String(c.code), days: d, project: String(c.project) }, log: 'changes', rowId: c.id, project: String(c.project) });
    }

  // close the loop: every RED KPI needs a live corrective action
  const idx = tracking.reportIdx;
  for (const k of KPIS) {
    const cell = tracking.rows[k.key][idx];
    if (cell?.rag !== 'RED') continue;
    const live = ds.logs.actions.some((a) => a.kpi === k.key && (a.status === 'Open' || a.status === 'In progress'));
    if (!live) out.push({ severity: 'serious', code: 'redNoAction', params: { kpi: k.key }, log: 'actions' });
    if (k.smallSample && cell.n < k.smallSample)
      out.push({ severity: 'warning', code: 'smallSample', params: { kpi: k.key, n: cell.n } });
  }

  const rank = { critical: 0, serious: 1, warning: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ---------- portfolio snapshot ----------
export function snapshot(ds: Dataset, p: Period, scope: Scope) {
  const projects = ds.logs.projects.filter((r) => inScope(scope, r.code));
  const bac = projects.reduce((a, r) => a + (isNum(r.bac) ? r.bac : 0), 0);
  const eac = projects.reduce((a, r) => a + (isNum(r.eac) ? r.eac : isNum(r.bac) ? r.bac : 0), 0);
  const risks = ds.logs.risks.filter((r) => inScope(scope, r.project) && isOpenRisk(r, p.asOf));
  const issues = ds.logs.issues.filter((r) => inScope(scope, r.project) && isOpenIssue(r, p.asOf));
  const actions = ds.logs.actions.filter((a) => (scope === null || inScope(scope, a.project)) && isISODate(a.raised) && a.raised <= p.asOf);
  const liveActions = actions.filter((a) => actionDueStatus(a, p.asOf) !== 'Closed');
  const ctx = makeCtx(ds, p.asOf);
  const judged = actions.filter((a) => isNum(a.after) && isNum(a.before));
  const improved = judged.filter((a) => {
    const t = ctx.kpiTarget(String(a.kpi));
    const dir = ctx.kpiDirection(String(a.kpi));
    if (dir === 'Band') return t?.green(a.after as number) ?? false;
    return dir === 'Higher' ? (a.after as number) > (a.before as number) : (a.after as number) < (a.before as number);
  }).length;
  const ciDone = ds.logs.ci.filter((c) => c.status === 'Implemented' && inRange(c.implDate, p.yearStart, p.end));
  return {
    projects: projects.length,
    active: projects.filter((r) => r.status === 'Active').length,
    completed: projects.filter((r) => r.status === 'Completed').length,
    bac,
    eac,
    vac: bac - eac,
    openRisks: risks.length,
    highRisks: risks.filter((r) => (riskScore(r.probability, r.impact) ?? 0) >= 15).length,
    openIssues: issues.length,
    agedIssues: issues.filter((i) => daysBetween(i.raised as string, p.asOf) > ds.targets.issueTime.amber).length,
    pendingCrs: ds.logs.changes.filter((c) => inScope(scope, c.project) && isPendingCr(c, p.asOf)).length,
    approvedCrCost: ds.logs.changes
      .filter((c) => inScope(scope, c.project) && c.decision === 'Approved' && inRange(c.decisionDate, p.yearStart, p.end))
      .reduce((a, c) => a + (isNum(c.costImpact) ? c.costImpact : 0), 0),
    overdueMilestones: ds.logs.milestones.filter((m) => inScope(scope, m.project) && milestoneOnTime(m, p.asOf) === 'Overdue').length,
    liveActions: liveActions.length,
    overdueActions: liveActions.filter((a) => actionDueStatus(a, p.asOf) === 'OVERDUE').length,
    improvedShare: judged.length ? improved / judged.length : null,
    ciImplemented: ciDone.length,
    ciVerified: ciDone.filter((c) => c.verified === 'Yes').length,
    targetRevisions: ds.logs.targetRevisions.length,
  };
}

export function periodFor(ds: Dataset, month: ISODate, today?: ISODate) {
  return makePeriod(month, ds.settings.yearStart, today);
}

export function actionCounts(ds: Dataset, kpi: KpiKey) {
  const rows = ds.logs.actions.filter((a) => a.kpi === kpi);
  return {
    live: rows.filter((a) => a.status === 'Open' || a.status === 'In progress').length,
    done: rows.filter((a) => a.status === 'Implemented').length,
  };
}
