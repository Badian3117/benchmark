// Reads the original "PM_KPI_Tracker.xlsx" layout (title rows 1-3, headers on row 4,
// data from row 5) into a BenchMark dataset. Columns are matched by header text, not
// position, so re-ordered or extra columns do not break the import.
import type ExcelJS from 'exceljs';
import { isISODate, monthStart, toISO } from '../engine/dates.ts';
import { DEFAULT_TARGETS, KPIS, type Dataset, type KpiKey, type KpiTarget } from '../engine/kpis.ts';
import { DEFAULT_LISTS, LOG_BY_KEY, defaultSettings, type ListKey, type LogKey, type Row } from '../engine/schema.ts';
import { en } from '../i18n/en.ts';
import { fr } from '../i18n/fr.ts';
import { newId } from './ids.ts';

type Sheet = { sheet: string; log: LogKey; cols: Record<string, string> };

// header text (lower-cased, trimmed) → field key
const SHEETS: Sheet[] = [
  { sheet: 'Projects', log: 'projects', cols: {
    'project id': 'code', 'project name': 'name', 'area / client': 'area', 'site / contract': 'site', 'project manager': 'pm', sponsor: 'sponsor',
    'start date': 'start', 'baseline finish': 'baselineFinish', 'forecast / actual finish': 'actualFinish', status: 'status',
    'budget at completion (bac)': 'bac', 'forecast / final cost (eac)': 'eac', 'scope fully delivered?': 'scopeDelivered',
    'deliverables accepted?': 'deliverablesAccepted', remarks: 'remarks' } },
  { sheet: 'Cost_Schedule', log: 'costSchedule', cols: {
    month: 'month', 'project id': 'project', 'approved budget (period)': 'budget', 'planned value (pv)': 'pv',
    'earned value (ev)': 'ev', 'actual cost (ac)': 'ac', comment: 'comment' } },
  { sheet: 'Change_Log', log: 'changes', cols: {
    'cr id': 'code', 'project id': 'project', 'date submitted': 'submitted', 'description of change': 'description',
    'change type': 'type', 'requested by': 'requestedBy', 'cost impact': 'costImpact', 'schedule impact (days)': 'scheduleImpact',
    decision: 'decision', 'decision date': 'decisionDate', 'implemented?': 'implemented', 'implementation date': 'implementationDate', remarks: 'remarks' } },
  { sheet: 'Risk_Log', log: 'risks', cols: {
    'risk id': 'code', 'project id': 'project', 'date identified': 'identified', 'risk description': 'description', category: 'category',
    'probability (1-5)': 'probability', 'impact (1-5)': 'impact', 'mitigation action': 'mitigation', owner: 'owner', status: 'status',
    'closure date': 'closureDate', 'materialised?': 'materialised', 'residual p (1-5)': 'residualP', 'residual i (1-5)': 'residualI' } },
  { sheet: 'Issue_Log', log: 'issues', cols: {
    'issue id': 'code', 'project id': 'project', 'date raised': 'raised', 'issue description': 'description', priority: 'priority',
    owner: 'owner', status: 'status', 'date resolved': 'resolved', 'root cause': 'rootCause', remarks: 'remarks' } },
  { sheet: 'Stakeholder_Survey', log: 'surveys', cols: {
    'survey date': 'date', 'project id': 'project', 'stakeholder name': 'stakeholder', 'stakeholder group': 'group',
    communication: 'communication', 'delivery vs plan': 'delivery', 'quality of outputs': 'quality', responsiveness: 'responsiveness', comments: 'comments' } },
  { sheet: 'Resources', log: 'resources', cols: {
    month: 'month', 'team / resource': 'team', discipline: 'discipline', 'available hours': 'available',
    'allocated project hours': 'allocated', 'output unit': 'unit', 'planned output': 'plannedOutput', 'actual output': 'actualOutput', remarks: 'remarks' } },
  { sheet: 'Milestones', log: 'milestones', cols: {
    'milestone id': 'code', 'project id': 'project', milestone: 'milestone', owner: 'owner', 'baseline due date': 'baselineDue',
    'actual / forecast completion': 'actualDate', status: 'status', remarks: 'remarks' } },
  { sheet: 'Quality_Log', log: 'quality', cols: {
    'inspection id': 'code', 'project id': 'project', deliverable: 'deliverable', 'inspection date': 'date', inspector: 'inspector',
    'defects found': 'defects', 'accepted first time?': 'firstTime', 'rework hours': 'reworkHours', 'rework cost': 'reworkCost',
    'defect description / root cause': 'description' } },
  { sheet: 'Benefits_Log', log: 'benefits', cols: {
    'benefit id': 'code', 'project id': 'project', 'benefit description': 'description', 'measure / unit': 'unit',
    'measurement date': 'date', 'planned value (cumulative)': 'planned', 'realised value (cumulative)': 'realised', 'benefit owner': 'owner', remarks: 'remarks' } },
  { sheet: 'CI_Log', log: 'ci', cols: {
    'ci id': 'code', 'date proposed': 'proposed', initiative: 'initiative', 'kpi targeted': 'kpi', owner: 'owner', status: 'status',
    'implementation date': 'implDate', 'expected benefit': 'expected', 'benefit verified?': 'verified', 'verified result': 'verifiedResult', remarks: 'remarks' } },
  { sheet: 'Action_Log', log: 'actions', cols: {
    'action id': 'code', 'date raised': 'raised', 'kpi concerned': 'kpi', 'project id (optional)': 'project', 'kpi value before': 'before',
    'problem / root cause': 'rootCause', 'corrective action / change': 'action', owner: 'owner', 'due date': 'due', status: 'status',
    'date implemented': 'implemented', 'kpi value after': 'after', remarks: 'remarks' } },
  { sheet: 'Target_Revisions', log: 'targetRevisions', cols: {
    date: 'date', kpi: 'kpi', 'old target': 'oldTarget', 'new target': 'newTarget', 'old amber': 'oldAmber', 'new amber': 'newAmber',
    'reason for change': 'reason', 'proposed by': 'proposedBy', 'approved by': 'approvedBy' } },
];

