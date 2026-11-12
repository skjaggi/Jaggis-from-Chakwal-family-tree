// Forms for suggesting changes: add or edit a person, photo, links.
import { store, submitChange, uploadPendingPhoto } from './data.js';
import { config } from './config.js';
import { fullName, shortName, searchPeople, relationHint } from './model.js';
import { h, modal, toast, field, select, confirmDialog } from './ui.js';

const GENDERS = [['unknown', 'Not recorded'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']];
const LIVING = [['', 'Not sure'], ['true', 'Living'], ['false', 'Deceased']];
const VIS = [['branch', 'Branch only: family in this branch'], ['public', 'Public: anyone']];
const KINDS = [['biological', 'Birth'], ['adoptive', 'Adopted'], ['step', 'Step'], ['foster', 'Foster']];
const CONF = [['confirmed', 'Confirmed'], ['uncertain', 'Not certain']];
const STATUSES = [['married', 'Married'], ['divorced', 'Divorced'], ['widowed', 'Widowed'], ['separated', 'Separated'], ['partners', 'Partners']];

const PERSON_FIELDS = ['title', 'given_name', 'surname', 'other_names', 'gender', 'is_living'];
const DETAIL_FIELDS = ['visibility', 'birth_date', 'birth_place', 'death_date', 'death_place', 'profession', 'notes', 'sources', 'uncertainty'];
const LABELS = {
  title: 'Title', given_name: 'First name(s)', surname: 'Surname', other_names: 'Other names', gender: 'Gender',
  is_living: 'Living', visibility: 'Who can see details', birth_date: 'Birth date', birth_place: 'Birth place',
  death_date: 'Death date', death_place: 'Death place', profession: 'Profession', notes: 'Notes', sources: 'Sources',
  uncertainty: "What's uncertain",
};
export { LABELS };

async function send(kind, payload, opts, close) {
  try {
    const { applied } = await submitChange(kind, payload, opts);
    close();
    toast(applied ? 'Saved.' : `Sent to ${config.adminName} for approval. You can follow it under "My changes".`, 'ok');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Something went wrong.', 'error');
  }
}

function textInput(name, value, attrs = {}) {
  return h('input', { name, type: 'text', value: value ?? '', autocomplete: 'off', ...attrs });
}

function textArea(name, value, rows = 3) {
  return h('textarea', { name, rows, value: value ?? '' });
}

// mode 'add' needs relation {as: 'child'|'spouse'|'parent', of: personId}
export function openPersonForm({ mode, person = null, relation = null }) {
  const fam = store.fam;
  const d = person ? fam.details.get(person.id) || {} : {};
  const p = person || {};
  const of = relation ? fam.byId.get(relation.of) : null;
  const livingVal = p.is_living === true ? 'true' : p.is_living === false ? 'false' : '';

  const relBox = [];
  if (relation?.as === 'child') {
    const spouses = fam.spouses(of.id);
    relBox.push(
      spouses.length ? field('Other parent', select('other_parent', [['', 'Not recorded'], ...spouses.map((s) => [s.person.id, fullName(s.person)])], spouses[0].person.id)) : null,
      field('Relationship', select('kind', KINDS, 'biological')),
      field('Is this certain?', select('confidence', CONF, 'confirmed')));
  } else if (relation?.as === 'parent') {
    relBox.push(field('Relationship', select('kind', KINDS, 'biological')), field('Is this certain?', select('confidence', CONF, 'confirmed')));
  } else if (relation?.as === 'spouse') {
    relBox.push(field('Status', select('status', STATUSES, 'married')),
      h('div.row2', field('Marriage date', textInput('start_date', '')), field('End date', textInput('end_date', '', { placeholder: 'if divorced or widowed' }))));
  }

  const visSelect = select('visibility', VIS, d.visibility || (p.is_living === false ? 'public' : 'branch'));
  const form = h('form.form', { novalidate: true },
    relation ? h('p.form-note', `Adding a ${relation.as} of ${fullName(of)}.`) : null,
    h('fieldset', h('legend', 'Name'),
      h('div.row2', field('Title', textInput('title', p.title, { placeholder: 'e.g. Bakhshi' })), field('Gender', select('gender', GENDERS, p.gender || 'unknown'))),
      field('First name(s) *', textInput('given_name', p.given_name, { required: true })),
      field('Surname', textInput('surname', p.surname ?? (relation?.as === 'child' ? of.surname : ''))),
      field('Other names', textInput('other_names', p.other_names), 'Married name, nickname, other spellings')),
    relBox.length ? h('fieldset', h('legend', 'Relationship'), relBox) : null,
    h('fieldset', h('legend', 'Life'),
      field('Living?', select('is_living', LIVING, livingVal)),
      h('div.row2', field('Birth date', textInput('birth_date', d.birth_date, { placeholder: 'e.g. 1952 or c. 1890' })), field('Birth place', textInput('birth_place', d.birth_place))),
      h('div.row2', field('Death date', textInput('death_date', d.death_date)), field('Death place', textInput('death_place', d.death_place))),
      field('Profession', textInput('profession', d.profession)),
      field('Notes', textArea('notes', d.notes))),
    h('fieldset', h('legend', 'Sources and certainty'),
      field('Sources', textArea('sources', d.sources, 2), 'Where this information came from: a person, a document, a record'),
      field("What's uncertain", textArea('uncertainty', d.uncertainty, 2), 'e.g. "Birth year is approximate"')),
    h('fieldset', h('legend', 'Privacy'),
      field('Who can see dates, places and notes', visSelect, 'The name always shows in the tree. Details of living people default to branch only.')),
    h('div.form-actions',
      h('button.btn', { type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button.btn.primary', { type: 'submit' }, store.isAdmin ? 'Save' : 'Send for approval')));

  // Deceased defaults to public, living to branch only, until the person picks one.
  let visTouched = !!person;
  visSelect.addEventListener('change', () => (visTouched = true));
  form.is_living.addEventListener('change', () => {
    if (!visTouched) visSelect.value = form.is_living.value === 'false' ? 'public' : 'branch';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const val = (k) => (fd.get(k) ?? '').toString().trim();
    if (!val('given_name')) {
      toast('Please enter a first name.', 'error');
      form.given_name.focus();
      return;
    }
    const newPerson = {};
    for (const k of PERSON_FIELDS) newPerson[k] = k === 'is_living' ? (val(k) === '' ? null : val(k) === 'true') : val(k);
    const newDetails = {};
    for (const k of DETAIL_FIELDS) newDetails[k] = val(k);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;

    if (mode === 'add') {
      const link = { as: relation.as, of: relation.of };
      for (const k of ['other_parent', 'kind', 'confidence', 'status', 'start_date', 'end_date']) if (fd.has(k)) link[k] = val(k);
      const name = [newPerson.given_name, newPerson.surname].filter(Boolean).join(' ');
      await send('add_person', { person: newPerson, details: newDetails, link },
        { target: relation.of, summary: `Add ${name} as ${relation.as} of ${shortName(of)}` }, m.close);
    } else {
      // Send only what changed.
      const pChanges = {};
      const dChanges = {};
      const norm = (v) => (v === undefined || v === null ? '' : String(v));
      for (const k of PERSON_FIELDS) if (norm(newPerson[k]) !== norm(p[k] ?? (k === 'gender' ? 'unknown' : ''))) pChanges[k] = newPerson[k];
      for (const k of DETAIL_FIELDS) if (norm(newDetails[k]) !== norm(d[k] ?? (k === 'visibility' ? visSelect.options[0].value : ''))) dChanges[k] = newDetails[k];
      // Visibility always travels with detail edits, so the chosen privacy applies.
      if (Object.keys(dChanges).length) dChanges.visibility = newDetails.visibility;
      const changed = [...Object.keys(pChanges), ...Object.keys(dChanges).filter((k) => k !== 'visibility' || norm(d.visibility) !== newDetails.visibility)];
      if (!changed.length) {
        toast('Nothing was changed.');
        btn.disabled = false;
        return;
      }
      await send('edit_person', { person_id: person.id, person: pChanges, details: dChanges },
        { target: person.id, summary: `Edit ${shortName(person)}: ${changed.map((k) => LABELS[k].toLowerCase()).join(', ')}` }, m.close);
    }
    btn.disabled = false;
  });

  const title = mode === 'add' ? `Add ${relation.as}` : `Edit ${shortName(person)}`;
  const m = modal(title, form);
  setTimeout(() => form.given_name.focus(), 50);
}

// Resize to at most 900px on the long side and re-encode as JPEG.
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
}

export function openPhotoForm(person) {
  const input = h('input', { type: 'file', accept: 'image/*', name: 'photo' });
  const preview = h('div.photo-preview', h('span.muted', 'No photo chosen'));
  const vis = select('visibility', VIS, person.is_living === false ? 'public' : 'branch');
  let blob = null;
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      blob = await shrinkImage(f);
      preview.replaceChildren(h('img', { src: URL.createObjectURL(blob), alt: 'Preview' }));
    } catch {
      blob = null;
      toast('That file could not be read as a picture.', 'error');
    }
  });
  const form = h('form.form',
    h('p.form-note', `One profile photo for ${fullName(person)}. A new photo replaces the current one.`),
    field('Photo', input), preview,
    field('Who can see this photo', vis),
    h('div.form-actions',
      h('button.btn', { type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button.btn.primary', { type: 'submit' }, store.isAdmin ? 'Save photo' : 'Send for approval')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!blob) return toast('Please choose a photo first.', 'error');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      const path = await uploadPendingPhoto(blob);
      await send('set_photo', { person_id: person.id, path, visibility: vis.value }, { target: person.id, summary: `New photo for ${shortName(person)}` }, m.close);
    } catch (err) {
      toast(err.message || 'Upload failed.', 'error');
    }
    btn.disabled = false;
    btn.textContent = store.isAdmin ? 'Save photo' : 'Send for approval';
  });
  const m = modal('Profile photo', form);
}

// A search box that lets you pick one person.
export function personPicker(onPick, { placeholder = 'Search for a person', exclude = [] } = {}) {
  const input = h('input', { type: 'search', placeholder, autocomplete: 'off' });
  const list = h('ul.pick-list');
  const wrap = h('div.picker', input, list);
  input.addEventListener('input', () => {
    const res = searchPeople(store.fam, input.value, 8).filter((p) => !exclude.includes(p.id));
    list.replaceChildren(...res.map((p) => h('li', h('button', { type: 'button', onclick: () => {
      input.value = fullName(p);
      list.replaceChildren();
      onPick(p);
    } }, h('strong', fullName(p)), h('span.muted', ' ' + relationHint(store.fam, p.id))))));
  });
  return wrap;
}

export function openLinkForm(person) {
  let other = null;
  const type = select('rel', [['parent', `…is a parent of ${shortName(person)}`], ['child', `…is a child of ${shortName(person)}`], ['spouse', `…is a spouse of ${shortName(person)}`]], 'parent');
  const chosen = h('p.form-note', 'Nobody chosen yet.');
  const kind = select('kind', KINDS, 'biological');
  const conf = select('confidence', CONF, 'confirmed');
  const status = select('status', STATUSES, 'married');
  const pcBox = h('div', field('Relationship', kind), field('Is this certain?', conf));
  const spBox = h('div', { hidden: true }, field('Status', status));
  type.addEventListener('change', () => {
    pcBox.hidden = type.value === 'spouse';
    spBox.hidden = type.value !== 'spouse';
  });
  const form = h('form.form',
    h('p.form-note', 'Connect two people who are both already in the tree, for example to confirm which parent someone had.'),
    field('Person already in the tree', personPicker((p) => {
      other = p;
      chosen.textContent = `Chosen: ${fullName(p)}`;
    }, { exclude: [person.id] })),
    chosen,
    field('Who are they?', type), pcBox, spBox,
    h('div.form-actions',
      h('button.btn', { type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button.btn.primary', { type: 'submit' }, store.isAdmin ? 'Save' : 'Send for approval')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!other) return toast('Please choose a person first.', 'error');
    let payload;
    let summary;
    if (type.value === 'spouse') {
      payload = { type: 'union', partner_a: person.id, partner_b: other.id, status: status.value };
      summary = `Link ${shortName(other)} as spouse of ${shortName(person)}`;
    } else {
      const [parent, child] = type.value === 'parent' ? [other, person] : [person, other];
      payload = { type: 'parent_child', parent_id: parent.id, child_id: child.id, kind: kind.value, confidence: conf.value };
      summary = `Link ${shortName(parent)} as parent of ${shortName(child)}`;
    }
    await send('add_link', payload, { target: person.id, summary }, m.close);
  });
  const m = modal('Link to someone in the tree', form);
}

export async function requestRemoveLink(person, kind, link, otherName) {
  const msg = kind === 'union'
    ? `Remove the marriage between ${shortName(person)} and ${otherName}? Both people stay in the tree.`
    : `Remove the parent link between ${shortName(person)} and ${otherName}? Both people stay in the tree.`;
  if (!(await confirmDialog(msg, store.isAdmin ? 'Remove link' : 'Ask to remove'))) return;
  await send('remove_link', { type: kind, id: link.id }, { target: person.id, summary: `Remove link: ${shortName(person)} and ${otherName}` }, () => {});
}

export async function requestDelete(person) {
  const kids = store.fam.childLinks(person.id).length;
  const msg = `Remove ${fullName(person)} from the tree?${kids ? ` Their ${kids} children stay in the tree but will no longer be connected through them.` : ''}`;
  if (!(await confirmDialog(msg, store.isAdmin ? 'Remove person' : 'Ask to remove'))) return;
  await send('delete_person', { person_id: person.id, name: fullName(person) }, { target: person.id, summary: `Remove ${fullName(person)}` }, () => {});
}
