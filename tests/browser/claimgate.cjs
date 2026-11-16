// "Claim your box first": invitees land on their box after signing in, and
// members who haven't claimed a box are asked to before any change.
const { chromium, devices } = require('playwright'); const fs = require('fs');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
(async () => {
  const b = await chromium.launch(); const errors = [];
  const ok = (cond, what) => { if (!cond) errors.push('FAILED: ' + what); console.log(cond ? 'ok  ' : 'FAIL', what); };
  const setup = async (opts, init) => {
    const ctx = await b.newContext(opts);
    await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
    await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal' };" }));
    await ctx.addInitScript(init);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push(e.message));
    return { ctx, pg };
  };
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }], ['phone', devices['iPhone 13']]]) {
    // 1. Signing in with an invitation linked to a box: taken to it, asked "Is this you?".
    let { ctx, pg } = await setup(opts, () => { window.__FAKE_ROLE__ = 'member'; window.__FAKE_NAME__ = 'Sunil'; });
    await pg.goto('http://localhost:8765/'); await pg.waitForSelector('dialog .claim-gate');
    await pg.waitForTimeout(500);
    ok((await pg.locator('dialog h2').innerText()) === 'Is this you?', `${name}: welcome asks "Is this you?"`);
    ok(/Sunil Kumar/.test(await pg.locator('#panel').innerText()), `${name}: their box is open behind it`);
    await pg.screenshot({ path: `${SHOTS}claim-welcome-${name}.png` });
    await pg.locator('dialog .modal-head button').click();
    // 2. Closed it and tried to edit someone: the gate asks first.
    await pg.locator('#panel .panel-top button', { hasText: /edit/i }).first().click(); await pg.waitForSelector('dialog .claim-gate');
    ok((await pg.locator('dialog h2').innerText()) === 'First, claim your own box', `${name}: editing without a box asks to claim first`);
    ok(await pg.locator('dialog form').count() === 0, `${name}: edit form not opened yet`);
    await pg.screenshot({ path: `${SHOTS}claim-gate-${name}.png` });
    await pg.locator('dialog button', { hasText: /^Yes, I am/ }).click(); await pg.waitForSelector('dialog form'); await pg.waitForTimeout(300);
    ok(await pg.evaluate(() => window.__db.profiles[0].claimed_person_id) !== null, `${name}: linked box claimed`);
    ok((await pg.locator('dialog button[type=submit]').innerText()) === 'Save', `${name}: then the edit form opens and saves right away`);
    await ctx.close();

    // 3. Not linked to a box: search for yourself, or say you're not in the tree yet.
    ({ ctx, pg } = await setup(opts, () => { window.__FAKE_ROLE__ = 'member'; window.__FAKE_UNLINKED__ = 1; }));
    await pg.goto('http://localhost:8765/'); await pg.waitForSelector('g.node'); await pg.waitForTimeout(600);
    ok(await pg.locator('dialog .claim-gate').count() === 0, `${name}: no welcome prompt without a linked box`);
    await pg.fill('#search', 'harbans'); await pg.keyboard.press('Enter'); await pg.waitForSelector('#panel .panel-top');
    await pg.locator('.add-row button', { hasText: 'Child' }).click(); await pg.waitForSelector('dialog .claim-gate');
    ok(await pg.locator('dialog .claim-linked').count() === 0, `${name}: no linked box shown`);
    await pg.fill('dialog .picker input', 'sunil'); await pg.locator('dialog .pick-list button').first().click();
    ok(await pg.locator('dialog .claim-pick:not([hidden])').count() === 1, `${name}: picked box offers "Yes, this is me"`);
    await pg.screenshot({ path: `${SHOTS}claim-search-${name}.png` });
    await pg.locator('dialog button', { hasText: "My box isn't in the tree yet" }).click();
    await pg.screenshot({ path: `${SHOTS}claim-not-in-tree-${name}.png` });
    await pg.locator('dialog .claim-gate-none button', { hasText: 'Continue' }).click(); await pg.waitForSelector('dialog form');
    ok(await pg.locator('dialog form input[name=given_name]').count() === 1, `${name}: "not in the tree yet" lets them add a child`);
    await pg.locator('dialog .modal-head button').click(); await pg.waitForTimeout(200);
    await pg.locator('#panel .panel-top button', { hasText: /edit/i }).first().click(); await pg.waitForSelector('dialog form');
    ok(true, `${name}: not asked again in the same visit`);
    await ctx.close();
  }
  await b.close();
  console.log('claimgate ERRORS:', errors.length ? errors.join('; ') : 'none');
  if (errors.length) process.exit(1);
})();
