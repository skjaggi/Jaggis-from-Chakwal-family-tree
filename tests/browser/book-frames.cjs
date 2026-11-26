// Book photos: each photo gets its own frame and a slight tilt (the same
// every time the book is built), and while editing any photo can be tilted,
// moved, made bigger or smaller, or given another frame. The changes are saved
// and printed. SHOTS_DIR=dir saves pictures.
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const ok = (c, m) => (c ? console.log('ok  ', m) : fail(m));
const seed = JSON.parse(fs.readFileSync(__dirname + '/../../site/data/seed.json'));
const sample = ['p1.jpg', 'p3.jpg', 'p2.jpg', 'p4.jpg'];
let n = 0;
for (const p of [...seed.people].sort((a, b) => (a.generation ?? 99) - (b.generation ?? 99))) { if (!p.photo_path) p.photo_path = `img/test/${sample[n++ % 4]}`; }
const idOf = (given) => seed.people.find((p) => p.given_name.startsWith(given)).id;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: OUT ? 2 : 1 });
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
  await ctx.route('**/js/config.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.route('**/data/seed.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(seed) }));
  await ctx.route('**/img/test/*', (r) => r.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(__dirname + '/book-photos/' + r.request().url().split('/').pop()) }));
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.addInitScript(() => { window.__FAKE_ROLE__ = 'admin'; window.__FAKE_CLAIMED__ = 1; window.__FAKE_NAME__ = 'Sunil Jaggi'; window.print = () => { window.__printed = true; }; try { for (const k of ['blessings-intro', 'blessingsIntro', 'founder-thanks']) localStorage.setItem(k, '1'); } catch {} });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => fail(e.message));
  await pg.goto('http://localhost:8765/#/book'); await pg.waitForTimeout(1500); await pg.keyboard.press('Escape');

  const shot = async (keys, name, edit) => {
    await pg.evaluate(() => { for (const el of document.querySelectorAll('body *')) if (['sticky', 'fixed'].includes(getComputedStyle(el).position)) { el.dataset.hid = '1'; el.style.display = 'none'; } });
    await pg.evaluate(([ks, edit]) => { const box = document.createElement('div'); box.id = 'shot'; box.style.cssText = 'display:flex;gap:24px;padding:24px;background:#e9ece6;position:absolute;left:0;top:0;z-index:99;zoom:0.5'; for (const k of ks) { const src = document.querySelector(`.bk-page[data-key="${k}"] .bk-doc`); const c = src.cloneNode(true); c.style.transform = 'none'; c.querySelectorAll('.low-res').forEach((e) => e.classList.remove('low-res')); if (!edit) c.querySelectorAll('.bp-ptools, .bp-pt-grip, .bp-photo-hint').forEach((e) => e.remove()); else c.querySelectorAll('.bp-main-ph .bp-ptools, .bp-main-ph .bp-pt-grip').forEach((e) => { e.style.opacity = 1; }); c.querySelectorAll('[contenteditable]:empty, .bp-mini').forEach((e) => e.remove()); c.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable')); box.append(c); } document.body.append(box); }, [keys, !!edit]);
    await pg.locator('#shot').screenshot({ path: `${OUT}${name}.png` });
    await pg.evaluate(() => { document.getElementById('shot').remove(); document.querySelectorAll('[data-hid]').forEach((el) => { el.style.display = ''; delete el.dataset.hid; }); });
  };
  await pg.click('button:has-text("Build the book")'); await pg.waitForSelector('.bk-page .bp'); await pg.waitForTimeout(3000);
  const walter = `.bk-page[data-key="fam:${idOf('Bhanna Mal')}"]`;
  const ph = `${walter} .bp-main-ph`;
  const looks = await pg.$$eval('.bk-page .bp-photo:not(.bp-cover-ph):not(.bp-full-ph)', (els) => els.map((e) => [...e.classList].find((c) => c.startsWith('fr-')) + '|' + e.style.transform));
  const frames = new Set(looks.map((l) => l.split('|')[0]));
  ok(frames.size >= 4, `photos get a mix of frames (${[...frames].join(', ')})`);
  ok(looks.filter((l) => l.includes('rotate')).length >= looks.length / 3, 'many photos sit at a slight angle');
  ok(!(await pg.$('.bp-cover-ph[style*="rotate"]')), 'the cover photo stays straight');
  // The same book built again looks the same (not a new shuffle every time).
  const again = async () => pg.$$eval('.bk-page .bp-photo', (els) => els.map((e) => e.className + e.style.transform).join());
  const first = await again();
  if (OUT) { const fams = await pg.$$eval('.bk-page[data-key^="fam:"]', (els) => els.map((e) => e.dataset.key)); await shot(fams.slice(0, 3), '1-mixed-frames'); await shot(fams.slice(3, 6), '1b-mixed-frames'); }
  // Tilt buttons
  const tf = () => pg.$eval(ph, (e) => e.style.transform);
  const r0 = (await tf()).match(/rotate\((-?[\d.]+)deg/)?.[1] || '0';
  await pg.hover(ph); await pg.click(`${ph} button[aria-label="Tilt right"]`); await pg.waitForTimeout(400);
  const r1 = (await tf()).match(/rotate\((-?[\d.]+)deg/)?.[1];
  ok(Math.abs(+r1 - (+r0 + 2)) < 0.01, `tilt right turns the photo 2 degrees (${r0} → ${r1})`);
  // Frame button
  const frOf = () => pg.$eval(ph, (e) => [...e.classList].find((c) => c.startsWith('fr-')));
  const f0 = await frOf(); await pg.hover(ph); await pg.click(`${ph} button[aria-label^="Frame"]`); await pg.waitForTimeout(400);
  ok((await frOf()) !== f0, `the frame button gives another frame (${f0} → ${await frOf()})`);
  // Drag to move
  const box0 = await pg.$eval(ph, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  await pg.hover(ph); const mv = await pg.$(`${ph} .bp-pt-move`); const mb = await mv.boundingBox();
  await pg.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await pg.mouse.down();
  await pg.mouse.move(mb.x - 40, mb.y + 30, { steps: 5 }); await pg.mouse.up(); await pg.waitForTimeout(500);
  const box1 = await pg.$eval(ph, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  const t1 = await tf(); ok(/translate\(calc\(var\(--pw\) \* -0\.\d+\), calc\(var\(--ph\) \* 0\.\d+\)\)/.test(t1), `dragging the ✥ button moves the photo left and down (${t1})`);
  // Drag the corner to resize
  await pg.hover(ph); const gb = await (await pg.$(`${ph} .bp-pt-grip`)).boundingBox();
  await pg.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await pg.mouse.down();
  await pg.mouse.move(gb.x + 40, gb.y + 40, { steps: 5 }); await pg.mouse.up(); await pg.waitForTimeout(500);
  const box2 = await pg.$eval(ph, (e) => e.getBoundingClientRect().width);
  ok(+((await tf()).match(/scale\(([\d.]+)\)/)?.[1] || 1) > 1.1, `dragging the corner makes the photo bigger (${Math.round(box1.w)} → ${Math.round(box2)})`);
  ok(!(await pg.$('.bk-page.is-hidden')) && !(await pg.$('#bk-chooser[open], .bk-chooser')), 'using the photo buttons does not open the photo chooser');
  if (OUT) await shot([`fam:${idOf('Bhanna Mal')}`], '2-walter-moved-tilted-bigger', true);
  // The PDF keeps the changes
  const want = await tf();
  await pg.click('button:has-text("Make the print-ready PDF")'); await pg.waitForTimeout(1500);
  const inPdf = await pg.$eval(`#bk-print .bp[data-key="fam:${idOf('Bhanna Mal')}"] .bp-main-ph`, (e) => e.style.transform).catch(() => '');
  ok(inPdf === want && /scale\(1\.[1-9]|scale\([2-3]/.test(inPdf), 'the PDF has the photo moved, tilted and bigger');
  ok(!(await pg.$('#bk-print .bp-ptools, #bk-print .bp-pt-grip')), 'the PDF has no photo buttons');
  await pg.keyboard.press('Escape'); await pg.evaluate(() => document.getElementById('bk-print')?.remove()); await pg.waitForTimeout(300);
  // The changes are saved with the book.
  await pg.waitForTimeout(1500);
  const saved = await pg.evaluate((k) => JSON.stringify(window.__db.book_drafts[0]?.data?.edits?.[k]?.pf || window.__db.book_drafts[0]), `fam:${idOf('Bhanna Mal')}`);
  ok(/"s":1\.[1-9]/.test(saved) && /"r":/.test(saved) && /"x":-?0\./.test(saved), 'the changes are saved with the book');
  // Reset puts this photo back
  await pg.hover(ph); await pg.click(`${ph} button[aria-label^="Put this photo back"]`); await pg.waitForTimeout(400);
  ok((await again()) === first, 'the reset button puts the photo back as it was');
  // Untick mixed frames: plain, straight photos.
  await pg.uncheck('#bk-mix-frames'); await pg.waitForTimeout(1500);
  ok(!(await pg.$('.bk-page .bp-photo[class*="fr-"]')) && !(await pg.$('.bk-page .bp-photo[style*="rotate"]')), 'unticking "Mixed photo frames" gives plain, straight photos');
  await pg.check('#bk-mix-frames'); await pg.waitForTimeout(1500);
  ok((await again()) === first, 'ticking it again brings the same frames back');
  await b.close();
})();
