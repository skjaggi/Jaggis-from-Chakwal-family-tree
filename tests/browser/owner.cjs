// "This is me" and branch owners, against the fake backend.
const { chromium } = require('playwright'); const fs = require('fs');
const seed = JSON.parse(fs.readFileSync(__dirname + '/../../site/data/seed.json', 'utf8'));
const idOf = (g) => seed.people.find((p) => p.given_name === g).id;
const SUNIL = idOf('Sunil Kumar'); const HARBANS = idOf('Harbans Lal');
(async () => {
  const b = await chromium.launch(); const errors = [];
  for (const role of ['member', 'owner', 'admin']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
    await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal' };" }));
    await ctx.addInitScript(r => { window.__FAKE_ROLE__ = r; }, role);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push(role + ': ' + e.message));
    const open = async (id) => { await pg.goto(`http://localhost:8765/#/tree/${HARBANS}?p=${id}`); await pg.waitForSelector('#panel .panel-actions'); await pg.waitForTimeout(400); };
    await open(SUNIL);
    const claim = async () => (await pg.locator('#panel .claim-box:not([hidden])').count()) ? (await pg.locator('#panel .claim-box').innerText()).replace(/\n/g, ' ') : '(none)';
    console.log(role, '| claim box:', await claim(), '| edit button:', await pg.locator('#panel .panel-actions > button').nth(1).innerText());
    if (role === 'member') {
      await pg.click('#panel .claim-box button'); await pg.locator('dialog button', { hasText: 'This is me' }).click(); await pg.waitForTimeout(600);
      console.log(role, '| after claim toast:', await pg.locator('#toast').innerText(), '| box:', await claim(), '| nav has Review:', (await pg.locator('#nav').innerText()).includes('Review'));
    }
    if (role === 'owner') {
      await pg.locator('#panel .panel-actions button', { hasText: 'Edit' }).click(); await pg.waitForSelector('dialog form');
      console.log(role, '| form button:', await pg.locator('dialog button[type=submit]').innerText());
      await pg.fill('dialog [name=profession]', 'Engineer'); await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(600);
      console.log(role, '| edit toast:', await pg.locator('#toast').innerText(), '| status:', await pg.evaluate(() => window.__db.change_requests.at(-1).status));
      await open(HARBANS);
      console.log(role, '| parent edit button:', await pg.locator('#panel .panel-actions > button').nth(1).innerText());
      await pg.goto('http://localhost:8765/#/review'); await pg.waitForSelector('#page h1');
      console.log(role, '| review title:', await pg.locator('#page h1').innerText());
    }
    if (role === 'admin') {
      await pg.locator('#panel .panel-actions button', { hasText: 'Edit' }).click(); await pg.waitForSelector('dialog form');
      await pg.fill('dialog [name=profession]', 'Doctor'); await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(600);
      await pg.goto('http://localhost:8765/#/review'); await pg.waitForSelector('#page .history');
      console.log(role, '| undo buttons:', await pg.locator('#page .history button', { hasText: 'Undo' }).count());
      await pg.locator('#page .history button', { hasText: 'Undo' }).first().click(); await pg.locator('dialog button', { hasText: 'Undo' }).click(); await pg.waitForTimeout(600);
      console.log(role, '| after undo:', await pg.locator('#toast').innerText(), (await pg.locator('#page .history li').first().innerText()).split('\n')[0]);
      await open(SUNIL); await pg.click('#panel .claim-box button'); await pg.locator('dialog button', { hasText: 'This is me' }).click(); await pg.waitForTimeout(600);
      await pg.goto('http://localhost:8765/#/members'); await pg.waitForSelector('.branch-admins');
      console.log(role, '| branch admins:', (await pg.locator('.branch-admins tbody').innerText()).replace(/\s+/g, ' '));
      await pg.locator('.branch-admins button').click(); await pg.locator('dialog button', { hasText: 'Remove' }).click(); await pg.waitForTimeout(600);
      console.log(role, '| after revoke:', await pg.locator('#toast').innerText(), '|', await pg.locator('.branch-admins').count() ? 'table still there' : (await pg.locator('#page section').first().innerText()).split('\n').slice(0, 1).join(''));
    }
    await ctx.close();
  }
  await b.close();
  console.log('owner ERRORS:', errors.length ? errors.join('; ') : 'none');
})();
