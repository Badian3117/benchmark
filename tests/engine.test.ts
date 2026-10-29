import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { alerts, periodFor, projectHealth, snapshot } from '../src/engine/analysis.ts';
import { computeTracking, KPIS, rag, trend, DEFAULT_TARGETS, type Dataset } from '../src/engine/kpis.ts';
import { validateAll } from '../src/engine/validate.ts';
import { importWorkbook } from '../src/io/importXlsx.ts';

const TODAY = '2026-10-29';
let ds: Dataset;
let excel: (number | null)[][]; // KPI 1..16 × Jan..Oct, as calculated by Excel

beforeAll(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync('tests/fixtures/PM_KPI_Tracker.xlsx') as unknown as ArrayBuffer);
  ds = importWorkbook(wb, TODAY).dataset;
  // Excel's own cached results (extracted with openpyxl – ExcelJS drops cached zeros)
  excel = JSON.parse(readFileSync('tests/fixtures/excel_kpis.json', 'utf8'));
});

describe('import', () => {
  it('reads every log of the sample workbook', () => {
    expect(ds.logs.projects).toHaveLength(8);
    expect(ds.logs.costSchedule).toHaveLength(53);
    expect(ds.logs.changes).toHaveLength(26);
    expect(ds.logs.risks).toHaveLength(28);
    expect(ds.logs.issues).toHaveLength(40);
    expect(ds.logs.milestones).toHaveLength(46);
    expect(ds.logs.actions).toHaveLength(10);
    expect(ds.logs.targetRevisions).toHaveLength(2);
    expect(ds.settings.yearStart).toBe('2026-01-01');
    expect(ds.settings.lists.owners).toContain('A. Camara');
    expect(ds.logs.actions[0].kpi).toBe('sv');
  });
});

describe('KPI engine matches the Excel workbook', () => {
  it('reproduces all 16 original KPIs for Jan–Oct, except the documented Success Rate fix', () => {
    const t = computeTracking(ds, '2026-10-01', null, TODAY);
    const mismatches: string[] = [];
    KPIS.filter((k) => k.num <= 16).forEach((k) => {
      for (let m = 0; m < 10; m++) {
        const mine = t.rows[k.key][m]?.value ?? null;
        const xl = excel[k.num - 1][m];
        const same = mine === null || xl === null ? mine === xl : Math.abs(mine - xl) < 1e-9;
        if (!same) mismatches.push(`${k.key}[${m + 1}] engine=${mine} excel=${xl}`);
      }
    });
    // P08 (completed 30 Sep) had 'Deliverables accepted? = No' but Excel counted it as successful
    expect(mismatches).toEqual(['successRate[9] engine=0.4 excel=0.6', 'successRate[10] engine=0.4 excel=0.6']);
  });

  it('leaves months after the reporting month empty', () => {
    const t = computeTracking(ds, '2026-10-01', null, TODAY);
    expect(t.rows.sv[10]).toBeNull();
    expect(t.rows.sv[9]?.value).toBeCloseTo(-0.067027, 5);
  });

  it('reports the sample size next to small-sample KPIs', () => {
    const t = computeTracking(ds, '2026-10-01', null, TODAY);
    expect(t.rows.onTime[9]?.n).toBe(5);
  });

  it('filters KPIs by project scope', () => {
    const t = computeTracking(ds, '2026-10-01', new Set(['P05']), TODAY);
    const rows = ds.logs.costSchedule.filter((r) => r.project === 'P05' && r.month === '2026-10-01');
    const ev = rows.reduce((a, r) => a + (r.ev as number), 0), pv = rows.reduce((a, r) => a + (r.pv as number), 0);
    expect(t.rows.sv[9]?.value).toBeCloseTo((ev - pv) / pv, 12);
    // resource utilisation has no project dimension – unaffected by the filter
    expect(t.rows.resourceUtil[9]?.value).toBeCloseTo(excel[8][9]!, 12);
  });
});

