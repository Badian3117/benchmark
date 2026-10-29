// Turns new alerts into desktop notifications. Runs after every data change (local edit
// or sync). What was already notified is remembered in this user's local database, so
// restarting the app, or syncing, never repeats a notification.
import { useEffect } from 'react';
import type { Alert } from '../../engine/analysis.ts';
import type { LogKey } from '../../engine/schema.ts';
import { desktop } from '../../data/persistence.ts';
import { useI18n } from '../../i18n/index.ts';
import { alertText, currentAlerts, newAlerts, type DesktopLevel } from '../../notify/core.ts';
import { prefs, useApp } from '../context.ts';

export const desktopLevel = (): DesktopLevel => (prefs.get('notify.level') as DesktopLevel) || 'critical';

let clickHandler: ((p: { log?: string; rowId?: string } | null) => void) | null = null;
let registered = false;

export function showNotification(title: string, body: string, payload: { log?: string; rowId?: string } | null) {
  if (desktop?.notify) return void desktop.notify(title, body, payload);
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.focus();
      clickHandler?.(payload);
    };
  }
}

export function Notifier() {
  const { store, ds, today, edit, go } = useApp();
  const i = useI18n();

  useEffect(() => {
    clickHandler = (p) => (p?.log && p.rowId ? edit(p.log as LogKey, p.rowId) : go('dashboard'));
    if (!registered && desktop?.onNotifyClick) {
      registered = true;
      desktop.onNotifyClick((p) => clickHandler?.(p));
    }
  }, [edit, go]);

  useEffect(() => {
    const t = setTimeout(() => {
      const level = desktopLevel();
      const { month, alerts } = currentAlerts(ds, today);
      const r = newAlerts(alerts, month, store.getMeta<string[]>('notify.seen'), level === 'off' ? 'off' : level);
      store.setMeta('notify.seen', r.seen);
      void store.flush();
      if (!r.fresh.length) return;
      const show = (a: Alert) => showNotification(`BenchMark – ${i.d.severity[a.severity]}`, alertText(a, i.lang), a.log && a.rowId ? { log: a.log, rowId: a.rowId } : null);
      // a burst (e.g. first sync of a big site) becomes one summary instead of a wall of toasts
      if (r.fresh.length <= 3) r.fresh.forEach(show);
      else {
        show(r.fresh[0]);
        showNotification('BenchMark', i.t(i.d.notify.more, { n: r.fresh.length - 1 }), null);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [ds, today, store, i]);

  return null;
}
