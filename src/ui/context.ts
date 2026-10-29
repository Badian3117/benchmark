import { createContext, useContext } from 'react';
import type { Alert } from '../engine/analysis.ts';
import type { ISODate, Period } from '../engine/dates.ts';
import type { Dataset, Scope, Tracking } from '../engine/kpis.ts';
import type { LogKey, Row } from '../engine/schema.ts';
import type { Finding } from '../engine/validate.ts';
import type { Store } from '../data/store.ts';

export type Page = 'dashboard' | 'tracking' | 'trends' | 'health' | 'log' | 'targets' | 'quality' | 'settings' | 'data' | 'audit' | 'guide' | 'sites' | 'sync' | 'admin';

export interface Filter {
  site?: string;
  pm?: string;
  project?: string;
}

export interface AppState {
  store: Store;
  ds: Dataset;
  today: ISODate;
  month: ISODate;
  setMonth: (m: ISODate) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  scope: Scope;
  period: Period;
  tracking: Tracking;
  alerts: Alert[];
  findings: Finding[];
  go: (page: Page, log?: LogKey) => void;
  edit: (log: LogKey, rowId: string | null, preset?: Partial<Row>) => void;
}

export const AppContext = createContext<AppState | null>(null);
export function useApp(): AppState {
  const a = useContext(AppContext);
  if (!a) throw new Error('AppContext missing');
  return a;
}

export const prefs = {
  get(key: string): string | null {
    try { return localStorage.getItem('bm.' + key); } catch { return null; }
  },
  set(key: string, v: string) {
    try { localStorage.setItem('bm.' + key, v); } catch { /* storage unavailable */ }
  },
};
