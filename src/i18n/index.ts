import { createContext, useContext } from 'react';
import type { Unit } from '../engine/kpis.ts';
import { en, type Dict } from './en.ts';
import { fr } from './fr.ts';

export type Lang = 'en' | 'fr';
export const DICTS: Record<Lang, Dict> = { en, fr };

export function interpolate(s: string, params?: Record<string, string | number>) {
  return params ? s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`)) : s;
}

export function makeI18n(lang: Lang) {
  const d = DICTS[lang];
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const nf = (digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const f0 = nf(0), f1 = nf(1), f2 = nf(2), f3 = nf(3);
  return {
    lang,
    d,
    locale,
    /** translate a stored list value (English) for display; custom values pass through */
    v: (x: unknown) => (x === null || x === undefined || x === '' ? '' : (d.values[String(x)] ?? String(x))),
    t: interpolate,
    num: (x: number, digits = 0) => (digits === 0 ? f0 : digits === 1 ? f1 : f2).format(x),
    pct: (x: number, digits = 1) => (digits === 0 ? f0 : f1).format(x * 100) + ' %',
    money: (x: number, cur?: string) => {
      const abs = Math.abs(x);
      const s = abs >= 1e6 ? f2.format(x / 1e6) + ' M' : abs >= 1e4 ? f0.format(x / 1e3) + ' k' : f0.format(x);
      return cur ? `${s} ${cur}` : s;
    },
    date: (iso: unknown) => {
      if (typeof iso !== 'string' || !iso) return '';
      const [y, m, day] = iso.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    },
    monthLabel: (iso: string, long = false) => {
      const [y, m] = iso.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: long ? 'long' : 'short', year: long ? 'numeric' : undefined, timeZone: 'UTC' });
    },
    /** KPI value in its unit */
    kpi: (x: number | null, unit: Unit) => {
      if (x === null || !Number.isFinite(x)) return '—';
      if (Math.abs(x) < 1e-12) x = 0;
      switch (unit) {
        case 'pct': return f1.format(x * 100) + ' %';
        case 'ratio': return f2.format(x);
        case 'days': return f1.format(x) + (lang === 'fr' ? ' j' : ' d');
        case 'score': return f2.format(x);
        case 'count': return f0.format(x);
        case 'perProject': return f2.format(x);
        case 'hours': return f1.format(x) + ' h';
        case 'rate': return f2.format(x);
      }
    },
    /** difference between two KPI values, in the KPI's unit */
    kpiDelta: (x: number, unit: Unit) => {
      const a = Math.abs(x);
      const [fmt, shown, suffix] =
        unit === 'pct' ? [f1, a * 100, ' pt'] : unit === 'days' ? [f1, a, lang === 'fr' ? ' j' : ' d'] : unit === 'hours' ? [f1, a, ' h'] : unit === 'count' ? [f0, a, ''] : unit === 'ratio' ? [f3, a, ''] : [f2, a, ''];
      const txt = fmt.format(shown);
      const zero = Number(txt.replace(/[^\d]/g, '')) === 0;
      return `${zero ? '±' : x > 0 ? '+' : '−'}${txt}${suffix}`;
    },
  };
}

export type I18n = ReturnType<typeof makeI18n>;
export const I18nContext = createContext<I18n>(makeI18n('en'));
export const useI18n = () => useContext(I18nContext);
