// Phase 3 contractor KPIs and alerts on a hand-built dataset whose answers are worked out by hand.
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { alerts, makeCtx, periodFor } from '../src/engine/analysis.ts';
import { computeTracking, DEFAULT_TARGETS, rag, type Dataset } from '../src/engine/kpis.ts';
import { LOGS, defaultSettings, gateWaitHours, type LogKey, type Row } from '../src/engine/schema.ts';
import { validateAll } from '../src/engine/validate.ts';
import { buildWorkbook } from '../src/io/exportXlsx.ts';
import { importWorkbook } from '../src/io/importXlsx.ts';
import { makeI18n } from '../src/i18n/index.ts';

const TODAY = '2026-10-29';
let n = 0;
const row = (r: Record<string, unknown>): Row => ({ id: `r${++n}`, ...r });

function dataset(): Dataset {
  const logs = Object.fromEntries(LOGS.map((l) => [l.key, [] as Row[]])) as Record<LogKey, Row[]>;
  logs.projects = [row({ code: 'C1', name: 'Contract', site: 'KGM', pm: 'A', start: '2026-01-01', baselineFinish: '2027-12-31', status: 'Active', bac: 1e6 })];
  logs.gates = [
    row({ code: 'G-1', project: 'C1', block: 'B1', gate: 'Pattern design', submittedAt: '2026-10-05T08:00', approvedAt: '2026-10-05T18:00', status: 'Approved' }),
    row({ code: 'G-2', project: 'C1', block: 'B1', gate: 'Loading authorisation', submittedAt: '2026-10-06T08:00', approvedAt: '2026-10-07T14:00', status: 'Approved' }),
    row({ code: 'G-3', project: 'C1', block: 'B2', gate: 'Loading authorisation', submittedAt: '2026-10-27T10:00', status: 'Pending' }),
    row({ code: 'G-4', project: 'C1', block: 'B3', gate: 'Bench release', submittedAt: '2026-10-24T10:00', status: 'Pending' }),
  ];
  logs.variations = [
    row({ code: 'VO-1', project: 'C1', instructed: '2026-03-01', instructedBy: 'MM', instructionType: 'Written', confirmedInWriting: 'Yes', confirmationDate: '2026-03-01', description: 'x', valueClaimed: 100, status: 'Approved', submittedDate: '2026-03-02', decisionDate: '2026-03-20', valueApproved: 80 }),
    row({ code: 'VO-2', project: 'C1', instructed: '2026-04-01', instructedBy: 'MM', instructionType: 'Verbal', confirmedInWriting: 'Yes', confirmationDate: '2026-04-02', description: 'y', valueClaimed: 50, status: 'Rejected', submittedDate: '2026-04-03', decisionDate: '2026-05-01', valueApproved: 0 }),
    row({ code: 'VO-3', project: 'C1', instructed: '2026-10-20', instructedBy: 'MM', instructionType: 'Verbal', confirmedInWriting: 'No', description: 'z', status: 'Instructed' }),
  ];
  logs.production = [
    row({ date: '2026-10-09', project: 'C1', plannedMetres: 500, actualMetres: 400, plannedBlasts: 5, actualBlasts: 4, reblasts: 1, misfires: 1 }),
    row({ date: '2026-10-16', project: 'C1', plannedMetres: 500, actualMetres: 500, plannedBlasts: 5, actualBlasts: 4, reblasts: 0, misfires: 0 }),
  ];
  logs.explosives = [
    row({ month: '2026-10-01', project: 'C1', product: 'Bulk emulsion', unit: 'kg', opening: 100, received: 1000, issued: 1040, designed: 1000, closingCounted: 60 }),
    row({ month: '2026-10-01', project: 'C1', product: 'Electronic detonators', unit: 'units', opening: 50, received: 100, issued: 90, closingCounted: 58 }),
  ];
  logs.safety = [
    row({ month: '2026-09-01', project: 'C1', hoursWorked: 250_000, lti: 0, mti: 1, rwi: 0 }),
    row({ month: '2026-10-01', project: 'C1', hoursWorked: 250_000, lti: 1, mti: 0, rwi: 0, blastsMonitored: 8, ppvExceedances: 1, airblastExceedances: 0 }),
  ];
  logs.handovers = [
    row({ code: 'H-1', project: 'C1', date: '2026-10-01', outgoing: 'A', incoming: 'B', overlapBriefing: 'Yes', signedOff: 'Yes' }),
    row({ code: 'H-2', project: 'C1', date: '2026-10-28', outgoing: 'B', incoming: 'A', overlapBriefing: 'No', signedOff: 'Yes' }),
  ];
  const settings = { ...defaultSettings(TODAY), yearStart: '2026-01-01' };
  return { settings, targets: structuredClone(DEFAULT_TARGETS), logs };
}

