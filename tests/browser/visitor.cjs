// What a signed-out visitor sees: married women by their married name only.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const errors = [];
  for (const role of ['anon', 'admin']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
    await ctx.route('**/js/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
    await ctx.addInitScript(r => { window.__FAKE_ROLE__ = r; }, role);
    await ctx.addInitScript(() => { sessionStorage.setItem('claim-welcome', '1'); sessionStorage.setItem('claim-not-in-tree', '1'); try { localStorage.setItem('blessings-welcome-seen', '1'); } catch {} });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push(role + ': ' + e.message));
    await pg.goto('http://localhost:8765/'); await pg.waitForSelector('g.node');
    await pg.fill('#search', 'Motia'); await pg.keyboard.press('Enter');
    await pg.waitForSelector('.panel-top');
    const panel = await pg.locator('#panel').innerText();
    const name = (await pg.locator('#panel h2').first().innerText()).trim();
    console.log(role, 'name:', name, '| also known as shown:', /Also known as/.test(panel));
    if (role === 'anon') {
      if (name !== 'Motia Rani Talwar' || /Also known as/.test(panel)) errors.push('anon sees maiden name or other names: ' + name);
      if (/Motia Rani Jaggi/.test(await pg.locator('body').innerText())) errors.push('anon page shows maiden name');
      await pg.fill('#search', 'Motia Rani Jaggi'); await pg.waitForTimeout(300);
      const hits = await pg.locator('.search-results li, #search-results li').allInnerTexts().catch(() => []);
      if (hits.some((t) => /Motia/.test(t))) errors.push('anon can search by maiden name');
    } else if (!/Jaggi/.test(name)) errors.push('admin does not see the maiden name: ' + name);
    await ctx.close();
  }
  await b.close();
  console.log('visitor ERRORS:', errors.length ? errors.join('\n') : 'none');
  if (errors.length) process.exit(1);
})();
