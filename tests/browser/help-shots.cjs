// Takes the pictures used in site/help.html, on a phone-sized screen, against
// the fake backend (sample data only: no real private details or photos).
//   tests/browser/run.sh shots   (or: node help-shots.cjs with the server running)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, '../../site/img/help');
const SITE = 'http://localhost:8765/';
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../../site/data/seed.json'), 'utf8'));
const idOf = (given) => seed.people.find((p) => p.given_name === given).id;

async function context(b, role) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
  await ctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.addInitScript(([r, n]) => { window.__FAKE_ROLE__ = r; window.__FAKE_NAME__ = n; }, [role, 'Asha']);
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

  // Signed-in family member
  ctx = await context(b, 'member');
  pg = await ctx.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(`${SITE}#/tree/${root}?p=${kesar}`); await pg.waitForSelector('#panel .panel-name'); await pg.waitForTimeout(800);
  await shot(pg, 'person-card');
  await pg.locator('#panel').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await pg.waitForTimeout(200);
  await shot(pg, 'card-actions');

  await pg.locator('#panel button', { hasText: 'Suggest an edit' }).click();
  await pg.waitForSelector('dialog form');
  await pg.fill('dialog [name=uncertainty]', 'Example: not sure of the exact year');
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

  await pg.goto(`${SITE}#/outline/${root}`); await pg.waitForTimeout(600);
  await shot(pg, 'list');
  await ctx.close();
  await b.close();
  console.log('help shots:', fs.readdirSync(OUT).join(', '), '| ERRORS:', errors.length ? errors.join('; ') : 'none');
})();