describe('RAG rules', () => {
  const T = DEFAULT_TARGETS;
  it('higher / lower are inclusive at the thresholds', () => {
    expect(rag(0.9, T.onTime)).toBe('GREEN');
    expect(rag(0.8, T.onTime)).toBe('AMBER');
    expect(rag(0.79, T.onTime)).toBe('RED');
    expect(rag(7, T.issueTime)).toBe('GREEN');
    expect(rag(14, T.issueTime)).toBe('AMBER');
    expect(rag(14.1, T.issueTime)).toBe('RED');
  });
  it('band KPIs penalise both under- and over-shoot', () => {
    expect(rag(0.5, T.budgetUtil)).toBe('RED'); // the workbook showed this GREEN
    expect(rag(0.93, T.budgetUtil)).toBe('AMBER');
    expect(rag(1.0, T.budgetUtil)).toBe('GREEN');
    expect(rag(1.08, T.budgetUtil)).toBe('RED');
    expect(rag(0.97, T.resourceUtil)).toBe('RED'); // the workbook showed this GREEN
    expect(rag(0.86, T.resourceUtil)).toBe('GREEN');
  });
  it('trend is direction-aware, and distance-to-band for band KPIs', () => {
    expect(trend(5, 13, T.issueTime)).toBe('better');
    expect(trend(0.955, 0.944, T.budgetUtil)).toBe('better'); // moving towards the band (Excel said 'Worse')
    expect(trend(0.97, 0.98, T.budgetUtil)).toBe('stable'); // both inside the band
  });
});

describe('analysis', () => {
  it('builds project health, watch list and snapshot', () => {
    const p = periodFor(ds, '2026-10-01', TODAY);
    const t = computeTracking(ds, '2026-10-01', null, TODAY);
    const health = projectHealth(ds, p, null);
    expect(health.map((h) => h.code).sort()).toContain('P05');
    const al = alerts(ds, t, p, null);
    expect(al.some((a) => a.code === 'milestoneOverdue')).toBe(true);
    const snap = snapshot(ds, p, null);
    expect(snap.projects).toBe(8);
    expect(snap.overdueMilestones).toBe(3);
  });

  it('data-quality checks catch the known sample-data problems', () => {
    const f = validateAll(ds, TODAY);
    const codes = new Set(f.map((x) => x.code));
    expect(codes.has('afterClosure')).toBe(true); // P04 milestones / CR after completion
    expect(codes.has('futureActual')).toBe(true); // CR-002 decided 31 Oct (future)
  });
});

describe('Excel export round-trip', () => {
  it('re-imports an exported workbook without loss', async () => {
    const { buildWorkbook } = await import('../src/io/exportXlsx.ts');
    const { makeI18n } = await import('../src/i18n/index.ts');
    const t = computeTracking(ds, '2026-10-01', null, TODAY);
    const wb = buildWorkbook(ExcelJS, { ds, tracking: t, i18n: makeI18n('fr'), scopeLabel: 'Portfolio', asOf: TODAY });
    const buf = await wb.xlsx.writeBuffer();
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(buf as ArrayBuffer);
    const rep = importWorkbook(wb2, TODAY);
    expect(rep.missingSheets).toEqual([]);
    expect(rep.unknownColumns).toEqual([]);
    const strip = (d: Dataset) => Object.fromEntries(Object.entries(d.logs).map(([k, rows]) => [k, rows.map(({ id: _id, ...r }) => r)]));
    expect(strip(rep.dataset)).toEqual(strip(ds));
    expect(rep.dataset.targets).toEqual(ds.targets);
    expect(rep.dataset.settings.lists).toEqual(ds.settings.lists);
    // and the numbers are identical
    const t2 = computeTracking(rep.dataset, '2026-10-01', null, TODAY);
    expect(t2.rows).toEqual(t.rows);
  });
});
