// Contractor module through the UI (standalone preview on :4173 with the sample data).
const { chromium } = require('playwright');
const ok = (c, m) => { if (!c) { console.log('FAIL ' + m); process.exitCode = 1; } else console.log('ok   ' + m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:4173/');
  await p.waitForSelector('.tiles');
  const kpi = (name) => p.locator('tbody tr', { has: p.locator(`.kpi-name:text-is("${name}")`) }).locator('td').nth(3).innerText();

  // safety section comes first
  ok((await p.locator('tr.group-row').first().innerText()).toUpperCase().includes('SAFETY'), 'safety KPIs head the dashboard');
  const lagBefore = await kpi('Approval Gate Lag');

  // a gate authorised after 70 h raises the October average
  await p.click('.nav-item:has-text("Approval gates")');
  await p.click('button:has-text("+ New")');
  await p.selectOption('#f-project', 'P09');
  await p.fill('#f-block', 'B999');
  await p.selectOption('#f-gate', 'Loading authorisation');
  await p.fill('#f-submittedAt', '2026-10-25T08:00');
  await p.selectOption('#f-status', 'Approved');
  await p.click('.drawer-foot button:has-text("Save")');
  ok(await p.locator('.msg.error').first().isVisible(), 'approved gate without decision time is refused');
  await p.fill('#f-approvedAt', '2026-10-28T06:00');
  await p.click('.drawer-foot button:has-text("Save")');
  await p.waitForTimeout(300);
  ok(!(await p.locator('.drawer').isVisible()), 'gate saved');
  ok((await p.locator('tbody tr', { has: p.locator('td:text-is("B999")') }).innerText()).includes('70.0 h'), 'wait computed: 70.0 h');
  await p.click('.nav-item:has-text("Dashboard")');
  const lagAfter = await kpi('Approval Gate Lag');
  ok(lagAfter !== lagBefore, `gate lag recalculated (${lagBefore} → ${lagAfter})`);

  // handover pack → record the handover with the open items pre-filled
  await p.click('.nav-item:has-text("Handover pack")');
  await p.selectOption('.page-head select', 'P09');
  await p.click('button:has-text("Record this handover")');
  ok((await p.inputValue('#f-pendingAuthorisations')).includes('Loading authorisation'), 'handover pre-filled with pending authorisations');
  await p.selectOption('#f-incoming', 'F. Bah');
  await p.selectOption('#f-overlapBriefing', 'Yes');
  await p.selectOption('#f-signedOff', 'Yes');
  await p.click('.drawer-foot button:has-text("Save")');
  await p.waitForTimeout(300);
  await p.click('.nav-item:has-text("Rotation handovers")');
  ok((await p.locator('tbody tr').count()) === 11, 'handover recorded (11 rows)');

  // monthly report renders every section
  await p.click('.nav-item:has-text("Monthly report")');
  ok((await p.locator('.report-section').count()) >= 10, 'monthly report sections rendered');

  // Power BI export
  await p.click('.nav-item:has-text("Import / export")');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.card button:has-text("Export for Power BI")')]);
  ok(/BenchMark_PowerBI_2026-10\.xlsx/.test(dl.suggestedFilename()), 'Power BI workbook downloaded: ' + dl.suggestedFilename());

  // French labels for the new module
  await p.click('.seg button:has-text("FR")');
  ok((await p.locator('.nav-title:has-text("Opérations sous-traitant")').count()) === 1, 'French contractor menu');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
