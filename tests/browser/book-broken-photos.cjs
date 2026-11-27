// Book photos whose private links ran out (the page was left open for hours):
// the book maker warns about a photo that did not load, and "Rebuild from the
// tree" (or the photo failing to load) makes fresh links so the photos come back.
const { chromium } = require('playwright'); const fs = require('fs');
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const ok = (c, m) => (c ? console.log('ok  ', m) : fail(m));
const seed = JSON.parse(fs.readFileSync(__dirname + '/../../site/data/seed.json'));
// Every early person gets a "Family branch only" photo, served by private link.
for (const p of seed.people) { p.photo_path = `${p.id}/photo.jpg`; p.photo_visibility = 'branch'; }
let expired = true; // links handed out before this point no longer work
let firstGood = Infinity;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
  await ctx.route('**/js/config.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.route('**/data/seed.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(seed) }));
  await ctx.route('https://x.supabase.co/storage/v1/object/sign/**', (r) => {
    const n = +new URL(r.request().url()).searchParams.get('token');
    if (expired || n < firstGood) return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"InvalidJWT","message":"exp claim timestamp check failed"}' });
    return r.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(__dirname + '/book-photos/p1.jpg') });
  });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.addInitScript(() => { window.__FAKE_SIGNED__ = 1; window.__FAKE_ROLE__ = 'admin'; window.__FAKE_CLAIMED__ = 1; window.__FAKE_NAME__ = 'Sunil Jaggi'; window.print = () => { window.__printed = true; }; try { for (const k of ['blessings-intro', 'blessingsIntro', 'founder-thanks']) localStorage.setItem(k, '1'); } catch {} });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => fail(e.message));
  await pg.goto('http://localhost:8765/#/book'); await pg.waitForTimeout(1500); await pg.keyboard.press('Escape');
  await pg.click('button:has-text("Build the book")'); await pg.waitForSelector('.bk-page .bp'); await pg.waitForTimeout(2500);

  const cover = '.bk-page[data-key="cover"]';
  ok(await pg.$$eval(`${cover} .bp-cover-ph img`, (els) => els.length) >= 2, 'the cover has photos');
  ok(await pg.$$eval(`${cover} .bp-cover-ph.broken`, (els) => els.length) >= 2, 'photos that did not load are marked on the page');
  const sum = await pg.textContent('#bk-issue-sum');
  ok(/pages? to check/.test(sum) && !/No warnings/.test(sum), `the warnings list the pages with broken photos (${sum.slice(0, 40)}…)`);
  ok(/did not load/.test(await pg.textContent(`${cover} .bk-issues`)), 'the cover says a photo did not load');

  // New links work again: "Rebuild from the tree" makes fresh ones.
  expired = false;
  firstGood = await pg.evaluate(() => window.__FAKE_SIGNED__ + 1);
  await pg.click('button:has-text("Rebuild from the tree")'); await pg.waitForTimeout(2500);
  const loaded = await pg.$$eval(`${cover} .bp-cover-ph img`, (els) => els.every((i) => i.complete && i.naturalWidth > 0));
  ok(loaded, 'after Rebuild from the tree every cover photo loads');
  ok(!(await pg.$(`${cover} .bp-cover-ph.broken`)), 'no cover photo is marked broken');
  ok(/No warnings: every photo loaded/.test(await pg.textContent('#bk-issue-sum')), 'the warnings are clear again');

  // Links run out while the page stays open: the photos on screen are switched
  // to new links by themselves, without a rebuild.
  firstGood = Infinity;
  await pg.evaluate(async () => { const d = await import('./js/data.js'); window.__d = d; });
  const before = await pg.getAttribute(`${cover} .bp-cover-ph img`, 'src');
  firstGood = await pg.evaluate(() => window.__FAKE_SIGNED__ + 1);
  await pg.evaluate(() => window.__d.renewPhotoLinks({ force: true }));
  await pg.waitForTimeout(800);
  const after = await pg.getAttribute(`${cover} .bp-cover-ph img`, 'src');
  ok(after !== before && +new URL(after).searchParams.get('token') >= firstGood, 'renewed links replace the old ones on the screen');
  ok(await pg.$eval(`${cover} .bp-cover-ph img`, (i) => i.naturalWidth > 0), 'and the photo shows');
  await b.close();
})();
