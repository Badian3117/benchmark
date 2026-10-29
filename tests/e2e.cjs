// End-to-end UI check against the browser preview (npm run build && npx vite preview --port 4173).
// Usage: node tests/e2e.cjs <screenshot-dir>
const { chromium } = require('playwright');
const out = process.argv[2] || '.';
const ok = (c, m) => { if (!c) { console.log('FAIL ' + m); process.exitCode = 1; } else console.log('ok   ' + m); };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:4173/');
  await p.waitForSelector('.tiles');

  // 1. new issue with resolution before raised date -> blocked
  await p.click('.nav-item:has-text("Issues")');
  const before = await p.locator('tbody tr').count();
  await p.click('button:has-text("+ New")');
  await p.fill('#f-description', 'Drill rig DR-04 hydraulic leak');
  await p.selectOption('#f-project', 'P05');
  await p.fill('#f-raised', '2026-10-20');
  await p.selectOption('#f-status', 'Resolved');
  await p.fill('#f-resolved', '2026-10-10');
  await p.click('.drawer-foot button:has-text("Save")');
  ok(await p.locator('.drawer').isVisible(), 'invalid record is not saved');
  ok((await p.locator('.msg.error:has-text("Cannot be before")').count()) > 0, 'date-order error shown');
  await p.fill('#f-resolved', '2026-10-24');
  await p.click('.drawer-foot button:has-text("Save")');
  await p.waitForTimeout(300);
  ok(!(await p.locator('.drawer').isVisible()), 'valid record saved');
  ok((await p.locator('tbody tr').count()) === before + 1, 'row added to the issues log');
  ok((await p.locator('td:text-is("I-041")').count()) === 1, 'auto-numbered I-041');

  // 2. KPI 7 for October now includes the new 4-day issue: (5 + 4)/2 = 4.5 d
  await p.click('.nav-item:has-text("Dashboard")');
  const row7 = p.locator('tbody tr', { has: p.locator('.kpi-name:text-is("Issue Resolution Time")') });
  ok((await row7.locator('td').nth(3).innerText()).includes('4.5'), 'dashboard recalculated KPI #7 = 4.5 d');

  // 3. raise action from a red KPI: prefilled with KPI and value before (in %)
  const row11 = p.locator('tbody tr', { has: p.locator('.kpi-name:text-is("Milestone Completion Rate")') });
  await row11.locator('button:has-text("Raise action")').click();
  ok((await p.inputValue('#f-before')) === '25', 'action pre-filled: before = 25 (%)');
  await p.fill('#f-rootCause', 'Handover packs not ready');
  await p.fill('#f-action', 'Weekly handover readiness review');
  await p.selectOption('#f-owner', 'F. Bah');
  await p.fill('#f-due', '2026-11-15');
  await p.click('.drawer-foot button:has-text("Save")');
  await p.waitForTimeout(300);
  ok((await row11.locator('td').nth(9).innerText()).startsWith('1 open'), 'action counted as open on the dashboard');

  // 4. target change requires reason + approver, and logs a revision
  await p.click('.nav-item:has-text("Targets")');
  const tr = p.locator('tbody tr', { has: p.locator('.kpi-name:text-is("Issue Resolution Time")') });
  await tr.locator('button:has-text("Change target")').click();
  await p.locator('.modal input[type=number]').first().fill('6');
  await p.click('.modal button:has-text("Save")');
  ok(await p.locator('.notice.err').isVisible(), 'target change blocked without reason');
  await p.fill('.modal textarea', 'Triage process stable for 6 months');
  await p.locator('.modal select').nth(1).selectOption('M. Diallo');
  await p.locator('.modal select').nth(2).selectOption('B. Toure');
  await p.click('.modal button:has-text("Save")');
  await p.waitForTimeout(300);
  ok((await p.locator('td:has-text("Triage process stable")').count()) === 1, 'target revision logged');

  // 5. lock September: September records become read-only
  await p.click('.nav-item:has-text("Settings")');
  await p.locator('select').filter({ has: p.locator('option:text-is("No lock")') }).selectOption({ label: 'September 2026' });
  await p.click('.nav-item:has-text("Issues")');
  await p.locator('tbody tr', { has: p.locator('td:text-is("I-001")') }).click();
  ok(await p.locator('.notice.warn:has-text("locked")').isVisible(), 'locked-period notice shown');
  ok(await p.locator('.drawer-foot button:has-text("Save")').isDisabled(), 'save disabled in locked period');
  await p.keyboard.press('Escape');

  // 6. audit trail and persistence across reload
  await p.click('.nav-item:has-text("Audit trail")');
  ok((await p.locator('tbody tr').count()) >= 4, 'audit trail records the changes');
  await p.waitForTimeout(800);
  await p.reload();
  await p.waitForSelector('.app'); // reopens on the last page used
  await p.click('.nav-item:has-text("Issues")');
  ok((await p.locator('td:text-is("I-041")').count()) === 1, 'data persisted after reload');

  // 7. French UI + dark theme
  await p.click('.seg button:has-text("FR")');
  await p.click('.nav-item:has-text("Tableau de bord")');
  await p.waitForTimeout(300);
  ok((await p.locator('h1:has-text("Tableau de bord KPI")').count()) === 1, 'French dashboard');
  await p.screenshot({ path: out + '/fr.png' });
  await p.click('.nav-item:has-text("Santé des projets")');
  await p.screenshot({ path: out + '/health.png' });
  await p.selectOption('select[aria-label="Thème"]', 'dark');
  await p.click('.nav-item:has-text("Tendances")');
  await p.waitForTimeout(300);
  await p.screenshot({ path: out + '/dark.png' });
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
