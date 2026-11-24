// Faces from a group photo (#/faces). A member chooses a family photo; the
// browser finds the faces in it (the photo is never uploaded); the member taps
// each face, says who it is (someone in the tree, or someone new to add), and
// that face becomes the person's tree photo through the usual photo change, so
// the usual rules apply: it goes live for people they look after, otherwise it
// waits for approval, and it starts as "Family branch only".
// The site never guesses who a face belongs to: there is no face recognition,
// only face finding, and people are always named by hand.
// Afterwards the photo can be kept in the family Library (only if the member
// chooses to: until then it never leaves the device), with a name on each face.
import { store, uploadPendingPhoto, canManage } from './data.js';
import { personPicker, openPersonForm, publicWarning, VIS, send } from './forms.js';
import { claimGate } from './claim-gate.js';
import { photoEditor } from './photo-editor.js';
import { fullName, shortName, relationHint } from './model.js';
import { h, clear, modal, toast, field, select, confirmDialog } from './ui.js';
import { saveGroupPhoto, updatePhotoFaces, allTopics, LIBRARY_BLESSINGS } from './library.js';

// The face finder (MIT licence) runs in the browser. About 7 MB the first time,
// then the browser keeps it.
const FACE_API = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js';
const FACE_MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';
const MAX_SIDE = 2400; // big phone photos are scaled down to this first

let finder = null;
function loadFinder() {
  finder ||= (async () => {
    const api = await import(FACE_API);
    await api.nets.ssdMobilenetv1.loadFromUri(FACE_MODELS);
    return api;
  })().catch((e) => {
    finder = null;
    throw e;
  });
  return finder;
}

// The photo, scaled down, on a canvas that everything else reads from.
export async function readPhoto(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

export const finderReady = () => !!finder;

export async function findFaces(photo) {
  const api = await loadFinder();
  const found = await api.detectAllFaces(photo, new api.SsdMobilenetv1Options({ minConfidence: 0.45, maxResults: 80 }));
  return found.map((d) => ({ x: d.box.x, y: d.box.y, w: d.box.width, h: d.box.height }));
}

// Left to right, row by row. People in one row stand at slightly different
// heights, so a face joins a row when it is within about one face height of
// the row's first face; a back row sits clearly higher.
export function order(boxes) {
  const rows = [];
  for (const b of [...boxes].sort((a, c) => a.y - c.y)) {
    const row = rows.find((r) => Math.abs(r[0].y - b.y) < Math.max(r[0].h, b.h) * 1.3);
    if (row) row.push(b);
    else rows.push([b]);
  }
  return rows.flatMap((r) => r.sort((a, c) => a.x - c.x));
}

// A square around the face with room for hair and shoulders, kept inside the photo.
function frameAround(photo, b, room = 2.2) {
  const side = Math.min(Math.max(b.w, b.h) * room, photo.width, photo.height);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h * 0.55;
  const x = Math.max(0, Math.min(photo.width - side, cx - side / 2));
  const y = Math.max(0, Math.min(photo.height - side, cy - side / 2));
  return { x, y, side };
}

function cropCanvas(photo, b, size, room) {
  const f = frameAround(photo, b, room);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo, f.x, f.y, f.side, f.side, 0, 0, size, size);
  return c;
}

const cropBlob = (photo, b) => new Promise((res) => cropCanvas(photo, b, Math.min(900, Math.round(frameAround(photo, b).side)) || 300).toBlob(res, 'image/jpeg', 0.92));

// Kept while the site is open, so a redraw (after a save) or a visit to the
// tree and back does not lose the photo and the faces named so far.
const s = { photo: null, url: null, faces: [], adding: false, busy: false, kept: null, title: '', note: '', where: '', when: '' };

// The named faces, as the Library keeps them: fractions of the picture.
function tagsOf() {
  return s.faces.filter((f) => f.who?.personId && store.fam.byId.get(f.who.personId)).map((f) => ({
    person_id: f.who.personId,
    x: +(Math.max(0, f.box.x) / s.photo.width).toFixed(4),
    y: +(Math.max(0, f.box.y) / s.photo.height).toFixed(4),
    w: +(f.box.w / s.photo.width).toFixed(4),
    h: +(f.box.h / s.photo.height).toFixed(4),
  }));
}

