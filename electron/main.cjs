// BenchMark desktop shell: one window, the app served from a private app:// scheme,
// and a small file API (database load/save, open/save dialogs). The renderer has no
// Node access (contextIsolation + sandbox); everything goes through preload.cjs.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
/** one database per signed-in user ('user-<uuid>'), 'benchmark' when standalone */
const dbFile = (name) => {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(String(name))) throw new Error('bad database name');
  return path.join(DATA_DIR, `${name}.sqlite`);
};
const KEEP_BACKUPS = 30;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

/** Write to a temp file and rename: a crash mid-write can never corrupt the database. */
function atomicWrite(file, bytes) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/** One backup per database per day (first save of the day), keeping the last KEEP_BACKUPS of each. */
function dailyBackup(name) {
  const file = dbFile(name);
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const target = path.join(BACKUP_DIR, `${name}-${day}.sqlite`);
  if (!fs.existsSync(target)) fs.copyFileSync(file, target);
  const mine = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(name + '-') && /\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
  for (const f of mine.slice(0, Math.max(0, mine.length - KEEP_BACKUPS))) fs.rmSync(path.join(BACKUP_DIR, f));
}

// ---- Microsoft sign-in comes back as benchmark://auth/callback?code=… ----
const PROTOCOL = 'benchmark';
if (process.defaultApp) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
else app.setAsDefaultProtocolClient(PROTOCOL);
let pendingAuthUrl = process.argv.find((a) => a.startsWith(PROTOCOL + '://')) || null;
let rendererReady = false;
function deliverAuth(url) {
  if (!url || !url.startsWith(PROTOCOL + '://')) return;
  if (win && rendererReady) win.webContents.send('auth:callback', url);
  else pendingAuthUrl = url;
}
app.on('open-url', (e, url) => { e.preventDefault(); deliverAuth(url); });

let win;
let closing = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'BenchMark',
    backgroundColor: '#f4f4f2',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadURL('app://bundle/index.html');
  // external links open in the browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  // flush pending edits before the window goes away
  win.on('close', (e) => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    const done = () => win && !win.isDestroyed() && win.destroy();
    const timer = setTimeout(done, 4000);
    win.webContents
      .executeJavaScript('window.benchmarkFlush ? window.benchmarkFlush() : null')
      .catch(() => {})
      .finally(() => { clearTimeout(timer); done(); });
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  fs.mkdirSync(DATA_DIR, { recursive: true });

  ipcMain.handle('db:load', (_e, name) => {
    const file = dbFile(name);
    return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
  });
  ipcMain.handle('db:save', (_e, name, bytes) => {
    dailyBackup(name);
    atomicWrite(dbFile(name), Buffer.from(bytes));
  });
  ipcMain.on('app:version', (e) => (e.returnValue = app.getVersion()));
  ipcMain.handle('db:location', () => DATA_DIR);
  ipcMain.handle('app:openExternal', (_e, url) => {
    if (!/^https:\/\//.test(String(url))) throw new Error('only https links');
    return shell.openExternal(url);
  });
  ipcMain.on('auth:ready', () => {
    rendererReady = true;
    if (pendingAuthUrl) { win.webContents.send('auth:callback', pendingAuthUrl); pendingAuthUrl = null; }
  });
  ipcMain.handle('db:showFolder', () => shell.openPath(DATA_DIR));
  ipcMain.handle('file:open', async (_e, filters) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
    if (r.canceled || !r.filePaths[0]) return null;
    return { name: path.basename(r.filePaths[0]), bytes: new Uint8Array(fs.readFileSync(r.filePaths[0])) };
  });
  ipcMain.handle('file:save', async (_e, defaultName, bytes, filters) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters });
    if (r.canceled || !r.filePath) return null;
    atomicWrite(r.filePath, Buffer.from(bytes));
    return r.filePath;
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
    ]),
  );
  createWindow();
});

app.on('second-instance', (_e, argv) => {
  deliverAuth(argv.find((a) => a.startsWith(PROTOCOL + '://')));
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('window-all-closed', () => app.quit());
