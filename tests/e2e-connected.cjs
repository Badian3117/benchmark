// Connected-mode UI test (run through scripts/e2e-connected.sh). Each user gets their own
// browser context = their own laptop, with its own local database.
const { chromium } = require('playwright');
const path = require('node:path');
const out = process.argv[2] || '.';
const APP = 'http://localhost:4174/';
const ok = (c, m) => { if (!c) { console.log('FAIL ' + m); process.exitCode = 1; } else console.log('ok   ' + m); };

async function laptop(b, email, errs) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(email + ': ' + e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(APP);
  await p.fill('#email', email);
  await p.fill('#password', 'pass');
  await p.click('button[type=submit]');
  return p;
}
const synced = (p) => p.waitForSelector('.chip.GREEN:has-text("Synced")', { timeout: 20000 });
async function syncNow(p) {
  await p.click('.nav-item:has-text("Sync")');
  await p.click('button:has-text("Sync now")');
  await p.waitForTimeout(600);
  await synced(p);
}
const kpiCell = (p, name, col) => p.locator('tbody tr', { has: p.locator(`.kpi-name:text-is("${name}")`) }).locator('td').nth(col).innerText();

(async () => {
  const b = await chromium.launch();
  const errs = [];

  // 1. pending user sees the approval screen
  const pend = await laptop(b, 'new.pm@corica.test', errs);
  await pend.waitForSelector('h2:has-text("waiting for approval")');
  ok(true, 'unapproved account sees the approval screen');

  // 2. wrong password
  const bad = await (await b.newContext()).newPage();
  await bad.goto(APP);
  await bad.fill('#email', 'coo@corica.test');
  await bad.fill('#password', 'nope');
  await bad.click('button[type=submit]');
  await bad.waitForSelector('.notice.err');
  ok((await bad.locator('.notice.err').innerText()).includes('Invalid login'), 'wrong password is refused');

  // 3. admin signs in to an empty server and uploads the site workbook
  const admin = await laptop(b, 'pc@corica.test', errs);
  await admin.waitForSelector('.app');
  await synced(admin);
  ok(true, 'admin signed in and synced');
  await admin.click('.nav-item:has-text("Import / export")');
  ok((await admin.locator('button:has-text("Replace all data")').count()) === 0, 'no “replace all” while connected');
  await admin.locator('.ctl select').last().selectOption('KGM – Kouroussa');
  const [fc] = await Promise.all([admin.waitForEvent('filechooser'), admin.click('button:has-text("Add to existing data")')]);
  await fc.setFiles(path.join(__dirname, 'fixtures', 'PM_KPI_Tracker.xlsx'));
  await admin.waitForSelector('.notice.ok', { timeout: 30000 });
  await syncNow(admin);
  const st = await admin.locator('.chip.GREEN').first().innerText();
  ok(!/waiting|to review/.test(st), 'all imported records accepted by the server: ' + st);

  // 4. executive: same numbers, read-only
  const coo = await laptop(b, 'coo@corica.test', errs);
  await coo.waitForSelector('.app');
  await synced(coo);
  await coo.click('.nav-item:has-text("Dashboard")');
  await coo.waitForTimeout(300);
  ok((await kpiCell(coo, 'Schedule Variance (SV%)', 3)).includes('-6.7'), 'executive sees the synced KPIs (SV% −6.7 %)');
  ok((await coo.locator('button:has-text("Raise action")').count()) === 0, 'executive cannot raise actions');
  await coo.click('.nav-item:has-text("Projects")');
  ok((await coo.locator('button:has-text("+ New")').count()) === 0, 'executive has no “New” button');
  await coo.locator('tbody tr').first().click();
  ok(await coo.locator('.notice.info:has-text("Read-only")').isVisible(), 'executive opens records read-only');
  ok((await coo.locator('.drawer-foot button:has-text("Save")').count()) === 0, 'no Save for the executive');
  await coo.keyboard.press('Escape');
  await coo.screenshot({ path: out + '/connected-coo.png' });

  // 5. PM: own projects editable, others read-only; edit reaches the executive
  const cam = await laptop(b, 'a.camara@corica.test', errs);
  await cam.waitForSelector('.app');
  await synced(cam);
  await cam.click('.nav-item:has-text("Projects")');
  await cam.locator('tbody tr', { has: cam.locator('td:text-is("P04")') }).click();
  ok(await cam.locator('.notice.info:has-text("another project manager")').isVisible(), 'PM: someone else’s project is read-only');
  await cam.keyboard.press('Escape');
  await cam.locator('tbody tr', { has: cam.locator('td:text-is("P07")') }).click();
  await cam.fill('#f-eac', '975000');
  await cam.click('.drawer-foot button:has-text("Save")');
  await syncNow(cam);
  await syncNow(coo);
  await coo.click('.nav-item:has-text("Projects")');
  ok((await coo.locator('tbody tr', { has: coo.locator('td:text-is("P07")') }).innerText()).includes('975'), 'PM edit reached the executive');

  // 6. other-site PM sees nothing until the admin gives them the site
  const dia = await laptop(b, 'm.diallo@corica.test', errs);
  await dia.waitForSelector('.app');
  await synced(dia);
  await dia.click('.nav-item:has-text("Projects")');
  ok((await dia.locator('tbody tr').count()) === 0, 'PM of another site sees no KGM project');
  await admin.click('.nav-item:has-text("Users & sites")');
  const row = admin.locator('tbody tr', { has: admin.locator('td:text-is("m.diallo@corica.test")') });
  await row.locator('label:has-text("KGM – Kouroussa") input').check();
  await row.locator('button:has-text("Save")').click();
  await admin.waitForSelector('button:has-text("✓ Saved")');
  await admin.screenshot({ path: out + '/connected-admin.png' });
  await syncNow(dia);
  ok(true, 'admin assigned KGM to M. Diallo');
  // membership is read at sign-in: sign out and in again
  await dia.click('button:has-text("Sign out")');
  await dia.fill('#email', 'm.diallo@corica.test');
  await dia.fill('#password', 'pass');
  await dia.click('button[type=submit]');
  await synced(dia);
  await dia.click('.nav-item:has-text("Projects")');
  ok((await dia.locator('tbody tr').count()) === 8, 'after the new site assignment the PM sees its 8 projects');

  // 7. conflict between two laptops of the same PM
  const cam2 = await laptop(b, 'a.camara@corica.test', errs);
  await synced(cam2);
  for (const [pg, v] of [[cam, '981000'], [cam2, '982000']]) {
    await pg.click('.nav-item:has-text("Projects")');
    await pg.locator('tbody tr', { has: pg.locator('td:text-is("P07")') }).click();
    await pg.fill('#f-eac', v);
    await pg.click('.drawer-foot button:has-text("Save")');
  }
  await syncNow(cam);
  await cam2.click('.nav-item:has-text("Sync")');
  await cam2.click('button:has-text("Sync now")');
  await cam2.waitForSelector('.card:has-text("Changed by someone else first")', { timeout: 20000 });
  ok(true, 'second laptop shows the conflict');
  await cam2.screenshot({ path: out + '/connected-conflict.png' });
  await cam2.click('button:has-text("Keep mine")');
  await cam2.waitForSelector('.notice.ok:has-text("Nothing to review")', { timeout: 20000 });
  await syncNow(cam);
  await cam.click('.nav-item:has-text("Projects")');
  ok((await cam.locator('tbody tr', { has: cam.locator('td:text-is("P07")') }).innerText()).includes('982'), '“keep mine” wins on the other laptop');

  // 8. sites overview for executives
  await coo.click('.nav-item:has-text("Sites overview")');
  ok((await coo.locator('tbody tr').count()) >= 1, 'sites overview lists the sites');
  await coo.screenshot({ path: out + '/connected-sites.png' });

  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
