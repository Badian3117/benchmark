// Notification core – no UI, no storage, no network: shared by the desktop app (desktop
// notifications) and the server function (emails).
import { alerts as buildAlerts, periodFor, type Alert, type Severity } from '../engine/analysis.ts';
import { computeTracking, effectiveReportingMonth, KPI_BY_KEY, type Dataset, type KpiKey } from '../engine/kpis.ts';
import { en } from '../i18n/en.ts';
import { fr } from '../i18n/fr.ts';

export type Lang = 'en' | 'fr';
const DICTS = { en, fr };
const MONTHLY = new Set(['misfire', 'redNoAction', 'smallSample', 'cpiEscalate', 'cpiReview', 'spiTwice', 'forecastLate']);

/**
 * Stable identity of an alert. The same situation never notifies twice; an escalation
 * (serious → critical) does. Alerts not tied to a record are scoped to their month.
 */
export function alertKey(a: Alert, month: string): string {
  const anchor = a.rowId ?? `${a.project ?? ''}|${a.params.kpi ?? ''}`;
  return [a.code, a.severity, anchor, !a.rowId || MONTHLY.has(a.code) ? month.slice(0, 7) : ''].join('|');
}

export function alertText(a: Alert, lang: Lang): string {
  const d = DICTS[lang];
  const p: Record<string, string | number> = { ...a.params };
  if (typeof p.kpi === 'string' && p.kpi in KPI_BY_KEY) p.kpi = d.kpi[p.kpi as KpiKey].name;
  if (typeof p.gate === 'string') p.gate = d.values[p.gate] ?? p.gate;
  if (typeof p.product === 'string') p.product = d.values[p.product] ?? p.product;
  const tpl = (d.alerts as Record<string, string>)[a.code] ?? a.code;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in p ? String(p[k]) : `{${k}}`));
}

/** The portfolio's alerts for the current reporting month, as an unfiltered user sees them. */
export function currentAlerts(ds: Dataset, today: string, scope: Set<string> | null = null) {
  const month = effectiveReportingMonth(ds.settings, today);
  const period = periodFor(ds, month, today);
  const tracking = computeTracking(ds, month, scope, today);
  return { month, alerts: buildAlerts(ds, tracking, period, scope) };
}

export type DesktopLevel = 'off' | 'critical' | 'serious';
export const meetsLevel = (s: Severity, level: DesktopLevel) =>
  level === 'critical' ? s === 'critical' : level === 'serious' ? s === 'critical' || s === 'serious' : false;

/**
 * Which alerts are new since the last check. First call (seen === null) only records a
 * baseline, so installing the app does not fire a notification for every existing alert.
 */
export function newAlerts(alerts: Alert[], month: string, seen: string[] | null, level: DesktopLevel) {
  const keys = alerts.map((a) => alertKey(a, month));
  if (seen === null) return { fresh: [] as Alert[], seen: keys };
  const old = new Set(seen);
  const fresh = alerts.filter((a, i) => meetsLevel(a.severity, level) && !old.has(keys[i]));
  // remember current alerts (+ the most recent history) so a resolved alert that comes back notifies again
  return { fresh, seen: [...new Set([...keys, ...seen])].slice(0, 2000) };
}

// ---------------------------------------------------------------------------------
// e-mail

export interface Recipient {
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'executive' | 'pm';
  sites: string[];
  lang: Lang;
  digest: boolean;
  critical: boolean;
}

export interface Email {
  userId: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** alert keys this e-mail reports (recorded so they are not sent again) */
  keys: string[];
}

