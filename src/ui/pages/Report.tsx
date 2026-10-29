// Printable documents: the monthly report (contractor → client / management) and the
// rotation handover pack. Both are built from live data and exported to PDF.
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { daysBetween, inRange, isISODate } from '../../engine/dates.ts';
import { isOpenIssue, isOpenRisk, projectHealth, type Alert } from '../../engine/analysis.ts';
import { KPI_GROUPS, KPIS_ORDERED, trend } from '../../engine/kpis.ts';
import { actionDueStatus, gateWaitHours, milestoneOnTime, riskScore, stockDiscrepancy, type Row } from '../../engine/schema.ts';
import { makeCtx } from '../../engine/analysis.ts';
import { canCreate } from '../../engine/permissions.ts';
import { desktop } from '../../data/persistence.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';
import { useSession } from '../session.ts';
import { KpiChart } from '../components/charts.tsx';
import { RagChip, SeverityChip, TrendText, formatValue, targetRule } from '../components/common.tsx';
import { useAlertText } from './Dashboard.tsx';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sumOf = (rows: Row[], k: string) => rows.reduce((a, r) => a + (isNum(r[k]) ? (r[k] as number) : 0), 0);

async function exportPdf(name: string) {
  if (desktop?.printToPdf) await desktop.printToPdf(name);
  else window.print();
}

