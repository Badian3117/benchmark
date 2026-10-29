// Builds src/data/sample.json from the original workbook so the app ships with demo data.
import { readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { importWorkbook } from '../src/io/importXlsx.ts';

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(readFileSync(process.argv[2] ?? 'tests/fixtures/PM_KPI_Tracker.xlsx') as unknown as ArrayBuffer);
const rep = importWorkbook(wb, '2026-10-29');
const ds = rep.dataset;
// demo: two sites so the multi-site filter has something to show
const kgm = new Set(['P01', 'P04', 'P07']);
for (const p of ds.logs.projects) p.site = kgm.has(String(p.code)) ? 'KGM – Kouroussa' : 'Siguiri Services';
ds.settings.lists.sites = ['KGM – Kouroussa', 'Siguiri Services'];
// site-level records (no project) belong to a site
for (const r of ds.logs.resources) r.site = String(r.team).startsWith('Drill') ? 'KGM – Kouroussa' : 'Siguiri Services';
for (const r of ds.logs.ci) r.site = 'KGM – Kouroussa';
const siteOf = new Map(ds.logs.projects.map((p) => [p.code, p.site]));
for (const a of ds.logs.actions) a.site = a.project ? siteOf.get(a.project) ?? null : 'KGM – Kouroussa';
ds.settings.orgName = 'CORICA Mining Services – Project Portfolio';
writeFileSync('src/data/sample.json', JSON.stringify(ds));
console.log(rep.counts, 'unknown columns:', rep.unknownColumns, 'missing:', rep.missingSheets);
