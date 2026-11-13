// Dashboard: the tree at a glance, what is missing, and open questions.
// Everything is worked out from the data this visitor can already see, so it
// follows the same privacy rules as the rest of the site.
import {
  store, pendingCount, listProfiles, listInvites, listViews, visitorStats, listQuestions, addQuestion, updateQuestion, deleteQuestion, personLabel,
} from './data.js';
import { fullName, birthYear, skeleton, lifeLine } from './model.js';
import { branchesOf, BRANCH_GEN } from './branches.js';
import { h, clear, toast, field, formatWhen, confirmDialog } from './ui.js';
import { personPicker } from './forms.js';


function yearNum(v) {
  const m = String(v || '').match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

export function computeStats(fam) {
  const people = [...fam.byId.values()];
  const det = (p) => fam.details.get(p.id);
  const seen = people.filter((p) => det(p)); // details this visitor may see
  const living = people.filter((p) => p.is_living === true);
  const deceased = people.filter((p) => p.is_living === false);
  const gens = people.map((p) => p.generation).filter(Number.isFinite);
  const unions = new Set();
  for (const p of people) for (const u of fam.unionsOf(p.id)) unions.add(u.id || `${u.partner_a}-${u.partner_b}`);

  const years = seen.map((p) => yearNum(det(p).birth_date)).filter(Boolean);
  const earliestYear = years.length ? Math.min(...years) : null;
  const earliestPerson = earliestYear ? seen.find((p) => yearNum(det(p).birth_date) === earliestYear) : null;
  const top = people.filter((p) => p.generation === Math.min(...gens));

  const withSources = seen.filter((p) => det(p).sources);
  const withPhotos = people.filter((p) => p.photo_path);

  // Needs attention
  const missingParent = people.filter((p) => p.generation > 1 && fam.parentLinks(p.id).length === 0 && !fam.isMarriedIn(p.id));
  const uncertainParent = people.filter((p) => fam.parentLinks(p.id).some((l) => l.confidence === 'uncertain'));
  const noBirthYear = seen.filter((p) => !birthYear(det(p).birth_date));
  const noBirthPlace = seen.filter((p) => !det(p).birth_place);
  const deadNoYear = seen.filter((p) => p.is_living === false && !birthYear(det(p).death_date));
  const unknownStatus = people.filter((p) => p.is_living !== true && p.is_living !== false);
  const noSources = seen.filter((p) => !det(p).sources);
  const noPhoto = people.filter((p) => !p.photo_path);

  // Possible duplicates: same name (allowing for spelling) within a generation of each other.
  const byKey = new Map();
  for (const p of people) {
    const key = skeleton(`${p.given_name || ''}${p.surname || ''}`);
    if (!key) continue;
    (byKey.get(key) || byKey.set(key, []).get(key)).push(p);
  }
  const dupes = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const close = group.filter((p) => group.some((q) => q !== p && Math.abs((p.generation ?? 0) - (q.generation ?? 0)) <= 1));
    dupes.push(...close);
  }

  const br = branchesOf(fam);

  // Born by period (25-year spans), from the birth years this visitor can see
  const periods = new Map();
  for (const y of years) {
    const start = Math.floor(y / 25) * 25;
    periods.set(start, (periods.get(start) || 0) + 1);
  }
  const byPeriod = [...periods.entries()].sort((x, y) => x[0] - y[0]).map(([start, count]) => ({ label: `${start}–${start + 24}`, count }));

  // Birthplaces
  const places = new Map();
  for (const p of seen) {
    const raw = (det(p).birth_place || '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const cur = places.get(key) || { label: raw, count: 0 };
    cur.count++;
    places.set(key, cur);
  }
  let byPlace = [...places.values()].sort((x, y) => y.count - x.count);
  if (byPlace.length > 8) {
    const rest = byPlace.slice(7).reduce((n, x) => n + x.count, 0);
    byPlace = [...byPlace.slice(0, 7), { label: 'Other places', count: rest }];
  }

  // Most common first names
  const names = new Map();
  for (const p of people) {
    const first = (p.given_name || '').trim().split(/\s+/)[0];
    if (first) names.set(first, (names.get(first) || 0) + 1);
  }
  const commonNames = [...names.entries()].filter(([, n]) => n > 1).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 8);

  const earliest = people.filter((p) => p.generation && p.generation <= 2)
    .sort((a, b) => a.generation - b.generation || (a.birth_order ?? 0) - (b.birth_order ?? 0));

  return {
    people, living, deceased, unknownStatus, gens, unions: unions.size, top, earliestYear, earliestPerson,
    withSources, withPhotos, seenCount: seen.length,
    attention: [
      { key: 'no-birth-year', label: 'No birth year', list: noBirthYear, where: 'details' },
      { key: 'no-birth-place', label: 'No birthplace', list: noBirthPlace, where: 'details' },
      { key: 'dead-no-year', label: 'Died, but no year of death', list: deadNoYear, where: 'details' },
      { key: 'unknown-status', label: 'Not known if living', list: unknownStatus, where: 'details' },
      { key: 'missing-parent', label: 'No parent in the tree', list: missingParent, where: 'relationships' },
      { key: 'uncertain-parent', label: 'Parent not confirmed', list: uncertainParent, where: 'relationships' },
      { key: 'possible-dupes', label: 'Possible duplicates (similar names)', list: dupes, where: 'people' },
      { key: 'no-sources', label: 'No sources noted', list: noSources, where: 'sources' },
      { key: 'no-photo', label: 'No photo', list: noPhoto, where: 'photos' },
    ],
    branches: br.list, earlier: br.earlier, byPeriod, byPlace, commonNames, earliest,
  };
}

