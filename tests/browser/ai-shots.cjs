// AI helper (#/ai) against the fake backend: Ask the family tree, research a
// person who has passed away, use a finding. Takes preview pictures too.
//   (server running on 8765) SHOTS_DIR=/some/dir node ai-shots.cjs
// Also runs as a test in run.sh.
const { chromium, devices } = require('playwright'); const fs = require('fs'); const path = require('path');
const OUT = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const SITE = 'http://localhost:8765/';
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../../site/data/seed.json'), 'utf8'));
const idOf = (given) => seed.people.find((p) => p.given_name === given).id;

async function context(b, { role = 'admin', phone = false, theme = 'light', sample = true } = {}) {
  const ctx = await b.newContext(phone ? devices['iPhone 13'] : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await ctx.route('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/.vendor/d3.esm.js') }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
  await ctx.route('**/js/config.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: "export const config = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', siteTitle: 'Jaggis of Chakwal', adminName: 'Sunil' };" }));
  await ctx.addInitScript(([r, t, s]) => { window.__FAKE_ROLE__ = r; window.__FAKE_CLAIMED__ = 1; window.__FAKE_AI__ = s; window.__FAKE_NAME__ = r === 'admin' ? 'Sunil Jaggi' : 'Asha'; try { localStorage.setItem('theme', t); } catch {} sessionStorage.setItem('claim-welcome', '1'); }, [role, theme, sample ? 1 : 0]);
  return ctx;
}
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const watch = (pg) => { pg.on('pageerror', (e) => errors.push(e.message)); pg.on('console', (m) => m.type() === 'error' && console.log('console:', m.text())); };

  // Admin: the AI page, asking a question.
  let ctx = await context(b); let pg = await ctx.newPage(); watch(pg);
  await pg.goto(SITE + '#/ai'); await pg.waitForSelector('.ai-ask .chip'); await pg.waitForSelector('.ai-finding');
  ok(await pg.locator('nav a[data-nav=ai], [data-nav=ai]').count() >= 1, 'admin menu has Ask AI');
  ok((await pg.textContent('.ai-spend')).includes('of the $2.00 daily limit'), 'today\'s spending and limit shown');
  await pg.setViewportSize({ width: 1280, height: 2300 }); await pg.waitForTimeout(300);
  await pg.screenshot({ path: OUT + 'ai-page-desktop.png' });
  await pg.setViewportSize({ width: 1280, height: 900 });
  await pg.click('.ai-ask .chip >> nth=0');
  await pg.waitForSelector('.ai-msg.ai .ai-person');
  ok(await pg.locator('.ai-msg.me').count() === 1, 'question shows in the chat');
  ok(await pg.locator('.ai-msg.ai a.ai-person').count() >= 3, 'answer links people to the tree');
  ok(await pg.locator('.ai-msg.ai strong a.ai-person').count() >= 1 && !(await pg.textContent('.ai-msg.ai')).includes('](#P'), 'names inside bold headings are links too');
  ok((await pg.textContent('.ai-msg.ai .ai-cost')).includes('cost'), 'answer shows its cost');
  await pg.locator('.ai-ask').screenshot({ path: OUT + 'ai-ask-desktop.png' });
  const href = await pg.getAttribute('.ai-msg.ai a.ai-person >> nth=0', 'href');
  ok(href.includes(`?p=${idOf('Kesar Mal')}`), 'person link opens their card in the tree');

  // Using a finding: the profession and the strong sources are ticked already.
  await pg.click('.ai-finding button:has-text("Use the ticked items")');
  await pg.click('dialog button:has-text("Use these")');
  await pg.waitForFunction(() => (window.__approved || []).length === 1);
  const appr = await pg.evaluate(() => window.__approved[0].payload);
  ok(appr.details.profession === 'Merchant' && appr.details.sources.includes('example.com/sample-arya-school-1933'), 'used details go in as an edit');
  ok(!appr.details.sources.includes('sample-gazetteer'), 'only strong-match sources are added');
  ok(await pg.evaluate(() => window.__db.ai_findings[0].status) === 'used', 'finding marked as used');

  // Research from a person's card (deceased only).
  await pg.goto(SITE + `#/tree/${idOf('Bhanna Mal')}?p=${idOf('Kesar Mal')}`);
  await pg.waitForSelector('.ai-card-box button');
  await pg.locator('.panel').screenshot({ path: OUT + 'ai-card-button.png' }).catch(() => {});
  await pg.click('.ai-card-box button');
  await pg.waitForSelector('dialog .ai-sent');
  ok(!(await pg.textContent('dialog .ai-sent')).includes('Sunil'), 'living relatives are not in what is sent');
  await pg.screenshot({ path: OUT + 'ai-research-start.png' });
  await pg.click('dialog button:has-text("Start the search")');
  await pg.waitForSelector('dialog .ai-searching');
  await pg.screenshot({ path: OUT + 'ai-research-searching.png' });
  await pg.waitForSelector('dialog .ai-finding .ai-sources', { timeout: 15000 });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: OUT + 'ai-research-result.png' });
  ok(await pg.locator('dialog .ai-finding .tag:has-text("Medium confidence")').count() === 1, 'finding shows its confidence');
  await pg.click('dialog button:has-text("Decline")');
  await pg.waitForFunction(() => window.__db.ai_findings.some((f) => f.status === 'declined'));
  ok(true, 'finding can be declined');
  await pg.keyboard.press('Escape');
  // A living person's card: no search button.
  await pg.goto(SITE + `#/tree/${idOf('Bhanna Mal')}?p=${idOf('Sunil Kumar')}`);
  await pg.waitForSelector('.ai-card-box');
  ok(await pg.locator('.ai-card-box button').count() === 0, 'no web research for living people');
  await ctx.close();

  // Dark mode and phone.
  ctx = await context(b, { theme: 'dark' }); pg = await ctx.newPage(); watch(pg);
  await pg.goto(SITE + '#/ai'); await pg.waitForSelector('.ai-finding'); await pg.click('.ai-ask .chip >> nth=0'); await pg.waitForSelector('.ai-msg.ai .ai-person');
  await pg.setViewportSize({ width: 1280, height: 2300 }); await pg.waitForTimeout(300); await pg.screenshot({ path: OUT + 'ai-page-dark.png' });
  await ctx.close();
  ctx = await context(b, { phone: true }); pg = await ctx.newPage(); watch(pg);
  await pg.goto(SITE + '#/ai'); await pg.waitForSelector('.ai-finding'); await pg.click('.ai-ask .chip >> nth=0'); await pg.waitForSelector('.ai-msg.ai .ai-person');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone: no sideways scrolling');
  await pg.screenshot({ path: OUT + 'ai-page-phone.png', fullPage: true });
  await ctx.close();

  // Members don't get the AI helper during the pilot.
  ctx = await context(b, { role: 'member' }); pg = await ctx.newPage(); watch(pg);
  await pg.goto(SITE + '#/ai'); await pg.waitForSelector('#page h1');
  ok((await pg.textContent('#page')).includes('being tested by the admins'), 'members see that the AI helper is admins only');
  ok(await pg.locator('[data-nav=ai]').count() === 0, 'members have no Ask AI menu item');
  await ctx.close();

  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await b.close();
})();
