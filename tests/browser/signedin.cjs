const { chromium, devices } = require('playwright'); const fs = require('fs');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
(async () => {
  const b = await chromium.launch(); const errors = [];
  for (const role of ['member', 'admin']) {
    const ctx = await b.newContext(role === 'member' ? devices['iPhone 13'] : { viewport: { width: 1280, height: 800 } });
    await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
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
    await pg.fill('dialog input[name=birth_date]', '4 March 2020');
    await pg.click('dialog button[type=submit]');
    await pg.waitForTimeout(500);
    console.log(role, 'birth saved as', await pg.evaluate(() => window.__db.change_requests[0].payload.details.birth_date), 'toast:', await pg.locator('#toast').innerText(), '| requests:', await pg.evaluate(() => JSON.stringify(window.__db.change_requests.map(r => [r.kind, r.summary, r.status, r.payload.link]))));
    // edit
    await pg.click('.panel-actions button:has-text("dit")');
    await pg.fill('dialog input[name=profession]', 'Engineer');
    await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(400);
    console.log(role, 'edit payload:', await pg.evaluate(() => JSON.stringify(window.__db.change_requests.at(-1).payload)), await pg.evaluate(() => window.__db.change_requests.at(-1).summary));
    // photo
    await pg.click('.panel-photo button');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDKgCxAMAAB0sAX9i8b6ZwAAAABJRU5ErkJggg==', 'base64');
    await pg.setInputFiles('dialog input[type=file]', '' + SHOTS + 'desktop-1-tree.png');
    await pg.waitForSelector('dialog .photo-editor:not([hidden])');
    const box = await pg.locator('dialog canvas.photo-frame').boundingBox();
    await pg.mouse.move(box.x + 130, box.y + 130); await pg.mouse.down(); await pg.mouse.move(box.x + 200, box.y + 140, { steps: 5 }); await pg.mouse.up();
    await pg.locator('dialog .zoom-row input').fill('1.5');
    if (role === 'admin') await pg.screenshot({ path: `${SHOTS}admin-photo-editor.png` });
    await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(700);
    console.log(role, 'photo request:', await pg.evaluate(() => JSON.stringify([window.__db.change_requests.at(-1).summary, window.__db.change_requests.at(-1).status])));
    if (role === 'admin') {
      await pg.waitForTimeout(300);
      const photoBtns = (await pg.locator('.panel-photo .photo-actions').innerText()).replace(/\n/g, ' | ');
      console.log(role, 'photo buttons after save:', photoBtns);
      await pg.locator('.panel-photo button', { hasText: 'Change or center photo' }).click();
      await pg.waitForSelector('dialog .photo-editor:not([hidden])');
      console.log(role, 'existing photo loads for centering:', await pg.locator('dialog .photo-editor').isVisible(), '|', (await pg.locator('dialog .form-note').first().innerText()));
      await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(700);
      console.log(role, 'recenter request:', await pg.evaluate(() => window.__db.change_requests.at(-1).summary));
      await pg.locator('.panel-photo button', { hasText: 'Remove photo' }).click();
      await pg.locator('dialog button', { hasText: 'Remove photo' }).click(); await pg.waitForTimeout(700);
      console.log(role, 'after remove:', await pg.evaluate(() => JSON.stringify([window.__db.change_requests.at(-1).summary, window.__db.change_requests.at(-1).status])), '| button now:', await pg.locator('.panel-photo button').first().innerText());
    }
    // link form
    await pg.click('.panel-actions button:has-text("Link to someone")');
    await pg.fill('dialog .picker input', 'gokal'); await pg.click('dialog .pick-list button');
    await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(300);
    console.log(role, 'link:', await pg.evaluate(() => window.__db.change_requests.at(-1).summary));
    // Invite a relative (works at once, no approval)
    await pg.goto('http://localhost:8765/#/invite'); await pg.waitForSelector('.invite-form');
    await pg.fill('.invite-form input[name=email]', 'Cousin@Example.com');
    await pg.fill('.invite-form input[name=display_name]', 'Neha Jaggi');
    await pg.fill('.invite-form .picker input', 'Om Parkash'); await pg.locator('.invite-form .pick-list button').first().click();
    await pg.locator('.invite-form button[type=submit]').click(); await pg.waitForSelector('.send-invite');
    console.log(role, 'invite list:', (await pg.locator('#page section').innerText()).replace(/\n/g, ' | '), '| invites:', await pg.evaluate(() => JSON.stringify(window.__db.invites.map(i => [i.email, i.role, i.invited_by, !!i.person_id]))));
    console.log(role, 'mailto ok:', /^mailto:cousin@example\.com\?subject=/.test(await pg.locator('.send-invite a').first().getAttribute('href')));
    const wa = decodeURIComponent(await pg.locator('.send-invite a', { hasText: 'WhatsApp' }).first().getAttribute('href'));
    console.log(role, 'whatsapp text has site + email:', wa.includes('http://localhost:8765/') && wa.includes('cousin@example.com'), '| greets:', wa.includes('Dear Neha,'));
    await pg.fill('.invite-form input[name=email]', 'cousin@example.com');
    await pg.fill('.invite-form .picker input', 'Om Parkash'); await pg.locator('.invite-form .pick-list button').first().click();
    await pg.locator('.invite-form button[type=submit]').click(); await pg.waitForTimeout(300);
    console.log(role, 'duplicate toast:', await pg.locator('#toast').innerText());
    if (role === 'member') await pg.screenshot({ path: `${SHOTS}member-invite.png` });
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