const personHref = (id) => `#/tree/${store.fam.defaultRootId}?p=${id}`;

function tile(value, label, sub) {
  return h('div.stat', h('div.stat-label', label), h('div.stat-value', String(value)), sub ? h('div.stat-sub', sub) : null);
}

function peopleList(list) {
  const sorted = [...list].sort((a, b) => (a.generation ?? 99) - (b.generation ?? 99) || fullName(a).localeCompare(fullName(b)));
  return h('ul.dash-people', sorted.map((p) => h('li', h('a', { href: personHref(p.id) }, fullName(p)),
    p.generation ? h('span.muted', ` · gen ${p.generation}`) : null)));
}

// Horizontal bars, one row per item, value written at the end of each bar.
function barChart(rows, label, { colour, unit = ['person', 'people'] } = {}) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return h('div.bars', { role: 'table', 'aria-label': label },
    rows.map((r) => h('div.bar-row', { role: 'row', title: `${r.label}: ${r.count} ${r.count === 1 ? unit[0] : unit[1]}` },
      h('div.bar-label', { role: 'cell' }, r.href ? h('a', { href: r.href }, r.label) : r.label),
      h('div.bar-track', { role: 'cell' },
        h('div.bar', { style: `width:${(r.count / max) * 100}%;${colour ? `background:${colour(r)}` : ''}` }),
        h('span.bar-value', String(r.count))))));
}

function branchChart(branches, earlier) {
  const rows = [...branches.map((b) => ({ label: fullName(b.person, { title: false }), count: b.count, href: personHref(b.person.id), slot: b.slot })),
    ...(earlier ? [{ label: 'Generations 1–3', count: earlier, slot: 'gold' }] : [])];
  return barChart(rows, 'People per branch', { colour: (r) => (r.slot === 'gold' ? 'var(--gold)' : `var(--branch-${r.slot})`) });
}

// ---------------------------------------------------------------- visits
// Admin only: which signed-in members visit, how often, and what they open.
// A "visit" is a run of page views with no gap longer than 30 minutes.
const VISIT_GAP = 30 * 60 * 1000;
const VIEW_LABEL = { tree: 'Tree', outline: 'List', dashboard: 'Dashboard', mine: 'My changes', invite: 'Invite', review: 'Review', members: 'Members', export: 'Export' };

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

