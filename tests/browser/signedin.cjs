const { chromium, devices } = require('playwright'); const fs = require('fs');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
(async () => {
  const b = await chromium.launch(); const errors = [];
  for (const role of ['member', 'admin']) {
    const ctx = await b.newContext(role === 'member' ? devices['iPhone 13'] : { viewport: { width: 1280, height: 800 } });
    await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
    await ctx.route('**/js/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
    await ctx.addInitScript(r => { window.__FAKE_ROLE__ = r; }, role);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push(role + ': ' + e.message));
    pg.on('console', m => m.type() === 'error' && errors.push(role + ' console: ' + m.text()));
    await pg.goto('http://localhost:8765/'); await pg.waitForSelector('g.node');
    console.log(role, 'nav:', (await pg.locator('#nav').innerText()).replace(/\n/g, ' | '), '| who:', await pg.locator('#who').innerText());
    await pg.fill('#search', 'sunil'); await pg.keyboard.press('Enter');
    await pg.waitForSelector('.panel-actions');
    console.log(role, 'panel shows details?', await pg.locator('#panel .details, #panel .sources').count() > 0, '| actions:', (await pg.locator('.panel-actions').innerText()).replace(/\n/g, ' | '));
    // add child
    await pg.click('.add-row button:has-text("Child")');
    await pg.waitForSelector('dialog form');
    await pg.screenshot({ path: `${SHOTS}${role}-addchild.png` });
    await pg.fill('dialog input[name=given_name]', 'Test Baby');
    await pg.selectOption('dialog select[name=is_living]', 'true');
    await pg.fill('dialog input[name=birth_date]', '2020');
    await pg.click('dialog button[type=submit]');
    await pg.waitForTimeout(500);
    console.log(role, 'toast:', await pg.locator('#toast').innerText(), '| requests:', await pg.evaluate(() => JSON.stringify(window.__db.change_requests.map(r => [r.kind, r.summary, r.status, r.payload.link]))));
    // edit
    await pg.click('.panel-actions button:has-text("dit")');
    await pg.fill('dialog input[name=profession]', 'Engineer');
    await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(400);
    console.log(role, 'edit payload:', await pg.evaluate(() => JSON.stringify(window.__db.change_requests.at(-1).payload)), await pg.evaluate(() => window.__db.change_requests.at(-1).summary));
    // photo
    await pg.click('.panel-photo button');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDKgCxAMAAB0sAX9i8b6ZwAAAABJRU5ErkJggg==', 'base64');
    await pg.setInputFiles('dialog input[type=file]', '' + SHOTS + 'desktop-1-tree.png');
    await pg.waitForTimeout(500); console.log(role, 'preview:', await pg.locator('dialog .photo-preview').innerHTML(), await pg.locator('#toast').innerText());
    await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(500);
    console.log(role, 'photo request:', await pg.evaluate(() => JSON.stringify(window.__db.change_requests.at(-1).payload)));
    // link form
    await pg.click('.panel-actions button:has-text("Link to someone")');
    await pg.fill('dialog .picker input', 'gokal'); await pg.click('dialog .pick-list button');
    await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(300);
    console.log(role, 'link:', await pg.evaluate(() => window.__db.change_requests.at(-1).summary));
    if (role === 'member') {
      await pg.goto('http://localhost:8765/#/mine'); await pg.waitForSelector('.history');
      console.log(role, 'mine:', (await pg.locator('#page').innerText()).replace(/\n/g, ' | ').slice(0, 300));
      await pg.screenshot({ path: `${SHOTS}member-mine.png` });
    } else {
      console.log(role, 'tree now has Test Baby node:', await pg.locator('g.node text.name', { hasText: 'Test Baby' }).count());
      // add a pending request from a "member" and review it
      await pg.evaluate(() => window.__db.change_requests.push({ id: 'r1', kind: 'edit_person', status: 'pending', submitted_by: 'u-1', submitted_at: new Date().toISOString(), summary: 'Edit Veena: birth date', payload: { person_id: window.__db.people.find(p => p.given_name === 'Veena').id, person: {}, details: { birth_date: '1960', visibility: 'branch' } } }));
      await pg.goto('http://localhost:8765/#/review'); await pg.waitForSelector('.req-card');
      await pg.screenshot({ path: `${SHOTS}admin-review.png` });
      await pg.click('.req-card button:has-text("Approve")'); await pg.waitForTimeout(400);
      console.log(role, 'review after approve:', (await pg.locator('#page').innerText()).replace(/\n/g, ' | ').slice(0, 250));
      await pg.goto('http://localhost:8765/#/members'); await pg.waitForSelector('.invite-form');
      await pg.fill('.invite-form input[name=email]', 'Cousin@Example.com');
      await pg.fill('.invite-form .picker input', 'rekha'); await pg.click('.invite-form .pick-list button');
      await pg.click('.invite-form button[type=submit]'); await pg.waitForTimeout(400);
      console.log(role, 'invites:', await pg.evaluate(() => JSON.stringify(window.__db.invites.map(i => [i.email, i.person_id ? 'linked' : 'none']))));
      await pg.screenshot({ path: `${SHOTS}admin-members.png`, fullPage: true });
    }
    await ctx.close();
  }
  console.log('ERRORS:', errors.length ? errors : 'none'); await b.close();
})();
