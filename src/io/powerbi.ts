// "Export for Power BI": a workbook of proper Excel tables in long (tidy) format, so a
// Power BI report can be built once and refreshed from a new export every month.
//   Dim_Projects, Dim_KPI, Fact_KPI_Monthly (portfolio / site / project × KPI × month), one table per log.
import type ExcelJS from 'exceljs';
import { makeCtx } from '../engine/analysis.ts';
import { computeTracking, KPIS_ORDERED, type Dataset } from '../engine/kpis.ts';
import { LOGS, type ComputedType, type FieldType } from '../engine/schema.ts';
import { en } from '../i18n/en.ts';

const tableName = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');

function cell(v: unknown, t: FieldType | ComputedType | 'text'): ExcelJS.CellValue {
  if (v === null || v === undefined || v === '') return null;
  if ((t === 'date' || t === 'month' || t === 'datetime') && typeof v === 'string') {
    const [y, m, d] = v.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, Number(v.slice(11, 13) || 0), Number(v.slice(14, 16) || 0)));
  }
  return v as ExcelJS.CellValue;
}

function addTable(wb: ExcelJS.Workbook, name: string, columns: string[], rows: ExcelJS.CellValue[][]) {
  const ws = wb.addWorksheet(name);
  ws.addTable({
    name: tableName(name),
    ref: 'A1',
    headerRow: true,
    style: { theme: 'TableStyleLight9', showRowStripes: true },
    columns: columns.map((c) => ({ name: c, filterButton: true })),
    // an Excel table needs at least one data row
    rows: rows.length ? rows : [columns.map(() => null)],
  });
  columns.forEach((_, i) => (ws.getColumn(i + 1).width = 16));
}

export function buildPowerBiWorkbook(ExcelJSmod: typeof ExcelJS, ds: Dataset, reportMonth: string, today: string): ExcelJS.Workbook {
  const wb = new ExcelJSmod.Workbook();
  wb.creator = 'BenchMark';
  const siteOf = new Map(ds.logs.projects.map((p) => [String(p.code), p.site ? String(p.site) : null]));

  addTable(wb, 'Dim_Projects', ['Project', 'Name', 'Site', 'PM', 'Sponsor', 'Status', 'Start', 'BaselineFinish', 'ForecastFinish', 'BAC', 'EAC'],
    ds.logs.projects.map((p) => [p.code, p.name, p.site, p.pm, p.sponsor, p.status, cell(p.start, 'date'), cell(p.baselineFinish, 'date'), cell(p.actualFinish, 'date'), p.bac, p.eac] as ExcelJS.CellValue[]));

  addTable(wb, 'Dim_KPI', ['KPI', 'Number', 'Group', 'Name', 'Unit', 'Basis', 'Direction', 'Target', 'Amber', 'GreenFrom', 'GreenTo', 'AmberFrom', 'AmberTo', 'Owner'],
    KPIS_ORDERED.map((k) => {
      const t = ds.targets[k.key];
      return [k.key, k.num, k.group, en.kpi[k.key].name, k.unit, k.basis, t.direction, t.target, t.amber, t.greenLo ?? null, t.greenHi ?? null, t.amberLo ?? null, t.amberHi ?? null, t.owner];
    }));

  // the same KPI engine as the app, for the whole portfolio, every site and every project
  const scopes: { type: string; name: string; set: Set<string> | null }[] = [{ type: 'Portfolio', name: 'Portfolio', set: null }];
  for (const s of ds.settings.lists.sites) scopes.push({ type: 'Site', name: s, set: new Set(ds.logs.projects.filter((p) => p.site === s).map((p) => String(p.code))) });
  for (const p of ds.logs.projects) scopes.push({ type: 'Project', name: String(p.code), set: new Set([String(p.code)]) });
  const fact: ExcelJS.CellValue[][] = [];
  for (const sc of scopes) {
    const t = computeTracking(ds, reportMonth, sc.set, today);
    for (const k of KPIS_ORDERED)
      t.rows[k.key].forEach((c, m) => {
        if (!c) return;
        // site/project rows of portfolio-level KPIs would repeat the portfolio value
        if (!k.projectScoped && sc.type !== 'Portfolio') return;
        fact.push([sc.type, sc.name, sc.type === 'Project' ? siteOf.get(sc.name) ?? null : sc.type === 'Site' ? sc.name : null, cell(t.months[m], 'date'), k.key, c.value, c.n, c.rag]);
      });
  }
  addTable(wb, 'Fact_KPI_Monthly', ['ScopeType', 'Scope', 'Site', 'Month', 'KPI', 'Value', 'SampleSize', 'Status'], fact);

  const ctx = makeCtx(ds, today);
  for (const def of LOGS) {
    const cols = [
      'Id', 'Site',
      ...def.fields.map((f) => f.key),
      ...def.computed.map((c) => c.key),
    ];
    const rows = ds.logs[def.key].map((r) => [
      r.id,
      def.projectField ? siteOf.get(String(r[def.projectField])) ?? (r.site as string) ?? null : def.key === 'projects' ? (r.site as string) ?? null : (r.site as string) ?? null,
      ...def.fields.map((f) => cell(r[f.key], f.type)),
      ...def.computed.map((c) => cell(c.fn(r, ctx), c.type)),
    ] as ExcelJS.CellValue[]);
    // one column name per field key – avoid a clash between the 'site' field and the derived Site column
    const unique = cols.map((c, i) => (c === 'site' && i > 1 ? 'SiteField' : c));
    addTable(wb, 'Log_' + def.key, unique, rows);
  }
  return wb;
}
