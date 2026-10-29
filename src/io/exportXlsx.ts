// Writes a workbook in the same layout the importer reads (title rows 1-2, headers row 4,
// data from row 5), so an exported file can be re-imported without loss. Calculated
// columns are prefixed with '= ' and ignored on import.
import type ExcelJS from 'exceljs';
import { KPIS, KPIS_ORDERED, rag, type Dataset, type Tracking } from '../engine/kpis.ts';
import { LOGS, type ComputedType, type FieldType } from '../engine/schema.ts';
import { makeCtx } from '../engine/analysis.ts';
import { en } from '../i18n/en.ts';
import type { I18n } from '../i18n/index.ts';
import { SHEET_OF } from './importXlsx.ts';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
const RAG_FILL: Record<string, string> = { GREEN: 'FFC6EFCE', AMBER: 'FFFFEB9C', RED: 'FFFFC7CE' };

function numFmt(t: FieldType | ComputedType): string | undefined {
  if (t === 'date' || t === 'month') return 'dd-mmm-yyyy';
  if (t === 'datetime') return 'dd-mmm-yyyy hh:mm';
  if (t === 'money') return '#,##0';
  if (t === 'percent') return '0.0%';
  if (t === 'ratio') return '0.00';
  return undefined;
}

function toCell(v: unknown, t: FieldType | ComputedType): ExcelJS.CellValue {
  if (v === null || v === undefined || v === '') return null;
  if ((t === 'date' || t === 'month' || t === 'datetime') && typeof v === 'string') {
    const [y, m, d] = v.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, Number(v.slice(11, 13) || 0), Number(v.slice(14, 16) || 0)));
  }
  return v as ExcelJS.CellValue;
}

function header(ws: ExcelJS.Worksheet, title: string, note: string, heads: string[]) {
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = note;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF555555' } };
  const r = ws.getRow(4);
  heads.forEach((h, i) => {
    const c = r.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = HEADER_FILL;
    c.alignment = { wrapText: true, vertical: 'middle' };
  });
  r.height = 32;
  ws.views = [{ state: 'frozen', ySplit: 4 }];
}

export interface ExportOptions {
  ds: Dataset;
  tracking: Tracking;
  i18n: I18n;
  scopeLabel: string;
  asOf: string;
}

