// The person card that slides in when someone is tapped.
import { store } from './data.js';
import { config } from './config.js';
import { fullName, shortName, KIND_LABEL, relationHint, birthYear } from './model.js';
import { h, clear, initials } from './ui.js';
import { openPersonForm, openPhotoForm, openLinkForm, requestRemoveLink, requestDelete } from './forms.js';

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
    row('Died', [d.death_date, d.death_place].filter(Boolean).join(', '));
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

  const status = p.is_living === false ? 'Deceased' : p.is_living === true ? 'Living' : null;
  const pl = fam.primaryParentLink(id);

  clear(container,
    h('div.panel-head',
      h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: onClose }, '✕')),
    h('div.panel-photo', photo ? h('a', { href: photo, target: '_blank', rel: 'noopener', title: 'Open full size' }, h('img', { src: photo, alt: `Photo of ${shortName(p)}` })) : h('div.avatar-lg', initials(p.given_name)),
      canEdit ? h('button.btn.small', { type: 'button', onclick: () => openPhotoForm(p) }, photo ? 'Change photo' : 'Add photo') : null,
      !photo && p.photo_path && p.photo_visibility === 'branch' ? h('p.muted.small', 'Photo visible to this branch only.') : null),
    h('h2.panel-name', fullName(p)),
    p.other_names ? h('p.muted', p.other_names) : null,
    h('p.tags',
      p.generation ? h('span.tag', `Generation ${p.generation}`) : null,
      status ? h('span.tag', status) : null,
      d?.visibility === 'branch' ? h('span.tag.lock', 'Details: branch only') : null,
      pl?.confidence === 'uncertain' ? h('span.tag.warn', 'Parent not confirmed') : null),
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

    d?.sources ? h('details.sources', h('summary', 'Sources'), h('p', d.sources)) : null,

    h('div.panel-actions',
      h('button.btn', { type: 'button', onclick: () => onRoot(id) }, 'Show tree from here'),
      canEdit ? [
        h('button.btn', { type: 'button', onclick: () => openPersonForm({ mode: 'edit', person: p }) }, store.isAdmin ? 'Edit' : 'Suggest an edit'),
        h('div.add-row',
          h('span.muted', 'Add: '),
          h('button.btn.small', { type: 'button', onclick: () => openPersonForm({ mode: 'add', relation: { as: 'child', of: id } }) }, 'Child'),
          h('button.btn.small', { type: 'button', onclick: () => openPersonForm({ mode: 'add', relation: { as: 'spouse', of: id } }) }, 'Spouse'),
          h('button.btn.small', { type: 'button', onclick: () => openPersonForm({ mode: 'add', relation: { as: 'parent', of: id } }) }, 'Parent')),
        h('button.btn.small.ghost', { type: 'button', onclick: () => openLinkForm(p) }, 'Link to someone already in the tree'),
        h('button.btn.small.ghost.danger', { type: 'button', onclick: () => requestDelete(p) }, store.isAdmin ? 'Remove from tree' : 'Ask to remove'),
      ] : !store.preview
        ? h('p.muted.small', 'Family members can ', h('button.link', { type: 'button', onclick: onSignIn }, 'sign in'), ` to suggest changes. ${config.adminName} approves every change.`)
        : null),
    h('p.muted.small.hint', relationHint(fam, id)),
  );
}
