// Family book maker (admins only): build a book from the tree, edit text,
// add a quote page, hide and move pages, see warnings, and make the PDF.
// SHOTS_DIR=dir saves preview pictures and a sample PDF.
const { chromium, devices } = require('playwright'); const fs = require('fs');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const seed = JSON.parse(fs.readFileSync(__dirname + '/../../site/data/seed.json'));
// Sample portraits for a few early ancestors (made-up pictures, test only).
const sample = ['p1.jpg', 'p3.jpg', 'p2.jpg', 'p4.jpg'];
let n = 0;
for (const p of [...seed.people].sort((a, b) => (a.generation ?? 99) - (b.generation ?? 99))) {
  if (p.photo_path) continue;
  // Most people get a sample portrait; a few stay without one (initials).
  if (n++ % 5 !== 3) p.photo_path = `img/test/${sample[n % 4]}`;
}
async function open(b, opts, init, hash = '#/book') {
  const ctx = await b.newContext(opts);
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
  await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.route('**/data/seed.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(seed) }));
  await ctx.route('**/img/test/*', r => r.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(__dirname + '/book-photos/' + r.request().url().split('/').pop()) }));
  // Without the internet (CI) the web fonts fall back to the built-in ones.
  if (!process.env.BOOK_FONTS) await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.addInitScript(init);
  await ctx.addInitScript(() => { try { for (const k of ['blessings-intro', 'blessingsIntro', 'founder-thanks']) localStorage.setItem(k, '1'); } catch {} window.print = () => { window.__printed = true; }; });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => fail(e.message)); pg.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
  await pg.goto('http://localhost:8765/' + hash); await pg.waitForTimeout(1200);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  return { ctx, pg };
}
const proxy = process.env.BOOK_FONTS && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' } } : {};
(async () => {
  const b = await chromium.launch(proxy);
  // A member sees no Book menu and no book maker.
  {
    const { ctx, pg } = await open(b, { viewport: { width: 1280, height: 800 } }, () => { window.__FAKE_ROLE__ = 'member'; });
    if (await pg.$('[data-nav="book"]')) fail('member sees the Book menu');
    if (!/being tested by the admins/.test(await pg.textContent('#page'))) fail('member can open the book maker');
    await ctx.close();
  }
  const templates = (process.env.BOOK_TEMPLATES || 'heritage').split(',');
  for (const tpl of templates) {
    const { ctx, pg } = await open(b, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: OUT ? 2 : 1 }, () => { window.__FAKE_ROLE__ = 'admin'; window.__FAKE_CLAIMED__ = 1; window.__FAKE_NAME__ = 'Sunil Jaggi'; });
    if (!await pg.$('[data-nav="book"]')) fail('admin has no Book menu');
    await pg.check(`input[name="template"][value="${tpl}"]`);
    if (OUT && tpl === templates[0]) await pg.screenshot({ path: `${OUT}1-new-book.png`, fullPage: false });
    await pg.click('button:has-text("Build the book")');
    await pg.waitForSelector('.bk-page .bp').catch(async (e) => { await pg.screenshot({ path: '/tmp/claude-0/fail.png' }); console.log(await pg.evaluate(() => [location.hash, document.querySelectorAll('.bk-page .bp').length, document.body.innerText.slice(0, 400)])); throw e; }); await pg.waitForTimeout(2000);
    const pages = await pg.$$eval('.bk-page', (els) => els.map((e) => e.dataset.key));
    for (const k of ['cover', 'intro', 'chart:1', 'gen:1', 'end']) if (!pages.includes(k)) fail(`${tpl}: no ${k} page`);
    const famPages = pages.filter((k) => k.startsWith('fam:'));
    if (famPages.length < 20) fail(`${tpl}: only ${famPages.length} person pages`);
    // Everyone in the tree descends from Bhanna Mal, so the chart lists all the blood line.
    const rows = await pg.$$eval('.bp-row', (els) => els.length);
    if (rows < 40) fail(`${tpl}: chart has ${rows} rows`);
    // The 1933 plaque photo is too small for a 12 x 12 page: a warning shows.
    const kesar = seed.people.find((p) => p.given_name === 'Kesar Mal');
    await pg.waitForTimeout(800);
    const warn = await pg.textContent(`.bk-page[data-key="fam:${kesar.id}"] .bk-issues`);
    if (!/print blurry/.test(warn)) fail(`${tpl}: no low-resolution warning for the plaque photo (${warn})`);
    if (!/to check/.test(await pg.textContent('#bk-issue-sum'))) fail(`${tpl}: no warning summary`);
    if (OUT) await pg.screenshot({ path: `${OUT}${tpl}-2-editor.png` });
    // Generation pages carry a photo tree with everyone in that generation,
    // each generation in a different style.
    const gen5 = seed.people.filter((p) => p.generation === 5 && seed.parent_child.some((l) => l.child_id === p.id)).length; // born into the family
    const nodes = await pg.$$eval('.bk-page[data-key="gen:5"] .pt-kids .pt-node', (els) => els.length);
    if (nodes !== gen5) fail(`${tpl}: Generation 5 photo tree has ${nodes} people, expected ${gen5}`);
    const styles = await pg.$$eval('.bk-page[data-key^="gen:"] .bp-ptree', (els) => els.map((e) => [...e.classList].find((c) => c.startsWith('pt-'))));
    if (new Set(styles).size !== styles.length) fail(`${tpl}: generation trees repeat a style (${styles})`);
    if (await pg.$('.bk-page[data-key^="gen:"] .bp.has-issue')) fail(`${tpl}: a photo tree does not fit its page`);
    // Person pages take turns between layouts: no two in a row look the same.
    const lays = await pg.$$eval('.bk-page[data-key^="fam:"] .bp-fam', (els) => els.map((e) => [...e.classList].find((c) => c.startsWith('lay-'))));
    if (lays.some((l, i) => i && l === lays[i - 1])) fail(`${tpl}: two person pages in a row share a layout`);
    // Change one page's layout, and add a text box and a photo to a page.
    await pg.selectOption(`.bk-page[data-key="${famPages[0]}"] .bk-mini-sel`, 'portrait'); await pg.waitForTimeout(300);
    if (!await pg.$(`.bk-page[data-key="${famPages[0]}"] .bp-fam.lay-portrait`)) fail(`${tpl}: layout change did not apply`);
    await pg.click(`.bk-page[data-key="${famPages[3]}"] button:has-text("+ Text")`); await pg.waitForTimeout(300);
    await pg.keyboard.type('Remembered for his kindness to every guest. (sample)');
    await pg.click('.bk-count'); await pg.waitForTimeout(300);
    await pg.click(`.bk-page[data-key="${famPages[3]}"] button:has-text("+ Photo")`); await pg.waitForTimeout(300);
    await pg.fill('.modal input[type="search"]', 'Bir'); await pg.waitForTimeout(200);
    await pg.click('.bk-photo-pick'); await pg.waitForTimeout(400);
    await pg.waitForTimeout(900);
    const saved3 = await pg.evaluate((k) => window.__db.book_drafts[0].data.edits[k]?.adds?.length, famPages[3]);
    if (saved3 !== 2) fail(`${tpl}: added photo and text not saved (${saved3})`);
    if (!await pg.$(`.bk-page[data-key="${famPages[3]}"] .bp-add-ph img`)) fail(`${tpl}: added photo not on the page`);
    if (!/kindness/.test(await pg.textContent(`.bk-page[data-key="${famPages[3]}"] .bp-add-text`))) fail(`${tpl}: added text not on the page`);
    // Edit a story on the first ancestor's page.
    const first = famPages[0];
    const story = pg.locator(`.bk-page[data-key="${first}"] .bp-story`);
    await story.click(); await pg.keyboard.press('Control+A'); await pg.keyboard.type('He came to Chakwal as a young man and built the timber business that fed the family for three generations.');
    await pg.click('h1, .bk-count'); await pg.waitForTimeout(1200);
    const saved = await pg.evaluate((k) => window.__db.book_drafts[0].data.edits[k]?.f?.story, first);
    if (!/timber business/.test(saved || '')) fail(`${tpl}: edited story was not saved (${saved})`);
    // Too much text: a warning; then put the tree's words back.
    const second = famPages[2];
    const before = await pg.textContent(`.bk-page[data-key="${second}"] .bp-story`);
    const typeInto = (k, t) => pg.evaluate(([k, t]) => { const el = document.querySelector(`.bk-page[data-key="${k}"] .bp-story`); el.focus(); el.textContent = t; el.dispatchEvent(new Event('input')); el.blur(); }, [k, t]);
    await typeInto(second, 'A long memory that keeps going. '.repeat(320));
    await pg.waitForTimeout(500);
    if (!/too long/.test(await pg.textContent(`.bk-page[data-key="${second}"] .bk-issues`))) fail(`${tpl}: no overflow warning`);
    await typeInto(second, before);
    await pg.waitForTimeout(300);
    if (/too long/.test(await pg.textContent(`.bk-page[data-key="${second}"] .bk-issues`))) fail(`${tpl}: overflow warning stays after shortening`);
    // Add a quote page after the intro, in Punjabi.
    await pg.click('.bk-page[data-key="intro"] button:has-text("+ Page after")');
    await pg.click('.bk-add-choice:has-text("Quote page")'); await pg.waitForTimeout(400);
    const order1 = await pg.$$eval('.bk-page', (els) => els.map((e) => e.dataset.key));
    const qkey = order1[order1.indexOf('intro') + 1];
    if (!qkey?.startsWith('x:')) fail(`${tpl}: quote page not after the intro`);
    await pg.locator(`.bk-page[data-key="${qkey}"] .bp-big-quote`).click();
    await pg.keyboard.type('ਘਰ ਦੀ ਅੱਧੀ, ਬਾਹਰ ਦੀ ਸਾਰੀ ਨਾਲੋਂ ਚੰਗੀ');
    await pg.locator(`.bk-page[data-key="${qkey}"] .bp-quote-mean`).click();
    await pg.keyboard.type('Half a roti at home is better than a whole one away.');
    await pg.locator(`.bk-page[data-key="${qkey}"] .bp-quote-by`).click();
    await pg.keyboard.type('A saying Biji used often (sample)');
    await pg.click('.bk-count'); await pg.waitForTimeout(300);
    // Move it down one and back; hide the back page and show it again.
    await pg.click(`.bk-page[data-key="${qkey}"] button[aria-label="Move page down"]`); await pg.waitForTimeout(300);
    const order2 = await pg.$$eval('.bk-page', (els) => els.map((e) => e.dataset.key));
    if (order2.indexOf(qkey) !== order1.indexOf(qkey) + 1) fail(`${tpl}: move down did not work`);
    await pg.click(`.bk-page[data-key="${qkey}"] button[aria-label="Move page up"]`); await pg.waitForTimeout(300);
    await pg.click('.bk-page[data-key="end"] button:has-text("Hide")'); await pg.waitForTimeout(300);
    if (!await pg.$('.bk-page.is-hidden[data-key="end"]')) fail(`${tpl}: hide did not work`);
    await pg.click('.bk-page[data-key="end"] button:has-text("Show")'); await pg.waitForTimeout(500);
    // The edits survive a reload of the page.
    await pg.waitForTimeout(1000);
    const bookId = await pg.evaluate(() => window.__db.book_drafts[0].id);
    // Close-ups of single pages.
    if (OUT) {
      const shot = async (k, name) => { const el = await pg.$(`.bk-page[data-key="${k}"] .bk-scale`); if (el) { await el.scrollIntoViewIfNeeded(); await pg.waitForTimeout(300); await el.screenshot({ path: `${OUT}${tpl}-${name}.png` }); } };
      await shot('cover', '3-cover');
      await shot('intro', '4-about');
      await shot('chart:1', '5-tree-chart');
      for (const g of [1, 2, 3, 4, 5, 6]) await shot(`gen:${g}`, `6-generation-${g}`);
      for (const [i, k] of famPages.slice(0, 6).entries()) await shot(k, `13-person-layout-${i + 1}`);
      await shot(`fam:${kesar.id}`, '7-person-low-res-warning');
      await shot(first, '8-person-edited-story');
      const withSpouse = famPages.find((k) => { const id = k.slice(4); return seed.unions.some((u) => u.partner_a === id || u.partner_b === id) && seed.people.find((p) => p.id === id).photo_path?.startsWith('img/test'); }) || famPages[5];
      await shot(withSpouse, '9-couple');
      await shot(qkey, '10-quote-punjabi');
      await shot('end', '11-back-page');
      // The whole page card with its toolbar and a warning.
      const card = await pg.$(`.bk-page[data-key="fam:${kesar.id}"]`);
      await card.scrollIntoViewIfNeeded(); await pg.waitForTimeout(200);
      await pg.screenshot({ path: `${OUT}${tpl}-12-editor-warning.png` });
    }
    // Make the PDF: the print copy has one page per visible page at 12 x 12 in.
    await pg.click('button:has-text("Make the print-ready PDF")');
    await pg.waitForFunction(() => window.__printed, null, { timeout: 15000 });
    const printed = await pg.$$eval('#bk-print .bp', (els) => els.length);
    const visible = await pg.$$eval('.bk-page:not(.is-hidden)', (els) => els.length);
    if (printed !== visible) fail(`${tpl}: printed ${printed} pages, ${visible} visible`);
    if (await pg.$('#bk-print [contenteditable]')) fail(`${tpl}: print copy is editable`);
    if (OUT) {
      await pg.emulateMedia({ media: 'print' });
      await pg.pdf({ path: `${OUT}${tpl}-sample-book.pdf`, preferCSSPageSize: true, printBackground: true });
      await pg.emulateMedia({ media: 'screen' });
    }
    await pg.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    // Re-open: the edits come back from the saved draft.
    await pg.goto(`http://localhost:8765/#/book`); await pg.waitForTimeout(600);
    if (!(await pg.textContent('.bk-list')).includes('Jaggis of Chakwal book')) fail(`${tpl}: book not in the list`);
    if (OUT && tpl === templates[0]) await pg.screenshot({ path: `${OUT}0-book-list.png` });
    await pg.click(`.bk-list a[href="#/book?b=${bookId}"]`); await pg.waitForSelector('.bk-page .bp'); await pg.waitForTimeout(500);
    if (!(await pg.textContent(`.bk-page[data-key="${first}"] .bp-story`)).includes('timber business')) fail(`${tpl}: edit lost after re-opening`);
    await ctx.close();
  }
  // Phone: the editor still works on a narrow screen.
  {
    const { ctx, pg } = await open(b, devices['iPhone 13'], () => { window.__FAKE_ROLE__ = 'admin'; window.__FAKE_CLAIMED__ = 1; });
    await pg.click('button:has-text("Build the book")');
    await pg.waitForSelector('.bk-page .bp'); await pg.waitForTimeout(1500);
    const over = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('#page').scrollWidth > innerWidth + 1);
    if (over) fail('phone: book editor scrolls sideways');
    if (OUT) {
      await pg.$eval('.bk-page[data-key^="fam:"]', (e) => e.scrollIntoView());
      await pg.waitForTimeout(300);
      await pg.screenshot({ path: `${OUT}phone-editor.png` });
    }
    await ctx.close();
  }
  await b.close();
  if (!process.exitCode) console.log('book: ok');
})();
