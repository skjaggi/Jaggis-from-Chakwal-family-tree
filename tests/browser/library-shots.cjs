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
  await ctx.route('https://www.google.com/s2/favicons**', (r) => r.fulfill({ contentType: 'image/jpeg', body: thumb }));
  await ctx.route('https://example.com/pictures/**', (r) => r.fulfill({ contentType: 'image/jpeg', body: thumb }));
  await ctx.route('https://www.youtube.com/oembed**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'Chakwal: the old town and its families (sample video)', author_name: 'Sample channel' }) }));
  await ctx.addInitScript(([r, t]) => { window.__FAKE_ROLE__ = r; window.__FAKE_CLAIMED__ = 1; window.__FAKE_LIBRARY__ = 1; window.__FAKE_NAME__ = r === 'admin' ? 'Sunil Jaggi' : 'Asha'; try { localStorage.setItem('theme', t); } catch {} sessionStorage.setItem('claim-welcome', '1'); }, [role, theme]);
  return ctx;
}
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

(async () => {
  const b = await chromium.launch();
  const errors = [];
  for (const [name, opts] of [['desktop', {}], ['desktop-dark', { theme: 'dark' }], ['phone', { phone: true, role: 'member' }]]) {
    const ctx = await context(b, opts); const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message)); pg.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
    await pg.goto(SITE + '#/library'); await pg.waitForSelector('.lib-card'); await pg.waitForTimeout(600);
    await pg.screenshot({ path: OUT + `library-${name}.png`, fullPage: name !== 'phone' });
    if (name === 'desktop') {
      ok(await pg.locator('.lib-grid .lib-card').count() >= 6, 'library shows approved links');
      // Older links: the admin's visit fills in pictures the websites offer; the rest show their headline.
      await pg.waitForFunction(() => window.__db.library_links.some((l) => l.url.includes('1353858') && l.image_url));
      ok(true, 'older link without a picture gets one on the admin\'s visit');
      await pg.waitForSelector('.lib-card:has(a[href*="1353858"]) .lib-media:not(.no-thumb) img');
      ok(true, 'its card shows the new picture');
      ok(await pg.locator('.lib-card:has(a[href*="vahali"]) .lib-media.no-thumb .lib-hl-title').textContent() === 'Vahali State: a gem in the Salt Range', 'no picture: the headline shows instead');
      ok(await pg.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('library-pictures-tried') || '{}')).length >= 2), 'links already looked up are remembered');
      await pg.click('.lib-topics button:has-text("Partition")');
      ok(await pg.locator('.lib-grid .lib-card').count() === 1, 'topic filter');
      await pg.click('.lib-topics button:has-text("All")');
      await pg.fill('.lib-search', 'vahali');
      ok(await pg.locator('.lib-grid .lib-card').count() === 1, 'search');
      await pg.fill('.lib-search', '');
      // Adding a link that is already there: the message shows above the form, naming the card.
      await pg.click('button:has-text("Add a link")');
      await pg.fill('dialog input[name=url]', 'https://www.dawn.com/news/1353858');
      await pg.fill('dialog input[name=title]', 'Again');
      await pg.click('dialog button[type=submit]');
      await pg.waitForSelector('dialog #toast.show');
      ok((await pg.textContent('dialog #toast')).includes('already in the Library as'), 'duplicate link: message shows inside the open form');
      await pg.click('dialog .modal-head button'); await pg.click('dialog button:has-text("Discard")');
      // Topic suggested from the title; a new topic becomes a new button.
      await pg.click('button:has-text("Add a link")');
      await pg.fill('dialog input[name=url]', 'https://example.com/refugees');
      await pg.fill('dialog input[name=title]', 'Refugee trains of 1947');
      ok(await pg.inputValue('dialog select[name=topic]') === 'Partition 1947', 'topic suggested from the title');
      await pg.selectOption('dialog select[name=topic]', '__new');
      await pg.fill('dialog input[name=new_topic]', 'moti Mahal and butter chicken');
      await pg.click('dialog button[type=submit]'); await pg.waitForSelector('dialog', { state: 'detached' });
      await pg.waitForSelector('.lib-topics button:has-text("Moti Mahal and butter chicken")');
      ok(true, 'new topic becomes a button');
      // Another site's link: its own preview picture and title fill in by themselves.
      await pg.click('button:has-text("Add a link")');
      await pg.fill('dialog input[name=url]', 'https://example.com/news/old-chakwal');
      await pg.locator('dialog input[name=url]').dispatchEvent('change');
      await pg.waitForSelector('dialog .lib-form-preview img');
      ok(await pg.inputValue('dialog input[name=image_url]') === 'https://example.com/pictures/old-chakwal.jpg', 'article link: preview picture filled in');
      ok((await pg.inputValue('dialog input[name=title]')).includes('Old Chakwal remembered'), 'article link: title filled in');
      await pg.locator('dialog .lib-form-preview').screenshot({ path: OUT + 'library-link-preview.png' });
      // A different link with no picture: the first link's picture is not kept.
      await pg.fill('dialog input[name=url]', 'https://example.org/plain-page');
      await pg.locator('dialog input[name=url]').dispatchEvent('change'); await pg.waitForTimeout(300);
      ok(await pg.inputValue('dialog input[name=image_url]') === '', 'changed link: old picture cleared');
      await pg.fill('dialog input[name=url]', 'https://example.com/news/old-chakwal');
      await pg.locator('dialog input[name=url]').dispatchEvent('change'); await pg.waitForSelector('dialog .lib-form-preview img');
      await pg.click('dialog button[type=submit]'); await pg.waitForSelector('dialog', { state: 'detached' });
      ok(await pg.evaluate(() => window.__db.library_links.some((l) => l.url.includes('old-chakwal') && l.image_url === 'https://example.com/pictures/old-chakwal.jpg')), 'article link saved with its picture');
      await pg.waitForSelector('.lib-card img[src="https://example.com/pictures/old-chakwal.jpg"]');
      ok(true, 'article card shows its picture');
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
      // Suggest from a person's card, so that person is tagged already.
      await pg.goto(SITE + `#/tree/${idOf('Bhanna Mal')}?p=${idOf('Kesar Mal')}`); await pg.waitForSelector('.lib-person:not([hidden])');
      await pg.click('.lib-person button:has-text("Add a link about")');
      await pg.waitForSelector('dialog .lib-chip');
      await pg.fill('dialog input[name=url]', 'https://youtu.be/SAMPLEvid09?si=abc');
      await pg.locator('dialog input[name=url]').dispatchEvent('change'); await pg.waitForTimeout(500);
      ok((await pg.inputValue('dialog input[name=title]')).includes('sample video'), 'YouTube title filled in');
      await pg.selectOption('dialog select[name=topic]', 'Chakwal history');
      await pg.fill('dialog textarea[name=note]', 'Dadaji spoke about this street.');
      await pg.waitForTimeout(300);
      await pg.screenshot({ path: OUT + 'library-suggest-phone.png' });
      if (process.env.HELP_SHOT) {
      fs.mkdirSync(HELP, { recursive: true });
      await pg.setViewportSize({ width: 390, height: 760 });
      await pg.evaluate(() => { for (const el of document.querySelectorAll('dialog, dialog *')) if (el.scrollTop) el.scrollTop = 0; }); await pg.waitForTimeout(200);
      await pg.screenshot({ path: path.join(HELP, 'library-suggest.jpg'), type: 'jpeg', quality: 78 });
      }
      await pg.click('dialog button[type=submit]');
      await pg.waitForFunction(() => window.__db.library_links.some((l) => l.url.includes('SAMPLEvid09')), null, { timeout: 5000 }).catch(() => {});
      const row = await pg.evaluate(() => window.__db.library_links.find((l) => l.url.includes('SAMPLEvid09')) || {});
      if (!row.url) console.log('saved rows:', JSON.stringify(await pg.evaluate(() => window.__db.library_links.map((l) => l.url))));
      ok(row.url === 'https://www.youtube.com/watch?v=SAMPLEvid09' && row.status === 'pending' && row.person_ids.length === 1, 'member suggestion saved, waiting, tidy link, person tagged');
    }
    await ctx.close();
  }
  // Signed-out visitor
  const ctx = await context(b, { role: 'anon' }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(SITE + '#/library'); await pg.waitForSelector('#page h1');
  // The Library is for signed-in family members only.
  ok(/Please sign in/.test(await pg.textContent('#page h1')), 'visitors are asked to sign in to see the Library');
  ok(await pg.locator('.lib-card').count() === 0, 'visitors see no Library links');
  ok(await pg.locator('#nav [data-nav=library]').count() === 0, 'visitors have no Library menu item');
  await ctx.close();
  console.log('library ERRORS:', errors.length ? errors.join('\n') : 'none');
  if (errors.length) process.exitCode = 1;
  await b.close();
})();
