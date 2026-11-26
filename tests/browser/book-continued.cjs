// A story too long for its page carries on, automatically, on a "continued"
// page right after it: no words lost, page numbers in order, the note
// "Continued on the next page", and the same pages in the PDF.
const { chromium } = require('playwright'); const fs = require('fs');
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const ok = (c, m) => (c ? console.log('ok  ', m) : fail(m));
const seed = JSON.parse(fs.readFileSync(__dirname + '/../../site/data/seed.json'));
const ROOT = seed.people.find((p) => p.given_name === 'Bhanna Mal').id;
const KESAR = seed.people.find((p) => p.given_name === 'Kesar Mal').id;
const para = 'He kept the accounts of the family shop in a narrow book bound in red cloth, and every evening he read the day out loud to whoever was still awake. The grandchildren remembered the sound of it more than the numbers: the scratch of the pen, the long pause before a total, and the small nod when it came out right.';
const long = Array.from({ length: 30 }, (_, i) => `Part ${i + 1}. ${para}`).join('\n\n');
seed.person_details.find((d) => d.person_id === ROOT).notes = long;
const words = (t) => t.replace(/\s+/g, ' ').trim();
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
  await ctx.route('**/js/config.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.route('**/data/seed.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(seed) }));
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.addInitScript(() => { window.__FAKE_ROLE__ = 'admin'; window.__FAKE_CLAIMED__ = 1; window.__FAKE_NAME__ = 'Sunil Jaggi'; window.print = () => { window.__printed = true; }; try { for (const k of ['blessings-intro', 'blessingsIntro', 'founder-thanks']) localStorage.setItem(k, '1'); } catch {} });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => fail(e.message));
  await pg.goto('http://localhost:8765/#/book'); await pg.waitForTimeout(1200); await pg.keyboard.press('Escape');
  await pg.click('button:has-text("Build the book")'); await pg.waitForSelector('.bk-page .bp'); await pg.waitForTimeout(3000);
  const order = await pg.$$eval('.bk-page', (els) => els.map((e) => e.dataset.key));
  const root = `fam:${ROOT}`;
  const after = order.slice(order.indexOf(root) + 1).filter((x, i, a) => a.slice(0, i + 1).every((y) => y.startsWith(`more:${ROOT}`)));
  ok(after.length >= 2, `Bhanna Mal's very long story: ${after.length} continued pages right after his page`);
  ok(order.every((k, i) => !k.startsWith('more:') || [`fam:${k.split(':')[1]}`, `more:${k.split(':')[1]}`].some((p) => order[i - 1]?.startsWith(p))), 'every continued page comes right after its own page');
  const parts = await pg.$$eval(`.bk-page[data-key="${root}"] .bp-fam-text .bp-story, ${after.map((m) => `.bk-page[data-key="${m}"] .bp-story`).join(', ')}`, (els) => els.map((e) => e.textContent));
  ok(words(parts.join(' ')) === words(long), `every word appears once, in order, over ${parts.length} pages`);
  const pages = await pg.$$eval('.bk-page:not(.is-hidden)', (els) => els.map((e) => ({ k: e.dataset.key, no: e.querySelector('.bk-page-no')?.textContent, note: getComputedStyle(e.querySelector('.bp-cont-note') || document.body).display, issue: !!e.querySelector('.bk-issues')?.textContent.includes('too long') })));
  ok(pages.every((p, i) => p.no === `Page ${i + 1}`), 'page numbers run in order, continued pages included');
  ok(!pages.some((p) => p.issue), 'no page warns that its text is too long');
  const noteOn = (k) => pages.find((p) => p.k === k)?.note === 'block';
  ok(noteOn(root) && noteOn(after[0]) && !noteOn(after.at(-1)), '"Continued on the next page" on every part but the last');
  // Hiding the page hides its continued pages; showing brings them back.
  await pg.click(`.bk-page[data-key="${root}"] button:has-text("Hide")`); await pg.waitForTimeout(800);
  ok(!(await pg.$(`.bk-page[data-key^="more:${ROOT}"]`)), 'hiding a page hides its continued pages');
  await pg.click(`.bk-page[data-key="${root}"] button:has-text("Show")`); await pg.waitForTimeout(1500);
  ok(!!(await pg.$(`.bk-page[data-key^="more:${ROOT}"]`)), 'showing it again brings them back');
  ok(!(await pg.$(`.bk-page[data-key^="more:${KESAR}"]`)), 'a short story has no continued page');
  const vis = await pg.$$eval('.bk-page:not(.is-hidden)', (els) => els.length);
  await pg.click('button:has-text("Make the print-ready PDF")'); await pg.waitForTimeout(1500);
  const printed = await pg.$$eval('#bk-print .bp', (els) => els.map((e) => e.dataset.key));
  ok(printed.length === vis && printed.filter((k) => k.startsWith('more:')).length >= 2, `the PDF has all ${vis} pages, continued pages included`);
  await b.close();
})();
