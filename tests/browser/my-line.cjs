// Signed-in members with a claimed box open the tree on their own line: the
// path down to their box is open, their box and everyone below it is open,
// and every other branch is closed. Visitors keep the usual 3-generation view.
// SHOTS_DIR=dir saves preview pictures.
const { chromium, devices } = require('playwright'); const fs = require('fs');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
async function open(b, opts, init) {
  const ctx = await b.newContext(opts);
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
  await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.addInitScript(init);
  // Skip the one-time pop-ups so the tree is in view.
  await ctx.addInitScript(() => { try { for (const k of ['blessings-intro', 'blessingsIntro', 'founder-thanks']) localStorage.setItem(k, '1'); } catch {} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => fail(e.message));
  await pg.goto('http://localhost:8765/'); await pg.waitForSelector('g.node'); await pg.waitForTimeout(800);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  return { ctx, pg };
}
const ids = (pg) => pg.$$eval('g.node', (els) => els.map((e) => e.dataset.id));
(async () => {
  const b = await chromium.launch();
  const seed = JSON.parse(fs.readFileSync(__dirname + '/../../site/data/seed.json'));
  const kids = (id) => seed.parent_child.filter((l) => l.parent_id === id).map((l) => l.child_id);
  const sunil = seed.people.find((p) => p.given_name === 'Sunil Kumar');
  for (const [size, opts] of Object.entries({ desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, phone: devices['iPhone 13'] })) {
    // Signed in, own box claimed (Sunil).
    let { ctx, pg } = await open(b, opts, () => { window.__FAKE_ROLE__ = 'admin'; window.__FAKE_CLAIMED__ = 1; window.__FAKE_NAME__ = 'Sunil Jaggi'; });
    const shown = await ids(pg);
    if (!shown.includes(sunil.id)) fail(`${size}: Sunil's box not shown when signed in`);
    // Their box is on screen straight away.
    const r = await pg.locator(`g.node[data-id="${sunil.id}"]`).boundingBox();
    const vh = pg.viewportSize().height;
    if (!r || r.y < 0 || r.y + r.height > vh) fail(`${size}: Sunil's box is off screen (${r && Math.round(r.y)})`);
    // Siblings of an ancestor off the line stay closed: Prabh Dyal's children are not drawn.
    const prabh = seed.people.find((p) => /Prabh Dyal/.test(p.given_name));
    if (prabh) {
      if (kids(prabh.id).some((id) => shown.includes(id))) fail(`${size}: Prabh Dyal's branch should be closed`);
    }
    for (const k of kids(sunil.id)) if (!shown.includes(k)) fail(`${size}: Sunil's child ${k} not shown`);
    if (OUT) await pg.screenshot({ path: `${OUT}signed-in-${size}.png` });
    await ctx.close();
    // Visitor: the usual view.
    ({ ctx, pg } = await open(b, opts, () => { window.__FAKE_ROLE__ = 'anon'; }));
    if ((await ids(pg)).includes(sunil.id)) fail(`${size}: visitors should get the usual view`);
    if (OUT) await pg.screenshot({ path: `${OUT}visitor-${size}.png` });
    await ctx.close();
  }
  await b.close();
  if (!process.exitCode) console.log('my-line ok');
})();
