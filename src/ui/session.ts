import { createContext, useContext } from 'react';
import type { Who } from '../engine/permissions.ts';
import type { SyncEngine } from '../sync/engine.ts';
import type { AdminApi } from '../sync/admin.ts';
import type { ServerConfig } from '../sync/session.ts';

export interface SessionState {
  mode: 'standalone' | 'connected';
  /** null in standalone mode (no restrictions) */
  who: Who | null;
  sync: SyncEngine | null;
  admin: AdminApi | null;
  cfg: ServerConfig | null;
  /** role/sites come from the cached profile because the server was unreachable at start */
  offlineProfile: boolean;
  signOut: () => Promise<void>;
  /** email + password accounts only */
  changePassword: ((password: string) => Promise<void>) | null;
  /** connected mode: save the user's e-mail notification preferences */
  savePrefs: ((prefs: { lang: 'en' | 'fr'; digest: boolean; critical: boolean }) => Promise<void>) | null;
}

export const STANDALONE: SessionState = {
  mode: 'standalone', who: null, sync: null, admin: null, cfg: null, offlineProfile: false, signOut: async () => {}, changePassword: null, savePrefs: null,
};

export const SessionContext = createContext<SessionState>(STANDALONE);
export const useSession = () => useContext(SessionContext);
