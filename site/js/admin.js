// Screens for the admin (review changes, invites, members) and for members
// (their own submitted changes).
import {
  store, listRequests, approveChange, rejectChange, withdrawRequest, pendingPhotoUrl,
  listInvites, addInvite, removeInvite, listProfiles, updateProfile, personLabel,
} from './data.js';
import { config } from './config.js';
import { fullName } from './model.js';
import { h, clear, toast, formatWhen, field, select, confirmDialog } from './ui.js';
import { LABELS, personPicker } from './forms.js';
import { downloadGedcom } from './gedcom.js';
import { sendButtons } from './invite.js';

const KIND_TITLE = {
  add_person: 'Add a person', edit_person: 'Edit details', add_link: 'Add a relationship',
  remove_link: 'Remove a relationship', set_photo: 'New photo', remove_photo: 'Remove a photo', delete_person: 'Remove a person',
};

function valueText(k, v) {
  if (k === 'is_living') return v === true ? 'Living' : v === false ? 'Deceased' : 'Not sure';
  if (k === 'visibility') return v === 'public' ? 'Public' : 'Branch only';
  return v === null || v === undefined || v === '' ? '(empty)' : String(v);
}

export function describe(req, emailOf) {
  const fam = store.fam;
  const p = req.payload || {};
  const rows = [];
  const add = (label, value) => rows.push(h('div.dl-row', h('dt', label), h('dd', value)));
  if (req.kind === 'add_person') {
    const l = p.link || {};
    add('Relationship', `${l.as} of ${personLabel(l.of)}${l.other_parent ? ` and ${personLabel(l.other_parent)}` : ''}${l.kind && l.kind !== 'biological' ? ` (${l.kind})` : ''}${l.confidence === 'uncertain' ? ' (not certain)' : ''}${l.status && l.status !== 'married' ? ` (${l.status})` : ''}`);
    for (const [k, v] of Object.entries(p.person || {})) if (v !== '' && v !== null && !(k === 'gender' && v === 'unknown')) add(LABELS[k] || k, valueText(k, v));
    for (const [k, v] of Object.entries(p.details || {})) if (v !== '' && v !== null) add(LABELS[k] || k, valueText(k, v));
  } else if (req.kind === 'edit_person') {
    const cur = fam.byId.get(p.person_id) || {};
    const curD = fam.details.get(p.person_id) || {};
    for (const [k, v] of Object.entries(p.person || {})) add(LABELS[k] || k, h('span', h('s.muted', valueText(k, cur[k])), ' → ', h('strong', valueText(k, v))));
    for (const [k, v] of Object.entries(p.details || {})) {
      if (k === 'visibility' && curD.visibility === v) continue;
      add(LABELS[k] || k, h('span', h('s.muted', valueText(k, curD[k])), ' → ', h('strong', valueText(k, v))));
    }
  } else if (req.kind === 'add_link') {
    if (p.type === 'union') add('Marriage', `${personLabel(p.partner_a)} and ${personLabel(p.partner_b)} (${p.status})`);
    else add('Parent link', `${personLabel(p.parent_id)} is ${p.kind && p.kind !== 'biological' ? p.kind + ' ' : ''}parent of ${personLabel(p.child_id)}${p.confidence === 'uncertain' ? ' (not certain)' : ''}`);
  } else if (req.kind === 'set_photo') {
    add('Person', personLabel(p.person_id));
    add('Who can see it', valueText('visibility', p.visibility));
    const img = h('img.review-photo', { alt: 'Submitted photo' });
    pendingPhotoUrl(p.path).then((u) => u && (img.src = u));
    rows.push(img);
  } else if (req.kind === 'remove_photo') {
    add('Person', personLabel(p.person_id));
    const url = store.photoUrls.get(p.person_id);
    if (url) rows.push(h('img.review-photo', { src: url, alt: 'Photo to be removed' }));
  } else if (req.kind === 'delete_person') {
    add('Person', p.name || personLabel(p.person_id));
  } else if (req.kind === 'remove_link') {
    add('Link', req.summary || '');
  }
  return h('div',
    h('p.muted.small', `${emailOf(req.submitted_by)} · ${formatWhen(req.submitted_at)}`),
    h('dl.details', rows));
}

