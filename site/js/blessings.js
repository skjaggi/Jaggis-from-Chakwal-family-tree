// Blessings: points family members earn for approved additions to the tree,
// the badges they unlock, the leaderboard page and the corner chip at the top.
// The database works out the points (public.blessings_ledger); the scoring
// here only predicts them for the thank-you message after saving.
import { store } from './data.js';
import { fullName } from './model.js';
import { branchesOf } from './branches.js';
import { h, clear, toast, formatWhen, initials, field, select, modal } from './ui.js';

const ICON = {
  root: 'M12 4c-3 0-5 2.2-5 5 0 2 1.2 3.4 2.6 4.2L9 20h6l-.6-6.8C15.8 12.4 17 11 17 9c0-2.8-2-5-5-5z',
  story: 'M6 5h9l3 3v11H6z M9 11h6 M9 14h6',
  photo: 'M5 8h3l1.5-2h5L16 8h3v10H5z M12 15.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  link: 'M8 9a2 2 0 1 0 0-.1M16 9a2 2 0 1 0 0-.1M12 16a2 2 0 1 0 0-.1M9 10.5l2 4M15 10.5l-2 4',
  branch: 'M12 20v-9 M12 14l-4-3 M12 12l4-3.5 M8 11l-1.5-2.5 M8 11H5.5 M16 8.5l1.5-2.5 M16 8.5h2.5 M12 11V6.5 M9 20h6',
  seed: 'M12 20v-7 M12 13c0-3.5-2.4-6-6-6 0 3.5 2.4 6 6 6z M12 11c0-3.5 2.4-6 6-6 0 3.5-2.4 6-6 6z M8.5 20h7',
  star: 'M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4L4.2 9.7l5.4-.8z',
};
export const BADGES = [
  { id: 'root', name: 'Root Keeper', how: 'Add 10 people to the tree', need: 10, count: 'person', color: '#2f6b5a', icon: ICON.root },
  { id: 'story', name: 'Storyteller', how: 'Add 5 stories', need: 5, count: 'story', color: '#8a5a2b', icon: ICON.story },
  { id: 'photo', name: 'Photo Finder', how: 'Add 10 photos', need: 10, count: 'photo', color: '#3b6fb6', icon: ICON.photo },
  { id: 'conn', name: 'Connector', how: '3 relatives you invited sign in', need: 3, count: 'invite', color: '#7b4fa3', icon: ICON.link },
  { id: 'hist', name: 'Family Historian', how: 'Most blessings this month', need: 1, count: 'historian', color: '#c49a3a', icon: ICON.star },
];

// Special badges given by hand, not earned, each tied to one account and to
// that person's own box in the tree (so everyone sees it on the tree too).
export const FOUNDER = { id: 'founder', name: 'Founder of the Jaggi Family Tree', short: 'Founder', how: 'Had the idea and made the first family trees this one grew from', card: 'He had the idea for this family tree and made the first two family trees it grew from.', color: '#17706b', icon: ICON.seed, special: true,
  user: 'fb6fc331-a891-4756-8cfe-37a178b54fe4', person: '71296ea4-33fc-50e4-9924-8b156fdb27e9' }; // Suraj Parkash Jaggi
export const CREATOR = { id: 'creator', name: 'Creator of the Jaggi Family Tree', short: 'Creator', how: 'Built this family tree, with the idea and blessing of the founder', card: 'He built this family tree, with the idea and blessing of the founder, Suraj Parkash Jaggi.', color: '#7a2e3a', icon: ICON.branch, special: true,
  user: '80115979-6027-4f4a-939e-7fbad4c489a2', person: '143f144c-493b-5c9f-9996-9f7de3feafcc' }; // Sunil Kumar Jaggi
const SPECIAL = [FOUNDER, CREATOR];
export const specialOf = (userId) => SPECIAL.filter((b) => b.user === userId);
export const specialOfPerson = (personId) => SPECIAL.filter((b) => b.person === personId);
const isFounder = (userId) => FOUNDER.user === userId;

