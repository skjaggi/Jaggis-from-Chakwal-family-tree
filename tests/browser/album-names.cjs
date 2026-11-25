// "Name the faces" on a photo already in the Family Album (the admin, or the member
// who added it; other members don't get the button): the photo opens
// with its names, faces nobody named are found, a name is added and one taken
// off, and the album shows the new names. Uses the made-up cartoon group photo.
const { chromium, devices } = require('playwright'); const fs = require('fs');
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const PHOTO = __dirname + '/book-photos/group-sample.jpg';
// The five faces in group-sample.jpg as fractions of the photo: [x, y, width, height].
const ALL = [[0.1237, 0.318, 0.0775, 0.1302], [0.2888, 0.302, 0.0725, 0.1218], [0.46, 0.266, 0.08, 0.1344], [0.6375, 0.305, 0.075, 0.126], [0.8025, 0.344, 0.07, 0.1176]];
const box = ([x, y, w, h]) => ({ x, y, w, h });
const ALBUM = [{ src: '/test-photos/group.jpg', title: 'Cousins at the wedding', taken_where: 'Delhi', taken_when: 'December 2019', note: 'Sample photo.',
  faces: [{ name: 'Tapashi Ram', ...box(ALL[0]) }, { name: 'Harbans Lal', ...box(ALL[2]) }] }];
(async () => {
  const b = await chromium.launch(); const errors = [];
  for (const [label, dev] of [['desktop', { viewport: { width: 1280, height: 860 } }], ['phone', devices['iPhone 13']]]) {
    for (const who of ['admin', 'member', 'sender']) {
      const role = who === 'admin' ? 'admin' : 'member';
      const ctx = await b.newContext({ ...dev, deviceScaleFactor: 1 });
      await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
      await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
      await ctx.route('**/test-photos/group.jpg', (r) => r.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(PHOTO) }));
      await ctx.route('https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/**', (r) => r.fulfill({ contentType: 'application/javascript', body: `
        const boxes = ${JSON.stringify(ALL)};
        export const nets = { ssdMobilenetv1: { loadFromUri: async () => {} } };
        export class SsdMobilenetv1Options { constructor(o) { Object.assign(this, o); } }
        export async function detectAllFaces(c) { return boxes.map(([x, y, w, h]) => ({ box: { x: x * c.width, y: y * c.height, width: w * c.width, height: h * c.height } })); }` }));
      await ctx.addInitScript(([role, al]) => {
        Object.assign(window, { __FAKE_ROLE__: role, __FAKE_CLAIMED__: 1, __FAKE_ALBUM__: al });
        try { sessionStorage.setItem('claim-welcome', '1'); for (const k of ['blessings-intro', 'blessingsIntro', 'founder-thanks']) localStorage.setItem(k, '1'); } catch {}
      }, [role, ALBUM.map((a) => ({ ...a, mine: who === 'sender' }))]);
      const pg = await ctx.newPage();
      pg.on('pageerror', (e) => errors.push(`${label} ${who}: ${e.message}`));
      await pg.goto('http://localhost:8765/#/library'); await pg.waitForSelector('.album-tile');
      await pg.click('.album-tile-open'); await pg.waitForSelector('.album-spread .lib-face'); await pg.waitForTimeout(300);
      const btn = pg.locator('.album-spread button', { hasText: 'Name the faces' });
      if (who === 'member') { if (await btn.count()) fail(`${label}: a member sees Name the faces on someone else's photo`); else console.log(`ok: ${label} member: no Name the faces on someone else's photo`); await ctx.close(); continue; }
      if (!(await pg.locator('.album-spread button', { hasText: 'Edit the details' }).count())) fail(`${label} ${who}: no Edit the details`);
      await btn.click();
      await pg.waitForSelector('dialog .album-add-stage .face-box');
      await pg.waitForFunction(() => /not named yet/.test(document.querySelector('dialog .faces-status')?.textContent || ''));
      const faces = await pg.$$eval('dialog .album-add-stage .face-box', (els) => els.map((e) => e.classList.contains('named')));
      if (faces.length !== 5 || faces.filter(Boolean).length !== 2) fail(`${label}: expected 5 faces, 2 named: ${JSON.stringify(faces)}`);
      else console.log(`ok: ${label} ${who}: opens with 2 names and finds 3 more faces`);
      if (await pg.locator('dialog input[name=title]').isVisible()) fail(`${label}: details form should be hidden`);
      await pg.locator('dialog .face-box:not(.named)').first().click();
      await pg.fill('dialog .album-add-who .picker input', 'Kesar'); await pg.click('dialog .album-add-who .pick-list button');
      await pg.locator('dialog .face-box.named', { hasText: 'Harbans' }).click();
      await pg.locator('dialog .album-add-who button', { hasText: 'Remove the name' }).click();
      await pg.locator('dialog button[type=submit]', { hasText: 'Save the names' }).click();
      await pg.waitForTimeout(800);
      const row = await pg.evaluate(() => window.__db.library_links.find((l) => l.kind === 'photo'));
      const names = await pg.evaluate((ids) => ids.map((id) => window.__db.people.find((p) => p.id === id).given_name), row.faces.map((f) => f.person_id));
      if (row.faces.length !== 2 || !names.includes('Kesar Mal') || names.includes('Harbans Lal') || row.title !== ALBUM[0].title) fail(`${label}: names not saved right: ${names}`);
      else console.log(`ok: ${label} ${who}: saved ${names.join(', ')}`);
      await pg.waitForSelector('.album-spread .lib-face'); await pg.waitForTimeout(300);
      if (!/Kesar Mal/.test(await pg.textContent('.album-spread .lib-photo-names'))) fail(`${label}: album does not show the new name`);
      await ctx.close();
    }
  }
  await b.close();
  console.log('album names ERRORS:', errors.length ? errors.join('; ') : 'none');
  if (errors.length) process.exitCode = 1;
})();
