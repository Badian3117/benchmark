// Builds src/data/sample.json from the original workbook so the app ships with demo data.
import { readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { importWorkbook } from '../src/io/importXlsx.ts';
import { LOG_BY_KEY } from '../src/engine/schema.ts';

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

// ---------- contractor operations demo: the KGM drill & blast contract ----------
let seed = 20261029;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const between = (a: number, b: number) => a + rnd() * (b - a);
const id = () => crypto.randomUUID();
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addH = (dt: string, h: number) => {
  const d = new Date(Date.UTC(+dt.slice(0, 4), +dt.slice(5, 7) - 1, +dt.slice(8, 10), +dt.slice(11, 13), +dt.slice(14, 16)) + Math.round(h * 60) * 60_000);
  return `${iso(d)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const blank = (log: keyof typeof ds.logs) => Object.fromEntries(LOG_BY_KEY[log].fields.map((f) => [f.key, null]));
const add = (log: keyof typeof ds.logs, r: Record<string, unknown>) => ds.logs[log].push({ ...blank(log), id: id(), ...r });
const months = Array.from({ length: 10 }, (_, i) => `2026-${pad(i + 1)}-01`);

add('projects', { code: 'P09', name: 'KGM Drill & Blast Contract', site: 'KGM – Kouroussa', area: 'Drill & Blast', pm: 'A. Camara', sponsor: 'B. Toure',
  start: '2026-01-01', baselineFinish: '2027-12-31', actualFinish: '2027-12-31', status: 'Active', bac: 18_000_000, eac: 18_350_000 });
for (const m of months) {
  const budget = 750_000, pv = Math.round(between(730_000, 760_000));
  const ev = Math.round(pv * between(0.93, 1.02)), ac = Math.round(ev * between(0.98, 1.06));
  add('costSchedule', { month: m, project: 'P09', budget, pv, ev, ac });
}
// weekly production (Fridays), one gate set per blast block
let gate = 0, week = 0;
for (let d = new Date(Date.UTC(2026, 0, 2)); iso(d) <= '2026-10-23'; d = new Date(d.getTime() + 7 * 86_400_000)) {
  week++;
  const plannedBlasts = 5, actualBlasts = rnd() < 0.15 ? 4 : 5;
  add('production', { date: iso(d), project: 'P09', location: `Pit ${1 + (week % 3)}`, plannedMetres: 4200, actualMetres: Math.round(4200 * between(0.86, 1.04)),
    plannedBlasts, actualBlasts, reblasts: rnd() < 0.12 ? 1 : 0, misfires: week === 20 || week === 37 ? 1 : 0 });
  const block = `B${String(week).padStart(3, '0')}`;
  let t = `${iso(new Date(d.getTime() - 4 * 86_400_000))}T07:30`;
  for (const g of ['Pattern design', 'Loading authorisation', 'All-clear']) {
    gate++;
    const lag = g === 'All-clear' ? between(0.5, 3) : between(4, rnd() < 0.2 ? 70 : 30);
    const pending = iso(d) >= '2026-10-16' && g === 'Loading authorisation';
    add('gates', { code: `G-${String(gate).padStart(4, '0')}`, project: 'P09', block, gate: g, submittedAt: t, status: pending ? 'Pending' : 'Approved',
      approvedAt: pending ? null : addH(t, lag), approver: 'KGM drill & blast superintendent', verbalOnly: !pending && rnd() < 0.05 ? 'Yes' : 'No' });
    t = addH(t, lag + between(6, 20));
  }
}
const vos: [string, string, string, number, string, string | null, string | null, number | null][] = [
  ['2026-01-20', 'Written', 'Additional pre-split line, west wall', 85_000, 'Approved', '2026-02-02', '2026-02-20', 85_000],
  ['2026-02-11', 'Verbal', 'Re-drill of 270 holes – collapsed after rain', 120_000, 'Approved', '2026-02-16', '2026-03-12', 96_000],
  ['2026-03-30', 'Written', 'Change to electronic initiation, ramp holes', 60_000, 'Approved', '2026-04-03', '2026-04-28', 60_000],
  ['2026-05-14', 'Verbal', 'Standby – bench not released (3 shifts)', 45_000, 'Rejected', '2026-05-20', '2026-06-15', 0],
  ['2026-06-22', 'Written', 'Buffer zone redesign near haul road', 70_000, 'Approved', '2026-06-29', '2026-07-21', 58_000],
  ['2026-08-05', 'Verbal', 'Night blasting window extension', 30_000, 'Submitted', '2026-08-12', null, null],
  ['2026-09-18', 'Written', 'Additional toe re-blast, Pit 2', 40_000, 'Submitted', '2026-09-25', null, null],
  ['2026-10-20', 'Verbal', 'Pattern change instructed at the pit face (burden 3.2 m)', 25_000, 'Instructed', null, null, null],
];
vos.forEach(([date, type, desc, claimed, status, submitted, decided, approved], i) => {
  const confirmed = type === 'Written' || status !== 'Instructed';
  add('variations', { code: `VO-${String(i + 1).padStart(3, '0')}`, project: 'P09', instructed: date, instructedBy: 'KGM mine manager', instructionType: type,
    confirmedInWriting: confirmed ? 'Yes' : 'No', confirmationDate: confirmed ? date : null, description: desc, valueClaimed: claimed, status,
    submittedDate: submitted, decisionDate: decided, valueApproved: approved });
});
// explosives: bulk emulsion (kg) and electronic detonators (units)
let bulk = 42_000, dets = 3_500;
for (const m of months) {
  const designed = Math.round(between(165_000, 185_000));
  const issued = Math.round(designed * (m === '2026-10-01' ? 1.041 : between(0.985, 1.025)));
  const received = Math.round(issued + between(-8_000, 8_000));
  add('explosives', { month: m, project: 'P09', product: 'Bulk emulsion', unit: 'kg', opening: bulk, received, issued, designed, closingCounted: bulk + received - issued });
  bulk = bulk + received - issued;
  const dIssued = Math.round(between(1_900, 2_200)), dReceived = 2_000, lost = m === '2026-08-01' ? 2 : 0;
  add('explosives', { month: m, project: 'P09', product: 'Electronic detonators', unit: 'units', opening: dets, received: dReceived, issued: dIssued, closingCounted: dets + dReceived - dIssued - lost });
  dets = dets + dReceived - dIssued - lost;
}
// safety: monthly per active contract
months.forEach((m, i) => {
  const blasts = ds.logs.production.filter((r) => r.project === 'P09' && String(r.date).slice(0, 7) === m.slice(0, 7)).reduce((a, r) => a + (r.actualBlasts as number), 0);
  add('safety', { month: m, project: 'P09', hoursWorked: Math.round(between(50_000, 56_000)), lti: m === '2026-05-01' ? 1 : 0, mti: i === 2 || i === 7 ? 1 : 0,
    rwi: i === 4 ? 1 : 0, fai: Math.round(between(1, 5)), nearMisses: Math.round(between(4, 14)), blastsMonitored: blasts,
    ppvExceedances: m === '2026-09-01' ? 1 : 0, airblastExceedances: 0, envIncidents: 0 });
  if (i < 7) add('safety', { month: m, project: 'P01', hoursWorked: Math.round(between(28_000, 32_000)), lti: 0, mti: i === 3 ? 1 : 0, rwi: 0, fai: Math.round(between(0, 3)), nearMisses: Math.round(between(2, 8)) });
});
// monthly rotation handovers (1 month on / 1 month off)
months.forEach((m, i) => {
  const out = i % 2 ? 'F. Bah' : 'A. Camara', inc = i % 2 ? 'A. Camara' : 'F. Bah';
  add('handovers', { code: `H-${String(i + 1).padStart(3, '0')}`, project: 'P09', date: m.slice(0, 8) + '28', outgoing: out, incoming: inc,
    overlapBriefing: m === '2026-03-01' ? 'No' : 'Yes', signedOff: m === '2026-03-01' ? 'No' : 'Yes',
    openItems: 'See handover pack', keyRisks: 'Wet holes in Pit 2; authorisation delays on loading', pendingAuthorisations: null });
});
for (const k of ['gates', 'variations', 'production', 'explosives', 'safety', 'handovers'] as const)
  for (const r of ds.logs[k]) for (const f of LOG_BY_KEY[k].fields) if (!(f.key in r)) r[f.key] = null;
writeFileSync('src/data/sample.json', JSON.stringify(ds));
console.log(rep.counts, 'unknown columns:', rep.unknownColumns, 'missing:', rep.missingSheets);
