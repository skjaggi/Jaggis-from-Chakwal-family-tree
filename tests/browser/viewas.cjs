// Admin "View as": preview the site as a branch admin, against the fake backend.
// Writes previews to previews/view-as/ when PREVIEW_DIR is set.
const { chromium } = require('playwright'); const fs = require('fs');
const seed = JSON.parse(fs.readFileSync(__dirname + '/../../site/data/seed.json', 'utf8'));
const idOf = (g) => seed.people.find((p) => p.given_name === g).id;
const SUNIL = idOf('Sunil Kumar'); const HARBANS = idOf('Harbans Lal');
const OUT = process.env.PREVIEW_DIR;
// Someone in another branch (a grandchild of Prabh Dyal), invited but not yet claimed.
const PRABH = seed.people.find((p) => /Prabh Dyal/.test(p.given_name)).id;
const kidOf = (id) => seed.parent_child.find((l) => l.parent_id === id)?.child_id;
const OTHER = kidOf(kidOf(PRABH)) || kidOf(PRABH);
const fail = []; const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fail.push(what); };
(async () => {
  const b = await chromium.launch(); const errors = [];
  for (const [vw, vh, tag] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: OUT ? 2 : 1 });
    await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
    await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal' };" }));
    await ctx.addInitScript(() => { window.__FAKE_ROLE__ = 'admin'; window.__FAKE_NAME__ = 'Sunil Jaggi'; sessionStorage.setItem('claim-welcome', '1'); });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push(tag + ': ' + e.message));
    await pg.goto('http://localhost:8765/'); await pg.waitForSelector('#nav a');
    // A cousin who has claimed Sunil Kumar's box (a branch admin).
    await pg.evaluate((id) => { const u = window.__db.profiles.find((x) => x.id === 'u-2'); u.display_name = 'Asha Jaggi'; u.person_id = id; u.claimed_person_id = id; }, SUNIL);
    const nav = async () => (await pg.locator('#nav').innerText()).replace(/\s+/g, ' ');
    if (tag === 'desktop') check((await nav()).includes('View as') && (await nav()).includes('Members'), 'admin menu has View as and Members');
    if (tag === 'phone') { const m = pg.locator('#menu-toggle'); if (await m.count() && await m.isVisible()) await m.click(); }
    await pg.locator('#nav .viewas-btn').click();
    await pg.waitForSelector('.viewas-row');
    await pg.fill('.viewas-pick input', 'asha');
    if (OUT) await pg.screenshot({ path: `${OUT}/1-picker-${tag}.png` });
    await pg.locator('.viewas-row').first().click();
    await pg.waitForSelector('#viewas-banner:not([hidden])'); await pg.waitForTimeout(700);
    const banner = (await pg.locator('#viewas-banner').innerText()).replace(/\s+/g, ' ');
    check(/Viewing as Asha Jaggi/.test(banner) && /Branch admin of/.test(banner), 'banner: ' + banner);
    if (tag === 'desktop') {
      check(!(await nav()).includes('Members') && (await nav()).includes('Review'), 'member menu: ' + await nav());
      check(await pg.locator('#nav .viewas-btn').count() === 1, 'View as still offered to the real admin');
    }
    // The tree opens on her own line, as when she signs in: her box is drawn.
    check(await pg.locator(`g.node[data-id="${SUNIL}"]`).count() > 0, 'tree opens on her own line');
    if (OUT) await pg.waitForTimeout(3600);
    if (OUT) await pg.screenshot({ path: `${OUT}/2-tree-as-member-${tag}.png` });
    // Their own box: Edit form says Save (changes go live for a branch admin)... and nothing is saved.
    await pg.goto(`http://localhost:8765/#/tree/${HARBANS}?p=${SUNIL}`); await pg.waitForSelector('#panel .panel-top'); await pg.waitForTimeout(400);
    if (OUT) await pg.screenshot({ path: `${OUT}/3-own-card-${tag}.png` });
    const before = await pg.evaluate(() => window.__db.change_requests.length);
    await pg.locator('#panel .panel-top button', { hasText: 'Edit' }).first().click(); await pg.waitForSelector('dialog form');
    await pg.evaluate(() => { for (const [n, v] of [['gender', 'male'], ['is_living', 'true']]) { const s = document.querySelector(`dialog select[name=${n}]`); if (s && !s.value) { s.value = v; s.dispatchEvent(new Event('change')); } } });
    await pg.fill('dialog [name=profession]', 'Engineer'); await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(600);
    const t = await pg.locator('#toast').innerText();
    check(/only a preview/.test(t), 'save refused: ' + t);
    check(await pg.evaluate(() => window.__db.change_requests.length) === before, 'no change request written');
    if (OUT) await pg.screenshot({ path: `${OUT}/4-save-refused-${tag}.png` });
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    for (const b2 of await pg.locator('dialog[open] button', { hasText: /Discard|Don.t save|Close without/ }).all()) await b2.click().catch(() => {});
    if (tag === 'desktop') {
      // Invite: no email goes out.
      await pg.goto('http://localhost:8765/#/invite'); await pg.waitForSelector('#page form');
      const inv = await pg.evaluate(() => (window.__invoked || []).length);
      await pg.fill('#page form input[type=email]', 'x@example.com'); await pg.click('#page form button[type=submit]'); await pg.locator('dialog button', { hasText: 'Invite anyway' }).click(); await pg.waitForTimeout(500);
      check(await pg.evaluate(() => (window.__invoked || []).length) === inv && !(await pg.evaluate(() => window.__db.invites.some((i) => i.email === 'x@example.com'))), 'invite refused: ' + await pg.evaluate(() => document.getElementById('toast')?.textContent));
      // Members page is closed to them.
      await pg.goto('http://localhost:8765/#/members'); await pg.waitForTimeout(400);
      check(/Only the admin/.test(await pg.locator('#page').innerText()), 'members page closed');
      // Branch-only details: Asha sees her own branch's, not everyone's.
      const seen = await pg.evaluate(async () => { const { store } = await import('/js/data.js'); return [store.fam.details.size, store.real.fam.details.size, store.managed.size]; });
      check(seen[0] < seen[1] && seen[2] > 0, `details she can see ${seen[0]} of ${seen[1]}; looks after ${seen[2]} people`);
      // Reloading the tab keeps viewing as Asha.
      await pg.reload(); await pg.waitForSelector('#nav a'); await pg.waitForTimeout(600);
      check(!(await pg.locator('#viewas-banner').isHidden()), 'still viewing after reload');
      check(await pg.evaluate(() => window.__db.page_views.filter((v) => v.view === 'members').length) <= 1, 'visits not logged while viewing');
      // Someone else, linked to a box in another branch but not claimed yet: their line opens instead.
      await pg.evaluate((id) => { const u = window.__db.profiles.find((x) => x.id === 'u-4'); u.person_id = id; }, OTHER);
      await pg.locator('#viewas-banner button', { hasText: 'Someone else' }).click();
      await pg.fill('.viewas-pick input', 'came'); await pg.locator('.viewas-row').first().click(); await pg.waitForTimeout(800);
      const drawn = await pg.$$eval('g.node', (els) => els.map((e) => e.dataset.id));
      check(drawn.includes(OTHER) && !drawn.includes(SUNIL), 'switching opens the other member\'s line and closes the previous one');
      await pg.locator('#viewas-banner button', { hasText: 'Back to my view' }).click(); await pg.waitForTimeout(600);
      check(await pg.locator('#viewas-banner').isHidden() && (await nav()).includes('Members'), 'back to admin view');
      await pg.goto(`http://localhost:8765/#/tree/${HARBANS}?p=${SUNIL}`); await pg.waitForSelector('#panel .panel-top'); await pg.waitForTimeout(400);
      await pg.locator('#panel .panel-top button', { hasText: 'Edit' }).first().click(); await pg.waitForSelector('dialog form');
      check(/Save/.test(await pg.locator('dialog button[type=submit]').innerText()), 'admin can save again');
    }
    await ctx.close();
  }
  await b.close();
  console.log('viewas ERRORS:', errors.length ? errors.join('; ') : 'none', '| failed checks:', fail.length);
  if (errors.length || fail.length) process.exit(1);
})();