export async function renderReview(container) {
  clear(container, h('h1', 'Changes waiting for approval'), h('p.muted', 'Loading…'));
  let pending;
  let recent;
  let emails = new Map();
  try {
    [pending, recent] = await Promise.all([listRequests({ status: 'pending' }), listRequests({ status: null })]);
    emails = new Map((await listProfiles()).map((u) => [u.id, u.display_name || u.email]));
  } catch (e) {
    return clear(container, h('h1', 'Changes waiting for approval'), h('p.notice', e.message));
  }
  const emailOf = (id) => emails.get(id) || 'Unknown member';

  const card = (req) => {
    const note = h('input', { type: 'text', placeholder: 'Note to the member (optional)' });
    const buttons = h('div.form-actions',
      h('button.btn.danger', { type: 'button', onclick: async () => {
        buttons.querySelectorAll('button').forEach((b) => (b.disabled = true));
        try {
          await rejectChange(req, note.value || null);
          toast('Declined.');
          renderReview(container);
        } catch (e) {
          toast(e.message, 'error');
          buttons.querySelectorAll('button').forEach((b) => (b.disabled = false));
        }
      } }, 'Decline'),
      h('button.btn.primary', { type: 'button', onclick: async () => {
        buttons.querySelectorAll('button').forEach((b) => (b.disabled = true));
        try {
          await approveChange(req, note.value || null);
          toast('Approved and added to the tree.', 'ok');
          renderReview(container);
        } catch (e) {
          toast(e.message, 'error');
          buttons.querySelectorAll('button').forEach((b) => (b.disabled = false));
        }
      } }, 'Approve'));
    return h('article.req-card',
      h('h3', KIND_TITLE[req.kind] || req.kind, req.summary ? h('span.muted', ` · ${req.summary}`) : null),
      describe(req, emailOf), note, buttons);
  };

  clear(container,
    h('h1', 'Changes waiting for approval'),
    pending.length ? pending.map(card) : h('p.empty', 'Nothing waiting. 🎉'),
    h('h2', 'Recent decisions'),
    recent.length ? h('ul.history', recent.slice(0, 30).map((r) =>
      h('li', h('span.tag' + (r.status === 'approved' ? '.ok' : '.warn'), r.status), ' ', r.summary || KIND_TITLE[r.kind],
        h('span.muted', ` · ${emailOf(r.submitted_by)} · ${formatWhen(r.reviewed_at)}`), r.review_note ? h('div.muted.small', `Note: ${r.review_note}`) : null)))
      : h('p.muted', 'None yet.'));
}

export async function renderMine(container) {
  clear(container, h('h1', 'My changes'), h('p.muted', 'Loading…'));
  let pending;
  let done;
  try {
    [pending, done] = await Promise.all([listRequests({ status: 'pending', mine: true }), listRequests({ status: null, mine: true })]);
  } catch (e) {
    return clear(container, h('h1', 'My changes'), h('p.notice', e.message));
  }
  const item = (r) => h('li',
    h('span.tag' + (r.status === 'approved' ? '.ok' : r.status === 'rejected' ? '.warn' : ''), r.status === 'rejected' ? 'declined' : r.status),
    ' ', r.summary || KIND_TITLE[r.kind], h('span.muted', ` · ${formatWhen(r.submitted_at)}`),
    r.review_note ? h('div.muted.small', `${config.adminName}'s note: ${r.review_note}`) : null,
    r.status === 'pending' ? h('details.pending-detail', h('summary', 'See what you changed'), describe(r, () => 'You')) : null,
    r.status === 'pending' ? h('button.btn.small.ghost', { type: 'button', onclick: async () => {
      if (!(await confirmDialog('Withdraw this change?', 'Withdraw'))) return;
      try {
        await withdrawRequest(r);
        renderMine(container);
      } catch (e) {
        toast(e.message, 'error');
      }
    } }, 'Withdraw') : null);
  clear(container,
    h('h1', 'My changes'),
    h('p.muted', `Your changes are not visible in the tree until ${config.adminName} approves them. Until then you can see them here, and on the person's card.`),
    h('h2', 'Waiting'), pending.length ? h('ul.history', pending.map(item)) : h('p.muted', 'Nothing waiting.'),
    h('h2', 'Decided'), done.length ? h('ul.history', done.map(item)) : h('p.muted', 'Nothing yet.'));
}