function Section({ title, children, empty }: { title: string; children?: ReactNode; empty?: boolean }) {
  const { d } = useI18n();
  return (
    <section className="report-section">
      <h2>{title}</h2>
      {empty ? <p className="faint">{d.report.none}</p> : children}
    </section>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: (ReactNode | string | number)[][] }) {
  return (
    <table className="report-table">
      <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

function AlertList({ alerts }: { alerts: Alert[] }) {
  const text = useAlertText();
  return (
    <ul className="report-alerts">
      {alerts.map((a, i) => <li key={i}><SeverityChip s={a.severity} /> {text(a)}</li>)}
    </ul>
  );
}

// =====================================================================
export function MonthlyReport() {
  const { ds, period, tracking, scope, filter, alerts } = useApp();
  const i = useI18n();
  const d = i.d;
  const idx = tracking.reportIdx;
  const inScope = (p: unknown) => scope === null || scope.has(String(p));
  const month = (rows: Row[], key: string) => rows.filter((r) => inRange(r[key], period.start, period.end) && inScope(r.project));
  const scopeLabel = [filter.site, filter.pm, filter.project].filter(Boolean).join(' · ') || d.common.portfolio;
  const cur = ds.settings.currency;

  const health = useMemo(() => projectHealth(ds, period, scope), [ds, period, scope]);
  const byProject = new Map<string, Row[]>();
  for (const r of month(ds.logs.production, 'date')) byProject.set(String(r.project), [...(byProject.get(String(r.project)) ?? []), r]);
  const production = [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b));
  const gatesDecided = month(ds.logs.gates.filter((g) => g.status !== 'Pending'), 'approvedAt');
  const ctx = makeCtx(ds, period.asOf);
  const gatesLate = ds.logs.gates.filter((g) => inScope(g.project) && g.status === 'Pending' && (gateWaitHours(g, ctx.now) ?? 0) > 48);
  const openVos = ds.logs.variations.filter((v) => inScope(v.project) && ['Instructed', 'Submitted', 'Disputed'].includes(String(v.status)));
  const decidedVos = month(ds.logs.variations.filter((v) => v.status === 'Approved' || v.status === 'Rejected'), 'decisionDate');
  const explosives = month(ds.logs.explosives, 'month');
  const safety = month(ds.logs.safety, 'month');
  const highRisks = ds.logs.risks.filter((r) => inScope(r.project) && isOpenRisk(r, period.asOf) && (riskScore(r.probability, r.impact) ?? 0) >= 15);
  // look-ahead: the next four weeks after the evaluation date
  const horizon = new Date(Date.parse(period.asOf) + 28 * 86_400_000).toISOString().slice(0, 10);
  const milestonesAhead = ds.logs.milestones.filter((m) => inScope(m.project) && m.status !== 'Completed' && isISODate(m.baselineDue) && m.baselineDue > period.asOf && m.baselineDue <= horizon);
  const top = alerts.filter((a) => a.severity !== 'warning').slice(0, 12);

  const kpiRow = (k: (typeof KPIS_ORDERED)[number]) => {
    const c = tracking.rows[k.key][idx], p = idx > 0 ? tracking.rows[k.key][idx - 1] : null;
    const t = ds.targets[k.key];
    return [
      `#${k.num} ${d.kpi[k.key].name}`, targetRule(t, k.unit, i), i.kpi(c?.value ?? null, k.unit), i.kpi(p?.value ?? null, k.unit),
      <TrendText t={trend(c?.value ?? null, p?.value ?? null, t)} />, <RagChip rag={c?.rag ?? null} />,
    ];
  };

  return (
    <div className="report">
      <div className="page-head no-print">
        <div>
          <h1>{d.report.title}</h1>
          <p className="muted">{d.report.intro}</p>
        </div>
        <button className="btn primary" onClick={() => void exportPdf(`BenchMark_report_${period.month.slice(0, 7)}.pdf`)}>{d.report.exportPdf}</button>
      </div>

      <header className="report-head">
        <div className="report-title">{d.report.title} – {i.monthLabel(period.month, true)}</div>
        <div>{ds.settings.orgName}</div>
        <div className="faint">{scopeLabel} · {i.t(d.dashboard.asOf, { d: i.date(period.asOf) })} · {d.settings.preparedBy}: {ds.settings.preparedBy}</div>
      </header>

      <Section title={d.report.summary}>
        <div className="report-grid">
          {KPI_GROUPS.map((g) => {
            const ks = KPIS_ORDERED.filter((k) => k.group === g);
            const count = (r: string) => ks.filter((k) => tracking.rows[k.key][idx]?.rag === r).length;
            return (
              <div key={g} className="report-kpi-group">
                <b>{d.kpiGroups[g]}</b>
                <div><span className="chip GREEN">{count('GREEN')}</span> <span className="chip AMBER">{count('AMBER')}</span> <span className="chip RED">{count('RED')}</span></div>
              </div>
            );
          })}
        </div>
        <div className="report-grid">
          {(['trifr', 'ltifr', 'cumCpi', 'cumSpi', 'reblastRate', 'gateLag'] as const).map((k) => {
            const def = KPIS_ORDERED.find((x) => x.key === k)!;
            const c = tracking.rows[k][idx];
            return (
              <div key={k} className="report-figure">
                <span className="faint">{d.kpi[k].name}</span>
                <b>{i.kpi(c?.value ?? null, def.unit)}</b>
                <RagChip rag={c?.rag ?? null} />
              </div>
            );
          })}
          <div className="report-figure">
            <span className="faint">{d.report.vosPending}</span>
            <b>{i.money(sumOf(openVos, 'valueClaimed'), cur)}</b>
            <span className="faint">{openVos.length}</span>
          </div>
        </div>
        {top.length > 0 && <AlertList alerts={top} />}
      </Section>

      {KPI_GROUPS.map((g) => (
        <Section key={g} title={d.kpiGroups[g]}>
          <SimpleTable head={[d.dashboard.kpi, d.dashboard.target, d.dashboard.actual, d.dashboard.prev, d.dashboard.trend, d.dashboard.status]}
            rows={KPIS_ORDERED.filter((k) => k.group === g).map(kpiRow)} />
          {g === 'safety' && (
            <SimpleTable head={[d.fields.project, d.fields.hoursWorked, 'LTI', 'MTI', 'RWI', d.fields.nearMisses, d.fields.blastsMonitored, d.fields.ppvExceedances, d.fields.airblastExceedances]}
              rows={safety.map((s) => [String(s.project), i.num(sumOf([s], 'hoursWorked')), sumOf([s], 'lti'), sumOf([s], 'mti'), sumOf([s], 'rwi'), sumOf([s], 'nearMisses'), sumOf([s], 'blastsMonitored'), sumOf([s], 'ppvExceedances'), sumOf([s], 'airblastExceedances')])} />
          )}
        </Section>
      ))}

      <div className="report-charts">
        {(['trifr', 'cumCpi', 'cumSpi', 'reblastRate'] as const).map((k) => {
          const def = KPIS_ORDERED.find((x) => x.key === k)!;
          return (
            <div key={k} className="card chart-card">
              <h3>{d.kpi[k].name}</h3>
              <KpiChart months={tracking.months} cells={tracking.rows[k]} target={ds.targets[k]} unit={def.unit} reportIdx={idx} height={150} />
            </div>
          );
        })}
      </div>

      <Section title={d.logs.production.title} empty={production.length === 0}>
        <SimpleTable head={[d.fields.project, d.fields.plannedMetres, d.fields.actualMetres, d.fields.metresPct, d.fields.plannedBlasts, d.fields.actualBlasts, d.fields.reblasts, d.fields.misfires]}
          rows={production.map(([p, rows]) => {
            const pm = sumOf(rows, 'plannedMetres'), am = sumOf(rows, 'actualMetres');
            return [p, i.num(pm), i.num(am), pm ? i.pct(am / pm) : '—', sumOf(rows, 'plannedBlasts'), sumOf(rows, 'actualBlasts'), sumOf(rows, 'reblasts'), sumOf(rows, 'misfires')];
          })} />
      </Section>

      <Section title={d.nav.health} empty={health.length === 0}>
        <SimpleTable head={[d.health.code, d.health.name, d.health.cpi, d.health.spi, d.health.bac, d.health.eac, d.health.daysLate, d.health.health]}
          rows={health.map((h) => [h.code, h.name, h.cumCpi === null ? '—' : i.num(h.cumCpi, 2), h.cumSpi === null ? '—' : i.num(h.cumSpi, 2),
            h.bac === null ? '' : i.money(h.bac), h.eac === null ? '' : i.money(h.eac), h.forecastDaysLate ?? '', <RagChip rag={h.health} />])} />
      </Section>

      <Section title={d.logs.gates.title}>
        <p>{i.t(d.report.gatesSummary, { n: gatesDecided.length, lag: i.kpi(tracking.rows.gateLag[idx]?.value ?? null, 'hours'), late: gatesLate.length })}</p>
        {gatesLate.length > 0 && (
          <SimpleTable head={[d.fields.code, d.fields.project, d.fields.block, d.fields.gate, d.fields.submittedAt, d.fields.waitHours]}
            rows={gatesLate.map((g) => [String(g.code), String(g.project), String(g.block ?? ''), i.v(g.gate), formatValue(i, g.submittedAt, 'datetime'), i.num(gateWaitHours(g, ctx.now) ?? 0, 1)])} />
        )}
      </Section>

      <Section title={d.logs.variations.title}>
        <h3>{d.report.vosOpen}</h3>
        {openVos.length === 0 ? <p className="faint">{d.report.none}</p> : (
          <SimpleTable head={[d.fields.code, d.fields.project, d.fields.instructed, d.fields.instructionType, d.fields.confirmedInWriting, d.fields.description, d.fields.valueClaimed, d.fields.status]}
            rows={openVos.map((v) => [String(v.code), String(v.project), i.date(v.instructed), i.v(v.instructionType), i.v(v.confirmedInWriting), String(v.description ?? ''), i.money(sumOf([v], 'valueClaimed')), i.v(v.status)])} />
        )}
        <h3>{d.report.vosDecided}</h3>
        {decidedVos.length === 0 ? <p className="faint">{d.report.none}</p> : (
          <SimpleTable head={[d.fields.code, d.fields.project, d.fields.description, d.fields.valueClaimed, d.fields.valueApproved, d.fields.status]}
            rows={decidedVos.map((v) => [String(v.code), String(v.project), String(v.description ?? ''), i.money(sumOf([v], 'valueClaimed')), i.money(sumOf([v], 'valueApproved')), i.v(v.status)])} />
        )}
      </Section>

      <Section title={d.logs.explosives.title} empty={explosives.length === 0}>
        <SimpleTable head={[d.fields.project, d.fields.product, d.fields.unit, d.fields.issued, d.fields.designed, d.fields.designVar, d.fields.discrepancy]}
          rows={explosives.map((e) => {
            const disc = stockDiscrepancy(e);
            return [String(e.project), i.v(e.product), String(e.unit ?? ''), i.num(sumOf([e], 'issued')), isNum(e.designed) ? i.num(e.designed) : '—',
              isNum(e.designed) && e.designed ? i.pct((sumOf([e], 'issued') - e.designed) / e.designed) : '—', disc === null ? '—' : <b style={{ color: disc ? 'var(--critical-ink)' : undefined }}>{i.num(disc, 0)}</b>];
          })} />
      </Section>

      <Section title={d.report.risks} empty={highRisks.length === 0}>
        <SimpleTable head={[d.fields.code, d.fields.project, d.fields.description, d.fields.score, d.fields.mitigation, d.fields.owner]}
          rows={highRisks.map((r) => [String(r.code), String(r.project), String(r.description ?? ''), riskScore(r.probability, r.impact) ?? '', String(r.mitigation ?? ''), String(r.owner ?? '')])} />
      </Section>

      <Section title={d.report.lookahead} empty={milestonesAhead.length === 0}>
        <SimpleTable head={[d.fields.code, d.fields.project, d.fields.milestone, d.fields.baselineDue, d.fields.owner]}
          rows={milestonesAhead.map((m) => [String(m.code), String(m.project), String(m.milestone ?? ''), i.date(m.baselineDue), String(m.owner ?? '')])} />
      </Section>
    </div>
  );
}

// =====================================================================
export function HandoverPack() {
  const { ds, today, filter, alerts, edit } = useApp();
  const { who } = useSession();
  const i = useI18n();
  const d = i.d;
  const projects = ds.logs.projects.filter((p) => p.status === 'Active' || p.status === 'On hold');
  const [code, setCode] = useState<string>(filter.project ?? String(projects[0]?.code ?? ''));
  const p = ds.logs.projects.find((x) => x.code === code);
  const ctx = makeCtx(ds, today);
  const of = (rows: Row[]) => rows.filter((r) => r.project === code);
  const in14 = new Date(Date.parse(today) + 14 * 86_400_000).toISOString().slice(0, 10);
  const from28 = new Date(Date.parse(today) - 28 * 86_400_000).toISOString().slice(0, 10);

  const pendingGates = of(ds.logs.gates).filter((g) => g.status === 'Pending');
  const openVos = of(ds.logs.variations).filter((v) => ['Instructed', 'Submitted', 'Disputed'].includes(String(v.status)));
  const milestones = of(ds.logs.milestones).filter((m) => m.status !== 'Completed' && isISODate(m.baselineDue) && m.baselineDue <= in14);
  const actions = of(ds.logs.actions).filter((a) => actionDueStatus(a, today) !== 'Closed');
  const issues = of(ds.logs.issues).filter((x) => isOpenIssue(x, today));
  const risks = of(ds.logs.risks).filter((r) => isOpenRisk(r, today) && (riskScore(r.probability, r.impact) ?? 0) >= 8);
  const production = of(ds.logs.production).filter((r) => isISODate(r.date) && r.date >= from28 && r.date <= today);
  const projectAlerts = alerts.filter((a) => a.project === code);

  const summary = () => {
    const lines: string[] = [];
    if (pendingGates.length) lines.push(`${d.report.pendingGates}: ${pendingGates.map((g) => `${g.block} ${i.v(g.gate)}`).join(', ')}`);
    if (openVos.length) lines.push(`${d.report.vosOpen}: ${openVos.map((v) => v.code).join(', ')}`);
    if (milestones.length) lines.push(`${d.report.milestonesSoon}: ${milestones.map((m) => `${m.code} ${m.milestone}`).join(', ')}`);
    if (actions.length) lines.push(`${d.logs.actions.title}: ${actions.map((a) => a.code).join(', ')}`);
    if (issues.length) lines.push(`${d.logs.issues.title}: ${issues.map((x) => x.code).join(', ')}`);
    return lines.join('\n');
  };

  if (!p) return <div className="notice info">{d.report.noProject}</div>;
  return (
    <div className="report">
      <div className="page-head no-print">
        <div>
          <h1>{d.report.handoverTitle}</h1>
          <p className="muted">{d.report.handoverIntro}</p>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <select value={code} onChange={(e) => setCode(e.target.value)}>
            {projects.map((x) => <option key={x.id} value={String(x.code)}>{String(x.code)} – {String(x.name ?? '')}</option>)}
          </select>
          {canCreate('handovers', who) && (
            <button className="btn" onClick={() => edit('handovers', null, {
              project: code, date: today, outgoing: who?.owner || (p.pm as string) || null,
              openItems: summary() || null,
              keyRisks: risks.map((r) => `${r.code} ${r.description}`).join('\n') || null,
              pendingAuthorisations: pendingGates.map((g) => `${g.code} ${g.block} – ${i.v(g.gate)}`).join('\n') || null,
            })}>{d.report.recordHandover}</button>
          )}
          <button className="btn primary" onClick={() => void exportPdf(`BenchMark_handover_${code}_${today}.pdf`)}>{d.report.exportPdf}</button>
        </div>
      </div>

      <header className="report-head">
        <div className="report-title">{d.report.handoverTitle} – {String(p.code)} {String(p.name ?? '')}</div>
        <div>{String(p.site ?? '')} · {d.fields.pm}: {String(p.pm ?? '')}</div>
        <div className="faint">{i.date(today)} · {ds.settings.orgName}</div>
      </header>

      <Section title={d.dashboard.watch} empty={projectAlerts.length === 0}><AlertList alerts={projectAlerts} /></Section>

      <Section title={d.report.pendingGates} empty={pendingGates.length === 0}>
        <SimpleTable head={[d.fields.code, d.fields.block, d.fields.gate, d.fields.submittedAt, d.fields.waitHours, d.fields.approver]}
          rows={pendingGates.map((g) => [String(g.code), String(g.block ?? ''), i.v(g.gate), formatValue(i, g.submittedAt, 'datetime'), i.num(gateWaitHours(g, ctx.now) ?? 0, 1), String(g.approver ?? '')])} />
      </Section>

      <Section title={d.report.vosOpen} empty={openVos.length === 0}>
        <SimpleTable head={[d.fields.code, d.fields.instructed, d.fields.instructionType, d.fields.confirmedInWriting, d.fields.description, d.fields.status]}
          rows={openVos.map((v) => [String(v.code), i.date(v.instructed), i.v(v.instructionType), i.v(v.confirmedInWriting), String(v.description ?? ''), i.v(v.status)])} />
      </Section>

      <Section title={d.report.milestonesSoon} empty={milestones.length === 0}>
        <SimpleTable head={[d.fields.code, d.fields.milestone, d.fields.baselineDue, d.fields.status, d.fields.onTime]}
          rows={milestones.map((m) => [String(m.code), String(m.milestone ?? ''), i.date(m.baselineDue), i.v(m.status), i.v(milestoneOnTime(m, today))])} />
      </Section>

      <Section title={d.logs.actions.title} empty={actions.length === 0}>
        <SimpleTable head={[d.fields.code, d.fields.kpi, d.fields.action, d.fields.owner, d.fields.due, d.fields.dueStatus]}
          rows={actions.map((a) => [String(a.code), formatValue(i, a.kpi, 'kpi'), String(a.action ?? ''), String(a.owner ?? ''), i.date(a.due), i.v(actionDueStatus(a, today))])} />
      </Section>

      <Section title={`${d.logs.issues.title} · ${d.logs.risks.title}`} empty={issues.length + risks.length === 0}>
        {issues.length > 0 && <SimpleTable head={[d.fields.code, d.fields.description, d.fields.owner, d.fields.raised, d.fields.daysOpen]}
          rows={issues.map((x) => [String(x.code), String(x.description ?? ''), String(x.owner ?? ''), i.date(x.raised), isISODate(x.raised) ? daysBetween(x.raised, today) : ''])} />}
        {risks.length > 0 && <SimpleTable head={[d.fields.code, d.fields.description, d.fields.score, d.fields.mitigation, d.fields.owner]}
          rows={risks.map((r) => [String(r.code), String(r.description ?? ''), riskScore(r.probability, r.impact) ?? '', String(r.mitigation ?? ''), String(r.owner ?? '')])} />}
      </Section>

      <Section title={d.report.last4Weeks} empty={production.length === 0}>
        <SimpleTable head={[d.fields.date, d.fields.location, d.fields.actualMetres, d.fields.metresPct, d.fields.actualBlasts, d.fields.reblasts, d.fields.misfires]}
          rows={production.map((r) => [i.date(r.date), String(r.location ?? ''), i.num(sumOf([r], 'actualMetres')),
            isNum(r.plannedMetres) && r.plannedMetres ? i.pct(sumOf([r], 'actualMetres') / r.plannedMetres) : '—', sumOf([r], 'actualBlasts'), sumOf([r], 'reblasts'), sumOf([r], 'misfires')])} />
      </Section>

      <Section title={d.report.signatures}>
        <div className="report-grid signatures">
          {[d.fields.outgoing, d.fields.incoming].map((x) => <Fragment key={x}><div className="sig">{x}<br /><br />______________________</div></Fragment>)}
        </div>
      </Section>
    </div>
  );
}
