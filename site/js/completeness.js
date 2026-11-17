// Members page (admin only): "Missing details". For every branch admin (a
// member who claimed their box) it lists the people they look after whose
// boxes are still missing key details, and writes each of them a friendly,
// personal reminder email naming what is missing. The admin can edit every
// email and preview it before anything is sent. Emails go out through the
// same send-reminder function as the general reminder, one person at a time.
import { store, functionError } from './data.js';
import { fullName } from './model.js';
import { h, clear, toast, confirmDialog } from './ui.js';

// What counts as "missing". To change the list, add or remove a check here.
export const CHECKS = [
  { key: 'photo', label: 'photo', test: (p) => !p.photo_path },
  { key: 'birth', label: 'birth year', test: (p, d) => !d?.birth_date?.trim() },
  { key: 'death', label: 'year of passing', test: (p, d) => p.is_living === false && !d?.death_date?.trim() },
  { key: 'birthplace', label: 'birthplace', test: (p, d) => !d?.birth_place?.trim() },
  { key: 'gender', label: 'gender', test: (p) => !p.gender || p.gender === 'unknown' },
  { key: 'living', label: 'whether living', test: (p) => p.is_living === null || p.is_living === undefined },
];

// Names we don't know yet ("Daughter Name (?)", "Unknown") aren't worth a reminder line.
const PLACEHOLDER = /\(\?\)|\?\s*$|\bunknown\b|\bname\b/i;
const MAX_LINES = 12; // people listed in one email; the rest are summed up

const SUBJECT = 'A few missing details in your part of the family tree';

// The people a branch admin looks after, as the database decides it
// (public._branch_of): their box, everyone below it, and those people's
// spouses. Someone who married in doesn't get their own spouse's box.
export function branchOf(fam, c) {
  const down = new Set([c]);
  const stack = [c];
  while (stack.length) {
    for (const l of fam.childLinks(stack.pop())) if (!down.has(l.child_id)) { down.add(l.child_id); stack.push(l.child_id); }
  }
  const all = new Set(down);
  for (const id of down) {
    if (id === c && fam.isMarriedIn(c)) continue;
    for (const { person } of fam.spouses(id)) if (person) all.add(person.id);
  }
  return [...all];
}

export function missingFor(fam, id) {
  const p = fam.byId.get(id);
  if (!p) return [];
  const d = fam.details.get(id);
  return CHECKS.filter((c) => c.test(p, d)).map((c) => c.label);
}

const keyOf = Object.fromEntries(CHECKS.map((c) => [c.label, c.key]));

// One report per branch admin: who they are, how many boxes they look after,
// and the people with gaps (their own box first, then generation by generation).
export function completenessReport(fam, keepers) {
  return keepers.filter((u) => fam.byId.has(u.claimed_person_id)).map((u) => {
    const ids = branchOf(fam, u.claimed_person_id);
    const gaps = [];
    for (const id of ids) {
      const p = fam.byId.get(id);
      if (!p || PLACEHOLDER.test(fullName(p, { title: false }))) continue;
      const missing = missingFor(fam, id);
      if (missing.length) gaps.push({ id, name: fullName(p, { title: false }), you: id === u.claimed_person_id, gen: p.generation ?? 99, order: p._order ?? 0, missing });
    }
    gaps.sort((a, b) => b.you - a.you || a.gen - b.gen || a.order - b.order || a.name.localeCompare(b.name));
    return { user: u, rootName: fullName(fam.byId.get(u.claimed_person_id), { title: false }), total: ids.length, complete: ids.length - gaps.length, gaps };
  });
}