describe('contractor KPIs', () => {
  const ds = dataset();
  const t = computeTracking(ds, '2026-10-01', null, TODAY);
  const oct = (k: keyof typeof t.rows) => t.rows[k][9]!;

  it('gate lag = average hours of gates authorised in the month', () => {
    expect(oct('gateLag').value).toBe((10 + 30) / 2); // 08:00→18:00 and 08:00→14:00 next day
  });
  it('counts verbal instructions not confirmed in writing', () => {
    expect(oct('verbalOpen').value).toBe(1);
    expect(oct('verbalOpen').rag).toBe('AMBER');
  });
  it('variation recovery = approved ÷ claimed (decided YTD)', () => {
    expect(oct('variationRecovery').value).toBeCloseTo(80 / 150, 12);
  });
  it('production vs plan and re-blast rate', () => {
    expect(oct('drillPlan').value).toBe(0.9);
    expect(oct('blastPlan').value).toBe(0.8);
    expect(oct('reblastRate').value).toBe(1 / 8);
    expect(oct('reblastRate').rag).toBe('RED');
  });
  it('bulk explosives vs design uses kg products only, judged on a band', () => {
    expect(oct('explosivesVar').value).toBeCloseTo(0.04, 12);
    expect(oct('explosivesVar').rag).toBe('AMBER');
    expect(rag(-0.06, ds.targets.explosivesVar)).toBe('RED'); // under-charging is off target too
  });
  it('TRIFR / LTIFR per million hours, year to date', () => {
    expect(oct('trifr').value).toBe(4); // (1 MTI + 1 LTI) × 1e6 ÷ 500 000 h
    expect(oct('ltifr').value).toBe(2);
    expect(oct('trifr').rag).toBe('AMBER');
    expect(t.rows.trifr[8]!.value).toBe(4); // September: 1 MTI ÷ 250 000 h
  });
  it('blast vibration compliance and handover compliance', () => {
    expect(oct('blastCompliance').value).toBe(7 / 8);
    expect(oct('handoverCompliance').value).toBe(0.5);
  });
});

describe('contractor alerts', () => {
  const ds = dataset();
  const p = periodFor(ds, '2026-10-01', TODAY);
  const al = alerts(ds, computeTracking(ds, '2026-10-01', null, TODAY), p, null);
  const codes = al.map((a) => `${a.code}:${a.severity}`);

  it('escalates gates waiting more than 48 h (critical beyond 96 h)', () => {
    const now = '2026-10-29T12:00';
    expect(gateWaitHours(ds.logs.gates[2], now)).toBe(50);
    expect(gateWaitHours(ds.logs.gates[3], now)).toBe(122);
    const ctxNow = makeCtx(ds, TODAY).now;
    const g3 = gateWaitHours(ds.logs.gates[2], ctxNow)!, g4 = gateWaitHours(ds.logs.gates[3], ctxNow)!;
    const expected = [g3, g4].filter((h) => h > 48).map((h) => `gatePending:${h > 96 ? 'critical' : 'serious'}`);
    for (const e of expected) expect(codes).toContain(e);
  });
  it('flags verbal instructions older than 2 days without written confirmation', () => {
    expect(codes).toContain('verbalUnconfirmed:serious');
  });
  it('treats missing detonators as critical, a lost-time injury as critical', () => {
    expect(al.find((a) => a.code === 'stockDiscrepancy')).toMatchObject({ severity: 'critical', params: { qty: -2, product: 'Electronic detonators' } });
    expect(codes).toContain('lti:critical');
    expect(codes).toContain('exceedance:serious');
    expect(codes).toContain('misfire:serious');
  });
  it('validates contractor records', () => {
    const f = validateAll(ds, TODAY).map((x) => x.code);
    expect(f).toContain('stockMismatch'); // detonators: counted 58, book 60
    const bad = dataset();
    bad.logs.gates[0].approvedAt = '2026-10-04T08:00';
    bad.logs.production[0].reblasts = 9;
    const g = validateAll(bad, TODAY).map((x) => x.code);
    expect(g).toContain('dateOrder');
    expect(g).toContain('reblastsOverBlasts');
  });
});

describe('Excel round-trip with contractor logs (incl. date-times)', () => {
  it('re-imports the full sample without loss', async () => {
    const ds = JSON.parse(readFileSync('src/data/sample.json', 'utf8')) as Dataset;
    const wb = buildWorkbook(ExcelJS, { ds, tracking: computeTracking(ds, '2026-10-01', null, TODAY), i18n: makeI18n('en'), scopeLabel: 'x', asOf: TODAY });
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const rep = importWorkbook(wb2, TODAY);
    expect(rep.unknownColumns).toEqual([]);
    const strip = (d: Dataset) => Object.fromEntries(Object.entries(d.logs).map(([k, rows]) => [k, rows.map(({ id: _i, ...r }) => r)]));
    expect(strip(rep.dataset)).toEqual(strip(ds));
    expect(rep.dataset.logs.gates[0].submittedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
  });
});

describe('Power BI export', () => {
  it('writes tidy tables whose KPI values equal the app’s', async () => {
    const { buildPowerBiWorkbook } = await import('../src/io/powerbi.ts');
    const ds = JSON.parse(readFileSync('src/data/sample.json', 'utf8')) as Dataset;
    const wb = buildPowerBiWorkbook(ExcelJS, ds, '2026-10-01', TODAY);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const names = wb2.worksheets.map((w) => w.name);
    expect(names).toEqual(expect.arrayContaining(['Dim_Projects', 'Dim_KPI', 'Fact_KPI_Monthly', 'Log_gates', 'Log_safety']));
    const fact = wb2.getWorksheet('Fact_KPI_Monthly')!;
    const header = (fact.getRow(1).values as string[]).slice(1);
    expect(header).toEqual(['ScopeType', 'Scope', 'Site', 'Month', 'KPI', 'Value', 'SampleSize', 'Status']);
    // portfolio TRIFR for October equals the engine's
    const t = computeTracking(ds, '2026-10-01', null, TODAY);
    let found = false;
    fact.eachRow((r, i) => {
      if (i === 1) return;
      const v = r.values as unknown[];
      if (v[1] === 'Portfolio' && v[5] === 'trifr' && (v[4] as Date).toISOString().startsWith('2026-10')) {
        expect(v[6]).toBeCloseTo(t.rows.trifr[9]!.value!, 9);
        found = true;
      }
    });
    expect(found).toBe(true);
    expect(wb2.getWorksheet('Log_gates')!.rowCount).toBe(ds.logs.gates.length + 1);
  });
});
