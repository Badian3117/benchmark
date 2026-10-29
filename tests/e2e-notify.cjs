// Desktop notifications through the UI (browser preview; the Notification API is stubbed
// so the test can see what would pop up).
const { chromium } = require('playwright');
const ok = (c, m) => { if (!c) { console.log('FAIL ' + m); process.exitCode = 1; } else console.log('ok   ' + m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.addInitScript(() => {
    window.__notes = JSON.parse(sessionStorage.getItem('notes') || '[]');
    class N { constructor(title, o) { window.__notes.push({ title, body: o?.body }); sessionStorage.setItem('notes', JSON.stringify(window.__notes)); window.__last = this; } }
    N.permission = 'granted';
    N.requestPermission = async () => 'granted';
    window.Notification = N;
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:4173/');
  await p.waitForSelector('.tiles');
  await p.waitForTimeout(2500);
  const notes = () => p.evaluate(() => window.__notes);
  ok((await notes()).length === 0, 'first start: existing alerts are a baseline, nothing pops up');

  // record a lost-time injury on the KGM contract for October → critical notification
  await p.click('.nav-item:has-text("Safety & environment")');
  await p.locator('tbody tr', { has: p.locator('td:text-is("P09")') }).filter({ hasText: 'October 2026' }).first().click();
  await p.fill('#f-lti', '1');
  await p.click('.drawer-foot button:has-text("Save")');
  await p.waitForTimeout(2500);
  const n1 = await notes();
  ok(n1.length === 1 && /Critical/.test(n1[0].title) && /lost-time/.test(n1[0].body), 'LTI raised a critical notification: ' + (n1[0]?.body ?? ''));

  // clicking it opens the record
  await p.evaluate(() => window.__last.onclick());
  ok(await p.locator('.drawer h2:has-text("Edit")').isVisible(), 'clicking the notification opens the record');
  await p.keyboard.press('Escape');

  // reload: not repeated
  await p.reload();
  await p.waitForSelector('.app');
  await p.waitForTimeout(2500);
  ok((await notes()).length === 1, 'not repeated after a restart');

  // serious alerts are only shown when chosen in Settings
  await p.click('.nav-item:has-text("Settings")');
  await p.locator('.card:has-text("Desktop notifications") select').selectOption('serious');
  await p.click('.nav-item:has-text("Safety & environment")');
  await p.locator('tbody tr', { has: p.locator('td:text-is("P09")') }).filter({ hasText: 'October 2026' }).first().click();
  await p.fill('#f-ppvExceedances', '2');
  await p.click('.drawer-foot button:has-text("Save")');
  await p.waitForTimeout(2500);
  const n2 = await notes();
  const later = n2.slice(1);
  ok(later.some((n) => /Serious/.test(n.title) && /exceedance/.test(n.body)), 'serious level: vibration exceedance notified');
  ok(later.some((n) => /RED with no open corrective action/.test(n.body)), '…and the KPI turning red without an action');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