const joinWords = (w) => (w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`);

export function draftMessage(r) {
  const shown = r.gaps.slice(0, MAX_LINES);
  const keys = new Set(shown.flatMap((g) => g.missing.map((m) => keyOf[m])));
  const onlyPhotos = keys.size === 1 && keys.has('photo');
  const lines = shown.map((g) => `• ${g.name}${g.you ? ' (you)' : ''}${onlyPhotos ? '' : `: ${joinWords(g.missing)}`}`);
  const more = r.gaps.length - MAX_LINES;
  if (more > 0) lines.push(`• …and ${more} more ${more === 1 ? 'person' : 'people'} in your family`);
  const branch = r.rootName && !PLACEHOLDER.test(r.rootName) ? `the ${r.rootName} family branch` : 'your family branch';
  const thanks = `Thank you for being the branch admin for ${branch} of our tree. ` + (r.complete > 0
    ? `${r.complete} of the ${r.total} people in your branch already ${r.complete === 1 ? 'has' : 'have'} all their key details, which is wonderful.`
    : 'Every detail you add helps keep the story of the Jaggis of Chakwal alive for the generations after us.');
  const ask = onlyPhotos
    ? `The only thing missing now is a photo for ${r.gaps.length === 1 ? 'one person' : `${r.gaps.length} people`}. If you have ${r.gaps.length === 1 ? 'one' : 'any'}, could you please add ${r.gaps.length === 1 ? 'it' : 'them'} when you have a few minutes?`
    : 'A few details are still missing. If you know any of them, could you please add them when you have a few minutes?';

  // How-to tips only for the kinds of details this person is missing.
  const tips = [];
  if (keys.has('photo')) tips.push(`To add a photo, sign in, tap the person's box and then tap their photo circle. A clear picture of the face works best${keys.size === 1 ? ', and an old family photo is lovely too' : ''}.`);
  const facts = CHECKS.filter((c) => c.key !== 'photo' && keys.has(c.key)).map((c) => (c.key === 'living' ? 'whether they are living' : c.label));
  if (facts.length) tips.push(`To add ${joinWords(facts.map((f) => (f.startsWith('whether') ? f : `the ${f}`)))}, sign in, tap the person's box and press Edit.`);
  if (keys.has('birth') || keys.has('death')) tips.push('If you are not sure of a year, an approximate one such as "c. 1950" is perfectly fine.');

  return [
    thanks,
    `${ask}\n${lines.join('\n')}`,
    tips.join(' '),
    'Every detail you add also earns blessings on the family leaderboard. Thank you for helping keep our family\'s story complete.',
  ].join('\n\n');
}

async function call(body) {
  const { data, error } = await store.sb.functions.invoke('send-reminder', { body });
  if (error) throw new Error(await functionError(error));
  return data;
}

const firstName = (u) => (u.display_name || '').trim().split(/\s+/)[0] || 'Name';

