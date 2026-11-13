const { chromium, devices } = require('playwright');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const fs = require('fs');
const V = __dirname + '/.vendor/';
async function setup(ctx) {
  // Preview mode: no database, whatever site/js/config.js says.
  await ctx.route('**/js/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: '', supabaseAnonKey: '', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(V + 'd3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(V + 'supabase.esm.js') }));
}
(async () => {
  const b = await chromium.launch();
  const errors = [];
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', devices['iPhone 13']]]) {
    const ctx = await b.newContext(opts); await setup(ctx);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push(name + ': ' + e.message));
    pg.on('console', m => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
    await pg.goto('http://localhost:8765/');
    await pg.waitForSelector('g.node');
    console.log(name, 'nodes shown:', await pg.locator('g.node').count(), 'hash', await pg.evaluate(() => location.hash.slice(0, 30)));
    await pg.waitForTimeout(600); await pg.screenshot({ path: `${SHOTS}${name}-1-tree.png` });
    await pg.fill('#search', 'sunil');
    await pg.waitForSelector('#search-results li button');
    console.log(name, 'search:', await pg.locator('#search-results li').first().innerText());
    await pg.keyboard.press('Enter');
    await pg.waitForSelector('#panel:not([hidden]) .panel-name');
    console.log(name, 'panel:', await pg.locator('.panel-name').innerText(), '| nodes now', await pg.locator('g.node').count());
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: `${SHOTS}${name}-2-search.png` });
    // spelling variant
    await pg.fill('#search', 'ram prakash');
    await pg.waitForSelector('#search-results li button');
    console.log(name, 'fuzzy:', await pg.locator('#search-results li').first().innerText());
    await pg.keyboard.press('Escape');
    await pg.locator('.panel-actions button', { hasText: 'Show tree from here' }).click();
    await pg.waitForTimeout(500);
    console.log(name, 'crumbs:', (await pg.locator('#crumbs').innerText()).replace(/\n/g, ' '));
    await pg.click('a[data-nav=outline]');
    await pg.waitForSelector('.outline-row');
    console.log(name, "after outline click:", await pg.evaluate(() => location.hash), (await pg.locator("#crumbs").innerText()).replace(/\n/g," "));
    await pg.click('#crumbs button:has-text("Whole tree")');
    await pg.waitForTimeout(300);
    console.log(name, 'outline rows:', await pg.locator('.outline-row').count());
    await pg.screenshot({ path: `${SHOTS}${name}-3-outline.png` });
    // Ram Lal uncertain
    await pg.click('a[data-nav=tree]');
    await pg.fill('#search', 'ram lal'); await pg.waitForSelector('#search-results li button'); await pg.keyboard.press('Enter');
    await pg.waitForFunction(() => document.querySelector('.panel-name')?.textContent.includes('Ram Lal'));
    console.log(name, 'uncertain panel:', (await pg.locator('#panel').innerText()).replace(/\n+/g, ' | ').slice(0, 300));
    await pg.waitForTimeout(800);
    const bb = await pg.locator('g.node.selected').boundingBox({timeout: 3000});
    const sheet = await pg.locator('#panel').boundingBox();
    console.log(name, 'selected node box', JSON.stringify(bb), 'panel', JSON.stringify(sheet), 'scrollY', await pg.evaluate(() => scrollY));
    await pg.screenshot({ path: `${SHOTS}${name}-4-uncertain.png` });
    // GEDCOM
    await pg.goto('http://localhost:8765/#/export'); await pg.waitForSelector('.export-choices');
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.locator('button', { hasText: 'Download .ged file' }).click()]);
    const ged = fs.readFileSync(await dl.path(), 'utf8');
    console.log(name, 'gedcom INDI', (ged.match(/ INDI/g) || []).length, 'FAM', (ged.match(/ FAM\r/g) || []).length, 'CHIL', (ged.match(/CHIL/g) || []).length);
    if (name === 'desktop') fs.writeFileSync('' + SHOTS + 'test.ged', ged);
    // PDF family book: what the print dialog would save
    await pg.evaluate(() => { window.print = () => { window.__printed = true; }; });
    await pg.locator('button', { hasText: 'Make the PDF' }).click();
    await pg.waitForFunction(() => window.__printed === true);
    console.log(name, 'book:', await pg.locator('.bk-tree li').count(), 'tree rows,', await pg.locator('.bk-person').count(), 'people cards');
    if (name === 'desktop') {
      await pg.emulateMedia({ media: 'print' });
      await pg.pdf({ path: SHOTS + 'family-book.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
      await pg.emulateMedia({ media: 'screen' });
      console.log(name, 'pdf bytes:', fs.statSync(SHOTS + 'family-book.pdf').size);
    }
    await ctx.close();
  }
  console.log('ERRORS:', errors.length ? errors : 'none');
  await b.close();
})();
