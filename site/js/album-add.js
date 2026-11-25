// "Add photo to album" (24 Nov 2026): put a photo straight into the
// Family Album from the Library, without going to the Faces page. The member
// chooses a photo; the browser finds the faces (as on the Faces page, no face
// recognition); they may tap faces to name people who are in the tree, and they
// may fill in the details (title, where, when, about). Naming people is
// optional, so any family photo can go in, even one with nobody named.
// Unlike the Faces page, nobody's tree photo changes here.
// "Name the faces" (25 Nov 2026): the same screen, opened with a photo that is
// already in the album (link), lets the admin add, change or remove the names
// on its faces afterwards. The photo and its details stay as they are.
import { store } from './data.js';
import { personPicker } from './forms.js';
import { fullName, shortName } from './model.js';
import { h, clear, modal, toast, field, confirmDialog } from './ui.js';
import { readPhoto, findFaces, order, finderReady } from './faces.js';
import { saveGroupPhoto, updatePhotoFaces, libraryPhotoUrl, allTopics, LIBRARY_BLESSINGS } from './library.js';

export function openAddToAlbum({ onDone = () => {}, link = null } = {}) {
  const s = { photo: null, url: null, faces: [], adding: false, picking: null, busy: false };
  const input = h('input', { id: 'album-file', type: 'file', accept: 'image/*', hidden: true });
  const chooseBtn = h('button.btn.big.primary', { type: 'button', onclick: () => input.click() }, 'Choose a photo');
  const status = h('p.faces-status', { role: 'status' });
  const stage = h('div.faces-stage.album-add-stage', { hidden: true });
  const tools = h('div.faces-tools', { hidden: true });
  const who = h('section.album-add-who', { hidden: true });
  const details = h('div.album-add-details', { hidden: true });

  const title = h('input', { name: 'title', type: 'text', maxlength: 200, placeholder: 'e.g. Diwali at home' });
  const where = h('input', { name: 'taken_where', type: 'text', maxlength: 120, placeholder: 'e.g. Delhi, at the wedding' });
  const when = h('input', { name: 'taken_when', type: 'text', maxlength: 60, placeholder: 'e.g. December 2019, or about 1975' });
  const note = h('textarea', { name: 'note', rows: 3, maxlength: 2000, placeholder: 'What was happening, or a memory (optional)' });
  const saveLabel = link ? 'Save the names' : store.isAdmin ? 'Add to the album' : 'Send to the album';
  const btn = h('button.btn.primary', { type: 'submit', disabled: true }, saveLabel);
  clear(details,
    h('h3', 'About this photo'),
    field('Title *', title),
    h('div.row2', field('Where it was taken', where), field('When it was taken', when)),
    field('About this photo', note),
    h('p.form-note', store.isAdmin
      ? 'Only signed-in family members can see album photos (never public).'
      : `Only signed-in family members can see album photos (never public). The admin checks it first; once approved you earn +${LIBRARY_BLESSINGS} blessings.`));

  const form = h('form.form.album-add',
    h('p.lead', link
      ? 'Tap a face to name who it is, change the name, or take it off. Then tap Save the names.'
      : 'Choose a family photo. If people in it are in the tree, you can tap their faces to name them, so the family can see who is who. Naming them is up to you.'),
    link ? null : h('div.faces-choose', chooseBtn, input),
    status, stage, tools, who, details,
    h('div.form-actions',
      h('button.btn', { type: 'button', onclick: () => m.close() }, 'Cancel'),
      btn));
  // Enter in the name search picks nobody and must not send the form.
  who.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  const m = modal(link ? `Name the faces: ${link.title}` : 'Add photo to album', form, { wide: true, guard: true, onClose: () => { if (s.url) URL.revokeObjectURL(s.url); } });

  // A photo already in the album: open it with its names, then look for faces nobody has named yet.
  if (link) (async () => {
    s.busy = true;
    try {
      status.textContent = 'Opening the photo…';
      const url = await libraryPhotoUrl(link);
      if (!url) throw new Error('no photo');
      s.photo = await readPhoto(await (await fetch(url)).blob());
    } catch {
      status.textContent = 'The photo could not be opened. Please try again later.';
      s.busy = false;
      return;
    }
    s.url = URL.createObjectURL(await new Promise((res) => s.photo.toBlob(res, 'image/jpeg', 0.9)));
    const W = s.photo.width, H = s.photo.height;
    s.faces = (link.faces || []).map((f) => ({ box: { x: f.x * W, y: f.y * H, w: f.w * W, h: f.h * H }, person: store.fam.byId.get(f.person_id) || null }))
      .filter((f) => f.person).sort((a, b) => a.box.x - b.box.x).map((f, i) => ({ ...f, n: i + 1 }));
    btn.disabled = false;
    draw();
    status.textContent = finderReady() ? 'Looking for faces nobody has named yet…' : 'Looking for faces nobody has named yet (the first time takes a little while)…';
    try {
      // A found face whose middle sits inside a named one is that same face.
      const inside = (b, f) => b.x + b.w / 2 > f.box.x && b.x + b.w / 2 < f.box.x + f.box.w && b.y + b.h / 2 > f.box.y && b.y + b.h / 2 < f.box.y + f.box.h;
      const extra = order(await findFaces(s.photo)).filter((b) => !s.faces.some((f) => inside(b, f)));
      let n = s.faces.length;
      s.faces.push(...extra.map((b) => ({ n: ++n, box: b, person: null })));
      status.textContent = extra.length
        ? `${s.faces.filter((f) => f.person).length} named, ${extra.length} not named yet. Tap a face to name it.`
        : 'Tap a face to name it or change its name, or mark a face the site missed.';
    } catch (e) {
      console.warn('face finder', e);
      status.textContent = 'Tap a named face to change it, or mark a face the site missed.';
    }
    s.busy = false;
    draw();
  })();

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file || s.busy) return;
    if (s.faces.some((f) => f.person) && !(await confirmDialog('Use a different photo? The names you gave in this one will be lost.', 'Choose another photo'))) return;
    s.busy = true;
    chooseBtn.disabled = true;
    try {
      status.textContent = 'Opening the photo…';
      s.photo = await readPhoto(file);
    } catch {
      status.textContent = '';
      toast('That file could not be read as a photo.', 'error');
      s.busy = false;
      chooseBtn.disabled = false;
      return;
    }
    s.faces = [];
    s.picking = null;
    if (s.url) URL.revokeObjectURL(s.url);
    s.url = URL.createObjectURL(await new Promise((res) => s.photo.toBlob(res, 'image/jpeg', 0.9)));
    chooseBtn.textContent = 'Choose a different photo';
    chooseBtn.classList.remove('primary');
    details.hidden = false;
    btn.disabled = false;
    draw();
    status.textContent = finderReady() ? 'Looking for faces…' : 'Looking for faces (the first time takes a little while)…';
    try {
      s.faces = order(await findFaces(s.photo)).map((b, i) => ({ n: i + 1, box: b, person: null }));
      status.textContent = s.faces.length
        ? `Found ${s.faces.length} face${s.faces.length === 1 ? '' : 's'}. Tap a face to name someone in the tree, or just fill in the details below.`
        : 'No faces were found. You can mark one yourself, or just fill in the details below.';
    } catch (e) {
      console.warn('face finder', e);
      status.textContent = 'Faces could not be found on this device. You can mark them yourself, or just fill in the details below.';
    }
    s.busy = false;
    chooseBtn.disabled = false;
    draw();
    if (!title.value) title.focus({ preventScroll: true });
  });

  // Marking a face the finder missed: tap the middle of the face.
  stage.addEventListener('click', (e) => {
    if (!s.adding || e.target.closest('.face-box')) return;
    const r = stage.getBoundingClientRect();
    const k = s.photo.width / r.width;
    const sizes = s.faces.map((f) => f.box.w).sort((a, b) => a - b);
    const w = sizes.length ? sizes[Math.floor(sizes.length / 2)] : s.photo.width / 9;
    const cx = (e.clientX - r.left) * k;
    const cy = (e.clientY - r.top) * k;
    const face = { n: Math.max(0, ...s.faces.map((f) => f.n)) + 1, box: { x: cx - w / 2, y: cy - w * 0.55, w, h: w * 1.1 }, person: null };
    s.faces.push(face);
    s.adding = false;
    s.picking = face;
    draw();
  });

  function draw() {
    stage.hidden = !s.photo;
    tools.hidden = !s.photo;
    if (!s.photo) return;
    stage.classList.toggle('adding', s.adding);
    const pct = (v, of) => `${(v / of) * 100}%`;
    clear(stage,
      h('img', { src: s.url, alt: 'The photo', draggable: false }),
      s.faces.map((f) => h('button.face-box' + (f.person ? '.named' : '') + (f === s.picking ? '.picking' : ''), {
        type: 'button',
        style: `left:${pct(f.box.x, s.photo.width)};top:${pct(f.box.y, s.photo.height)};width:${pct(f.box.w, s.photo.width)};height:${pct(f.box.h, s.photo.height)}`,
        'aria-label': `Face ${f.n}${f.person ? `: ${fullName(f.person)}` : ''}`,
        onclick: () => { s.adding = false; s.picking = f; draw(); },
      }, h('span.face-num', f.person ? (f.person.given_name || '').split(' ')[0] || shortName(f.person) : String(f.n)))));
    const named = s.faces.filter((f) => f.person);
    clear(tools,
      h('button.btn.small' + (s.adding ? '.primary' : ''), { type: 'button', onclick: () => { s.adding = !s.adding; s.picking = null; draw(); } },
        s.adding ? 'Now tap on the face in the photo (or tap here to stop)' : '＋ Mark a face the site missed'),
      named.length ? h('p.small.muted', `Named: ${named.map((f) => shortName(f.person)).join(', ')}`) : null);
    drawWho();
  }

  // Who is this face? Only people already in the tree can be named here.
  function drawWho() {
    const f = s.picking;
    who.hidden = !f;
    if (!f) return;
    const taken = s.faces.filter((x) => x !== f && x.person).map((x) => x.person.id);
    clear(who,
      h('h3', f.person ? `Face ${f.n}: ${fullName(f.person)}` : `Who is face ${f.n}?`),
      h('p.form-note', 'Type the name of someone in the tree. Not in the tree? Leave it, the photo can go in without their name.'),
      personPicker((p) => { f.person = p; s.picking = null; draw(); }, { placeholder: 'Type their name', exclude: taken }),
      h('div.album-add-who-actions',
        f.person ? h('button.btn.small', { type: 'button', onclick: () => { f.person = null; draw(); } }, 'Remove the name') : null,
        h('button.btn.small', { type: 'button', onclick: () => { s.faces = s.faces.filter((x) => x !== f); s.picking = null; draw(); } }, 'Not a face'),
        h('button.btn.small', { type: 'button', onclick: () => { s.picking = null; draw(); } }, 'Done')));
    setTimeout(() => who.querySelector('.picker input')?.focus({ preventScroll: true }), 30);
    who.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!s.photo) return toast('Please choose a photo first.', 'error');
    if (!link && !title.value.trim()) { toast('Please give the photo a short title.', 'error'); title.focus(); return; }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const faces = s.faces.filter((f) => f.person).map((f) => ({
        person_id: f.person.id,
        x: +(Math.max(0, f.box.x) / s.photo.width).toFixed(4),
        y: +(Math.max(0, f.box.y) / s.photo.height).toFixed(4),
        w: +(f.box.w / s.photo.width).toFixed(4),
        h: +(f.box.h / s.photo.height).toFixed(4),
      }));
      if (link) {
        await updatePhotoFaces(link.id, faces);
        m.close();
        toast('The names are saved.', 'ok');
        onDone({ ...link, faces });
        return;
      }
      const blob = await new Promise((res) => s.photo.toBlob(res, 'image/jpeg', 0.88));
      const topics = allTopics();
      const row = await saveGroupPhoto({
        blob, faces, title: title.value.trim(), note: note.value.trim(),
        topic: topics.includes('Family photos') ? 'Family photos' : topics[0],
        taken_where: where.value.trim(), taken_when: when.value.trim(),
      });
      m.close();
      toast(row.status === 'approved' ? 'Added to the Family Album.' : 'Sent. It appears in the Family Album once the admin approves it.', 'ok');
      onDone(row);
    } catch (err) {
      toast(err.message || 'Could not save the photo.', 'error');
      btn.disabled = false;
      btn.textContent = saveLabel;
    }
  });
  return m;
}
