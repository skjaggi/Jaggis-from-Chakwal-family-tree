// Admin "Missing details" on the Members page: the per-branch report, the
// personal email drafts, preview and sending (fake backend).
const { chromium, devices } = require('playwright'); const fs = require('fs');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
(async () => {
  const b = await chromium.launch(); const errors = []; let fail = 0;
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
  for (const phone of [false, true]) {
    const ctx = await b.newContext(phone ? devices['iPhone 13'] : { viewport: { width: 1280, height: 900 } });
    await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
    await ctx.route('**/js/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
    await ctx.addInitScript(() => { window.__FAKE_ROLE__ = 'admin'; try { sessionStorage.setItem('claim-welcome', '1'); sessionStorage.setItem('claim-not-in-tree', '1'); } catch {} });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push(e.message));
    pg.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
    await pg.goto('http://localhost:8765/'); await pg.waitForSelector('g.node');
    // Two branch admins: Cousin claimed Sunil Kumar's box, Came Once claimed Ram Avtar's.
    await pg.evaluate(() => {
      const db = window.__db; const id = (n) => db.people.find((p) => p.given_name === n).id;
      db.profiles.find((u) => u.id === 'u-2').claimed_person_id = id('Sunil Kumar');
      db.profiles.find((u) => u.id === 'u-4').claimed_person_id = id('Ram Avtar');
      // Fill in part of Ram Avtar's branch so the report shows a mix.
      const kids = db.parent_child.filter((l) => l.parent_id === id('Ram Avtar')).map((l) => l.child_id);
      for (const pid of [id('Ram Avtar'), ...kids.slice(0, 1)]) {
        const p = db.people.find((x) => x.id === pid); p.photo_path = 'img/arya-school-plaque-1933.jpg'; p.is_living = true; p.gender = p.gender === 'unknown' ? 'male' : p.gender;
        const d = db.person_details.find((x) => x.person_id === pid) || (db.person_details.push({ person_id: pid, visibility: 'branch' }), db.person_details.at(-1));
        Object.assign(d, { birth_date: '1950', birth_place: 'Delhi' });
      }
    });
    await pg.goto('http://localhost:8765/#/members'); await pg.waitForSelector('.cmp-card');
    const cards = await pg.locator('.cmp-card').count();
    ok(cards === 2, `two branch admins listed (${cards})`);
    const heads = (await pg.locator('.cmp-head').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    console.log('     ', heads.join(' / '));
    await pg.locator('.cmp-gaps summary').first().click();
    const sec = pg.locator('section.completeness');
    await sec.scrollIntoViewIfNeeded();
    await pg.screenshot({ path: `${SHOTS}completeness-report${phone ? '-phone' : ''}.png`, fullPage: true });
    // One person: Write email on their card opens only their draft; nothing is sent yet.
    const first = pg.locator('.cmp-card').first();
    await first.locator('button:has-text("Write email")').click();
    await first.locator('.cmp-draft').waitFor();
    ok((await pg.locator('.cmp-draft').count()) === 1, 'Write email opens one draft, in that card');
    ok(!(await pg.evaluate(() => window.__reminder)), 'writing a draft sends nothing');
    const msg = await first.locator('.cmp-draft textarea').inputValue();
    console.log('----- draft 1 -----\n' + msg + '\n-------------------');
    ok(/• .+: /.test(msg) || /only thing missing now is a photo/.test(msg), 'draft lists people with their missing details');
    ok(!/c\. 1950/.test(msg) || /birth year|year of passing/.test(msg), 'year tip only when a year is missing');
    await first.locator('.cmp-draft textarea').fill(msg + '\n\nWarm wishes from Phoenix!');
    await first.locator('.cmp-draft button:has-text("Preview")').click();
    await first.locator('.rem-preview iframe').waitFor();
    await pg.evaluate(() => { document.querySelector('.cmp-draft textarea').rows = 22; });
    await pg.screenshot({ path: `${SHOTS}completeness-drafts${phone ? '-phone' : ''}.png`, fullPage: true });
    await first.locator('.cmp-draft button:has-text("Send to")').click();
    await pg.click('dialog button.primary');
    await pg.waitForTimeout(400);
    const sent = await pg.evaluate(() => window.__reminder);
    ok(sent && sent.emails.length === 1 && sent.message.includes('Warm wishes from Phoenix!'), `per-person Send sends only their edited email (${sent && sent.emails})`);
    ok((await first.locator('.rem-tag.ok:has-text("Sent")').count()) === 1, 'sent draft marked Sent');
    // Bulk: drafts for everyone ticked open in their cards; Send all sends the unsent ones.
    await pg.evaluate(() => { window.__reminder = null; });
    await pg.click('button:has-text("Write emails for everyone ticked")');
    const open = await pg.locator('.cmp-draft').count();
    ok(open === 2, `bulk opens a draft for each ticked person (${open})`);
    await pg.click('button:has-text("Send all open drafts")');
    await pg.click('dialog button.primary'); await pg.waitForTimeout(400);
    const sent2 = await pg.evaluate(() => window.__reminder);
    ok(sent2 && sent2.emails.length === 1 && sent2.emails[0] !== sent.emails[0], `Send all skips the one already sent (${sent2 && sent2.emails})`);
    await ctx.close();
  }
  console.log('ERRORS:', errors.length ? errors : 'none'); await b.close();
  if (fail || errors.length) process.exit(1);
})();
