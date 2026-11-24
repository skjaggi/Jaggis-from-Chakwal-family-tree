// Top bar on the tree, Help and Ancestors pages, side by side, for the admin,
// a family member and a visitor: they should match. Also checks the menus.
//   (serve site/ on :8765 first, as run.sh does) node page-header-shots.cjs
const { chromium, devices } = require('playwright'); const fs = require('fs');
const OUT = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const pages = { tree: '/', help: '/help.html', ancestors: '/people/', person: '/people/' + fs.readdirSync(__dirname + '/../../site/people').find((f) => f !== 'index.html') };
const who = {
  admin: { role: 'admin', claimed: 1, name: 'Sunil Jaggi' },
  member: { role: 'member', claimed: 1, name: 'Asha Jaggi' },
  visitor: { role: 'anon' },
};
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const [size, opts] of Object.entries({ desktop: { viewport: { width: 1440, height: 900 } }, phone: devices['iPhone 13'] })) for (const [w, cfg] of Object.entries(who)) {
    const menus = {};
    for (const [name, path] of Object.entries(pages)) {
      const ctx = await b.newContext({ ...opts, deviceScaleFactor: 2 });
      await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
      await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
      await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
      await ctx.addInitScript(c => {
        window.__FAKE_ROLE__ = c.role; window.__FAKE_CLAIMED__ = c.claimed; window.__FAKE_NAME__ = c.name; window.__FAKE_BONUS__ = 335; window.__FAKE_BADGES__ = 1;
        if (c.role !== 'anon') try { localStorage.setItem('sb-x-auth-token', '{}'); } catch {}
      }, cfg);
      const pg = await ctx.newPage();
      pg.on('pageerror', e => console.log('ERR', name, e.message));
      await pg.goto('http://localhost:8765' + path);
      await pg.waitForSelector('nav#nav a');
      if (cfg.role !== 'anon') await pg.waitForSelector('.me-chip');
      await pg.waitForTimeout(600);
      menus[name] = await pg.locator('nav#nav > *').evaluateAll(els => els.map(e => e.textContent.replace(/\d+$/, '').trim()).join(' | '));
      const vw = pg.viewportSize().width;
      await pg.screenshot({ path: `${OUT}${size}-${w}-${name}.png`, clip: { x: 0, y: 0, width: vw, height: size === 'phone' ? 260 : 150 } });
      await ctx.close();
    }
    const ref = menus.tree;
    for (const [n, m] of Object.entries(menus)) if (m !== ref) { bad++; console.log('DIFFERENT', size, w, n, '\n  tree:', ref, '\n  ', n + ':', m); }
    console.log(size, w, ref);
  }
  await b.close();
  if (bad) process.exit(1);
})();
