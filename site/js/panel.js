// The person card that slides in when someone is tapped.
import { store, listRequests, canManage, claimPerson, personClaimedBy, refreshProfile } from './data.js';
import { describe } from './admin.js';
import { config } from './config.js';
import { fullName, shortName, KIND_LABEL, relationHint, birthYear } from './model.js';
import { h, clear, initials, toast, confirmDialog } from './ui.js';
import { historyList, openPersonForm, openPhotoForm, removePhoto, openLinkForm, requestRemoveLink, requestDelete } from './forms.js';

export function renderPanel(container, id, { onSelect, onRoot, onClose, onSignIn }) {
  const fam = store.fam;
  const p = fam.byId.get(id);
  if (!p) return clear(container);
  const d = fam.details.get(id);
  const photo = store.photoUrls.get(id);
  const canEdit = store.signedIn;

  const personLink = (q, extra) =>
    h('li', h('button.link', { type: 'button', onclick: () => onSelect(q.id) }, fullName(q)), extra ? h('span.muted', ` ${extra}`) : null);
  const removeBtn = (kind, link, other) =>
    canEdit ? h('button.icon-btn.small', { type: 'button', title: 'Remove this link', 'aria-label': `Remove link to ${shortName(other)}`, onclick: () => requestRemoveLink(p, kind, link, shortName(other)) }, '✕') : null;

  const parents = fam.parents(id);
  const spouses = fam.spouses(id);
  const children = fam.children(id);
  const siblings = fam.siblings(id);

  const detailRows = [];
  const row = (label, value) => value && detailRows.push(h('div.dl-row', h('dt', label), h('dd', value)));
  if (d) {
    row('Born', [birthYear(d.birth_date), d.birth_place].filter(Boolean).join(', '));
    row('Died', [birthYear(d.death_date), d.death_place].filter(Boolean).join(', '));
    row('Profession', d.profession);
  }

  let hiddenNote = null;
  if (!d) {
    hiddenNote = store.preview
      ? h('p.notice', 'Details of living family members are only shown to their branch after signing in.')
      : !store.signedIn
        ? h('p.notice', 'Some details are only visible to family in this branch. ', h('button.link', { type: 'button', onclick: onSignIn }, 'Sign in'), ' to see them.')
        : h('p.notice', "This person's details are only visible to their branch of the family.");
  }

  // A member's own changes to this person that are still waiting for approval.
  const pendingBox = h('div.pending-mine', { hidden: true });
  if (store.signedIn && !store.isAdmin && !store.preview) {
    listRequests({ status: 'pending', mine: true }).then((reqs) => {
      const pl = (r) => r.payload || {};
      const mine = reqs.filter((r) => [r.target_person_id, pl(r).person_id, pl(r).link?.of, pl(r).link?.other_parent,
        pl(r).parent_id, pl(r).child_id, pl(r).partner_a, pl(r).partner_b].includes(id));
      if (!mine.length) return;
      clear(pendingBox,
        h('h3', 'Waiting for admin approval'),
        h('p.muted.small', 'Only you can see these until they are approved.'),
        mine.map((r) => h('details', h('summary', r.summary || 'Change'), describe(r, () => 'You'))),
        h('a.small', { href: '#/mine' }, 'See all my changes'));
      pendingBox.hidden = false;
    }).catch(() => {});
  }

  // Sources: what was written about where the information came from, followed by
  // who added this person and who updated them.
  const sourcesBox = h('details.sources', { hidden: !d?.sources, open: true },
    h('summary', 'Sources'), d?.sources ? h('p', d.sources) : null,
    historyList(id, () => { sourcesBox.hidden = false; }));

  // "This is me": whose own box this is, or a button to claim it.
  const claimBox = h('div.claim-box', { hidden: true });
  if (store.signedIn && !store.preview) {
    Promise.all([personClaimedBy(id), listRequests({ status: 'pending', mine: true }).catch(() => [])]).then(([owner, mine]) => {
      const waiting = mine.find((r) => r.kind === 'claim_person');
      if (store.claimedId === id) {
        clear(claimBox, h('p', h('strong', 'This is you. You are the branch admin here.'), ' Your changes to your own family below this box appear right away, and you approve what others suggest for it.'));
      } else if (owner) {
        clear(claimBox, h('p.muted', `Branch admin: ${owner} (this is their own box).`));
      } else if (waiting?.target_person_id === id) {
        clear(claimBox, h('p.muted', 'Waiting for confirmation that this is you.'));
      } else if (!store.claimedId && !waiting) {
        const btn = h('button.btn.small', { type: 'button', onclick: async () => {
          const linked = store.profile?.person_id === id;
          const msg = linked
            ? `Confirm that you are ${fullName(p)}? This is the person your invitation was linked to, so it takes effect right away. You can claim only one box.`
            : `Ask to confirm that you are ${fullName(p)}? The person who invited you, or the admin, will confirm it. You can claim only one box.`;
          if (!(await confirmDialog(msg, 'This is me'))) return;
          btn.disabled = true;
          try {
            const res = await claimPerson(p, `${store.profile?.display_name || 'A member'} says this is them: ${fullName(p)}`);
            toast(res.applied ? 'Done. This is now your box, and you are its branch admin.' : 'Sent. You become the branch admin once it is confirmed.', 'ok');
            await refreshProfile();
          } catch (e) {
            toast(e.message.includes('duplicate') ? 'You already have a claim waiting.' : e.message, 'error');
            btn.disabled = false;
          }
        } }, 'This is me');
        clear(claimBox, btn, h('span.muted.small', ' Is this you? Claim your own box to become the branch admin for your family below it.'));
      } else return;
      claimBox.hidden = false;
    }).catch(() => {});
  }

  const status = p.is_living === false ? 'Deceased' : p.is_living === true ? 'Living' : null;
  const pl = fam.primaryParentLink(id);

  clear(container,
    h('div.panel-head',
      h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: onClose }, '✕')),
    h('div.panel-photo', photo ? h('a', { href: photo, target: '_blank', rel: 'noopener', title: 'Open full size' }, h('img', { src: photo, alt: `Photo of ${shortName(p)}` })) : h('div.avatar-lg', initials(p.given_name)),
      canEdit ? h('div.photo-actions',
        h('button.btn.small', { type: 'button', onclick: () => openPhotoForm(p) }, photo ? 'Change or center photo' : 'Add photo'),
        p.photo_path ? h('button.btn.small.ghost', { type: 'button', onclick: () => removePhoto(p) }, 'Remove photo') : null) : null,
      !photo && p.photo_path && p.photo_visibility === 'branch' ? h('p.muted.small', 'Photo visible to this branch only.') : null),
    h('h2.panel-name', fullName(p)),
    p.other_names ? h('p.muted', p.other_names) : null,
    claimBox,
    h('p.tags',
      p.generation ? h('span.tag', `Generation ${p.generation}`) : null,
      status ? h('span.tag', status) : null,
      d?.visibility === 'branch' ? h('span.tag.lock', 'Details: branch only') : null,
      pl?.confidence === 'uncertain' ? h('span.tag.warn', 'Parent not confirmed') : null),
    pendingBox,
    detailRows.length ? h('dl.details', detailRows) : null,
    hiddenNote,
    d?.uncertainty ? h('div.uncertain', h('strong', 'Uncertain: '), d.uncertainty) : null,
    d?.notes ? h('div.notes', d.notes) : null,

    h('div.family',
      parents.length ? h('section', h('h3', 'Parents'), h('ul', parents.map(({ person: q, link }) =>
        h('li', h('button.link', { type: 'button', onclick: () => onSelect(q.id) }, fullName(q)),
          [KIND_LABEL[link.kind], link.confidence === 'uncertain' ? 'not confirmed' : ''].filter(Boolean).length
            ? h('span.muted', ` (${[KIND_LABEL[link.kind], link.confidence === 'uncertain' ? 'not confirmed' : ''].filter(Boolean).join(', ')})`) : null,
          removeBtn('parent_child', link, q))))) : null,
      spouses.length ? h('section', h('h3', spouses.length > 1 ? 'Spouses' : 'Spouse'), h('ul', spouses.map(({ person: q, union: u }) =>
        h('li', h('button.link', { type: 'button', onclick: () => onSelect(q.id) }, fullName(q)),
          h('span.muted', ` ${[u.status !== 'married' ? u.status : '', u.start_date ? `m. ${u.start_date}` : '', u.end_date ? `until ${u.end_date}` : ''].filter(Boolean).join(', ')}`),
          removeBtn('union', u, q))))) : null,
      children.length ? h('section', h('h3', `Children (${children.length})`), h('ul', children.map(({ person: q, link }) =>
        h('li', h('button.link', { type: 'button', onclick: () => onSelect(q.id) }, fullName(q)),
          link.kind !== 'biological' ? h('span.muted', ` (${KIND_LABEL[link.kind]})`) : null,
          link.confidence === 'uncertain' ? h('span.muted', ' (not confirmed)') : null,
          removeBtn('parent_child', link, q))))) : null,
      siblings.length ? h('section', h('h3', `Siblings (${siblings.length})`), h('ul', siblings.map((q) => personLink(q)))) : null),

    sourcesBox,

    h('div.panel-actions',
      h('button.btn', { type: 'button', onclick: () => onRoot(id) }, 'Show tree from here'),
      canEdit ? [
        h('button.btn', { type: 'button', onclick: () => openPersonForm({ mode: 'edit', person: p }) }, canManage(id, 'person') ? 'Edit' : 'Suggest an edit'),
        h('div.add-row',
          h('span.muted', 'Add: '),
          h('button.btn.small', { type: 'button', onclick: () => openPersonForm({ mode: 'add', relation: { as: 'child', of: id } }) }, 'Child'),
          h('button.btn.small', { type: 'button', onclick: () => openPersonForm({ mode: 'add', relation: { as: 'spouse', of: id } }) }, 'Spouse'),
          h('button.btn.small', { type: 'button', onclick: () => openPersonForm({ mode: 'add', relation: { as: 'parent', of: id } }) }, 'Parent')),
        h('button.btn.small.ghost', { type: 'button', onclick: () => openLinkForm(p) }, 'Link to someone already in the tree'),
        h('button.btn.small.ghost.danger', { type: 'button', onclick: () => requestDelete(p) }, store.isAdmin ? 'Remove from tree' : 'Ask to remove'),
      ] : !store.preview
        ? h('p.muted.small', 'Family members can ', h('button.link', { type: 'button', onclick: onSignIn }, 'sign in'), ' to suggest changes. The admin approves every change.')
        : null),
    h('p.muted.small.hint', relationHint(fam, id)),
  );
}
