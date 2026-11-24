// Faces from a group photo (#/faces): choose a photo, faces are found, tap a
// face to give it to someone in the tree (it becomes their photo), add someone
// new from a face, skip a face, and mark a face the finder missed. Then keep
// the photo in the Family Album and open it like a book, with names on faces.
// The face finder is a small stand-in here that "finds" fixed boxes, so CI
// needs no internet. FACES_PHOTO=file.jpg FACES_REAL=1 runs the real finder
// (installed in .vendor by run.sh) on that photo. SHOTS_DIR=dir saves previews.
const { chromium, devices } = require('playwright'); const fs = require('fs');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const REAL = !!process.env.FACES_REAL;
// A made-up cartoon group photo (no real people).
const PHOTO = process.env.FACES_PHOTO || __dirname + '/book-photos/group-sample.jpg';
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const FA = __dirname + '/.vendor/node_modules/@vladmandic/face-api';
// The faces in group-sample.jpg as fractions of the photo: [x, y, width, height].
const FAKE_API = `
const boxes = [[0.1237, 0.318, 0.0775, 0.1302], [0.2888, 0.302, 0.0725, 0.1218], [0.46, 0.266, 0.08, 0.1344], [0.6375, 0.305, 0.075, 0.126], [0.8025, 0.344, 0.07, 0.1176]];
export const nets = { ssdMobilenetv1: { loadFromUri: async () => {} } };
export class SsdMobilenetv1Options { constructor(o) { Object.assign(this, o); } }
export async function detectAllFaces(c) {
  return boxes.map(([x, y, w, h]) => ({ box: { x: x * c.width, y: y * c.height, width: w * c.width, height: h * c.height } }));
}`;

