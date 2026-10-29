// Where the SQLite file lives. In the desktop app it is a file in the user's data folder
// (written atomically, with rolling backups – see electron/main.cjs). In a plain browser
// (development preview) it falls back to IndexedDB.

export interface Persistence {
  kind: 'file' | 'browser';
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
}

export interface DesktopBridge {
  version: string;
  loadDb(name: string): Promise<Uint8Array | null>;
  saveDb(name: string, bytes: Uint8Array): Promise<void>;
  openFile(filters: { name: string; extensions: string[] }[]): Promise<{ name: string; bytes: Uint8Array } | null>;
  saveFile(defaultName: string, bytes: Uint8Array, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  dataLocation(): Promise<string>;
  showDataFolder(): Promise<void>;
  /** open a URL in the system browser (Microsoft sign-in) */
  openExternal(url: string): Promise<void>;
  /** benchmark://auth/callback?code=… delivered by the OS after Microsoft sign-in */
  onAuthCallback(fn: (url: string) => void): void;
  /** print the current page (report) to a PDF file chosen by the user */
  printToPdf?(defaultName: string): Promise<string | null>;
}

declare global {
  interface Window {
    benchmark?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | undefined = typeof window !== 'undefined' ? window.benchmark : undefined;

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('benchmark', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const browserPersistence = (name: string): Persistence => ({
  kind: 'browser',
  async load() {
    try {
      const db = await idb();
      return await new Promise((resolve) => {
        const req = db.transaction('files').objectStore('files').get(name);
        req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result) : null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  },
  async save(bytes) {
    try {
      const db = await idb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put(bytes, name);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      /* preview only – nothing else to do */
    }
  },
});

/** name: 'benchmark' (standalone) or 'user-<uuid>' – one local database per signed-in user */
export function getPersistence(name: string): Persistence {
  // the preview used the key 'db' before databases were named
  const key = name === 'benchmark' && !desktop ? 'db' : name;
  if (desktop) return { kind: 'file', load: () => desktop.loadDb(key), save: (b) => desktop.saveDb(key, b) };
  return browserPersistence(key);
}

/** Save/download a file: native dialog on desktop, browser download otherwise. */
export async function saveBytes(name: string, bytes: Uint8Array, ext: string, label: string): Promise<string | null> {
  if (desktop) return desktop.saveFile(name, bytes, [{ name: label, extensions: [ext] }]);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}

/** Pick a file: native dialog on desktop, <input type=file> otherwise. */
export async function pickFile(ext: string[], label: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (desktop) return desktop.openFile([{ name: label, extensions: ext }]);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ext.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.click();
  });
}
