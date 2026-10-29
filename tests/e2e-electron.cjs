// Connected mode inside the real Electron shell (app:// origin, CSP, sandboxed preload).
// Needs dist/ built with VITE_BM_SUPABASE_URL pointing at tests/server/fake-supabase.mjs.
const { _electron: electron } = require('playwright');
const ok = (c, m) => { if (!c) { console.log('FAIL ' + m); process.exitCode = 1; } else console.log('ok   ' + m); };
(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--no-sandbox', '--disable-gpu'] });
  const w = await app.firstWindow();
  const errs = [];
  w.on('pageerror', (e) => errs.push(e.message));
  await w.waitForSelector('#email', { timeout: 30000 });
  await w.fill('#email', 'coo@corica.test');
  await w.fill('#password', 'pass');
  await w.click('button[type=submit]');
  await w.waitForSelector('.chip.GREEN:has-text("Synced")', { timeout: 30000 });
  ok(true, 'signed in and synced from inside Electron');
  await w.click('.nav-item:has-text("Projects")');
  ok((await w.locator('tbody tr').count()) === 8, 'executive laptop received the 8 projects');
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  const files = require('node:fs').readdirSync(require('node:path').join(userData, 'data'));
  ok(files.some((f) => /^user-[0-9a-f-]+\.sqlite$/.test(f)), 'per-user database file: ' + files.join(', '));
  // PDF export through the real Electron printToPDF (save dialog stubbed)
  const pdfPath = require('node:path').join(require('node:os').tmpdir(), 'bm-report-test.pdf');
  try { require('node:fs').unlinkSync(pdfPath); } catch {}
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, pdfPath);
  await w.click('.nav-item:has-text("Monthly report")');
  await w.click('button:has-text("Export PDF")');
  for (let i = 0; i < 40 && !require('node:fs').existsSync(pdfPath); i++) await w.waitForTimeout(250);
  const head = require('node:fs').existsSync(pdfPath) ? require('node:fs').readFileSync(pdfPath).subarray(0, 5).toString() : '';
  ok(head === '%PDF-', 'monthly report exported to PDF by the desktop app');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await app.close();
})();
