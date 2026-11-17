// Library previews against the fake backend (sample links only), plus the
// Help page picture img/help/library-suggest.jpg.
//   (server running on 8765) SHOTS_DIR=/some/dir [HELP_SHOT=1] node library-shots.cjs
// Also runs as a test in run.sh.
const { chromium, devices } = require('playwright'); const fs = require('fs'); const path = require('path');
const OUT = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const HELP = path.join(__dirname, '../../site/img/help');
const SITE = 'http://localhost:8765/';
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../../site/data/seed.json'), 'utf8'));
const idOf = (given) => seed.people.find((p) => p.given_name === given).id;
const thumb = fs.readFileSync(path.join(__dirname, '../../site/img/arya-school-plaque-1933.jpg'));

async function context(b, { role = 'admin', phone = false, theme = 'light' } = {}) {
  const ctx = await b.newContext(phone ? devices['iPhone 13'] : { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
  await ctx.route('**/js/config.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.route('https://i.ytimg.com/**', (r) => r.fulfill({ contentType: 'image/jpeg', body: thumb }));
  await ctx.route('https://www.youtube.com/oembed**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'Chakwal: the old town and its families (sample video)', author_name: 'Sample channel' }) }));
  await ctx.addInitScript(([r, t]) => { window.__FAKE_ROLE__ = r; window.__FAKE_CLAIMED__ = 1; window.__FAKE_LIBRARY__ = 1; window.__FAKE_NAME__ = r === 'admin' ? 'Sunil Jaggi' : 'Asha'; try { localStorage.setItem('theme', t); } catch {} sessionStorage.setItem('claim-welcome', '1'); }, [role, theme]);
  return ctx;
}
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

(async () => {
  const b = await chromium.launch();
  const errors = [];
  for (const [name, opts] of [['desktop', {}], ['desktop-dark', { theme: 'dark' }], ['phone', { phone: true, role: 'member' }]]) {
    const ctx = await context(b, opts); const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
    await pg.goto(SITE + '#/library'); await pg.waitForSelector('.lib-card'); await pg.waitForTimeout(600);
    await pg.screenshot({ path: OUT + `library-${name}.png`, fullPage: name !== 'phone' });
    if (name === 'desktop') {
      ok(await pg.locator('.lib-grid .lib-card').count() >= 6, 'library shows approved links');
      await pg.click('.lib-topics button:has-text("Partition")');
      ok(await pg.locator('.lib-grid .lib-card').count() === 1, 'topic filter');
      await pg.click('.lib-topics button:has-text("All")');
      await pg.fill('.lib-search', 'vahali');
      ok(await pg.locator('.lib-grid .lib-card').count() === 1, 'search');
      await pg.fill('.lib-search', '');
      await pg.locator('.lib-play').first().click();
      ok(await pg.locator('.lib-media iframe[src*="youtube-nocookie.com/embed/SAMPLEvid01"]').count() === 1, 'video plays on the page');
      // Review page: the suggested link
      await pg.goto(SITE + '#/review'); await pg.waitForSelector('.lib-review'); await pg.waitForTimeout(400);
      await pg.locator('.lib-review').screenshot({ path: OUT + 'library-review.png' });
      await pg.click('.lib-review button:has-text("Approve")'); await pg.waitForTimeout(300);
      ok(await pg.evaluate(() => window.__db.library_links.every((l) => l.status === 'approved')), 'admin approves a suggestion');
      // Person card
      await pg.goto(SITE + `#/tree/${idOf('Bhanna Mal')}?p=${idOf('Bhanna Mal')}`); await pg.waitForSelector('.lib-person:not([hidden])'); await pg.waitForTimeout(400);
      await pg.locator('.lib-person').scrollIntoViewIfNeeded(); await pg.waitForTimeout(200);
      await pg.screenshot({ path: OUT + 'library-person-card.png' });
      ok(await pg.locator('.lib-person li').count() === 1, 'tagged link shows on the person card');
    }
    if (name === 'phone') {
      ok(await pg.locator('.lib-mine .lib-card').count() === 1, 'member sees own waiting suggestion');
      await pg.click('button:has-text("Suggest a link")');
      await pg.fill('dialog input[name=url]', 'https://youtu.be/SAMPLEvid09?si=abc');
      await pg.locator('dialog input[name=url]').dispatchEvent('change'); await pg.waitForTimeout(500);
      ok((await pg.inputValue('dialog input[name=title]')).includes('sample video'), 'YouTube title filled in');
      await pg.selectOption('dialog select[name=topic]', 'Chakwal history');
      await pg.fill('dialog textarea[name=note]', 'Dadaji spoke about this street.');
      await pg.fill('dialog .picker input', 'Kesar'); await pg.waitForTimeout(200); await pg.click('dialog .pick-list button >> nth=0');
      await pg.waitForTimeout(300);
      await pg.screenshot({ path: OUT + 'library-suggest-phone.png' });
      if (process.env.HELP_SHOT) {
      fs.mkdirSync(HELP, { recursive: true });
      await pg.setViewportSize({ width: 390, height: 760 });
      await pg.evaluate(() => { for (const el of document.querySelectorAll('dialog, dialog *')) if (el.scrollTop) el.scrollTop = 0; }); await pg.waitForTimeout(200);
      await pg.screenshot({ path: path.join(HELP, 'library-suggest.jpg'), type: 'jpeg', quality: 78 });
      }
      await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(400);
      const row = await pg.evaluate(() => window.__db.library_links.at(-1));
      ok(row.url === 'https://www.youtube.com/watch?v=SAMPLEvid09' && row.status === 'pending' && row.person_ids.length === 1, 'member suggestion saved, waiting, tidy link, person tagged');
    }
    await ctx.close();
  }
  // Signed-out visitor
  const ctx = await context(b, { role: 'anon' }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(SITE + '#/library'); await pg.waitForSelector('.lib-card');
  ok(await pg.locator('button:has-text("Sign in to suggest a link")').count() === 1, 'visitors are asked to sign in to suggest');
  await ctx.close();
  console.log('library ERRORS:', errors.length ? errors.join('\n') : 'none');
  if (errors.length) process.exitCode = 1;
  await b.close();
})();