export async function renderAdmin(container) {
  clear(container, h('h1', 'Family members and invites'), h('p.muted', 'Loading…'));
  let invites;
  let profiles;
  try {
    [invites, profiles] = await Promise.all([listInvites(), listProfiles()]);
  } catch (e) {
    return clear(container, h('h1', 'Family members and invites'), h('p.notice', e.message));
  }
  const names = new Map(profiles.map((u) => [u.id, u.display_name || u.email]));

  let chosen = null;
  const chosenLabel = h('span.muted.small', 'Not linked yet');
  const form = h('form.form.invite-form',
    h('div.row2',
      field('Email *', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })),
      field('Name', h('input', { name: 'display_name', type: 'text' }))),
    field('Who are they in the tree?', personPicker((p) => {
      chosen = p;
      chosenLabel.textContent = `Linked to ${fullName(p)}`;
    }), 'Linking decides which branch details and photos they can see.'),
    chosenLabel,
    field('Role', select('role', [['member', 'Member: suggests changes'], ['admin', 'Admin: approves changes']], 'member')),
    h('div.form-actions', h('button.btn.primary', { type: 'submit' }, 'Add invite')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!email.includes('@')) return toast('Please enter an email address.', 'error');
    try {
      await addInvite({ email, display_name: form.display_name.value.trim(), person_id: chosen?.id, role: form.role.value });
      toast(`Invite added. Use the Email or WhatsApp button next to ${email} to send them the invitation.`, 'ok');
      renderAdmin(container);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const memberRow = (u) => {
    const label = h('span', u.person_id ? personLabel(u.person_id) : h('em.muted', 'not linked'));
    const picker = personPicker(async (p) => {
      try {
        await updateProfile(u.id, { person_id: p.id });
        toast(`${u.email} is now linked to ${fullName(p)}.`, 'ok');
        renderAdmin(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    }, { placeholder: 'Change who they are' });
    const roleSel = select('role', [['member', 'Member'], ['admin', 'Admin']], u.role);
    roleSel.disabled = u.id === store.session.user.id;
    roleSel.addEventListener('change', async () => {
      try {
        await updateProfile(u.id, { role: roleSel.value });
        toast('Role updated.', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    return h('li.member', h('div', h('strong', u.display_name || u.email), h('div.muted.small', u.email)), h('div', 'In tree: ', label), picker, roleSel);
  };

  clear(container,
    h('h1', 'Family members and invites'),
    h('section', h('h2', 'Invite someone'),
      h('p.muted', 'Only invited emails can sign in. After adding them here, use the Email or WhatsApp button to send the invitation. Family members can also invite relatives from Invite in the menu; you will see who invited whom below, and can remove any invite.'),
      form),
    h('section', h('h2', `Invites (${invites.length})`),
      invites.length ? h('ul.history', invites.map((i) => h('li',
        h('strong', i.email), i.display_name ? ` (${i.display_name})` : '',
        h('span.muted', ` · ${i.person_id ? personLabel(i.person_id) : 'not linked'} · ${i.role} · ${i.accepted_at ? 'signed in ' + formatWhen(i.accepted_at) : 'not signed in yet'}${i.invited_by && i.invited_by !== store.session.user.id && names.get(i.invited_by) ? ` · invited by ${names.get(i.invited_by)}` : ''}`),
        i.accepted_at ? null : sendButtons(i),
        h('button.btn.small.ghost', { type: 'button', onclick: async () => {
          if (!(await confirmDialog(`Remove the invite for ${i.email}? People who already signed in keep their login.`, 'Remove'))) return;
          await removeInvite(i.email).catch((e) => toast(e.message, 'error'));
          renderAdmin(container);
        } }, 'Remove')))) : h('p.muted', 'No invites yet.')),
    h('section', h('h2', `Members who have signed in (${profiles.length})`), h('ul.members', profiles.map(memberRow))),
    h('section', h('h2', 'Export'),
      h('p.muted', 'Download the whole tree as a GEDCOM file, the standard format other family tree programs open.'),
      h('button.btn', { type: 'button', onclick: downloadGedcom }, 'Download GEDCOM')));
}