export function medal(b, cls = 'medal') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', b.name);
  svg.innerHTML = b.special
    ? `<title>${b.name}</title><circle cx="12" cy="12" r="11.4" fill="#c49a3a"/><circle cx="12" cy="12" r="9.6" fill="${b.color}"/><circle cx="12" cy="12" r="8.4" fill="none" stroke="#f3dc95" stroke-width=".7"/><path d="${b.icon}" fill="none" stroke="#f3dc95" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<title>${b.name}</title><circle cx="12" cy="12" r="11" fill="${b.color}"/><circle cx="12" cy="12" r="9.2" fill="none" stroke="#f3dc95" stroke-width=".8"/><path d="${b.icon}" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
}
const coin = () => h('span.coin', { 'aria-hidden': 'true' }, '✦');

// ---------------------------------------------------------------- data
let cache = null;
let cacheAt = 0;
export function forgetBlessings() { cache = null; }
export async function loadBlessings() {
  if (!store.signedIn || store.preview) return [];
  if (cache && Date.now() - cacheAt < 60_000) return cache;
  const { data, error } = await store.sb.rpc('blessings_ledger');
  if (error) throw error;
  cache = data || [];
  cacheAt = Date.now();
  return cache;
}

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); };

// Per member: totals, counts toward badges, and their rows.
export function summarize(rows) {
  const since = monthStart();
  const by = new Map();
  for (const r of rows) {
    let m = by.get(r.user_id);
    if (!m) by.set(r.user_id, m = { id: r.user_id, name: r.name, personId: r.person_id, role: r.role, total: 0, month: 0, counts: { person: 0, story: 0, photo: 0, invite: 0 }, rows: [] });
    m.total += r.points;
    if (r.at >= since) m.month += r.points;
    if (r.kind === 'add_person') m.counts.person++;
    if (r.story) m.counts.story++;
    if (r.kind === 'set_photo' && !/^Re-centered/i.test(r.reason || '')) m.counts.photo++;
    if (r.kind === 'invite') m.counts.invite++;
    m.rows.push(r);
  }
  const list = [...by.values()];
  // Family Historian: the member (admins aside) with the most blessings this month.
  const top = list.filter((m) => m.role !== 'admin' && m.month > 0).sort((a, b) => b.month - a.month)[0];
  for (const m of list) {
    m.counts.historian = m === top ? 1 : 0;
    m.badges = [...specialOf(m.id), ...BADGES.filter((b) => m.counts[b.count] >= b.need)];
    m.rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  }
  return list;
}

// Predicts the blessings for a change (mirrors public.blessings_ledger).
const DETAIL = { notes: 5, birth_date: 2, death_date: 2, birth_place: 2, death_place: 2, profession: 2, sources: 2 };
const detailPoints = (d = {}) => Object.entries(d || {}).reduce((n, [k, v]) =>
  n + (k === 'visibility' || v === null || v === undefined || String(v).trim() === '' ? 0 : (DETAIL[k] ?? 1)), 0);
const MULT = { 1: 5, 2: 4, 3: 3, 4: 2 };
export function estimateBlessings(kind, payload, summary = '') {
  const fam = store.fam;
  let gen = null;
  if (payload?.person_id) gen = fam?.byId.get(payload.person_id)?.generation;
  else if (kind === 'add_person' && payload?.link) {
    const of = fam?.byId.get(payload.link.of)?.generation;
    if (of) gen = payload.link.as === 'child' ? of + 1 : payload.link.as === 'parent' ? of - 1 : of;
  }
  const mult = MULT[gen] || 1;
  let base = 0;
  if (kind === 'add_person') base = 5 + detailPoints(payload.details);
  else if (kind === 'edit_person') base = detailPoints(payload.details) + Object.keys(payload.person || {}).length;
  else if (kind === 'set_photo') base = /^Re-centered/i.test(summary) ? 1 : 5;
  else if (kind === 'add_link') base = 3;
  return { points: base * mult, mult };
}

export function thankYou(kind, payload, summary, applied) {
  const { points, mult } = estimateBlessings(kind, payload, summary);
  if (!points) return '';
  const extra = mult > 1 ? ` (${mult}× for an early generation)` : '';
  return applied ? ` +${points} blessings${extra}. Thank you!` : ` You'll get +${points} blessings${extra} once it's approved.`;
}

// ---------------------------------------------------------------- how it works
// A short explanation, shown once to each member the first time they sign in
// after Blessings arrived, and again from "How it works" whenever they like.
const seenKey = () => `blessings-intro-seen:${store.session?.user?.id || ''}`;
export function maybeShowBlessingsIntro() {
  if (!store.signedIn || store.preview || document.querySelector('dialog[open]')) return false;
  try { if (localStorage.getItem(seenKey())) return false; localStorage.setItem(seenKey(), '1'); } catch { return false; }
  showBlessingsIntro();
  return true;
}

// Congratulations, once a month, to whoever holds Family Historian (the most
// blessings this month). It can change hands, so a new leader is greeted too.
// A one-time thank-you to the founder, the first time he signs in after this.
export function maybeShowFounderThanks() {
  if (!store.signedIn || store.preview || !isFounder(store.session.user.id) || document.querySelector('dialog[open]')) return false;
  const key = `founder-thanks:${store.session.user.id}`;
  try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, '1'); } catch { return false; }
  const first = (store.profile?.display_name || '').trim().split(/\s+/)[0];
  const m = modal('A special badge', h('div.historian-pop',
    medal(FOUNDER, 'medal big-medal founder-medal'),
    h('p.hp-title', `Thank you${first ? `, ${first}` : ''}!`),
    h('p', 'You are the ', h('b', 'Founder of the Jaggi Family Tree'), '. This tree began with your idea and the first two family trees you put together.'),
    h('p', 'Everything the family adds here grows from that work. This badge is yours alone, and it shows next to your name for everyone to see.'),
    h('div.form-actions',
      h('button.btn', { type: 'button', onclick: () => { m.close(); location.hash = '#/blessings'; } }, 'See the leaderboard'),
      h('button.btn.primary', { type: 'button', onclick: () => m.close() }, 'Thank you'))));
  return true;
}

let congratsChecked = false;
export async function maybeShowHistorianCongrats() {
  if (congratsChecked) return false;
  congratsChecked = true;
  if (!store.signedIn || store.preview || document.querySelector('dialog[open]')) return false;
  const now = new Date();
  const key = `historian-congrats:${store.session.user.id}:${now.getFullYear()}-${now.getMonth() + 1}`;
  try { if (localStorage.getItem(key)) return false; } catch { return false; }
  let me;
  try { me = summarize(await loadBlessings()).find((m) => m.id === store.session.user.id); } catch { return false; }
  if (!me?.counts.historian || document.querySelector('dialog[open]')) return false;
  try { localStorage.setItem(key, '1'); } catch { /* shown anyway */ }
  showHistorianCongrats(me);
  return true;
}
export function showHistorianCongrats(me) {
  const month = new Date().toLocaleString('en', { month: 'long' });
  const first = (store.profile?.display_name || me.name || '').trim().split(/\s+/)[0];
  const m = modal('Family Historian', h('div.historian-pop',
    medal(BADGES.find((b) => b.id === 'hist'), 'medal big-medal'),
    h('p.hp-title', `Congratulations${first ? `, ${first}` : ''}!`),
    h('p', 'You are our ', h('b', `Family Historian for ${month}`), `. You have earned the most blessings in the family this month, `, h('b', `${me.month}`), ' so far.'),
    h('p', 'Thank you for keeping our family\'s story alive. Keep adding what you know to hold on to the badge until the end of the month.'),
    h('div.form-actions',
      h('button.btn', { type: 'button', onclick: () => { m.close(); location.hash = '#/blessings'; } }, 'See the leaderboard'),
      h('button.btn.primary', { type: 'button', onclick: () => m.close() }, 'Thank you'))));
  return m;
}
export function showBlessingsIntro() {
  const step = (n, title, text, extra) => h('section.intro-step', h('h3', h('span.intro-n', String(n)), title), h('p', text), extra);
  const m = modal('Welcome to Family Blessings', h('div.bless-intro',
    h('p.intro-lead', coin(), ' Every time you add to the family tree, you earn ', h('b', 'blessings'), '. They show how much each of us has given to keeping our family story alive.'),
    step(1, 'Add what you know', 'Each update earns blessings:', rulesTable()),
    step(2, 'Our elders count most', 'Details about the earliest generations are the rarest, so their blessings are multiplied:', multTable()),
    step(3, 'Collect badges', 'Reach a goal and you keep the badge for good.'),
    h('ul.intro-badges', BADGES.map((b) => h('li', medal(b), h('span', h('b', b.name), h('small', b.how))))),
    h('p.muted.small', store.claimedId
      ? 'Your blessings and badges show at the top right, next to your photo. Tap them to see the family leaderboard. Blessings count once a change is approved.'
      : 'Claim your own box with "This is me" to earn your first 5 blessings, and your blessings and badges will show at the top right. Blessings count once a change is approved.'),
    h('div.form-actions',
      h('button.btn', { type: 'button', onclick: () => { m.close(); location.hash = '#/blessings'; } }, 'See the leaderboard'),
      h('button.btn.primary', { type: 'button', onclick: () => m.close() }, 'Got it'))));
  return m;
}

// ---------------------------------------------------------------- corner chip
// At the top right once someone has signed in and claimed their box: their
// photo, their blessings and the badges they have.
export async function renderCorner(el) {
  if (!store.signedIn || store.preview || !store.claimedId) return false;
  let me = null;
  try { me = summarize(await loadBlessings()).find((m) => m.id === store.session.user.id); } catch { /* show without numbers */ }
  const p = store.fam.byId.get(store.claimedId);
  const photo = store.photoUrls.get(store.claimedId);
  clear(el, h('a.me-chip', { href: '#/blessings', title: 'Your blessings and badges' },
    photo ? h('img.me-photo', { src: photo, alt: '' }) : h('span.me-photo.me-initials', initials(p?.given_name || store.profile?.display_name || '')),
    h('span.me-name', store.profile?.display_name || (p ? fullName(p, { title: false }) : '')),
    h('span.me-points', coin(), ` ${me?.total ?? 0}`),
    me?.badges?.length ? h('span.me-badges', me.badges.map((b) => medal(b, 'mini-medal'))) : null),
  h('button.me-help', { type: 'button', title: 'How blessings and badges work', 'aria-label': 'How blessings and badges work', onclick: showBlessingsIntro }, '?'));
  return true;
}

// ---------------------------------------------------------------- page
export async function renderBlessings(page) {
  clear(page, h('p.muted', 'Loading blessings…'));
  let rows;
  try { rows = await loadBlessings(); } catch (e) { clear(page, h('h1', 'Family Blessings'), h('p.muted', 'Blessings are being set up. Please check back in a little while.')); console.warn(e); return; }
  const people = summarize(rows);
  const meId = store.session.user.id;
  const me = people.find((m) => m.id === meId);
  let period = 'month';

  const board = h('ol.board');
  const drawBoard = () => {
    const key = period === 'month' ? 'month' : 'total';
    const list = people.filter((m) => m[key] > 0).sort((a, b) => b[key] - a[key]);
    clear(board, list.length ? list.map((m, i) => {
      const p = m.personId && store.fam.byId.get(m.personId);
      const br = p && branchesOf(store.fam).of.get(p.id);
      const photo = m.personId && store.photoUrls.get(m.personId);
      return h('li' + (m.id === meId ? '.me' : ''),
        h('span.rank', String(i + 1)),
        photo ? h('img.av', { src: photo, alt: '' }) : h('span.av', initials(m.name)),
        h('span.who-cell', h('b', m.name), h('small', [br ? `${fullName(br.person, { title: false })} branch` : 'No box claimed yet', m.role === 'admin' ? ' · admin' : '', ...specialOf(m.id).map((b) => ` · ${b.short}`)].join(''))),
        h('span.pts', h('span.mini-badges', m.badges.map((b) => medal(b, 'mini-medal'))), String(m[key]), coin()));
    }) : h('li.empty', period === 'month' ? 'No blessings yet this month. Be the first!' : 'No blessings yet.'));
  };
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Period' },
    ...[['month', new Date().toLocaleString('en', { month: 'long' })], ['all', 'All time']].map(([v, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(v === period), onclick: (e) => {
        period = v;
        for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        drawBoard();
      } }, label)));
  drawBoard();

  // Branch totals (all time), by the claimed box's generation-4 branch.
  const totals = new Map();
  for (const m of people) {
    const br = m.personId && branchesOf(store.fam).of.get(m.personId);
    if (br) totals.set(br, (totals.get(br) || 0) + m.total);
  }
  const brList = [...totals].sort((a, b) => b[1] - a[1]);
  const max = brList[0]?.[1] || 1;

  const myCounts = me?.counts || { person: 0, story: 0, photo: 0, invite: 0, historian: 0 };
  clear(page,
    h('div.bless-head', h('h1.bless-title', 'Family Blessings'), h('button.btn.small', { type: 'button', onclick: showBlessingsIntro }, 'How it works')),
    h('p.muted', 'Every approved addition to the tree earns blessings. Details about the earliest generations count more: 5× for Generation 1, 4× for 2, 3× for 3 and 2× for 4.'),
    h('div.bless-grid',
      h('section.bless-card', seg, board),
      h('div.bless-side',
        h('section.bless-card',
          h('h2', 'Your badges'),
          h('p.muted.small', me ? `${me.total} blessings so far, ${me.month} this month.` : 'Add something to the tree to earn your first blessings.'),
          h('div.badges', specialOf(meId).map((b) => h('div.badge.special', medal(b), h('b', b.name), h('small', b.how), h('small.num', 'Special badge'))), BADGES.map((b) => {
            const have = Math.min(myCounts[b.count] || 0, b.need);
            const done = have >= b.need;
            return h('div.badge' + (done ? '' : '.locked'), medal(b), h('b', b.name), h('small', b.how),
              b.count === 'historian' ? h('small.num', done ? 'This month' : 'Not this month') :
                [h('span.prog', h('i', { style: `width:${(have / b.need) * 100}%` })), h('small.num', done ? 'Earned' : `${have} of ${b.need}`)]);
          }))),
        brList.length ? h('section.bless-card',
          h('h2', 'Branch totals'),
          h('div.branch-bars', brList.map(([br, n]) => h('div.br-row',
            h('span', fullName(br.person, { title: false })), h('b.num', String(n)),
            h('span.bar', h('i', { style: `width:${Math.max(3, (n / max) * 100)}%; background:${br.slot ? `var(--branch-${br.slot})` : 'var(--muted)'}` })))))) : null)),
    me ? h('section.bless-card.bless-mine',
      h('h2', 'Your blessings'),
      h('ul.ledger', me.rows.slice(0, 30).map((r) => h('li', h('span', r.reason, h('small.muted', ` · ${formatWhen(r.at)}`)), h('b.num', `${r.points > 0 ? '+' : ''}${r.points}`))))) : null,
    store.isAdmin ? adjustForm(people) : null,
    h('section.bless-card',
      h('h2', 'How blessings are earned'),
      rulesTable(), multTable(),
      h('p.muted.small', 'Blessings count once a change is approved. The admin can add or take back blessings.')));
}
const rule = (what, n) => h('tr', h('td', what), h('td.n', String(n)));
function rulesTable() {
  return h('table.rules', h('tbody',
    rule('Add a person', 5), rule('A story about someone (in "Notes / Story")', 5), rule('Add a photo', 5),
    rule('Birth or death year, birth or death place, profession, source', '2 each'),
    rule('Other details, like names or gender', '1 each'), rule('Connect two people already in the tree', 3),
    rule('A link for the family Library (once approved)', 3),
    rule('Claim your own box ("This is me")', 5), rule('Invite a relative who then signs in', 10)));
}
function multTable() {
  return h('table.rules.mult', h('thead', h('tr', h('th', 'Details about'), h('th.n', 'Earn'))), h('tbody',
    rule('Generation 1 (Bakhshi Bhanna Mal Jaggi)', '5×'), rule('Generation 2', '4×'), rule('Generation 3', '3×'), rule('Generation 4', '2×'),
    rule('Everyone else', '1×')));
}

function adjustForm(people) {
  const who = select('user', people.map((m) => [m.id, m.name]).sort((a, b) => a[1].localeCompare(b[1])), '');
  const pts = h('input', { name: 'points', type: 'number', min: -500, max: 500, step: 1, value: 10, required: true });
  const why = h('input', { name: 'reason', type: 'text', required: true, placeholder: 'e.g. Found the 1947 papers' });
  const form = h('form.form.adjust-form',
    h('div.row-fields', field('Member', who), field('Blessings (minus to take back)', pts)),
    field('Reason (they will see it)', why),
    h('div.form-actions', h('button.btn.primary', { type: 'submit' }, 'Give blessings')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = parseInt(pts.value, 10);
    if (!who.value || !n) return toast('Pick a member and a number other than 0.', 'error');
    const { error } = await store.sb.from('blessing_adjustments').insert({ user_id: who.value, points: n, reason: why.value.trim() });
    if (error) return toast(error.message, 'error');
    toast(`${n > 0 ? 'Gave' : 'Took back'} ${Math.abs(n)} blessings.`, 'ok');
    forgetBlessings();
    renderBlessings(form.closest('.page') || document.getElementById('page'));
  });
  return h('section.bless-card', h('h2', 'Give or take back blessings (admin)'), form);
}
