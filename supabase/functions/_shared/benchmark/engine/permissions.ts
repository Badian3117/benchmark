// GENERATED from src/engine/permissions.ts by scripts/gen-functions.mjs – do not edit.
// Client-side mirror of the server's row-level security (supabase/migrations). The server
// is the authority; this only decides what the UI offers, so users are not invited to
// make edits that would be rejected.
import type { Dataset } from './kpis.ts';
import { SITE_SCOPE, type LogKey, type Row } from './schema.ts';

export type Role = 'pending' | 'pm' | 'executive' | 'admin';

export interface Who {
  userId: string;
  email: string;
  fullName: string;
  /** name used in the logs (projects.pm, owners list) */
  owner: string;
  role: Role;
  sites: string[];
  /** e-mail preferences (server side) */
  prefs?: { lang: 'en' | 'fr'; digest: boolean; critical: boolean };
}

/** null = standalone (no server): everything is allowed */
export type Actor = Who | null;

export const isAdmin = (w: Actor) => w === null || w.role === 'admin';
export const canWriteAnything = (w: Actor) => w === null || w.role === 'admin' || w.role === 'pm';

function ownsProject(ds: Dataset, w: Who, code: unknown) {
  return ds.logs.projects.some((p) => p.code === code && p.pm === w.owner && w.sites.includes(String(p.site)));
}

export function canEdit(ds: Dataset, log: LogKey, row: Row, w: Actor): boolean {
  if (w === null || w.role === 'admin') return true;
  if (w.role !== 'pm') return false;
  switch (SITE_SCOPE[log]) {
    case 'self': return row.pm === w.owner && w.sites.includes(String(row.site));
    case 'project': return ownsProject(ds, w, row.project);
    case 'site': return w.sites.includes(String(row.site));
    case 'projectOrSite': return row.project ? ownsProject(ds, w, row.project) : w.sites.includes(String(row.site));
    case 'global': return false;
  }
}

export function canCreate(log: LogKey, w: Actor): boolean {
  if (w === null || w.role === 'admin') return true;
  return w.role === 'pm' && SITE_SCOPE[log] !== 'global';
}

/** sensible defaults for a new record created by a PM */
export function presetFor(log: LogKey, w: Actor): Partial<Row> {
  if (!w || w.role !== 'pm') return {};
  const site = w.sites[0] ?? null;
  if (log === 'projects') return { pm: w.owner, site };
  if (SITE_SCOPE[log] === 'site' || SITE_SCOPE[log] === 'projectOrSite') return { site };
  return {};
}

/** projects a PM may attach records to */
export function writableProjects(ds: Dataset, w: Actor): Row[] {
  if (w === null || w.role === 'admin') return ds.logs.projects;
  if (w.role !== 'pm') return [];
  return ds.logs.projects.filter((p) => p.pm === w.owner && w.sites.includes(String(p.site)));
}