export function buildWorkbook(ExcelJSmod: typeof ExcelJS, o: ExportOptions): ExcelJS.Workbook {
  const { ds, tracking, i18n } = o;
  const wb = new ExcelJSmod.Workbook();
  wb.creator = 'BenchMark';
  wb.created = new Date();

  // ---- KPI tracking (presentation, in the user's language) ----
  const kt = wb.addWorksheet('KPI_Tracking');
  const months = tracking.months.map((m) => i18n.monthLabel(m));
  header(kt, `${i18n.d.tracking.title} – ${ds.settings.orgName}`, `${o.scopeLabel} · ${i18n.t(i18n.d.dashboard.asOf, { d: i18n.date(o.asOf) })}`,
    ['#', 'KPI', i18n.d.targets.rule, ...months]);
  KPIS_ORDERED.forEach((k, i) => {
    const row = kt.getRow(5 + i);
    row.getCell(1).value = k.num;
    row.getCell(2).value = i18n.d.kpi[k.key].name;
    row.getCell(3).value = i18n.d.direction[ds.targets[k.key].direction];
    tracking.rows[k.key].forEach((cell, m) => {
      const c = row.getCell(4 + m);
      if (!cell || cell.value === null) return;
      c.value = cell.value;
      c.numFmt = k.unit === 'pct' ? '0.0%' : k.unit === 'count' ? '0' : '0.00';
      const r = rag(cell.value, ds.targets[k.key]);
      if (r) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RAG_FILL[r] } };
      c.note = `${i18n.d.rag[r ?? 'GREEN']} · n = ${cell.n}`;
    });
  });
  kt.getColumn(2).width = 38;
  kt.getColumn(3).width = 18;
  for (let c = 4; c < 16; c++) kt.getColumn(c).width = 10;

  // ---- KPI targets (importable layout: name col 2, direction 6, target 7, amber 8, owner 12, band 14-17) ----
  const tg = wb.addWorksheet('KPI_Targets');
  header(tg, 'KPI Targets & Definitions', 'Direction: Higher / Lower / Band. Band KPIs use columns N–Q.',
    ['#', 'KPI', 'What it measures', 'Calculation', 'Unit', 'Direction', 'Target (Green)', 'Amber limit', 'Basis', 'Data source', 'Project filter', 'Owner', 'Notes', 'Green from', 'Green to', 'Amber from', 'Amber to']);
  KPIS.forEach((k, i) => {
    const t = ds.targets[k.key];
    const row = tg.getRow(5 + i);
    const vals: ExcelJS.CellValue[] = [
      k.num, en.kpi[k.key].name, en.kpi[k.key].what, en.kpi[k.key].calc, k.unit, t.direction, t.target, t.amber, k.basis,
      k.sources.map((s) => SHEET_OF[s]).join(' + '), k.projectScoped ? 'Yes' : 'No', t.owner, en.kpi[k.key].notes,
      t.greenLo ?? null, t.greenHi ?? null, t.amberLo ?? null, t.amberHi ?? null,
    ];
    vals.forEach((v, j) => (row.getCell(j + 1).value = v));
  });
  tg.getColumn(2).width = 36;

  // ---- logs (importable) ----
  const ctx = makeCtx(ds, o.asOf);
  for (const def of LOGS) {
    const ws = wb.addWorksheet(SHEET_OF[def.key]);
    const heads = [...def.fields.map((f) => en.fields[f.key as keyof typeof en.fields] ?? f.key), ...def.computed.map((c) => '= ' + (en.fields[c.key as keyof typeof en.fields] ?? c.key))];
    header(ws, en.logs[def.key].title, en.logs[def.key].desc, heads);
    ds.logs[def.key].forEach((r, i) => {
      const row = ws.getRow(5 + i);
      def.fields.forEach((f, j) => {
        const c = row.getCell(j + 1);
        c.value = toCell(r[f.key], f.type);
        const fmt = numFmt(f.type);
        if (fmt) c.numFmt = fmt;
      });
      def.computed.forEach((cd, j) => {
        const c = row.getCell(def.fields.length + j + 1);
        c.value = toCell(cd.fn(r, ctx), cd.type);
        c.font = { color: { argb: 'FF555555' } };
        const fmt = numFmt(cd.type);
        if (fmt) c.numFmt = fmt;
      });
    });
    heads.forEach((_, j) => (ws.getColumn(j + 1).width = 16));
  }

  // ---- settings (importable layout) ----
  const st = wb.addWorksheet('Settings');
  st.getCell('A1').value = 'Settings & Lists';
  const s = ds.settings;
  const pairs: [string, ExcelJS.CellValue][] = [
    ['Organisation / portfolio name', s.orgName],
    ['Reporting year start (1st of month)', toCell(s.yearStart, 'date')],
    ['Current reporting month (1st of month)', toCell(s.reportingMonth, 'date')],
    ["Budget tolerance for 'within budget'", s.budgetTolerance],
    ['Prepared by', s.preparedBy],
  ];
  pairs.forEach(([k, v], i) => {
    st.getCell(4 + i, 1).value = k;
    st.getCell(4 + i, 2).value = v;
  });
  const listHeads: [string, keyof typeof s.lists][] = [
    ['Project Status', 'projectStatus'], ['Priority', 'priority'], ['Change Type', 'changeType'], ['CR Decision', 'crDecision'],
    ['Risk Status', 'riskStatus'], ['Risk Category', 'riskCategory'], ['Issue Status', 'issueStatus'], ['Milestone Status', 'milestoneStatus'],
    ['Action Status', 'actionStatus'], ['CI Status', 'ciStatus'], ['Owners', 'owners'], ['Sites', 'sites'],
    ['Stakeholder Groups', 'stakeholderGroups'], ['Disciplines', 'disciplines'],
  ];
  listHeads.forEach(([h, k], j) => {
    st.getCell(3, 4 + j).value = h;
    st.getCell(3, 4 + j).font = { bold: true };
    s.lists[k].forEach((item, i) => (st.getCell(4 + i, 4 + j).value = item));
  });
  st.getColumn(1).width = 38;
  st.getColumn(2).width = 34;
  return wb;
}
