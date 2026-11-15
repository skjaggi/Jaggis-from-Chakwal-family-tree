// Header previews: signed-in admin who has claimed a box, desktop + phone, light + dark.
const { chromium, devices } = require('playwright'); const fs = require('fs');
const OUT = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
(async () => {
  const b = await chromium.launch();
  const sizes = { wide: { viewport: { width: 1920, height: 1000 }, deviceScaleFactor: 2 }, desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, laptop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }, tablet: { viewport: { width: 768, height: 1000 }, deviceScaleFactor: 2 }, phone: devices['iPhone 13'] };
  for (const [name, opts] of Object.entries(sizes)) for (const theme of ['light', 'dark']) {
    const ctx = await b.newContext(opts);
    await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
    await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
    await ctx.addInitScript(t => { window.__FAKE_ROLE__ = 'admin'; window.__FAKE_CLAIMED__ = 1; window.__FAKE_NAME__ = 'Sunil Jaggi'; window.__FAKE_BONUS__ = 335; window.__FAKE_BADGES__ = 1; try { localStorage.setItem('theme', t); } catch {} }, theme);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => console.log('ERR', e.message));
    await pg.goto('http://localhost:8765/'); await pg.waitForSelector('g.node'); await pg.waitForSelector('.me-chip'); await pg.waitForTimeout(500);
    await pg.screenshot({ path: `${OUT}${name}-${theme}.png`, clip: { x: 0, y: 0, width: pg.viewportSize().width, height: Math.min(pg.viewportSize().height, name === 'phone' ? 420 : 260) } });
    console.log(name, theme, 'header height', await pg.locator('.topbar').evaluate(e => e.offsetHeight));
    await ctx.close();
  }
  await b.close();
})();
