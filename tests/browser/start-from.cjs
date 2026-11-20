// Members pick where the tree starts from a drop-down of everyone who has
// children; the line shows the generation, how many generations are above,
// and the clickable path above. The tree's "you are here" path shares the
// same line. The choice is remembered for the next visit. Visitors keep
// "Showing from". SHOTS_DIR=dir saves previews.
const { chromium, devices } = require('playwright'); const fs = require('fs');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
async function open(b, opts, init) {
  const ctx = await b.newContext(opts);
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
  await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.addInitScript(init);
  await ctx.addInitScript(() => { try { for (const k of ['blessings-intro', 'blessingsIntro', 'founder-thanks']) localStorage.setItem(k, '1'); } catch {} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => fail(e.message));
  await pg.goto('http://localhost:8765/'); await pg.waitForSelector('g.node'); await pg.waitForTimeout(800);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  return { ctx, pg };
}
(async () => {
  const b = await chromium.launch();
  const seed = JSON.parse(fs.readFileSync(__dirname + '/../../site/data/seed.json'));
  const find = (n) => seed.people.find((p) => p.given_name.startsWith(n));
  const tapashi = find('Tapashi Ram'), harbans = find('Harbans Lal');
  const parents = new Set(seed.parent_child.map((l) => l.parent_id));
  for (const [size, opts] of Object.entries({ desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, phone: devices['iPhone 13'] })) {
    let { ctx, pg } = await open(b, opts, () => { window.__FAKE_ROLE__ = 'admin'; window.__FAKE_CLAIMED__ = 1; window.__FAKE_NAME__ = 'Sunil Jaggi'; });
    const values = await pg.$$eval('#start-from option', (os) => os.map((o) => o.value));
    if (!values.length) fail(`${size}: no Start tree from drop-down`);
    if (values.some((v) => !parents.has(v))) fail(`${size}: drop-down lists someone with no children`);
    if (!values.includes(tapashi.id) || !values.includes(harbans.id)) fail(`${size}: Tapashi Ram / Harbans Lal missing from the drop-down`);
    if ((await pg.textContent('.start-gen')) !== 'Gen 1') fail(`${size}: whole tree badge should say Gen 1`);
    if (OUT) await pg.screenshot({ path: `${OUT}${size}-1-whole-tree.png` });
    await pg.selectOption('#start-from', tapashi.id); await pg.waitForTimeout(700);
    if (!(await pg.evaluate(() => location.hash)).includes(tapashi.id)) fail(`${size}: picking Tapashi Ram did not re-start the tree`);
    const badge = await pg.textContent('.start-gen');
    if (!/^Gen 4 · 3 generations above$/.test(badge)) fail(`${size}: badge says "${badge}"`);
    const path = await pg.$$eval('.start-path button', (bs) => bs.map((x) => x.textContent));
    if (path.length !== 3) fail(`${size}: expected 3 ancestors above, got ${path}`);
    // Top box is Tapashi Ram.
    const top = await pg.$$eval('g.node', (els) => els.map((e) => [e.dataset.id, e.getBoundingClientRect().y]).sort((a, c) => a[1] - c[1])[0][0]);
    if (top !== tapashi.id) fail(`${size}: top box is not Tapashi Ram`);
    // One line: the bar is a single row on desktop.
    const barH = await pg.$eval('#crumbs', (e) => e.getBoundingClientRect().height);
    if (size === 'desktop' && barH > 52) fail(`desktop: start line wraps (${barH}px)`);
    if (size === 'phone' && barH > 120) fail(`phone: start lines too tall (${barH}px)`);
    if (OUT) await pg.screenshot({ path: `${OUT}${size}-2-from-tapashi-ram.png` });
    if (OUT && size === 'desktop') await pg.locator('#crumbs').screenshot({ path: `${OUT}${size}-line-closeup.png` });
    // What the opened list looks like (a list box stands in for the browser's own pop-up).
    if (OUT && size === 'desktop') {
      await pg.evaluate(() => { const s = document.getElementById('start-from'); s.size = 16; s.style.position = 'absolute'; s.style.zIndex = 50; s.style.top = '0'; s.style.height = 'auto'; s.parentElement.style.position = 'relative'; });
      await pg.screenshot({ path: `${OUT}${size}-dropdown-open.png`, clip: { x: 0, y: 140, width: 900, height: 560 } });
      await pg.evaluate(() => { const s = document.getElementById('start-from'); s.size = 0; s.removeAttribute('style'); });
    }
    // Remembered: opening the site again starts from Tapashi Ram.
    await pg.goto('http://localhost:8765/'); await pg.waitForSelector('#start-from'); await pg.waitForTimeout(900);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    if (!(await pg.evaluate(() => location.hash)).includes(tapashi.id)) fail(`${size}: saved start (Tapashi Ram) not used on reopening`);
    if ((await pg.$eval('#start-from', (e) => e.value)) !== tapashi.id) fail(`${size}: drop-down not on the saved start`);
    if (OUT) await pg.screenshot({ path: `${OUT}${size}-2b-reopened.png` });
    await pg.selectOption('#start-from', harbans.id); await pg.waitForTimeout(700);
    if (!/^Gen 5 · 4 generations above$/.test(await pg.textContent('.start-gen'))) fail(`${size}: Harbans badge`);
    if (OUT) await pg.screenshot({ path: `${OUT}${size}-3-from-harbans-lal.png` });
    // Step back up by clicking an ancestor in the path.
    // Step back up: the path's last name is Harbans Lal's parent.
    const parent = seed.parent_child.filter((l) => l.child_id === harbans.id).map((l) => l.parent_id);
    await pg.click('.start-path button >> nth=-1'); await pg.waitForTimeout(700);
    const h2 = await pg.evaluate(() => location.hash);
    if (!parent.some((id) => h2.includes(id))) fail(`${size}: clicking the parent in the path did not move the start up`);
    if (OUT) await pg.screenshot({ path: `${OUT}${size}-3b-stepped-up.png` });
    // Picking the top ancestor forgets the choice: back to the member's own line.
    await pg.selectOption('#start-from', seed.people.find((p) => p.given_name === 'Bhanna Mal').id); await pg.waitForTimeout(500);
    await pg.goto('http://localhost:8765/'); await pg.waitForSelector('#start-from'); await pg.waitForTimeout(900);
    const sunil = seed.people.find((p) => p.given_name === 'Sunil Kumar');
    if (!(await pg.$$eval('g.node', (els) => els.map((e) => e.dataset.id))).includes(sunil.id)) fail(`${size}: after picking Bhanna Mal, reopening should show own line`);
    // The drop-down is open on a phone: show what the list looks like.
    if (OUT && size === 'desktop') {
      const opts2 = await pg.$$eval('#start-from option', (os) => os.map((o) => o.textContent));
      fs.writeFileSync(`${OUT}dropdown-list.txt`, opts2.join('\n') + '\n');
    }
    await ctx.close();
    ({ ctx, pg } = await open(b, opts, () => { window.__FAKE_ROLE__ = 'anon'; }));
    if (await pg.$('#start-from')) fail(`${size}: visitors should not get the drop-down`);
    if (!(await pg.textContent('#crumbs')).includes('Showing from')) fail(`${size}: visitors lost Showing from`);
    if (OUT) await pg.screenshot({ path: `${OUT}${size}-4-visitor.png` });
    await ctx.close();
  }
  await b.close();
  if (!process.exitCode) console.log('start-from ok');
})();
