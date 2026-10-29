import { useSyncExternalStore } from 'react';
import type { SyncEngine } from '../../sync/engine.ts';
import { useI18n } from '../../i18n/index.ts';
import { StatusIcon } from './common.tsx';

export function useSyncStatus(sync: SyncEngine) {
  return useSyncExternalStore(sync.subscribe, () => sync.status);
}

/** Top-bar indicator: synced / syncing / offline / needs attention. */
export function SyncChip({ sync, onOpen }: { sync: SyncEngine; onOpen: () => void }) {
  const i = useI18n();
  const d = i.d.sync;
  const s = useSyncStatus(sync);
  const time = s.lastSync ? s.lastSync.toLocaleTimeString(i.locale, { hour: '2-digit', minute: '2-digit' }) : '';
  const [rag, text] =
    s.state === 'syncing' ? (['NODATA', d.syncing] as const)
    : s.state === 'offline' ? (['AMBER', d.offline] as const)
    : s.state === 'auth' ? (['RED', d.authFailed] as const)
    : s.state === 'error' ? (['RED', d.error] as const)
    : (['GREEN', i.t(d.synced, { t: time })] as const);
  return (
    <button className={`chip ${rag}`} style={{ border: 0, cursor: 'pointer', minHeight: 30 }} onClick={onOpen} title={s.lastError ?? ''}>
      <StatusIcon rag={rag} />
      {text}
      {s.pending > 0 && <> · {i.t(d.pending, { n: s.pending })}</>}
      {s.issues > 0 && <> · {i.t(d.issues, { n: s.issues })}</>}
    </button>
  );
}