async function visitsSection() {
  const box = h('section.dash-card.wide', h('h2', 'Visits by family members'), h('p.muted', 'Loading…'));
  Promise.all([listViews(90), listProfiles(), listInvites().catch(() => [])]).then(([views, profiles, invites]) => {
    const me = store.session?.user.id;
    const rows = views.filter((v) => v.user_id !== me);
    const byUser = new Map();
    for (const v of rows) (byUser.get(v.user_id) || byUser.set(v.user_id, []).get(v.user_id)).push(v);
    const sessions = (list) => {
      let n = 0, prev = null;
      for (const v of [...list].sort((a, b) => new Date(a.viewed_at) - new Date(b.viewed_at))) {
        const t = new Date(v.viewed_at).getTime();
        if (prev === null || t - prev > VISIT_GAP) n++;
        prev = t;
      }
      return n;
    };
    const within = (v, days) => Date.now() - new Date(v.viewed_at) < days * 864e5;
    const fam = store.fam;
    const name = (pr) => (pr.person_id && fam.byId.get(pr.person_id) ? fullName(fam.byId.get(pr.person_id), { title: false }) : pr.display_name || pr.email);

    const members = profiles.filter((pr) => pr.id !== me).map((pr) => {
      const list = byUser.get(pr.id) || [];
      const counts = new Map();
      for (const v of list) if (v.person_id) counts.set(v.person_id, (counts.get(v.person_id) || 0) + 1);
      const fav = [...counts].sort((a, b) => b[1] - a[1])[0];
      return { pr, list, last: list[0]?.viewed_at, visits: sessions(list), fav: fav && fam.byId.get(fav[0]) };
    }).sort((a, b) => (b.last ? new Date(b.last) : 0) - (a.last ? new Date(a.last) : 0));

    const active30 = members.filter((m) => m.list.some((v) => within(v, 30))).length;
    const visits7 = [...byUser.values()].reduce((n, l) => n + sessions(l.filter((v) => within(v, 7))), 0);
    const people30 = rows.filter((v) => v.person_id && within(v, 30)).length;

    const personCounts = new Map();
    for (const v of rows) if (v.person_id && fam.byId.has(v.person_id)) personCounts.set(v.person_id, (personCounts.get(v.person_id) || 0) + 1);
    const topPeople = [...personCounts].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([id, count]) => ({ label: fullName(fam.byId.get(id)), count, href: personHref(id) }));
    const br = branchesOf(fam);
    const branchCounts = new Map();
    for (const [id, c] of personCounts) {
      const b = br.of.get(id);
      const key = b ? b.person.id : 'early';
      branchCounts.set(key, (branchCounts.get(key) || 0) + c);
    }
    const topBranches = [...branchCounts].sort((a, b) => b[1] - a[1]).map(([id, count]) => {
      const b = br.list.find((x) => x.person.id === id);
      return b ? { label: fullName(b.person, { title: false }), count, slot: b.slot } : { label: 'Generations 1–3', count, slot: 'gold' };
    });

    // Visits per week, last 12 weeks.
    const weeks = [];
    for (let w = 11; w >= 0; w--) {
      const end = Date.now() - w * 7 * 864e5, start = end - 7 * 864e5;
      const inWeek = rows.filter((v) => { const t = new Date(v.viewed_at).getTime(); return t >= start && t < end; });
      const per = new Map();
      for (const v of inWeek) (per.get(v.user_id) || per.set(v.user_id, []).get(v.user_id)).push(v);
      const d = new Date(start);
      weeks.push({ label: `Week of ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`, count: [...per.values()].reduce((n, l) => n + sessions(l), 0) });
    }

    while (weeks.length > 4 && weeks[0].count === 0) weeks.shift(); // skip quiet weeks before tracking began
    const notYet = invites.filter((i) => !i.accepted_at);
    const unit = ['view', 'views'];
    clear(box,
      h('h2', 'Visits by family members'),
      h('p.muted.small', 'Only you can see this. It covers signed-in family members over the last 90 days, not counting your own visits. A visit is one sitting; opening a person counts as a view. Public visitors who don\'t sign in are counted separately and anonymously.'),
      h('div.stats',
        tile(active30, 'Members active', 'last 30 days'),
        tile(visits7, 'Visits', 'last 7 days'),
        tile(people30, 'People opened', 'last 30 days')),
      h('h3', 'Members'),
      members.length ? h('table.dash-table',
        h('thead', h('tr', h('th', 'Member'), h('th', 'Last seen'), h('th.num', 'Visits'), h('th.num', 'Views'), h('th', 'Looked at most'))),
        h('tbody', members.map((m) => h('tr',
          h('td', name(m.pr)),
          h('td', m.last ? h('span', { title: formatWhen(m.last) }, ago(m.last)) : h('span.muted', 'not since tracking began')),
          h('td.num', String(m.visits)),
          h('td.num', String(m.list.length)),
          h('td', m.fav ? h('a', { href: personHref(m.fav.id) }, fullName(m.fav, { title: false })) : h('span.muted', '—')))))) : h('p.muted', 'No other members have signed in yet.'),
      notYet.length ? [h('h3', `Invited but not signed in yet (${notYet.length})`),
        h('ul.dash-people.single', notYet.map((i) => h('li', i.display_name || i.email, h('span.muted', ` · invited ${formatWhen(i.created_at)}`))))] : null,
      h('div.dash-grid',
        h('div', h('h3', 'Most viewed people'), topPeople.length ? barChart(topPeople, 'Most viewed people', { unit }) : h('p.muted', 'No one opened yet.')),
        h('div', h('h3', 'Most viewed branches'), topBranches.length ? barChart(topBranches, 'Most viewed branches', { unit, colour: (r) => (r.slot === 'gold' ? 'var(--gold)' : `var(--branch-${r.slot})`) }) : h('p.muted', 'No one opened yet.')),
        h('div', h('h3', 'Visits per week'), barChart(weeks, 'Visits per week', { unit: ['visit', 'visits'] }))));
  }).catch((e) => {
    clear(box, h('h2', 'Visits by family members'),
      h('p.muted', /page_views|relation|schema cache/i.test(e.message) ? 'Visit tracking is not switched on yet. Run supabase/updates/2026-11-13-member-visits.sql in the Supabase SQL Editor.' : `Could not load visits: ${e.message}`));
  });
  return box;
}