export const SHEET_OF = Object.fromEntries(SHEETS.map((s) => [s.log, s.sheet])) as Record<LogKey, string>;

/** BenchMark's own field labels (EN + FR) are accepted as headers too, so exported files re-import. */
function labelAliases(log: LogKey): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of LOG_BY_KEY[log].fields)
    for (const d of [en, fr]) {
      const label = (d.fields as Record<string, string>)[f.key];
      if (label) out[label.toLowerCase().replace(/\s+/g, ' ').trim()] = f.key;
    }
  return out;
}

// KPI names used in the workbook → KPI keys
const KPI_NAMES: Record<string, KpiKey> = {
  'project schedule variance (sv%)': 'sv', 'project cost variance (cv%)': 'cv', 'budget utilization': 'budgetUtil',
  'on-time project delivery': 'onTime', 'scope change frequency': 'scopeFreq', 'risk mitigation effectiveness': 'riskEff',
  'issue resolution time': 'issueTime', 'stakeholder satisfaction': 'satisfaction', 'resource utilization rate': 'resourceUtil',
  'project success rate': 'successRate', 'milestone completion rate': 'milestoneRate', 'project quality index': 'quality',
  'change request approval time': 'crTime', 'team productivity index': 'productivity', 'benefits realization': 'benefits',
  'continuous improvement initiatives': 'ci', 'cumulative spi (ytd)': 'cumSpi', 'cumulative cpi (ytd)': 'cumCpi',
};
export function kpiKeyFromName(name: unknown): KpiKey | null {
  if (typeof name !== 'string') return null;
  const s = name.trim();
  if (KPIS.some((k) => k.key === s)) return s as KpiKey;
  const lc = s.toLowerCase();
  if (KPI_NAMES[lc]) return KPI_NAMES[lc];
  for (const k of KPIS) if (en.kpi[k.key].name.toLowerCase() === lc || fr.kpi[k.key].name.toLowerCase() === lc) return k.key;
  return null;
}