export function completenessSection(invites, profiles, removed = []) {
  const fam = store.fam;
  const gone = new Set(removed.map((r) => String(r.email).toLowerCase()));
  const keepers = profiles.filter((u) => u.claimed_person_id && u.email && u.id !== store.session.user.id && !gone.has(u.email.toLowerCase()));
  const reports = completenessReport(fam, keepers)
    .sort((a, b) => b.gaps.length - a.gaps.length || (a.user.display_name || a.user.email).localeCompare(b.user.display_name || b.user.email));
  const noBox = profiles.filter((u) => !u.claimed_person_id && u.id !== store.session.user.id && u.email && !gone.has(u.email.toLowerCase())).length;

  const boxes = new Map();
  const count = h('span.muted');
  const update = () => { count.textContent = `${[...boxes.values()].filter((b) => b.checked).length} selected`; };
  const pick = (test) => { for (const r of reports) boxes.get(r.user.id).checked = test(r); update(); };
  const href = (id) => `#/tree/${fam.defaultRootId}?p=${id}&edit=1`;

  const cards = reports.map((r) => {
    const box = h('input', { type: 'checkbox', id: `cmp-${r.user.id}`, checked: r.gaps.length > 0, disabled: !r.gaps.length, onchange: update });
    boxes.set(r.user.id, box);
    const pct = r.total ? Math.round((r.complete / r.total) * 100) : 100;
    return h('li.cmp-card',
      h('label.cmp-head', { for: `cmp-${r.user.id}` }, box,
        h('span.cmp-who', h('strong', r.user.display_name || r.user.email), h('span.muted.small', ` · branch of ${fullName(fam.byId.get(r.user.claimed_person_id))}`)),
        h('span.rem-tag' + (r.gaps.length ? '.half' : '.ok'), r.gaps.length ? `${r.gaps.length} of ${r.total} need details` : 'All complete')),
      h('div.cmp-bar', { title: `${pct}% complete` }, h('span', { style: `width:${pct}%` })),
      r.gaps.length ? h('details.cmp-gaps',
        h('summary', `Show what's missing (${r.gaps.length})`),
        h('ul', r.gaps.map((g) => h('li', h('a', { href: href(g.id) }, g.name), g.you ? h('span.muted', ' (their own box)') : null, ': ', g.missing.join(', '))))) : null);
  });
  update();

  const drafts = h('div.cmp-drafts', { hidden: true });

  const writeBtn = h('button.btn.primary', { type: 'button', onclick: () => {
    const chosen = reports.filter((r) => boxes.get(r.user.id).checked && r.gaps.length);
    if (!chosen.length) return toast('Tick at least one person with missing details.', 'error');
    buildDrafts(chosen);
  } }, 'Write the reminder emails');

  function buildDrafts(chosen) {
    const items = chosen.map((r) => {
      const subject = h('input', { type: 'text', value: SUBJECT, maxlength: 150, 'aria-label': 'Subject' });
      const message = h('textarea', { rows: 12, value: draftMessage(r), maxlength: 5000, 'aria-label': 'Message' });
      const status = h('span.rem-tag', 'Not sent');
      const preview = h('div.rem-preview', { hidden: true });
      const item = { r, subject, message, status, sent: false };
      const previewBtn = h('button.btn.small', { type: 'button', onclick: async () => {
        if (!preview.hidden) { preview.hidden = true; previewBtn.textContent = 'Preview'; return; }
        previewBtn.disabled = true;
        try {
          const res = await call({ preview: true, subject: subject.value, message: message.value, previewName: firstName(r.user) });
          const frame = h('iframe', { title: `Email preview for ${r.user.display_name || r.user.email}`, sandbox: '' });
          frame.srcdoc = res.html;
          clear(preview, h('p.small.muted', h('strong', 'Subject: '), res.subject), frame);
          preview.hidden = false;
          previewBtn.textContent = 'Hide preview';
        } catch (e) { toast(e.message, 'error'); }
        previewBtn.disabled = false;
      } }, 'Preview');
      const skip = h('input', { type: 'checkbox', checked: true, 'aria-label': `Send to ${r.user.display_name || r.user.email}` });
      item.include = skip;
      item.el = h('li.cmp-draft',
        h('div.cmp-draft-head',
          h('label', skip, ' ', h('strong', `To ${r.user.display_name || r.user.email}`), h('span.muted.small', ` ${r.user.email}`)),
          status),
        h('label.field', h('span.field-label', 'Subject'), subject),
        h('label.field', h('span.field-label', `Message (starts "Dear ${firstName(r.user)}," and ends with the Open the family tree button and your name)`), message),
        h('div.form-actions', previewBtn),
        preview);
      return item;
    });

    const sendAll = h('button.btn.primary', { type: 'button', onclick: async () => {
      const go = items.filter((i) => i.include.checked && !i.sent);
      if (!go.length) return toast('Nothing left to send.', 'error');
      if (go.some((i) => !i.subject.value.trim() || !i.message.value.trim())) return toast('Every email needs a subject and a message.', 'error');
      if (!(await confirmDialog(`Send ${go.length} personal reminder ${go.length === 1 ? 'email' : 'emails'}? Each person gets only their own. This can't be undone.`, `Send ${go.length}`))) return;
      sendAll.disabled = true;
      let ok = 0;
      const bad = [];
      for (const i of go) {
        i.status.textContent = 'Sending…';
        try {
          const res = await call({ subject: i.subject.value, message: i.message.value, emails: [i.r.user.email.toLowerCase()] });
          if (res.sent?.length) {
            ok++; i.sent = true; i.status.textContent = 'Sent'; i.status.className = 'rem-tag ok';
            i.include.checked = false; i.include.disabled = true;
          } else { throw new Error('not on the invite list'); }
        } catch (e) {
          bad.push(i.r.user.display_name || i.r.user.email);
          i.status.textContent = `Not sent: ${e.message}`; i.status.className = 'rem-tag no';
        }
      }
      sendAll.disabled = false;
      toast(`Sent ${ok} ${ok === 1 ? 'email' : 'emails'}.${bad.length ? ` Could not send to ${bad.join(', ')}.` : ''}`, bad.length ? 'error' : 'ok');
    } }, 'Send these emails');

    clear(drafts,
      h('h3', `Emails to review (${items.length})`),
      h('p.muted', 'Each email lists only that person\'s missing details. Change any wording you like, tap Preview to see exactly what they will get, untick anyone you don\'t want to send to, then send. Replies come to your own email.'),
      h('ol.cmp-draft-list', items.map((i) => i.el)),
      h('div.form-actions', h('button.btn', { type: 'button', onclick: () => { drafts.hidden = true; } }, 'Close without sending'), sendAll));
    drafts.hidden = false;
    drafts.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const withGaps = reports.filter((r) => r.gaps.length).length;
  return h('section.completeness',
    h('h2', 'Missing details'),
    h('p.muted', `Checks every box each branch admin looks after (their own, everyone below it and their spouses) for a missing ${joinWords(CHECKS.map((c) => c.label))}. Tick who to remind, then write the emails: each one lists that person's own gaps, and you can edit and preview every email before it goes.`),
    reports.length ? [
      h('div.row.rem-quick',
        h('span.muted.small', 'Select:'),
        h('button.btn.small', { type: 'button', onclick: () => pick((r) => r.gaps.length > 0) }, `Everyone with gaps (${withGaps})`),
        h('button.btn.small.ghost', { type: 'button', onclick: () => pick(() => false) }, 'None'),
        count),
      h('ul.cmp-list', cards),
      h('div.form-actions', writeBtn),
    ] : h('p.muted', 'Nobody else has claimed a box yet, so there is no branch to check.'),
    noBox ? h('p.small.muted', `${noBox} signed-in ${noBox === 1 ? 'member has' : 'members have'} not claimed a box yet, so there is nothing to check for them. Use "No box claimed" in Send a reminder email below to ask them to claim it first.`) : null,
    drafts);
}