// ---------------------------------------------------------------- public visitors
// Admin only: anonymous visitors counted by GoatCounter (no names, no cookies).
const COUNTRY = (() => { try { return new Intl.DisplayNames(undefined, { type: 'region' }); } catch { return null; } })();
function placeName(s) {
  // GoatCounter gives "US" or "US-AZ" style codes, with a name.
  if (s.name && !/^[A-Z]{2}(-|$)/.test(s.name)) return s.name;
  const code = String(s.id || s.name || '').split('-')[0];
  try { return COUNTRY?.of(code) || s.name || code; } catch { return s.name || code; }
}

async function publicVisitorsSection() {
  const box = h('section.dash-card.wide', h('h2', 'Public visitors'), h('p.muted', 'Loading…'));
  let days = 30;
  const load = () => visitorStats(days).then((d) => {
    const stats = (x) => (x?.stats || []).filter((s) => s.count > 0).map((s) => ({ label: s.name || s.id || 'Other', count: s.count, raw: s }));
    const totalDays = d.total?.stats || [];
    // Visits by hour of day. GoatCounter already gives these in the time zone
    // set in its own settings (picked from the browser when the account was made).
    const shift = 0;
    const hours = Array(24).fill(0);
    for (const day of totalDays) (day.hourly || []).forEach((n, hr) => { hours[(((hr + shift) % 24) + 24) % 24] += n; });
    const hourRows = hours.map((n, hr) => ({ label: `${String(hr).padStart(2, '0')}:00`, count: n }));
    const busiest = hours.indexOf(Math.max(...hours));
    // Visits per day (or per week for long ranges).
    const perDay = totalDays.map((x) => ({ label: new Date(`${x.day}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), count: x.daily || 0 }));
    let timeRows = perDay;
    if (perDay.length > 14) {
      timeRows = [];
      for (let i = 0; i < perDay.length; i += 7) timeRows.push({ label: `Week of ${perDay[i].label}`, count: perDay.slice(i, i + 7).reduce((n, r) => n + r.count, 0) });
    }
    const pages = (d.pages?.hits || []).map((x) => ({ label: x.title && !/^Jaggis of Chakwal$/.test(x.title) ? `${x.title}` : x.path, count: x.count || 0 }));
    const places = stats(d.locations).map((r) => ({ ...r, label: placeName(r.raw) }));
    const refs = stats(d.referrers).map((r) => ({ ...r, label: r.label === '' || r.label === '(unknown)' ? 'Typed in or bookmark' : r.label })).sort((a, b) => b.count - a.count);
    const unit = ['visitor', 'visitors'];
    const total = d.total?.total ?? 0;
    const picker = h('select', { 'aria-label': 'Period', onchange: (e) => { days = Number(e.target.value); clear(box, h('h2', 'Public visitors'), h('p.muted', 'Loading…')); load(); } },
      [7, 30, 90, 365].map((n) => h('option', { value: n, selected: n === days }, n === 365 ? 'Last year' : `Last ${n} days`)));
    clear(box,
      h('div.dash-head', h('h2', 'Public visitors'), picker),
      h('p.muted.small', 'Everyone who opens the site, signed in or not, counted anonymously by GoatCounter: no names, no cookies. Only you can see this. Times are in your time zone. Search words people typed into Google are in Google Search Console.'),
      h('div.stats',
        tile(total, 'Visitors', days === 365 ? 'last year' : `last ${days} days`),
        tile(places.length, 'Countries and regions', places[0] ? `most from ${places[0].label}` : ''),
        tile(total ? `${String(busiest).padStart(2, '0')}:00` : '—', 'Busiest hour', 'your time')),
      h('div.dash-grid',
        h('div', h('h3', 'Where visitors are'), places.length ? barChart(places.slice(0, 12), 'Where visitors are', { unit }) : h('p.muted', 'No visitors yet.')),
        h('div', h('h3', 'How they found the site'), refs.length ? barChart(refs.slice(0, 10), 'How they found the site', { unit }) : h('p.muted', 'Nothing yet. Visitors from Google, WhatsApp and other sites will show here.')),
        h('div', h('h3', 'Pages visited'), pages.length ? barChart(pages.slice(0, 12), 'Pages visited', { unit }) : h('p.muted', 'No visitors yet.')),
        h('div', h('h3', timeRows === perDay ? 'Visitors per day' : 'Visitors per week'), timeRows.length ? barChart(timeRows, 'Visitors over time', { unit }) : h('p.muted', 'No visitors yet.')),
        h('div', h('h3', 'Time of day'), total ? barChart(hourRows, 'Time of day', { unit }) : h('p.muted', 'No visitors yet.')),
        h('div', h('h3', 'Devices'),
          barChart(stats(d.sizes), 'Screen sizes', { unit }) || h('p.muted', 'No visitors yet.'),
          h('h3', 'Browsers'), barChart(stats(d.browsers), 'Browsers', { unit }) || h('p.muted', '—'),
          h('h3', 'Systems'), barChart(stats(d.systems), 'Systems', { unit }) || h('p.muted', '—'))),
      h('p.muted.small', 'More detail: ', h('a', { href: 'https://jaggis-chakwal.goatcounter.com', target: '_blank', rel: 'noopener' }, 'open GoatCounter'), '.'));
  }).catch((e) => {
    const msg = /not_configured/.test(e.message)
      ? 'Not switched on yet: the GoatCounter token still needs to be saved as a secret in Supabase.'
      : /Failed to send a request/i.test(e.message) ? 'Could not reach the visitor-stats server function in Supabase.'
        : `Could not load visitor numbers: ${e.message}`;
    clear(box, h('h2', 'Public visitors'), h('p.muted', msg),
      h('p.muted.small', 'You can still see the numbers directly on ', h('a', { href: 'https://jaggis-chakwal.goatcounter.com', target: '_blank', rel: 'noopener' }, 'GoatCounter'), '.'));
  });
  load();
  return box;
}

async function questionsSection() {
  const box = h('section.dash-card.dash-wide', h('h2', 'Open questions'), h('p.muted', 'Loading…'));
  if (!store.signedIn) {
    clear(box, h('h2', 'Open questions'), h('p.muted', 'Family members can sign in to see and add open questions.'));
    return box;
  }
  const render = async () => {
    let qs;
    try {
      qs = await listQuestions();
    } catch (e) {
      const missing = /research_questions|schema cache|does not exist/i.test(e.message);
      clear(box, h('h2', 'Open questions'), h('p.notice', missing ? 'Open questions will appear here once the admin finishes setting them up.' : e.message));
      return;
    }
    let chosen = null;
    const chosenLabel = h('span.form-note', '');
    const form = h('form.form.q-form',
      field('Question *', h('textarea', { name: 'question', rows: 2, required: true, placeholder: 'e.g. Who was Kesar Mal’s wife?' })),
      field('About (optional)', personPicker((p) => { chosen = p; chosenLabel.textContent = `About ${fullName(p)}`; })),
      chosenLabel,
      field('Next step (optional)', h('input', { name: 'next_step', type: 'text', placeholder: 'e.g. Ask Dadi; look for the school record' })),
      h('div.form-actions', h('button.btn.primary', { type: 'submit' }, 'Add question')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const question = form.question.value.trim();
      if (!question) return;
      try {
        await addQuestion({ question, person_id: chosen?.id, next_step: form.next_step.value.trim() });
        toast('Question added.', 'ok');
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    const open = qs.filter((q) => q.status === 'open');
    const closed = qs.filter((q) => q.status !== 'open');
    const row = (q) => h('li.q',
      h('div.q-text', q.question),
      h('div.muted.small',
        q.person_id ? h('a', { href: personHref(q.person_id) }, personLabel(q.person_id)) : null,
        q.person_id ? ' · ' : '', `added ${formatWhen(q.created_at)}`),
      q.next_step ? h('div.small', h('strong', 'Next step: '), q.next_step) : null,
      q.answer ? h('div.small', h('strong', 'Answer: '), q.answer) : null,
      store.isAdmin && q.status === 'open' ? h('div.q-actions',
        h('button.btn.small', { type: 'button', onclick: (e) => {
          const ans = h('input', { type: 'text', placeholder: 'The answer (optional)' });
          const save = h('button.btn.small.primary', { type: 'button', onclick: async () => {
            try { await updateQuestion(q.id, { status: 'answered', answer: ans.value.trim() || null }); render(); } catch (err) { toast(err.message, 'error'); }
          } }, 'Save');
          e.currentTarget.parentElement.replaceChildren(ans, save);
          ans.focus();
        } }, 'Mark answered'),
        h('button.btn.small.ghost', { type: 'button', onclick: async () => {
          if (!(await confirmDialog('Remove this question?', 'Remove'))) return;
          try { await deleteQuestion(q.id); render(); } catch (err) { toast(err.message, 'error'); }
        } }, 'Remove')) : null);
    clear(box,
      h('h2', `Open questions (${open.length})`),
      h('p.muted.small', 'Things the family is still trying to find out. Anyone signed in can add one; the admin marks them answered.'),
      open.length ? h('ul.q-list', open.map(row)) : h('p.muted', 'No open questions yet.'),
      h('details', h('summary', 'Add a question'), form),
      closed.length ? h('details', h('summary', `Answered (${closed.length})`), h('ul.q-list', closed.map(row))) : null);
  };
  render();
  return box;
}

export async function renderDashboard(container) {
  const fam = store.fam;
  const s = computeStats(fam);
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const total = s.people.length;
  const maxGen = s.gens.length ? Math.max(...s.gens) : 0;
  const top = s.top[0];

  const tiles = h('div.stats',
    tile(total, 'People', `${s.living.length} living · ${s.deceased.length} deceased`),
    tile(maxGen, 'Generations', top ? `from ${fullName(top)}` : ''),
    tile(s.earliestYear || '—', 'Earliest recorded year', s.earliestPerson ? fullName(s.earliestPerson) : 'no years yet'),
    tile(s.unions, 'Marriages', ''),
    tile(s.branches.length, 'Branches', `from generation ${BRANCH_GEN}`),
    tile(s.withPhotos.length, 'With a photo', `${pct(s.withPhotos.length, total)}% of people`),
    tile(s.withSources.length, 'With a source', `${pct(s.withSources.length, s.seenCount)}% of those you can see`));
  const extra = tiles; // admin-only tiles join the same grid
  if (store.isAdmin) {
    Promise.all([pendingCount().catch(() => 0), listProfiles().catch(() => [])]).then(([pending, profiles]) => {
      extra.append(
        h('a.stat.stat-link', { href: '#/review' }, h('div.stat-label', 'Waiting for approval'), h('div.stat-value', String(pending)), h('div.stat-sub', 'open Review')),
        h('a.stat.stat-link', { href: '#/members' }, h('div.stat-label', 'Members signed in'), h('div.stat-value', String(profiles.length)), h('div.stat-sub', 'open Members')));
    });
  }

  const attention = h('table.dash-table',
    h('thead', h('tr', h('th', 'What'), h('th.num', 'How many'), h('th', 'Area'))),
    h('tbody', s.attention.flatMap((a) => {
      if (!a.list.length) {
        return [h('tr', h('td', a.label), h('td.num', h('span.muted', '0')), h('td.muted.area', a.where))];
      }
      // The names open in a full-width row underneath, so they fit on a phone.
      const names = h('tr.names-row', { hidden: true }, h('td', { colspan: 3 }, peopleList(a.list)));
      const toggle = h('button.linkish.row-toggle', { type: 'button', 'aria-expanded': 'false', onclick: () => {
        names.hidden = !names.hidden;
        toggle.setAttribute('aria-expanded', String(!names.hidden));
      } }, a.label);
      return [h('tr', h('td', toggle), h('td.num', h('strong', String(a.list.length))), h('td.muted.area', a.where)), names];
    })));

  clear(container,
    h('h1', 'Family dashboard'),
    h('p.muted', 'The tree at a glance. Tap a row to see who it is about, then tap a name to open their card.'),
    tiles,
    store.isAdmin ? await visitsSection() : null,
    store.isAdmin ? await publicVisitorsSection() : null,
    h('div.dash-grid',
      h('section.dash-card', h('h2', 'Needs attention'),
        attention,
        store.isAdmin ? null : h('p.muted.small', 'Dates, places and sources count only the people whose details you can see.')),
      h('section.dash-card', h('h2', 'People per branch'),
        h('p.muted.small', `Everyone descended from each generation-${BRANCH_GEN} ancestor, with their spouses. Each branch's colour is also the top edge of its cards in the tree.`),
        branchChart(s.branches, s.earlier)),
      h('section.dash-card', h('h2', 'Born by period'),
        s.byPeriod.length ? barChart(s.byPeriod, 'People born per period')
          : h('p.muted', 'No birth years recorded yet. Add them with "Suggest an edit" on a person\'s card.')),
      h('section.dash-card', h('h2', 'Birthplaces'),
        s.byPlace.length ? barChart(s.byPlace, 'Birthplaces', { colour: () => 'var(--leaf)' })
          : h('p.muted', 'No birthplaces recorded yet.')),
      h('section.dash-card', h('h2', 'Earliest ancestors'),
        h('ul.dash-people.single', s.earliest.map((p) => h('li', h('a', { href: personHref(p.id) }, fullName(p)),
          h('span.muted', ` · generation ${p.generation}${lifeLine(p, store.fam.details.get(p.id)) ? ` · ${lifeLine(p, store.fam.details.get(p.id))}` : ''}`))))),
      h('section.dash-card', h('h2', 'Most common first names'),
        s.commonNames.length ? h('table.dash-table',
          h('thead', h('tr', h('th', 'Name'), h('th.num', 'People'))),
          h('tbody', s.commonNames.map(([n, c]) => h('tr', h('td', n), h('td.num', String(c))))))
          : h('p.muted', 'Every first name is different so far.'))),
    await questionsSection());
}