/** Plain value of a cell: formula results, rich text and hyperlinks unwrapped; dates → ISO. */
export function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return toISO(v);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('formula' in v || 'sharedFormula' in v) return null; // formula without cached result
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
    return null;
  }
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  return v;
}

function coerce(log: LogKey, key: string, v: unknown): unknown {
  if (v === null) return null;
  const fd = LOG_BY_KEY[log].fields.find((f) => f.key === key);
  if (!fd) return v;
  switch (fd.type) {
    case 'date': return isISODate(v) ? v : null;
    case 'month': return isISODate(v) ? monthStart(v) : null;
    case 'number': case 'money': case 'percent': case 'score': {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s,]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'yesno': {
      const s = String(v).toLowerCase();
      return s === 'yes' || s === 'oui' ? 'Yes' : s === 'no' || s === 'non' ? 'No' : null;
    }
    case 'kpi': return kpiKeyFromName(v) ?? String(v);
    default: return String(v);
  }
}

export interface ImportReport {
  dataset: Dataset;
  counts: Partial<Record<LogKey, number>>;
  missingSheets: string[];
  unknownColumns: string[];
}

function headerRow(ws: ExcelJS.Worksheet): number {
  for (let r = 1; r <= 8; r++) {
    const first = cellValue(ws.getRow(r).getCell(1).value);
    const second = cellValue(ws.getRow(r).getCell(2).value);
    if (typeof first === 'string' && typeof second === 'string' && ws.getRow(r + 1).cellCount > 0 && r > 1) return r;
  }
  return 4;
}

const fmt = (x: unknown) => (typeof x === 'number' ? String(+x.toFixed(4)) : x === null || x === undefined ? '' : String(x));

