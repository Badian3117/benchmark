// GENERATED from src/engine/dates.ts by scripts/gen-functions.mjs – do not edit.
// All dates are ISO strings 'YYYY-MM-DD' (no time, no timezone) so that string
// comparison equals chronological comparison and nothing shifts across timezones.

export type ISODate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(v: unknown): v is ISODate {
  return typeof v === 'string' && ISO_RE.test(v);
}

/** 'YYYY-MM-DDTHH:MM' – local site time, no timezone (approval gates are measured in hours) */
const ISO_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export function isISODateTime(v: unknown): v is string {
  return typeof v === 'string' && ISO_DT_RE.test(v);
}
/** the calendar day of a date or date-time value */
export function dayOf(v: unknown): ISODate | null {
  if (isISODate(v)) return v;
  if (isISODateTime(v)) return v.slice(0, 10);
  return null;
}
export function hoursBetween(from: string, to: string): number {
  const p = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +(s.slice(11, 13) || 0), +(s.slice(14, 16) || 0));
  return (p(to) - p(from)) / 3_600_000;
}

export function toISO(d: Date): ISODate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): ISODate {
  const d = new Date();
  // local calendar day, not UTC day
  return toISO(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}

function parse(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function monthStart(d: ISODate): ISODate {
  return d.slice(0, 7) + '-01';
}

export function monthEnd(d: ISODate): ISODate {
  const x = parse(monthStart(d));
  return toISO(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)));
}

export function addMonths(d: ISODate, n: number): ISODate {
  const x = parse(monthStart(d));
  return toISO(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1)));
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function inRange(d: unknown, start: ISODate, end: ISODate): boolean {
  const day = dayOf(d);
  return day !== null && day >= start && day <= end;
}

/** The 12 reporting months of the year starting at yearStart. */
export function yearMonths(yearStart: ISODate): ISODate[] {
  return Array.from({ length: 12 }, (_, i) => addMonths(yearStart, i));
}

export interface Period {
  month: ISODate; // 1st of month
  start: ISODate;
  end: ISODate;
  /** Evaluation date: end of month, or today if the month is still running. */
  asOf: ISODate;
  yearStart: ISODate;
}

export function makePeriod(month: ISODate, yearStart: ISODate, today: ISODate = todayISO()): Period {
  const start = monthStart(month);
  const end = monthEnd(month);
  return { month: start, start, end, asOf: minDate(end, today), yearStart: monthStart(yearStart) };
}
