// Dashboard: the tree at a glance, what is missing, and open questions.
// Everything is worked out from the data this visitor can already see, so it
// follows the same privacy rules as the rest of the site.
import {
  store, pendingCount, listProfiles, listQuestions, addQuestion, updateQuestion, deleteQuestion, personLabel,
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
function barChart(rows, label, { colour } = {}) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return h('div.bars', { role: 'table', 'aria-label': label },
    rows.map((r) => h('div.bar-row', { role: 'row', title: `${r.label}: ${r.count} ${r.count === 1 ? 'person' : 'people'}` },
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