const SEV_COLOR: Record<Severity, string> = { critical: '#d03b3b', serious: '#ec835a', warning: '#fab219' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const T = {
  en: {
    criticalSubject: (n: number) => `BenchMark – ${n} new critical alert${n > 1 ? 's' : ''}`,
    digestSubject: (date: string, c: number, s: number) => `BenchMark daily digest ${date} – ${c} critical, ${s} serious`,
    intro: (name: string) => `Hello ${name},`,
    criticalIntro: 'The following critical situation(s) appeared since the last check:',
    digestIntro: 'Situations that need attention today:',
    portfolio: 'Portfolio',
    footer: 'BenchMark · You receive this because of your notification settings (Sync › Account in the app).',
  },
  fr: {
    criticalSubject: (n: number) => `BenchMark – ${n} nouvelle${n > 1 ? 's' : ''} alerte${n > 1 ? 's' : ''} critique${n > 1 ? 's' : ''}`,
    digestSubject: (date: string, c: number, s: number) => `BenchMark – synthèse du ${date} : ${c} critique(s), ${s} sérieuse(s)`,
    intro: (name: string) => `Bonjour ${name},`,
    criticalIntro: 'Situation(s) critique(s) apparue(s) depuis la dernière vérification :',
    digestIntro: 'Situations à traiter aujourd’hui :',
    portfolio: 'Portefeuille',
    footer: 'BenchMark · Vous recevez ce message selon vos préférences de notification (Synchronisation › Compte dans l’application).',
  },
};

function render(r: Recipient, alerts: Alert[], ds: Dataset, intro: string) {
  const t = T[r.lang];
  const d = DICTS[r.lang];
  const siteOf = new Map(ds.logs.projects.map((p) => [String(p.code), p.site ? String(p.site) : '']));
  const groups = new Map<string, Alert[]>();
  for (const a of alerts) {
    const site = (a.project && siteOf.get(a.project)) || t.portfolio;
    groups.set(site, [...(groups.get(site) ?? []), a]);
  }
  const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const text = [t.intro(r.name), '', intro, '']
    .concat(...sorted.map(([site, xs]) => [`${site}`, ...xs.map((a) => `  [${d.severity[a.severity]}] ${alertText(a, r.lang)}`), '']))
    .concat([t.footer])
    .join('\n');
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0b0b0b">
<p>${esc(t.intro(r.name))}</p><p>${esc(intro)}</p>
${sorted.map(([site, xs]) => `<h3 style="margin:16px 0 6px;font-size:15px">${esc(site)}</h3>
<table style="border-collapse:collapse;width:100%">${xs.map((a) => `<tr><td style="padding:4px 8px;white-space:nowrap;vertical-align:top"><span style="background:${SEV_COLOR[a.severity]};color:#fff;border-radius:10px;padding:1px 8px;font-size:12px">${esc(d.severity[a.severity])}</span></td><td style="padding:4px 8px">${esc(alertText(a, r.lang))}</td></tr>`).join('')}</table>`).join('\n')}
<p style="color:#7a7974;font-size:12px;margin-top:20px">${esc(t.footer)}</p></div>`;
  return { text, html };
}

/** project codes a recipient may see (PMs: their sites; others: everything) */
function scopeFor(ds: Dataset, r: Recipient): Set<string> | null {
  if (r.role !== 'pm') return null;
  return new Set(ds.logs.projects.filter((p) => r.sites.includes(String(p.site))).map((p) => String(p.code)));
}

/**
 * mode 'critical' – hourly: only critical alerts not yet sent to this person.
 * mode 'digest'   – daily: every critical and serious alert in the person's scope.
 */
export function buildEmails(ds: Dataset, recipients: Recipient[], mode: 'critical' | 'digest', today: string, sent: Map<string, Set<string>>): Email[] {
  const out: Email[] = [];
  const cache = new Map<string, ReturnType<typeof currentAlerts>>();
  for (const r of recipients) {
    if (!r.email || (mode === 'critical' ? !r.critical : !r.digest)) continue;
    const scope = scopeFor(ds, r);
    const ck = scope ? [...scope].sort().join(',') : '*';
    if (!cache.has(ck)) cache.set(ck, currentAlerts(ds, today, scope));
    const { month, alerts } = cache.get(ck)!;
    const t = T[r.lang];
    if (mode === 'critical') {
      const already = sent.get(r.userId) ?? new Set();
      const fresh = alerts.filter((a) => a.severity === 'critical' && !already.has(alertKey(a, month)));
      if (!fresh.length) continue;
      const body = render(r, fresh, ds, t.criticalIntro);
      out.push({ userId: r.userId, to: r.email, subject: t.criticalSubject(fresh.length), ...body, keys: fresh.map((a) => alertKey(a, month)) });
    } else {
      const xs = alerts.filter((a) => a.severity !== 'warning');
      if (!xs.length) continue;
      const c = xs.filter((a) => a.severity === 'critical').length;
      const body = render(r, xs, ds, t.digestIntro);
      out.push({ userId: r.userId, to: r.email, subject: t.digestSubject(today, c, xs.length - c), ...body, keys: [] });
    }
  }
  return out;
}