export function importWorkbook(wb: ExcelJS.Workbook, today: string): ImportReport {
  const settings = defaultSettings(today);
  const logs = Object.fromEntries(Object.keys(LOG_BY_KEY).map((k) => [k, [] as Row[]])) as Record<LogKey, Row[]>;
  const targets = structuredClone(DEFAULT_TARGETS);
  const counts: ImportReport['counts'] = {};
  const missingSheets: string[] = [];
  const unknownColumns: string[] = [];

  for (const s of SHEETS) {
    const ws = wb.getWorksheet(s.sheet);
    if (!ws) { missingSheets.push(s.sheet); continue; }
    const hr = headerRow(ws);
    const map = new Map<number, string>();
    const aliases = labelAliases(s.log);
    ws.getRow(hr).eachCell((c, col) => {
      const h = String(cellValue(c.value) ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
      const key = s.cols[h] ?? aliases[h];
      if (key && ![...map.values()].includes(key)) map.set(col, key);
      else if (h && !key && !h.startsWith('= ') && !isComputedHeader(h)) unknownColumns.push(`${s.sheet}: ${h}`);
    });
    const firstKey = [...map.values()][0];
    for (let r = hr + 1; r <= ws.rowCount; r++) {
      const row: Row = { id: newId() };
      for (const f of LOG_BY_KEY[s.log].fields) row[f.key] = null;
      const wsRow = ws.getRow(r);
      for (const [col, key] of map) row[key] = coerce(s.log, key, cellValue(wsRow.getCell(col).value));
      if (row[firstKey] === null || row[firstKey] === undefined) continue;
      if (s.log === 'targetRevisions' && ('oldTarget' in row || 'newTarget' in row)) {
        row.before = `${fmt(row.oldTarget)} / ${fmt(row.oldAmber)}`;
        row.after = `${fmt(row.newTarget)} / ${fmt(row.newAmber)}`;
        for (const k of ['oldTarget', 'newTarget', 'oldAmber', 'newAmber']) delete row[k];
      }
      logs[s.log].push(row);
    }
    counts[s.log] = logs[s.log].length;
  }

  // ---- KPI targets ----
  const kt = wb.getWorksheet('KPI_Targets');
  if (kt) {
    for (let r = 5; r <= Math.min(kt.rowCount, 40); r++) {
      const row = kt.getRow(r);
      const key = kpiKeyFromName(cellValue(row.getCell(2).value));
      if (!key) continue;
      const dir = cellValue(row.getCell(6).value);
      const target = cellValue(row.getCell(7).value);
      const amber = cellValue(row.getCell(8).value);
      const owner = cellValue(row.getCell(12).value);
      const t: KpiTarget = targets[key];
      const band = [14, 15, 16, 17].map((c) => cellValue(row.getCell(c).value));
      if (dir === 'Band' && band.every((x) => typeof x === 'number')) {
        // BenchMark export: explicit band
        t.direction = 'Band';
        [t.greenLo, t.greenHi, t.amberLo, t.amberHi] = band as number[];
        if (typeof target === 'number') t.target = target;
        if (typeof amber === 'number') t.amber = amber;
      } else if (t.direction !== 'Band' && (dir === 'Higher' || dir === 'Lower')) {
        // Original workbook: utilisation-type KPIs stay bands; others keep the workbook's thresholds
        t.direction = dir;
        if (typeof target === 'number') t.target = target;
        if (typeof amber === 'number') t.amber = amber;
      }
      if (typeof owner === 'string') t.owner = owner;
    }
  }

  // ---- settings & lists ----
  const st = wb.getWorksheet('Settings');
  if (st) {
    const v = (r: number) => cellValue(st.getRow(r).getCell(2).value);
    if (typeof v(4) === 'string') settings.orgName = v(4) as string;
    if (isISODate(v(5))) settings.yearStart = monthStart(v(5) as string);
    if (typeof v(7) === 'number') settings.budgetTolerance = v(7) as number;
    if (typeof v(8) === 'string') settings.preparedBy = v(8) as string;
    const listCols: Record<string, ListKey> = {
      'project status': 'projectStatus', priority: 'priority', 'change type': 'changeType', 'cr decision': 'crDecision',
      'risk status': 'riskStatus', 'risk category': 'riskCategory', 'issue status': 'issueStatus',
      'milestone status': 'milestoneStatus', 'action status': 'actionStatus', 'ci status': 'ciStatus', owners: 'owners',
      sites: 'sites', 'stakeholder groups': 'stakeholderGroups', disciplines: 'disciplines',
    };
    st.getRow(3).eachCell((c, col) => {
      const lk = listCols[String(cellValue(c.value) ?? '').toLowerCase()];
      if (!lk) return;
      const items: string[] = [];
      for (let r = 4; r <= Math.min(st.rowCount, 60); r++) {
        const x = cellValue(st.getRow(r).getCell(col).value);
        if (typeof x === 'string' && !x.startsWith('Tip:')) items.push(x);
      }
      if (items.length) settings.lists[lk] = items;
    });
  }
  // make sure every value used in the logs exists in its list
  for (const def of Object.values(LOG_BY_KEY))
    for (const fd of def.fields)
      if (fd.list)
        for (const r of logs[def.key]) {
          const x = r[fd.key];
          if (typeof x === 'string' && x && !settings.lists[fd.list].includes(x)) settings.lists[fd.list].push(x);
        }
  for (const k of Object.keys(DEFAULT_LISTS) as ListKey[]) if (!settings.lists[k]) settings.lists[k] = [...DEFAULT_LISTS[k]];

  return { dataset: { settings, targets, logs }, counts, missingSheets, unknownColumns };
}

// computed columns in the workbook that BenchMark recalculates itself
const COMPUTED = [
  'on time?', 'within budget?', 'successful?', 'days late (+) / early (−)', 'cost variance at completion', 'project name',
  'schedule var. sv = ev−pv', 'cost var. cv = ev−ac', 'spi = ev/pv', 'cpi = ev/ac', 'budget used = ac/budget',
  'approval time (days)', 'inherent score', 'rating', 'residual score', 'reduction %', 'days to resolve',
  'days open (if open)', 'overall score', 'utilisation', 'productivity (actual/plan)', 'realisation %', 'result',
  'due status', 'rev #',
];
function isComputedHeader(h: string) {
  return COMPUTED.includes(h);
}
