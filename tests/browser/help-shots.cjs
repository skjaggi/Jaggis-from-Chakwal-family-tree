// Takes the pictures used in site/help.html, on a phone-sized screen, against
// the fake backend (sample data only: no real private details or photos).
//   tests/browser/run.sh shots   (or: node help-shots.cjs with the server running)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
// Gender and Living? are required in the person form; pick them when the seed left them blank.
const fillRequired = (pg) => pg.evaluate(() => {
  for (const [n, v] of [['gender', 'male'], ['is_living', 'true']]) {
    const s = document.querySelector(`dialog select[name=${n}]`);
    if (s && !s.value) { s.value = v; s.dispatchEvent(new Event('change')); }
  }
});
const OUT = path.join(__dirname, '../../site/img/help');
const SITE = 'http://localhost:8765/';
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../../site/data/seed.json'), 'utf8'));
const idOf = (given) => seed.people.find((p) => p.given_name === given).id;

async function context(b, role, extra = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
  await ctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.addInitScript(([r, n]) => { window.__FAKE_ROLE__ = r; window.__FAKE_NAME__ = n; }, [role, 'Asha']);
  await ctx.addInitScript((x) => Object.assign(window, x), extra);
  if (!extra.__WELCOME__) await ctx.addInitScript(() => { sessionStorage.setItem('claim-welcome', '1'); sessionStorage.setItem('claim-not-in-tree', '1'); });
  return ctx;
}
const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 78 });
const quiet = (pg) => pg.evaluate(() => { const t = document.getElementById('toast'); if (t) t.style.display = 'none'; });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const errors = [];
  const root = idOf('Bhanna Mal');
  const kesar = idOf('Kesar Mal');

  // Visitor: the tree, and the sign-in box
  let ctx = await context(b, 'anon');
  let pg = await ctx.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(SITE); await pg.waitForSelector('g.node'); await pg.waitForTimeout(600);
  await shot(pg, 'tree');
  await pg.locator('#nav button', { hasText: 'Sign in' }).click();
  await pg.fill('dialog input[name=email]', 'you@example.com');
  await pg.locator('dialog button', { hasText: 'I already have a code' }).click();
  await pg.fill('dialog input[name=code]', '123456');
  await pg.locator('dialog input[name=code]').blur();
  await shot(pg, 'sign-in');
  await ctx.close();

  // Start tree from: the line above the tree, with numbered labels.
  const tapashi = idOf('Tapashi Ram');
  const harbans = idOf('Harbans Lal');
  const label = (pg, side) => pg.evaluate((side) => {
    if (!side) for (const el of document.querySelectorAll('header')) el.style.visibility = 'hidden';
    if (side) { const g = document.querySelector('.start-gen'); if (g) g.style.marginLeft = '18px'; const c = document.getElementById('crumbs'); c.style.paddingLeft = '30px'; }
    const marks = [['.start-path', 1], ['#start-from', 2], ['.start-gen', 3], ['.tree-trail .gen', 4]];
    for (const [sel, n] of marks) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const m = document.createElement('div');
      m.textContent = n;
      Object.assign(m.style, { position: 'fixed', left: side ? `${r.left - 23}px` : `${r.left + Math.min(r.width, 160) / 2 - 10}px`, top: side ? `${r.top + r.height / 2 - 10}px` : `${r.top - 21}px`, width: '20px', height: '20px', borderRadius: '50%', background: '#c0392b', color: '#fff', font: '700 13px/20px system-ui, sans-serif', textAlign: 'center', zIndex: 99, boxShadow: '0 0 0 2px #fff' });
      document.body.append(m);
    }
  }, side);
  {
    const c2 = await b.newContext({ viewport: { width: 1200, height: 520 }, deviceScaleFactor: 2 });
    for (const [u, f] of [['https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', '/.vendor/d3.esm.js'], ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', '/fake-supabase.js']]) await c2.route(u, (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + f) }));
    await c2.route('**/js/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
    await c2.addInitScript(() => { window.__FAKE_ROLE__ = 'member'; window.__FAKE_NAME__ = 'Asha'; sessionStorage.setItem('claim-welcome', '1'); sessionStorage.setItem('claim-not-in-tree', '1'); try { for (const k of ['blessings-intro', 'blessingsIntro', 'founder-thanks']) localStorage.setItem(k, '1'); } catch {} });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(`${SITE}#/tree/${tapashi}`); await p2.waitForSelector('#start-from'); await p2.waitForTimeout(900);
    await p2.keyboard.press('Escape'); await p2.waitForTimeout(200);
    await p2.locator('#claim-banner button', { hasText: 'Later' }).click().catch(() => {});
    await p2.waitForTimeout(300);
    await label(p2);
    const top = await p2.$eval('#crumbs', (e) => e.getBoundingClientRect().top);
    await p2.screenshot({ path: path.join(OUT, 'start-from.jpg'), type: 'jpeg', quality: 80, clip: { x: 0, y: top - 22, width: 1080, height: 76 } });
    await c2.close();
  }
  ctx = await context(b, 'member');
  pg = await ctx.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(`${SITE}#/tree/${harbans}`); await pg.waitForSelector('#start-from'); await pg.waitForTimeout(900);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  await pg.locator('#claim-banner button', { hasText: 'Later' }).click().catch(() => {});
  await pg.waitForTimeout(300);
  await label(pg, true);
  await shot(pg, 'start-from-phone');
  await ctx.close();

  // Signed-in family member
  ctx = await context(b, 'member');
  pg = await ctx.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(`${SITE}#/tree/${root}?p=${kesar}`); await pg.waitForSelector('#panel .panel-name'); await pg.waitForTimeout(800);
  await shot(pg, 'person-card');
  await pg.locator('#panel').evaluate((el) => { el.scrollTop = el.querySelector('.panel-top').offsetTop - 120; });
  await pg.waitForTimeout(200);
  await shot(pg, 'card-actions');

  await pg.locator('#panel button', { hasText: 'Suggest an edit' }).click();
  await pg.waitForSelector('dialog form');
  await fillRequired(pg); await pg.fill('dialog [name=uncertainty]', 'Example: not sure of the exact year');
  await pg.locator('dialog [name=uncertainty]').scrollIntoViewIfNeeded();
  await shot(pg, 'suggest-edit');
  await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(600);
  await quiet(pg);
  await pg.locator('#panel').evaluate((el) => { el.scrollTop = 0; });
  await pg.waitForSelector('#panel .pending-mine:not([hidden])');
  await pg.locator('#panel .pending-mine summary').first().click();
  await pg.locator('#panel .pending-mine').scrollIntoViewIfNeeded();
  await shot(pg, 'pending-card');

  await pg.locator('#panel').evaluate((el) => { el.scrollTop = 0; });
  await pg.locator('#panel .photo-actions button').first().click();
  await pg.setInputFiles('dialog input[type=file]', path.join(__dirname, '../../site/img/arya-school-plaque-1933.jpg'));
  await pg.waitForSelector('dialog .photo-editor:not([hidden])');
  await pg.locator('dialog .zoom-row input').fill('1.6');
  await pg.locator('dialog canvas.photo-frame').scrollIntoViewIfNeeded();
  await shot(pg, 'photo-center');
  await pg.locator('dialog button', { hasText: 'Cancel' }).click();

  await pg.goto(`${SITE}#/invite`); await pg.waitForSelector('.invite-form');
  await pg.fill('.invite-form input[name=email]', 'asha.cousin@example.com');
  await pg.fill('.invite-form input[name=display_name]', 'Asha Example');
  await pg.fill('.invite-form .picker input', 'Harbans'); await pg.locator('.invite-form .pick-list button').first().click();
  await shot(pg, 'invite-form');
  await pg.locator('.invite-form button[type=submit]').click(); await pg.waitForSelector('.send-invite');
  await quiet(pg);
  await pg.locator('.send-invite').first().scrollIntoViewIfNeeded();
  await shot(pg, 'invite-sent');

  await pg.goto(`${SITE}#/mine`); await pg.waitForSelector('.history');
  await pg.locator('#page details summary').first().click();
  await shot(pg, 'my-changes');

  await pg.goto(`${SITE}#/dashboard`); await pg.waitForSelector('.stats .stat'); await pg.waitForTimeout(400);
  await shot(pg, 'dashboard');
  await pg.locator('.dash-grid').scrollIntoViewIfNeeded();
  await pg.locator('.dash-table .row-toggle').first().click();
  await shot(pg, 'dashboard-attention');

  await pg.goto(`${SITE}#/outline/${root}`); await pg.waitForTimeout(600);
  await shot(pg, 'list');
  await ctx.close();

  // Just signed in, invitation linked to a box: "Is this you?"
  ctx = await context(b, 'member', { __WELCOME__: 1 });
  pg = await ctx.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(SITE); await pg.waitForSelector('dialog .claim-gate'); await pg.waitForTimeout(600);
  await shot(pg, 'claim-welcome');
  await ctx.close();

  // A member with a claimed box and some badges: the Blessings page
  ctx = await context(b, 'owner', { __FAKE_BADGES__: 1, __FAKE_BONUS__: 25 });
  pg = await ctx.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(`${SITE}#/blessings`); await pg.waitForSelector('.board li'); await pg.waitForTimeout(800);
  // Close the once-a-month "Family Historian" congratulations so the page shows.
  if (await pg.locator('dialog[open]').count()) { await pg.locator('dialog[open] .modal-head button').click(); await pg.waitForTimeout(300); }
  await shot(pg, 'blessings');
  await ctx.close();
  await b.close();
  console.log('help shots:', fs.readdirSync(OUT).join(', '), '| ERRORS:', errors.length ? errors.join('; ') : 'none');
})();