async function open(b, opts, role) {
  const ctx = await b.newContext(opts);
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/**', r => {
    const path = new URL(r.request().url()).pathname.replace('/npm/@vladmandic/face-api@1.7.15', '');
    if (!REAL) return r.fulfill({ contentType: 'application/javascript', body: FAKE_API });
    r.fulfill({ contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream', body: fs.readFileSync(FA + path) });
  });
  await ctx.route('**/js/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.addInitScript(r => { window.__FAKE_ROLE__ = r; window.__FAKE_CLAIMED__ = 1; }, role);
  await ctx.addInitScript(() => { try { for (const k of ['blessings-intro', 'blessingsIntro', 'founder-thanks']) localStorage.setItem(k, '1'); sessionStorage.setItem('claim-welcome', '1'); } catch {} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => fail(role + ': ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
  await pg.goto('http://localhost:8765/#/faces'); await pg.waitForTimeout(1000);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  return { ctx, pg };
}

async function choosePhoto(pg) {
  await pg.setInputFiles('#faces-file', { name: 'group.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(PHOTO) });
  await pg.waitForSelector('.face-card', { timeout: REAL ? 120000 : 10000 });
  await pg.waitForTimeout(300);
}

async function pickPerson(pg, name) {
  await pg.fill('dialog .picker input', name);
  await pg.click('dialog .pick-list button');
  await pg.waitForSelector('dialog .photo-editor:not([hidden])');
}

(async () => {
  const b = await chromium.launch();
  // A visitor (not signed in) gets the sign-in page and no Faces menu.
  {
    const { ctx, pg } = await open(b, { viewport: { width: 1280, height: 800 } }, 'anon');
    if (await pg.$('[data-nav="faces"]')) fail('visitor sees the Faces menu');
    if (!/Please sign in/.test(await pg.textContent('#page'))) fail('visitor can open Faces');
    await ctx.close();
  }
  // The admin, on a computer.
  {
    const { ctx, pg } = await open(b, { viewport: { width: 1280, height: 860 }, deviceScaleFactor: OUT ? 2 : 1 }, 'admin');
    if (!await pg.$('[data-nav="faces"]')) fail('admin has no Faces menu');
    if (OUT) await pg.screenshot({ path: `${OUT}1-start.png` });
    await choosePhoto(pg);
    const n = await pg.$$eval('.face-card', (els) => els.length);
    console.log('faces found:', n, '|', await pg.textContent('.faces-status'));
    if (!REAL && n !== 5) fail(`found ${n} faces, expected 5`);
    if (OUT) { await pg.waitForTimeout(600); await pg.screenshot({ path: `${OUT}2-faces-found.png` }); }

    // Face 1 → someone already in the tree.
    await pg.click('.face-card >> nth=0 >> .face-pick');
    await pg.waitForSelector('dialog .face-big');
    if (OUT) await pg.screenshot({ path: `${OUT}3-who-is-this.png` });
    await pickPerson(pg, 'sunil');
    if (!/Use as tree photo/.test(await pg.textContent('dialog button[type=submit]'))) fail('admin button should save at once');
    if (OUT) await pg.screenshot({ path: `${OUT}4-frame-photo.png` });
    await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(600);
    const req = await pg.evaluate(() => window.__db.change_requests.at(-1));
    if (req.kind !== 'set_photo' || req.status !== 'approved') fail('photo not saved: ' + JSON.stringify([req.kind, req.status]));
    if (req.payload.visibility !== 'branch' && !req.summary) fail('photo visibility ' + req.payload.visibility);
    console.log('face 1:', req.summary, '|', req.payload.visibility, '|', await pg.textContent('.face-card >> nth=0'));
    if (!/Tree photo saved/.test(await pg.textContent('.face-card >> nth=0'))) fail('face 1 not shown as saved');

    // Face 2 → a new person, added as a child, then their photo.
    await pg.click('.face-card >> nth=1 >> .face-pick');
    await pg.click('dialog button:has-text("Add a new person")');
    await pg.fill('dialog .picker input', 'sunil'); await pg.click('dialog .pick-list button');
    await pg.selectOption('dialog select[name=as]', 'child');
    if (OUT) await pg.screenshot({ path: `${OUT}5-new-person.png` });
    await pg.click('dialog button:has-text("Next: their details")');
    await pg.waitForSelector('dialog input[name=given_name]');
    await pg.fill('dialog input[name=given_name]', 'Face Test');
    await pg.selectOption('dialog select[name=gender]', 'female');
    await pg.selectOption('dialog select[name=is_living]', 'true');
    await pg.click('dialog button[type=submit]');
    await pg.waitForSelector('dialog .photo-editor:not([hidden])');
    await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(600);
    const kinds = await pg.evaluate(() => window.__db.change_requests.slice(-2).map((r) => [r.kind, r.status, r.summary]));
    console.log('face 2:', JSON.stringify(kinds));
    if (kinds[0][0] !== 'add_person' || kinds[1][0] !== 'set_photo') fail('new person + photo not saved');
    if (!/Face Test/.test(await pg.textContent('.face-card >> nth=1'))) fail('face 2 not named');

    // "A brother or sister of" is offered, and adds them as a child of the same parents.
    await pg.click('.face-card >> nth=2 >> .face-pick');
    await pg.click('dialog button:has-text("Add a new person")');
    await pg.fill('dialog .picker input', 'sunil'); await pg.click('dialog .pick-list button');
    await pg.selectOption('dialog select[name=as]', 'sibling');
    await pg.click('dialog button:has-text("Next: their details")');
    await pg.waitForSelector('dialog input[name=given_name]');
    const sib = await pg.evaluate(() => {
      const fam = window.__store?.fam;
      return { title: document.querySelector('dialog h2')?.textContent, note: document.querySelector('dialog .form-note')?.textContent,
        other: document.querySelector('dialog select[name=other_parent]')?.value };
    });
    console.log('sibling form:', JSON.stringify(sib));
    if (!/brother or sister/i.test(sib.title + sib.note) || !sib.other) fail('sibling form not right: ' + JSON.stringify(sib));
    await pg.click('dialog button:has-text("Cancel")').catch(() => pg.keyboard.press('Escape'));
    await pg.waitForTimeout(300);
    if (await pg.locator('dialog[open]').count()) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); }

    // Face 3 → skipped.
    await pg.click('.face-card >> nth=2 >> .face-pick');
    await pg.click('dialog button:has-text("Skip this face")');
    if (!/Skipped/.test(await pg.textContent('.face-card >> nth=2'))) fail('face 3 not skipped');

    // A face the finder missed: mark it by hand.
    await pg.click('.faces-tools button');
    const size = await pg.$eval('.faces-stage', (el) => ({ w: el.clientWidth, h: el.clientHeight }));
    await pg.locator('.faces-stage').click({ position: { x: size.w * 0.3, y: size.h * 0.6 } });
    await pg.waitForSelector('dialog .face-big');
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    const after = await pg.$$eval('.face-card', (els) => els.length);
    if (after !== n + 1) fail('marked face not added');
    if (OUT) await pg.screenshot({ path: `${OUT}6-after.png`, fullPage: true });

    // Keep the photo in the Family Album, with where and when.
    await pg.waitForSelector('.faces-keep:not([hidden]) form');
    await pg.locator('.faces-keep').scrollIntoViewIfNeeded();
    await pg.fill('.faces-keep input[type=text] >> nth=0', 'Cousins at the wedding');
    await pg.fill('.faces-keep input[type=text] >> nth=1', 'Delhi');
    await pg.fill('.faces-keep input[type=text] >> nth=2', 'December 2019');
    await pg.fill('.faces-keep textarea', 'The whole family came together for the wedding.');
    if (OUT) await pg.screenshot({ path: `${OUT}9-keep-in-album.png` });
    await pg.click('.faces-keep button[type=submit]'); await pg.waitForTimeout(600);
    const kept = await pg.evaluate(() => window.__db.library_links.find((l) => l.kind === 'photo'));
    console.log('album:', kept && JSON.stringify([kept.title, kept.status, kept.taken_where, kept.taken_when, kept.faces.length, kept.added_by_name]));
    if (!kept || kept.status !== 'approved' || kept.faces.length !== 2 || kept.taken_when !== 'December 2019') fail('photo not kept in the album');
    if (!(await pg.evaluate((p) => window.__files.has('library-photos/' + p), kept.photo_path))) fail('album picture not stored');
    if (!/In the Family Album/.test(await pg.textContent('.faces-keep'))) fail('album status not shown');
    // A second photo already there, so the album has a cover.
    await pg.evaluate((k) => {
      const id = crypto.randomUUID();
      window.__files.set(`library-photos/${id}/photo.jpg`, window.__files.get('library-photos/' + k.photo_path));
      window.__db.library_links.push({ ...k, id, photo_path: `${id}/photo.jpg`, title: 'Diwali at home', taken_where: 'Phoenix', taken_when: 'November 2024',
        note: 'Lighting the lamps together.', faces: k.faces.slice(0, 1), submitted_at: new Date(Date.now() + 1000).toISOString() });
    }, kept);

    // The Library shows the Family Album; it opens like a book.
    await pg.goto('http://localhost:8765/#/library'); await pg.waitForSelector('.album-tile');
    if (!/2 photos/.test(await pg.textContent('.album-tile'))) fail('album tile count: ' + await pg.textContent('.album-tile'));
    if (await pg.locator('.lib-grid .lib-card:has-text("Cousins at the wedding")').count()) fail('album photo also in the link grid');
    if (OUT) await pg.screenshot({ path: `${OUT}10-library-album.png` });
    await pg.click('.album-tile-open');
    await pg.waitForSelector('.album-cover');
    await pg.waitForTimeout(400);
    if (OUT) await pg.screenshot({ path: `${OUT}11-album-cover.png` });
    await pg.click('.album-nav button:has-text("Next")');
    await pg.waitForSelector('.album-spread .lib-face');
    await pg.waitForTimeout(600);
    const page1 = await pg.textContent('.album-spread');
    if (!/Cousins at the wedding/.test(page1) || !/December 2019 · Delhi/.test(page1) || !/Added by Tester on/.test(page1)) fail('album page details: ' + page1);
    await pg.hover('.album-spread .lib-face >> nth=0'); await pg.waitForTimeout(200);
    const shown = await pg.locator('.album-spread .lib-face >> nth=0 >> .lib-face-name').isVisible();
    console.log('hover name shown:', shown, await pg.textContent('.album-spread .lib-face >> nth=0'));
    if (!shown) fail('hovering a face does not show the name');
    if (OUT) await pg.screenshot({ path: `${OUT}12-album-page-hover.png` });
    await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(600);
    if (!/Diwali at home/.test(await pg.textContent('.album-spread'))) fail('arrow key does not turn the page');
    // Adding a picture straight from the album, naming one face (no Faces page).
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    await pg.click('.album-tile-add button');
    await pg.waitForSelector('dialog .album-add');
    if (OUT) await pg.screenshot({ path: `${OUT}14-add-to-album-start.png` });
    await pg.setInputFiles('#album-file', { name: 'party.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(PHOTO) });
    await pg.waitForFunction(() => document.querySelectorAll('dialog .album-add-stage .face-box').length >= 1, null, { timeout: REAL ? 120000 : 10000 });
    const nAdd = await pg.locator('dialog .album-add-stage .face-box').count();
    if (!REAL && nAdd !== 5) fail('add to album: faces found ' + nAdd);
    await pg.locator('dialog .album-add-stage .face-box >> nth=2').click({ position: { x: 5, y: 5 } });
    await pg.waitForSelector('dialog .album-add-who:not([hidden])');
    await pg.fill('dialog .album-add-who .picker input', 'sunil');
    await pg.click('dialog .album-add-who .pick-list button');
    await pg.waitForTimeout(200);
    if (!(await pg.locator('dialog .album-add-stage .face-box.named').count())) fail('add to album: face not named');
    await pg.fill('dialog input[name=title]', 'Anniversary dinner');
    await pg.fill('dialog input[name=taken_where]', 'Amritsar');
    await pg.fill('dialog input[name=taken_when]', 'About 1985');
    await pg.fill('dialog textarea[name=note]', 'Everyone came for the 25th anniversary.');
    if (OUT) { await pg.locator('dialog .album-add-stage').scrollIntoViewIfNeeded(); await pg.waitForTimeout(400); await pg.screenshot({ path: `${OUT}15-add-to-album-named.png` }); }
    await pg.click('dialog .album-add button[type=submit]');
    await pg.waitForSelector('.album-spread:has-text("Anniversary dinner")');
    const added = await pg.evaluate(() => window.__db.library_links.find((l) => l.title === 'Anniversary dinner'));
    console.log('added from album:', JSON.stringify([added?.status, added?.faces.length, added?.taken_where, added?.taken_when]));
    if (!added || added.status !== 'approved' || added.faces.length !== 1 || added.taken_when !== 'About 1985') fail('picture added from the album not saved right');
    if (!(await pg.evaluate((p) => window.__files.has('library-photos/' + p), added.photo_path))) fail('album-added picture not stored');
    if (!/Amritsar/.test(await pg.textContent('.album-spread'))) fail('new album page details');
    if (OUT) { await pg.waitForTimeout(600); await pg.screenshot({ path: `${OUT}16-add-to-album-page.png` }); }
    await ctx.close();
  }
  // A member on a phone: a face for someone they don't look after waits for approval.
  {
    const { ctx, pg } = await open(b, { ...devices['iPhone 13'], hasTouch: true, ...(OUT ? {} : { deviceScaleFactor: 1 }) }, 'member');
    if (!await pg.$('[data-nav="faces"]')) fail('member has no Faces menu');
    await choosePhoto(pg);
    if (OUT) {
      await pg.waitForTimeout(600);
      await pg.screenshot({ path: `${OUT}7-phone-faces.png` });
      await pg.locator('.faces-grid').scrollIntoViewIfNeeded(); await pg.waitForTimeout(300);
      await pg.screenshot({ path: `${OUT}7b-phone-face-list.png` });
    }
    await pg.click('.face-card >> nth=0 >> .face-pick');
    await pickPerson(pg, 'bhanna');
    const label = await pg.textContent('dialog button[type=submit]');
    if (!/Send for approval/.test(label)) fail('member button: ' + label);
    if (OUT) await pg.screenshot({ path: `${OUT}8-phone-frame.png` });
    await pg.click('dialog button[type=submit]'); await pg.waitForTimeout(600);
    const r = await pg.evaluate(() => window.__db.change_requests.at(-1));
    if (r.kind !== 'set_photo' || r.status !== 'pending') fail('member photo should wait: ' + r.status);
    if (!/Sent for approval/.test(await pg.textContent('.face-card >> nth=0'))) fail('member face not shown as waiting');
    // The member keeps the photo: it waits for approval, and a tap on a face shows the name.
    await pg.locator('.faces-keep').scrollIntoViewIfNeeded();
    await pg.fill('.faces-keep input[type=text] >> nth=0', 'Our picnic');
    await pg.click('.faces-keep button[type=submit]'); await pg.waitForTimeout(600);
    const mk = await pg.evaluate(() => window.__db.library_links.find((l) => l.kind === 'photo'));
    if (!mk || mk.status !== 'pending') fail('member album photo should wait for approval');
    if (!/once the admin approves/.test(await pg.textContent('.faces-keep'))) fail('member not told it waits');
    await pg.evaluate(() => { window.__db.library_links.find((l) => l.kind === 'photo').status = 'approved'; });
    await pg.goto('http://localhost:8765/#/library'); await pg.waitForSelector('.album-tile');
    await pg.click('.album-tile-open'); await pg.waitForSelector('.album-spread .lib-face'); await pg.waitForTimeout(600);
    await pg.tap('.album-spread .lib-face >> nth=0'); await pg.waitForTimeout(200);
    if (!(await pg.locator('.album-spread .lib-face.show .lib-face-name').isVisible())) fail('tapping a face does not show the name');
    if (OUT) { await pg.screenshot({ path: `${OUT}13-phone-album-tap.png` }); }
    // A member adds a picture from the album without naming anyone: it waits for approval.
    await pg.click('dialog .modal-head button'); await pg.waitForTimeout(200);
    await pg.click('.album-tile-add button');
    await pg.waitForSelector('dialog .album-add');
    await pg.setInputFiles('#album-file', { name: 'trip.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(PHOTO) });
    await pg.waitForSelector('dialog .album-add-details:not([hidden])');
    await pg.waitForTimeout(400);
    const lbl = await pg.textContent('dialog .album-add button[type=submit]');
    if (!/Send to the album/.test(lbl)) fail('member add button: ' + lbl);
    await pg.fill('dialog input[name=title]', 'School trip');
    if (OUT) { await pg.screenshot({ path: `${OUT}17-phone-add-to-album.png` }); }
    await pg.click('dialog .album-add button[type=submit]'); await pg.waitForTimeout(600);
    const trip = await pg.evaluate(() => window.__db.library_links.find((l) => l.title === 'School trip'));
    if (!trip || trip.status !== 'pending' || trip.faces.length !== 0) fail('member album picture: ' + JSON.stringify(trip && [trip.status, trip.faces]));
    await ctx.close();
  }
  await b.close();
  console.log(process.exitCode ? 'faces: FAILED' : 'faces: ok');
})();
