// Blessings: points family members earn for approved additions to the tree,
// the badges they unlock, the leaderboard page and the corner chip at the top.
// The database works out the points (public.blessings_ledger); the scoring
// here only predicts them for the thank-you message after saving.
import { store } from './data.js';
import { fullName } from './model.js';
import { branchesOf } from './branches.js';
import { h, clear, toast, formatWhen, initials, field, select } from './ui.js';

const ICON = {
  root: 'M12 4c-3 0-5 2.2-5 5 0 2 1.2 3.4 2.6 4.2L9 20h6l-.6-6.8C15.8 12.4 17 11 17 9c0-2.8-2-5-5-5z',
  story: 'M6 5h9l3 3v11H6z M9 11h6 M9 14h6',
  photo: 'M5 8h3l1.5-2h5L16 8h3v10H5z M12 15.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  link: 'M8 9a2 2 0 1 0 0-.1M16 9a2 2 0 1 0 0-.1M12 16a2 2 0 1 0 0-.1M9 10.5l2 4M15 10.5l-2 4',
  star: 'M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4L4.2 9.7l5.4-.8z',
};
export const BADGES = [
  { id: 'root', name: 'Root Keeper', how: 'Add 10 people to the tree', need: 10, count: 'person', color: '#2f6b5a', icon: ICON.root },
  { id: 'story', name: 'Storyteller', how: 'Add 5 stories', need: 5, count: 'story', color: '#8a5a2b', icon: ICON.story },
  { id: 'photo', name: 'Photo Finder', how: 'Add 10 photos', need: 10, count: 'photo', color: '#3b6fb6', icon: ICON.photo },
  { id: 'conn', name: 'Connector', how: '3 relatives you invited sign in', need: 3, count: 'invite', color: '#7b4fa3', icon: ICON.link },
  { id: 'hist', name: 'Family Historian', how: 'Most blessings this month', need: 1, count: 'historian', color: '#c49a3a', icon: ICON.star },
];

export function medal(b, cls = 'medal') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', b.name);
  svg.innerHTML = `<title>${b.name}</title><circle cx="12" cy="12" r="11" fill="${b.color}"/><circle cx="12" cy="12" r="9.2" fill="none" stroke="#f3dc95" stroke-width=".8"/><path d="${b.icon}" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
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
    m.badges = BADGES.filter((b) => m.counts[b.count] >= b.need);
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
    me?.badges?.length ? h('span.me-badges', me.badges.map((b) => medal(b, 'mini-medal'))) : null));
  return true;
}

// ---------------------------------------------------------------- page
export async function renderBlessings(page) {
  clear(page, h('p.muted', 'Loading blessings…'));
  let rows;
  try { rows = await loadBlessings(); } catch (e) { clear(page, h('p.error', e.message)); return; }
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
        h('span.who-cell', h('b', m.name), h('small', [br ? `${fullName(br.person, { title: false })} branch` : 'No box claimed yet', m.role === 'admin' ? ' · admin' : ''].join(''))),
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
    h('h1.bless-title', 'Family Blessings'),
    h('p.muted', 'Every approved addition to the tree earns blessings. Details about the earliest generations count more: 5× for Generation 1, 4× for 2, 3× for 3 and 2× for 4.'),
    h('div.bless-grid',
      h('section.bless-card', seg, board),
      h('div.bless-side',
        h('section.bless-card',
          h('h2', 'Your badges'),
          h('p.muted.small', me ? `${me.total} blessings so far, ${me.month} this month.` : 'Add something to the tree to earn your first blessings.'),
          h('div.badges', BADGES.map((b) => {
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
      h('table.rules', h('tbody',
        rule('Add a person', 5), rule('A story about someone (Notes)', 5), rule('Add a photo', 5),
        rule('Birth or death year, birth or death place, profession, source', '2 each'),
        rule('Other details, like names or gender', '1 each'), rule('Connect two people already in the tree', 3),
        rule('Claim your own box ("This is me")', 5), rule('Invite a relative who then signs in', 10),
        rule('Generation 1, 2, 3 or 4 ancestors', '×5, ×4, ×3, ×2'))),
      h('p.muted.small', 'Blessings count once a change is approved. The admin can add or take back blessings.')));
}
const rule = (what, n) => h('tr', h('td', what), h('td.n', String(n)));

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
