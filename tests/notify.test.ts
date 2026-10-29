import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Alert } from '../src/engine/analysis.ts';
import type { Dataset } from '../src/engine/kpis.ts';
import { alertKey, alertText, buildEmails, currentAlerts, newAlerts } from '../src/notify/core.ts';

const A = (p: Partial<Alert>): Alert => ({ severity: 'critical', code: 'lti', params: { project: 'P09', n: 1 }, rowId: 'r1', project: 'P09', ...p });

describe('notification core', () => {
  it('first check only records a baseline – no flood on install', () => {
    const r = newAlerts([A({})], '2026-10-01', null, 'critical');
    expect(r.fresh).toEqual([]);
    expect(r.seen).toHaveLength(1);
  });
  it('notifies a new alert once', () => {
    const first = newAlerts([], '2026-10-01', [], 'critical');
    const r1 = newAlerts([A({})], '2026-10-01', first.seen, 'critical');
    expect(r1.fresh).toHaveLength(1);
    const r2 = newAlerts([A({})], '2026-10-01', r1.seen, 'critical');
    expect(r2.fresh).toHaveLength(0);
  });
  it('an escalation notifies again; the level filter applies', () => {
    const serious = A({ code: 'gatePending', severity: 'serious', rowId: 'g1', params: { id: 'G-1', hours: 50 } });
    const critical = A({ code: 'gatePending', severity: 'critical', rowId: 'g1', params: { id: 'G-1', hours: 100 } });
    expect(alertKey(serious, '2026-10-01')).not.toBe(alertKey(critical, '2026-10-01'));
    expect(alertKey(critical, '2026-10-01')).toBe(alertKey({ ...critical, params: { id: 'G-1', hours: 120 } }, '2026-10-01'));
    const r = newAlerts([serious], '2026-10-01', [], 'critical');
    expect(r.fresh).toEqual([]);
    expect(newAlerts([serious], '2026-10-01', [], 'serious').fresh).toHaveLength(1);
    expect(newAlerts([critical], '2026-10-01', r.seen, 'critical').fresh).toHaveLength(1);
  });
  it('alerts without a record are scoped to their month', () => {
    const m = A({ code: 'misfire', rowId: undefined, severity: 'serious' });
    expect(alertKey(m, '2026-10-01')).not.toBe(alertKey(m, '2026-11-01'));
  });
  it('renders alert text in English and French', () => {
    expect(alertText(A({}), 'en')).toBe('P09: 1 lost-time injury(ies) this month');
    expect(alertText(A({}), 'fr')).toBe('P09 : 1 accident(s) avec arrêt ce mois');
    expect(alertText(A({ code: 'redNoAction', params: { kpi: 'trifr' } }), 'fr')).toContain('TRIFR');
  });
  it('builds e-mails from the sample: PMs see only their sites', () => {
    const ds = JSON.parse(readFileSync('src/data/sample.json', 'utf8')) as Dataset;
    const { alerts } = currentAlerts(ds, '2026-10-29');
    expect(alerts.some((a) => a.severity === 'critical')).toBe(true);
    const mails = buildEmails(ds, [
      { userId: 'a', email: 'kgm@x', name: 'KGM PM', role: 'pm', sites: ['KGM – Kouroussa'], lang: 'en', digest: true, critical: true },
      { userId: 'b', email: 'sig@x', name: 'SIG PM', role: 'pm', sites: ['Siguiri Services'], lang: 'fr', digest: true, critical: true },
    ], 'digest', '2026-10-29', new Map());
    const kgm = mails.find((m) => m.to === 'kgm@x')!, sig = mails.find((m) => m.to === 'sig@x')!;
    expect(kgm.text).toContain('P09');
    expect(sig.text).not.toContain('P09');
    expect(sig.subject).toMatch(/synthèse/);
  });
});