export function renderFaces(page) {
  s.adding = false;

  const input = h('input', { id: 'faces-file', type: 'file', accept: 'image/*', hidden: true });
  const chooseBtn = h('button.btn.big' + (s.photo ? '' : '.primary'), { type: 'button', onclick: () => input.click() }, s.photo ? 'Choose a different photo' : 'Choose a group photo');
  const status = h('p.faces-status', { role: 'status' }, s.photo && !s.busy ? (s.faces.length ? 'Tap a face to say who it is.' : '') : '');
  const stage = h('div.faces-stage', { hidden: true });
  const tools = h('div.faces-tools', { hidden: true });
  const grid = h('div.faces-grid');
  const keep = h('section.faces-keep', { hidden: true });
  // Where you are: 1 find the faces, 2 name them and build the tree,
  // 3 (optional) keep the photo in the Family Album.
  const steps = h('ol.faces-steps', { 'aria-label': 'Steps' },
    h('li', h('b', '1'), ' Find the faces'),
    h('li', h('b', '2'), ' Say who they are and add them to the tree'),
    h('li', h('b', '3'), ' Keep the photo in the Family Album ', h('small', '(if you like)')));
  const showStep = () => {
    const n = !s.photo || s.busy ? 1 : tagsOf().length ? 3 : 2;
    [...steps.children].forEach((li, i) => { li.classList.toggle('now', i + 1 === n); li.classList.toggle('done', i + 1 < n); });
  };

  clear(page,
    h('div.faces-page',
      h('a.back-link', { href: '#/tree' }, '← Back to the tree'),
      h('h1', 'Add people from a group photo'),
      h('p.lead', 'Choose a photo with several relatives in it. The site finds the faces; tap each one to say who it is, or add them to the tree if they are new. Each face becomes that person\'s photo in the tree.'),
      steps,
      h('ul.faces-promise', { hidden: !!s.photo },
        h('li', 'The group photo stays on your phone or computer. Only the faces you choose are saved, each as one person\'s tree photo. Afterwards you can choose to keep the whole photo in the Family Album, for signed-in family only.'),
        h('li', 'The site finds faces but never guesses who they are: you name each one.'),
        h('li', 'New photos start as "Family branch only". Photos for people you look after go in straight away; others are checked first, as usual.')),
      h('div.faces-choose', chooseBtn, input),
      status, stage, tools, grid, keep));
  showStep();

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file || s.busy) return;
    if (s.faces.some((f) => f.who) && !(await confirmDialog('Start again with a different photo? The faces you named here are already saved.', 'Choose another photo'))) return;
    s.busy = true;
    chooseBtn.disabled = true;
    try {
      status.textContent = 'Opening the photo…';
      s.photo = await readPhoto(file);
    } catch {
      status.textContent = '';
      toast('That file could not be read as a picture.', 'error');
      s.busy = false;
      chooseBtn.disabled = false;
      return;
    }
    s.faces = [];
    s.kept = null;
    s.title = '';
    s.note = '';
    s.where = '';
    s.when = '';
    if (s.url) URL.revokeObjectURL(s.url);
    s.url = URL.createObjectURL(await new Promise((res) => s.photo.toBlob(res, 'image/jpeg', 0.9)));
    draw();
    status.textContent = finder ? 'Looking for faces…' : 'Getting the face finder ready (the first time takes a little while)…';
    try {
      const boxes = await findFaces(s.photo);
      s.faces = order(boxes).map((b, i) => ({ n: i + 1, box: b, who: null }));
      status.textContent = s.faces.length
        ? `Found ${s.faces.length} face${s.faces.length === 1 ? '' : 's'}. Tap a face to say who it is.`
        : 'No faces were found. You can mark them yourself: tap "Mark a face", then tap on a face in the photo.';
    } catch (e) {
      console.warn('face finder', e);
      status.textContent = 'The face finder could not start on this device. You can still mark faces yourself: tap "Mark a face", then tap on a face in the photo.';
    }
    status.scrollIntoView({ block: 'start', behavior: 'smooth' });
    chooseBtn.textContent = 'Choose a different photo';
    chooseBtn.classList.remove('primary');
    chooseBtn.disabled = false;
    s.busy = false;
    draw();
  });

  // Marking a face by hand: tap the middle of the face.
  stage.addEventListener('click', (e) => {
    if (!s.adding || e.target.closest('.face-box')) return;
    const r = stage.getBoundingClientRect();
    const k = s.photo.width / r.width;
    const sizes = s.faces.map((f) => f.box.w).sort((a, b) => a - b);
    const w = sizes.length ? sizes[Math.floor(sizes.length / 2)] : s.photo.width / 9;
    const cx = (e.clientX - r.left) * k;
    const cy = (e.clientY - r.top) * k;
    const face = { n: Math.max(0, ...s.faces.map((f) => f.n)) + 1, box: { x: cx - w / 2, y: cy - w * 0.55, w, h: w * 1.1 }, who: null, byHand: true };
    s.faces.push(face);
    s.adding = false;
    draw();
    whoIsThis(face);
  });

  function draw() {
    showStep();
    const promise = page.querySelector('.faces-promise');
    if (promise) promise.hidden = !!s.photo; // the photo needs the room on a phone
    stage.hidden = !s.photo;
    tools.hidden = !s.photo;
    if (!s.photo) return;
    stage.classList.toggle('adding', s.adding);
    const pct = (v, of) => `${(v / of) * 100}%`;
    clear(stage,
      h('img', { src: s.url, alt: 'The group photo', draggable: false }),
      s.faces.map((f) => h('button.face-box' + (f.who ? (f.who.skipped ? '.skipped' : '.named') : ''), {
        type: 'button',
        style: `left:${pct(f.box.x, s.photo.width)};top:${pct(f.box.y, s.photo.height)};width:${pct(f.box.w, s.photo.width)};height:${pct(f.box.h, s.photo.height)}`,
        'aria-label': `Face ${f.n}${f.who?.name ? `: ${f.who.name}` : ''}`,
        onclick: () => whoIsThis(f),
      }, h('span.face-num', f.who && !f.who.skipped ? '✓' : String(f.n)))));
    clear(tools,
      h('button.btn' + (s.adding ? '.primary' : ''), { type: 'button', onclick: () => { s.adding = !s.adding; draw(); } },
        s.adding ? 'Now tap on the face in the photo (or tap here to stop)' : '＋ Mark a face the site missed'));
    clear(grid, s.faces.map((f) => faceCard(f)));
    drawKeep();
  }

  // Keep the photo in the family Library, with the names on the faces.
  function drawKeep() {
    const tags = tagsOf();
    keep.hidden = !tags.length;
    if (!tags.length) return;
    const names = tags.map((t) => shortName(store.fam.byId.get(t.person_id))).join(', ');
    if (s.kept) {
      const same = JSON.stringify(tags) === JSON.stringify(s.kept.faces);
      clear(keep,
        h('h2', 'Step 3: in the Family Album'),
        h('p', s.kept.status === 'approved'
          ? ['This photo is in the Family Album, with the names on the faces. ', h('a', { href: `#/library?photo=${s.kept.id}` }, 'See it in the album')]
          : `This photo was sent to the Family Album and appears there once the admin approves it (+${LIBRARY_BLESSINGS} blessings).`),
        !same && store.isAdmin ? h('button.btn', { type: 'button', onclick: async () => {
          try {
            await updatePhotoFaces(s.kept.id, tags);
            s.kept.faces = tags;
            toast('The names in the Library are updated.', 'ok');
            drawKeep();
          } catch (e) { toast(e.message, 'error'); }
        } }, 'Update the names in the Library') : null,
        !same && !store.isAdmin ? h('p.muted.small', 'You named more faces after sending it. The admin can add those names to the Library photo.') : null);
      return;
    }
    const title = h('input', { type: 'text', maxlength: 200, placeholder: 'e.g. Cousins at the wedding, 2019', value: s.title });
    const note = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'What was happening, or a memory (optional)' });
    note.value = s.note;
    const where = h('input', { type: 'text', maxlength: 120, placeholder: 'e.g. Delhi, at the wedding', value: s.where });
    const when = h('input', { type: 'text', maxlength: 60, placeholder: 'e.g. December 2019', value: s.when });
    title.addEventListener('input', () => { s.title = title.value; });
    note.addEventListener('input', () => { s.note = note.value; });
    where.addEventListener('input', () => { s.where = where.value; });
    when.addEventListener('input', () => { s.when = when.value; });
    const topics = allTopics();
    const topic = select('topic', topics.map((t) => [t, t]), topics.includes('Family photos') ? 'Family photos' : topics[0]);
    const btn = h('button.btn.primary', { type: 'submit' }, store.isAdmin ? 'Add to the Family Album' : 'Send to the Family Album');
    const form = h('form.form.faces-keep-form',
      h('h2', 'Step 3: keep this photo in the Family Album?'),
      h('p', `The Family Album is in the Library and opens like a book. Family members can see who is who: pointing at a face (or tapping it on a phone) shows the name. Named so far: ${names}.`),
      h('p.form-note', store.isAdmin
        ? 'The whole photo is saved, for signed-in family members only (never public).'
        : `The whole photo is saved, for signed-in family members only (never public). The admin checks it first; once approved you earn +${LIBRARY_BLESSINGS} blessings.`),
      field('Title *', title),
      h('div.row2', field('Where it was taken', where), field('When it was taken', when)),
      field('About this photo', note),
      h('input', { type: 'hidden', name: 'topic', value: topic.value }),
      h('div.form-actions', btn));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!title.value.trim()) { toast('Please give the photo a short title.', 'error'); title.focus(); return; }
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const blob = await new Promise((res) => s.photo.toBlob(res, 'image/jpeg', 0.88));
        const row = await saveGroupPhoto({ blob, title: title.value.trim(), topic: topic.value, note: note.value.trim(), faces: tags, taken_where: where.value.trim(), taken_when: when.value.trim() });
        s.kept = { id: row.id, status: row.status, faces: tags };
        toast(row.status === 'approved' ? 'Added to the Family Album.' : 'Sent. It appears in the Family Album once the admin approves it.', 'ok');
        drawKeep();
      } catch (err) {
        toast(err.message || 'Could not save the photo.', 'error');
        btn.disabled = false;
        btn.textContent = store.isAdmin ? 'Add to the Family Album' : 'Send to the Family Album';
      }
    });
    clear(keep, form);
  }

  function faceCard(f) {
    const thumb = cropCanvas(s.photo, f.box, 176, 1.7);
    thumb.className = 'face-thumb';
    const who = f.who;
    return h('div.face-card' + (who?.skipped ? '.skipped' : who ? '.named' : ''),
      h('button.face-pick', { type: 'button', onclick: () => whoIsThis(f), 'aria-label': `Face ${f.n}: ${who?.name || 'who is this?'}` },
        thumb,
        h('span.face-label', h('b', `Face ${f.n}`), ' ',
          who?.skipped ? h('span.muted', 'Skipped') : who ? h('span', who.name) : h('span.face-ask', 'Who is this?'))),
      who && !who.skipped ? h('span.face-state' + (who.live || who.tagOnly ? '.ok' : '.wait'), who.tagOnly ? 'Named in this photo' : who.live ? 'Tree photo saved' : 'Sent for approval') : null,
      who?.personId && store.fam.byId.get(who.personId)
        ? h('div.face-more',
          h('button.btn.small', { type: 'button', onclick: () => openPersonForm({ mode: 'edit', person: store.fam.byId.get(who.personId) }) }, 'Fill in their details'),
          h('a.btn.small', { href: `#/tree/${store.fam.defaultRootId}?p=${who.personId}` }, 'See in tree'))
        : null,
      !who ? h('button.linkish.face-remove', { type: 'button', onclick: () => { s.faces = s.faces.filter((x) => x !== f); draw(); } }, 'Not a face? Remove') : null);
  }

  // Step 1: who is this face?
  async function whoIsThis(f) {
    if (!(await claimGate())) return;
    const big = cropCanvas(s.photo, f.box, 360, 1.9);
    big.className = 'face-big';
    const taken = new Set(s.faces.filter((x) => x !== f && x.who?.personId).map((x) => x.who.personId));
    let m;
    const inTree = h('section.face-step',
      h('h3', 'Someone already in the tree'),
      personPicker(async (p) => {
        if (taken.has(p.id) && !(await confirmDialog(`${shortName(p)} is already given to another face in this photo. Use this face for them instead?`, 'Use this face'))) return;
        m.close();
        usePhoto(f, p);
      }, { placeholder: 'Type their name' }));
    const notInTree = h('section.face-step',
      h('h3', 'Not in the tree yet'),
      h('p.form-note', 'Add them first. You choose how they are related to someone in the tree, fill in their details, and then this face becomes their photo.'),
      h('button.btn', { type: 'button', onclick: () => { m.close(); addNewPerson(f); } }, 'Add a new person'));
    const other = h('div.form-actions',
      h('button.btn', { type: 'button', onclick: () => { f.who = { skipped: true }; m.close(); draw(); } }, 'Skip this face'),
      f.who && !f.who.skipped ? null : h('button.btn', { type: 'button', onclick: () => m.close() }, 'Close'));
    m = modal(`Who is face ${f.n}?`, [h('div.face-head', big,
      f.who?.name ? h('p', `Now given to ${f.who.name}. Pick someone else to change it.`) : h('p.form-note', 'Pick the person, then you can move and zoom the picture before it is saved.')),
    inTree, notInTree, other], { wide: false });
    setTimeout(() => m.body.querySelector('.picker input')?.focus(), 50);
  }

  // Step 1b: someone new. Who are they related to, and how?
  function addNewPerson(f) {
    let rel = null;
    const chosen = h('p.form-note', 'Nobody chosen yet.');
    const as = select('as', [['child', 'a child of'], ['spouse', 'the husband or wife of'], ['parent', 'a parent of'], ['sibling', 'a brother or sister of']], 'child');
    const form = h('form.form',
      h('p.form-note', `Face ${f.n} is…`),
      field('How are they related?', as),
      field('…this person in the tree', personPicker((p) => { rel = p; chosen.textContent = `Chosen: ${fullName(p)} (${relationHint(store.fam, p.id)})`; }, { placeholder: 'Type a name' })),
      chosen,
      h('div.form-actions',
        h('button.btn', { type: 'button', onclick: () => m.close() }, 'Cancel'),
        h('button.btn.primary', { type: 'submit' }, 'Next: their details')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!rel) return toast('Please choose who they are related to.', 'error');
      m.close();
      openPersonForm({ mode: 'add', relation: { as: as.value, of: rel.id }, onSaved: ({ applied, result }) => {
        const person = applied && result ? store.fam.byId.get(result) : null;
        if (person) return usePhoto(f, person);
        // Waiting for approval: the person is not in the tree yet, so their
        // photo can't be attached now.
        f.who = { name: 'New person (waiting for approval)', pending: true };
        draw();
        toast('Sent for approval. Once they are in the tree, open this photo again and pick their face.', 'ok');
      } });
    });
    const m = modal(`Add face ${f.n} to the tree`, form);
  }

  // Step 2: frame the face and save it as their tree photo.
  async function usePhoto(f, person) {
    const editor = photoEditor();
    try {
      await editor.load(await cropBlob(s.photo, f.box));
    } catch {
      return toast('Could not cut out this face. Please try again.', 'error');
    }
    const hasPhoto = !!person.photo_path;
    const vis = select('visibility', VIS, hasPhoto ? (person.photo_visibility || 'branch') : 'branch');
    const live = canManage(person.id);
    const form = h('form.form',
      h('p.form-note', `Tree photo for ${fullName(person)}.`, hasPhoto ? ' This replaces the photo they have now.' : ''),
      editor.el,
      field('Who can see this photo', vis),
      publicWarning(vis, () => person.is_living !== false, 'this photo').note,
      h('div.form-actions',
        h('button.btn', { type: 'button', onclick: () => m.close() }, 'Cancel'),
        // Someone with a good tree photo already: just name them in this photo.
        hasPhoto ? h('button.btn', { type: 'button', onclick: () => {
          f.who = { personId: person.id, name: fullName(person), tagOnly: true };
          m.close();
          draw();
        } }, 'Keep their photo, just name them here') : null,
        h('button.btn.primary', { type: 'submit' }, live ? 'Use as tree photo' : 'Send for approval')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const path = await uploadPendingPhoto(await editor.toBlob());
        const r = await send('set_photo', { person_id: person.id, path, visibility: vis.value },
          { target: person.id, summary: `New photo for ${shortName(person)} (from a group photo)` }, m.close);
        if (r) {
          f.who = { personId: person.id, name: fullName(person), live: r.applied };
          draw();
        }
      } catch (err) {
        toast(err.message || 'Upload failed.', 'error');
      }
      btn.disabled = false;
      btn.textContent = live ? 'Use as tree photo' : 'Send for approval';
    });
    const m = modal(`Face ${f.n}: ${shortName(person)}`, form, { guard: true });
  }

  draw();
}

// For tests: the parts that do not need a browser photo.
export const _test = { order, frameAround };
