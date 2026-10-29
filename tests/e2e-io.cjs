// Excel import + export through the real UI (browser build of ExcelJS).
const { chromium } = require('playwright');
const path = require('node:path');
const ok = (c, m) => { if (!c) { console.log('FAIL ' + m); process.exitCode = 1; } else console.log('ok   ' + m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:4173/?empty');
  await p.waitForSelector('.app');
  await p.click('.seg button:has-text("EN")');
  await p.click('.nav-item:has-text("Import / export")');
  // start from an empty database, then import the original workbook
  await p.click('button:has-text("Start with an empty database")');
  await p.waitForTimeout(500);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('button:has-text("Replace all data")')]);
  await fc.setFiles(path.join(__dirname, 'fixtures', 'PM_KPI_Tracker.xlsx'));
  await p.waitForSelector('.notice.ok', { timeout: 30000 });
  const msg = await p.locator('.notice.ok').innerText();
  ok(/Projects 8/.test(msg) && /Cost & schedule \(EVM\) 53/.test(msg), 'workbook imported: ' + msg.slice(0, 80));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.card button:has-text("Export to Excel")')]);
  const file = await dl.path();
  ok(require('node:fs').statSync(file).size > 20000, 'Excel export downloaded (' + require('node:fs').statSync(file).size + ' bytes)');
  await p.click('.nav-item:has-text("Dashboard")');
  const row1 = p.locator('tbody tr', { has: p.locator('.kpi-name:text-is("Schedule Variance (SV%)")') });
  ok((await row1.locator('td').nth(3).innerText()).includes('-6.7'), 'imported data drives the dashboard (SV% −6.7 %)');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
