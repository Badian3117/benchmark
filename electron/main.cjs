// BenchMark desktop shell: one window, the app served from a private app:// scheme,
// and a small file API (database load/save, open/save dialogs). The renderer has no
// Node access (contextIsolation + sandbox); everything goes through preload.cjs.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const DB_FILE = path.join(DATA_DIR, 'benchmark.sqlite');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
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

/** One backup per day (first save of the day), keeping the last KEEP_BACKUPS. */
function dailyBackup() {
  if (!fs.existsSync(DB_FILE)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const target = path.join(BACKUP_DIR, `benchmark-${day}.sqlite`);
  if (!fs.existsSync(target)) fs.copyFileSync(DB_FILE, target);
  const all = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sqlite')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(BACKUP_DIR, f));
}

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

  ipcMain.handle('db:load', () => (fs.existsSync(DB_FILE) ? new Uint8Array(fs.readFileSync(DB_FILE)) : null));
  ipcMain.handle('db:save', (_e, bytes) => {
    dailyBackup();
    atomicWrite(DB_FILE, Buffer.from(bytes));
  });
  ipcMain.on('app:version', (e) => (e.returnValue = app.getVersion()));
  ipcMain.handle('db:location', () => DB_FILE);
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

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('window-all-closed', () => app.quit());
