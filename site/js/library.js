// The family Library: links to videos, articles and other writing about the
// Jaggis of Chakwal, in one place. Any signed-in family member can suggest a
// link; it shows once the admin approves it (the admin's own go live at once).
// A link can be tagged with people in the tree, so it also shows on their card.
// Group photos from the Faces page are Library items too (kind 'photo'): the
// picture is kept for signed-in family only, and each tagged face shows the
// person's name when you point at it or tap it.
import { family } from './family.js';
import { config } from './config.js';
import { store } from './data.js';
import { fullName, shortName } from './model.js';
import { h, clear, toast, modal, field, select, confirmDialog, formatWhen } from './ui.js';
import { personPicker } from './forms.js';
import { forgetBlessings } from './blessings.js';

const LIB = family.library;
export const TOPICS = LIB.topics;
export const LIBRARY_BLESSINGS = 3;
const NEW_TOPIC = '__new';

// The standard topics, then any the family has added, with "Other" last.
export function allTopics() {
  const extra = [...new Set((cache || []).map((l) => l.topic).filter((t) => t && !TOPICS.includes(t)))].sort();
  return [...TOPICS.filter((t) => t !== 'Other'), ...extra, 'Other'];
}

// A best guess at the topic from the title, note and source (the article itself
// can't be read from the browser). The person adding the link can change it.
export function guessTopic(text, { tagged = false } = {}) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const custom = allTopics().filter((x) => !TOPICS.includes(x));
  const hit = custom.find((x) => x.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).some((w) => t.includes(w)));
  if (hit) return hit;
  for (const [topic, words, opts = {}] of LIB.hints) {
    if ((opts.tagged && tagged) || new RegExp(words).test(t)) return topic;
  }
  return null;
}

// ---------------------------------------------------------------- links

export function youTubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
      return m ? m[1] : null;
    }
  } catch { /* not a link */ }
  return null;
}

// Tidies a pasted link: adds https:// if missing, and writes YouTube links one
// way, so the same video can't be added twice under different addresses.
export function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    const yt = youTubeId(u.href);
    if (yt) {
      const t = u.searchParams.get('t');
      return `https://www.youtube.com/watch?v=${yt}${t ? `&t=${encodeURIComponent(t)}` : ''}`;
    }
    // Posts on X (Twitter): one address, without the sharing extras (?s=20 and the like).
    if (/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(u.hostname)) return `https://x.com${u.pathname.replace(/\/$/, '')}`;
    return u.href;
  } catch {
    return '';
  }
}

export function siteName(url) {
  if (youTubeId(url)) return 'YouTube';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function kindOf(link) {
  if (link.kind === 'photo') return 'Photo';
  if (youTubeId(link.url) || /vimeo\.com|facebook\.com\/.*\/videos|dailymotion/i.test(link.url)) return 'Video';
  if (/\.pdf(\?|#|$)/i.test(link.url)) return 'Document';
  if (/books\.google|archive\.org\/details/i.test(link.url)) return 'Book';
  return 'Article';
}

const KIND_ICON = { Video: '▶', Article: '📰', Document: '📄', Book: '📖', Photo: '🖼' };

function thumbOf(link) {
  const yt = youTubeId(link.url);
  if (yt) return `https://i.ytimg.com/vi/${encodeURIComponent(yt)}/hqdefault.jpg`;
  return link.image_url || null;
}

// ---------------------------------------------------------------- data

let cache = null;
let cacheAt = 0;
export function forgetLibrary() { cache = null; }

// Every link this visitor may see: approved ones, plus (signed in) their own
// suggestions, and for the admin, everything. [] if the Library isn't set up yet.
export async function loadLibrary(force = false) {
  if (store.preview || !store.sb) return [];
  if (!force && cache && Date.now() - cacheAt < 60_000) return cache;
  const { data, error } = await store.sb.from('library_links').select('*').order('submitted_at', { ascending: false });
  if (error) {
    console.warn('library', error.message);
    return [];
  }
  cache = data || [];
  cacheAt = Date.now();
  return cache;
}

export async function linksAbout(personId) {
  return (await loadLibrary()).filter((l) => l.status === 'approved' && (l.person_ids || []).includes(personId));
}

export async function pendingLibraryCount() {
  if (!store.isAdmin) return 0;
  return (await loadLibrary(true)).filter((l) => l.status === 'pending').length;
}

async function saveLink(fields, id = null) {
  const q = id
    ? store.sb.from('library_links').update(fields).eq('id', id).select('id')
    : store.sb.from('library_links').insert({ ...fields, status: store.isAdmin ? 'approved' : 'pending', submitted_by: store.session.user.id });
  const { data, error } = await q;
  // The database changes nothing (without an error) for someone who may not edit it.
  if (!error && id && !data?.length) throw new Error(NOT_YOURS);
  if (error) {
    if (/library_links_url_once|duplicate/i.test(error.message)) {
      const same = (cache || []).find((l) => l.url.toLowerCase() === String(fields.url).toLowerCase());
      throw new Error(same
        ? `This link is already in the Library as "${same.title}". ${store.isAdmin ? 'Close this and use Edit on that card to change its title or note.' : 'It may still be waiting for approval.'}`
        : 'This link is already in the Library, or waiting for approval.');
    }
    throw error;
  }
  forgetLibrary();
}

async function setStatus(link, status, note = null) {
  const { error } = await store.sb.from('library_links').update({ status, review_note: note || null }).eq('id', link.id);
  if (error) throw error;
  forgetLibrary();
  forgetBlessings();
}

async function removeLink(link) {
  if (link.photo_path) await store.sb.storage.from(PHOTO_BUCKET).remove([link.photo_path]).catch(() => {});
  const { error } = await store.sb.from('library_links').delete().eq('id', link.id);
  if (error) throw error;
  forgetLibrary();
}

// ---------------------------------------------------------------- group photos

const PHOTO_BUCKET = 'library-photos';
const photoUrls = new Map();

// A short-lived address for a Library photo (the bucket is private).
export async function libraryPhotoUrl(link) {
  if (!link.photo_path) return null;
  const hit = photoUrls.get(link.photo_path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data } = await store.sb.storage.from(PHOTO_BUCKET).createSignedUrl(link.photo_path, 3600);
  if (!data?.signedUrl) return null;
  photoUrls.set(link.photo_path, { url: data.signedUrl, until: Date.now() + 50 * 60_000 });
  return data.signedUrl;
}

// Keep a group photo in the Library with its tagged faces. faces: [{person_id,
// x, y, w, h}] as fractions of the picture. The admin's go in at once; a
// member's wait for approval. Returns the new item.
export async function saveGroupPhoto({ blob, title, topic, note, faces, taken_where = '', taken_when = '' }) {
  const id = crypto.randomUUID();
  const photo_path = `${id}/photo.jpg`;
  const row = {
    id, kind: 'photo', url: null, title, topic, note: note || null, visibility: 'family', photo_path,
    faces, person_ids: [...new Set(faces.map((f) => f.person_id))],
    taken_where: taken_where || null, taken_when: taken_when || null,
    added_by_name: store.profile?.display_name || null,
    status: store.isAdmin ? 'approved' : 'pending', submitted_by: store.session.user.id,
  };
  const { error } = await store.sb.from('library_links').insert(row);
  if (error) {
    if (/kind|photo_path|faces|column/i.test(error.message)) throw new Error('The Library is not ready for photos yet. Please ask the admin.');
    throw error;
  }
  const up = await store.sb.storage.from(PHOTO_BUCKET).upload(photo_path, blob, { contentType: 'image/jpeg' });
  if (up.error) {
    await store.sb.from('library_links').delete().eq('id', id);
    throw new Error('Could not save the photo: ' + up.error.message);
  }
  forgetLibrary();
  forgetBlessings();
  return row;
}

const NOT_YOURS = 'This could not be saved: only the admin, or the person who added it, can change it.';

// Change the names on a photo already in the Library (the admin, or the member who added it).
export async function updatePhotoFaces(id, faces) {
  const { data, error } = await store.sb.from('library_links').update({ faces, person_ids: [...new Set(faces.map((f) => f.person_id))] }).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error(NOT_YOURS);
  forgetLibrary();
}

// Who may change an album photo's details and the names on its faces: the admin,
// and the family member who added it (Sunil, 25 Nov 2026). The database checks
// the same rule, and only the admin approves or removes.
export const canEditPhoto = (link) => store.isAdmin || (link.kind === 'photo' && !!store.session && link.submitted_by === store.session.user.id);

// One album page: the photo with a name over each tagged face (shown when you
// point at a face on a computer or tap it on a phone, or all at once with
// "Show all names"), and beside it where and when it was taken, the story, who
// is in it, and who added it and when.
function albumPage(link, close) {
  const people = (link.faces || []).map((f) => ({ ...f, person: store.fam.byId.get(f.person_id) })).filter((f) => f.person)
    .sort((a, b) => a.x - b.x);
  const stage = h('div.lib-photo-stage', h('p.muted', 'Opening the photo…'));
  const boxes = new Map();
  const light = (id, on) => boxes.get(id)?.classList.toggle('lit', on);
  const open = (id) => { close(); goToPerson(id); };
  const showAll = h('button.btn.small', { type: 'button', 'aria-pressed': 'false', onclick: () => {
    const on = stage.classList.toggle('all-names');
    showAll.setAttribute('aria-pressed', String(on));
    showAll.textContent = on ? 'Hide names' : 'Show all names';
  } }, 'Show all names');
  libraryPhotoUrl(link).then((url) => {
    if (!url) return clear(stage, h('p.form-error', 'The photo could not be opened.'));
    const pct = (v) => `${v * 100}%`;
    clear(stage,
      h('img', { src: url, alt: link.title, draggable: false }),
      people.map((f) => {
        // Near the edge of the photo the name opens inwards, so it isn't cut off.
        const edge = f.x + f.w / 2 < 0.18 ? '.edge-left' : f.x + f.w / 2 > 0.82 ? '.edge-right' : '';
        const b = h('button.lib-face' + edge, {
          type: 'button', style: `left:${pct(f.x)};top:${pct(f.y)};width:${pct(f.w)};height:${pct(f.h)}`,
          'aria-label': fullName(f.person),
          onclick: (e) => {
            // First tap shows the name; a tap on the name opens them in the tree.
            if (b.classList.contains('show')) return;
            e.stopPropagation();
            for (const o of boxes.values()) o.classList.remove('show');
            b.classList.add('show');
          },
        }, h('span.lib-face-name', { onclick: () => open(f.person_id) }, shortName(f.person)));
        boxes.set(f.person_id, b);
        return b;
      }));
  }).catch(() => clear(stage, h('p.form-error', 'The photo could not be opened.')));
  stage.addEventListener('click', (e) => { if (!e.target.closest('.lib-face')) for (const o of boxes.values()) o.classList.remove('show'); });
  const when = [link.taken_when, link.taken_where].filter(Boolean);
  const added = new Date(link.submitted_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  return h('div.album-spread', { 'data-id': link.id },
    h('div.album-left',
      stage,
      people.length ? h('div.lib-photo-bar', h('span.muted.small', 'Point at a face, or tap it, to see who it is.'), showAll) : null),
    h('div.album-right',
      h('h3.album-title', link.title),
      when.length ? h('p.album-when', when.join(' · ')) : h('p.album-when.muted', 'Where and when: not added yet'),
      link.note ? h('p.album-note', link.note) : null,
      people.length ? [h('h4', 'In this photo (left to right)'),
        h('ol.lib-photo-names', people.map((f) => h('li', {
          onmouseenter: () => light(f.person_id, true), onmouseleave: () => light(f.person_id, false),
        }, h('button.link', { type: 'button', onclick: () => open(f.person_id) }, fullName(f.person)))))] : null,
      h('p.album-added', `Added by ${link.added_by_name || 'a family member'} on ${added}`),
      link.status === 'pending' ? h('p.tag.warn', 'Waiting for approval') : null,
      canEditPhoto(link) ? h('div.album-admin',
        h('button.btn.small.ghost', { type: 'button', onclick: async () => {
          close();
          const { openAddToAlbum } = await import('./album-add.js');
          // Afterwards the album opens again at this photo, with the new names.
          openAddToAlbum({ link, onDone: () => {
            const to = `#/library?photo=${link.id}`;
            if (location.hash === to) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = to;
          } });
        } }, 'Name the faces'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => { close(); openLibraryForm({ link }); } }, 'Edit the details')) : null));
}

// The Family Album: opens like a book, one photo to a page, with a cover.
// list: the photos in order; start: the id to open at (or the cover).
export function openAlbum(list, startId = null) {
  if (!list.length) return;
  const pages = list.length > 1 ? [null, ...list] : list;
  let i = Math.max(0, pages.findIndex((l) => l?.id === startId));
  if (startId && i === 0 && pages[0] === null) i = 0;
  const book = h('div.album-book');
  const where = h('span.album-count');
  const prev = h('button.btn', { type: 'button', 'aria-label': 'Previous page', onclick: () => turn(-1) }, '‹ Back');
  const next = h('button.btn.primary', { type: 'button', 'aria-label': 'Next page', onclick: () => turn(1) }, 'Next ›');
  const cover = () => h('div.album-cover',
    h('div.album-cover-inner',
      h('p.album-cover-small', config.siteTitle),
      h('h2', 'Family Album'),
      h('p', `${list.length} photos, added by the family`),
      h('div.album-cover-thumbs', list.slice(0, 4).map((l) => {
        const im = h('img', { alt: '' });
        libraryPhotoUrl(l).then((u) => { if (u) im.src = u; }).catch(() => {});
        return im;
      })),
      h('button.btn.primary.big', { type: 'button', onclick: () => turn(1) }, 'Open the album')));
  const draw = (dir = 0) => {
    const page = pages[i] ? albumPage(pages[i], () => m.close()) : cover();
    if (dir) page.classList.add(dir > 0 ? 'turn-next' : 'turn-back');
    clear(book, page);
    where.textContent = pages[i] ? `Photo ${list.indexOf(pages[i]) + 1} of ${list.length}` : 'Cover';
    prev.disabled = i === 0;
    next.disabled = i === pages.length - 1;
  };
  const turn = (d) => {
    const j = Math.max(0, Math.min(pages.length - 1, i + d));
    if (j === i) return;
    i = j;
    draw(d);
  };
  // Arrow keys on a computer, a swipe on a phone.
  const key = (e) => { if (e.key === 'ArrowRight') turn(1); if (e.key === 'ArrowLeft') turn(-1); };
  let x0 = null;
  book.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  book.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 60) turn(dx < 0 ? 1 : -1);
  });
  const m = modal('Family Album', h('div.album',
    book,
    pages.length > 1 ? h('div.album-nav', prev, where, next) : null), { wide: true, onClose: () => removeEventListener('keydown', key) });
  m.dialog.classList.add('album-dialog');
  addEventListener('keydown', key);
  draw();
  return m;
}

// A single photo (from a person's card, or one waiting for approval).
export const openPhotoViewer = (link) => openAlbum([link], link.id);

// ---------------------------------------------------------------- form

// Add, suggest or edit a link. prefill can carry person_ids (from a person's card).
export function openLibraryForm({ link = null, prefill = {}, onDone = () => {} } = {}) {
  if (!store.signedIn || store.preview) return toast('Please sign in first. Only family members can add links.', 'error');
  const v = { ...prefill, ...(link || {}) };
  const url = h('input', { name: 'url', type: 'url', required: true, inputmode: 'url', placeholder: 'https://www.youtube.com/watch?v=…', value: v.url || '' });
  const title = h('input', { name: 'title', type: 'text', required: true, maxlength: 200, placeholder: LIB.titleExample, value: v.title || '' });
  const source = h('input', { name: 'source', type: 'text', maxlength: 120, placeholder: 'e.g. YouTube, Dawn newspaper, a family member', value: v.source || '' });
  const topics = allTopics();
  if (v.topic && !topics.includes(v.topic)) topics.splice(-1, 0, v.topic);
  const topic = select('topic', [...topics.map((t) => [t, t]), [NEW_TOPIC, '+ New topic…']], v.topic || LIB.defaultTopic);
  const newTopic = h('input', { name: 'new_topic', type: 'text', maxlength: 60, placeholder: 'e.g. Moti Mahal and butter chicken' });
  const newTopicBox = h('div', { hidden: true }, field('Name of the new topic', newTopic, 'It becomes a new button on the Library page.'));
  const topicHint = h('span.field-hint', { hidden: true }, 'Suggested from the title. Change it if it fits better elsewhere.');
  // Suggest a topic as the title and note are typed, until someone picks one.
  let topicPicked = !!link;
  topic.addEventListener('change', () => {
    topicPicked = true;
    topicHint.hidden = true;
    newTopicBox.hidden = topic.value !== NEW_TOPIC;
    if (!newTopicBox.hidden) newTopic.focus();
  });
  const suggest = () => {
    if (topicPicked) return;
    const g = guessTopic(`${title.value} ${note.value} ${source.value}`, { tagged: people.length > 0 });
    if (g && g !== topic.value) {
      if (![...topic.options].some((o) => o.value === g)) topic.add(new Option(g, g), topic.options.length - 1);
      topic.value = g;
      topicHint.hidden = false;
    }
  };
  const note = h('textarea', { name: 'note', rows: 3, maxlength: 2000, placeholder: 'What is it about, and why does it matter to the family?' });
  note.value = v.note || '';
  for (const el of [title, note, source]) el.addEventListener('input', () => suggest());
  const image = h('input', { name: 'image_url', type: 'url', placeholder: 'https://… (optional)', value: v.image_url || '' });

  // People in the tree this link is about.
  let people = [...(v.person_ids || [])].filter((id) => store.fam.byId.has(id));
  const chips = h('div.lib-chips');
  const drawChips = () => clear(chips, people.length ? people.map((id) => h('span.lib-chip',
    shortName(store.fam.byId.get(id)),
    h('button', { type: 'button', 'aria-label': `Remove ${shortName(store.fam.byId.get(id))}`, onclick: () => { people = people.filter((x) => x !== id); drawChips(); } }, '✕')))
    : h('span.muted.small', 'Nobody tagged yet (optional).'));
  drawChips();
  const picker = personPicker((p) => {
    if (!people.includes(p.id)) people.push(p.id);
    drawChips();
    suggest();
    picker.querySelector('input').value = '';
  }, { placeholder: 'Type a name to tag someone' });

  // Fill in what we can from the link itself.
  let lastLooked = '';
  const lookUp = async () => {
    const u = normalizeUrl(url.value);
    if (!u || u === lastLooked) return;
    lastLooked = u;
    if (autoImage && image.value.trim() === autoImage) image.value = ''; // the last link's picture
    if (!source.value.trim()) source.value = siteName(u);
    if (youTubeId(u) && !title.value.trim()) {
      try {
        const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`);
        if (r.ok) {
          const j = await r.json();
          if (!title.value.trim() && j.title) { title.value = j.title.slice(0, 200); suggest(); }
          if (j.author_name && (!source.value.trim() || source.value === 'YouTube')) source.value = `YouTube: ${j.author_name}`.slice(0, 120);
        }
      } catch { /* type the title by hand */ }
    }
    preview.replaceChildren(previewThumb(u, image.value.trim()));
    // Other sites: ask for the page's own preview picture (the one WhatsApp shows).
    if (!youTubeId(u) && !image.value.trim()) {
      preview.replaceChildren(h('p.muted.small', 'Looking for a picture…'));
      const found = await linkPreview(u);
      if (lastLooked !== u) return; // the link was changed meanwhile
      if (found.title && !title.value.trim()) { title.value = found.title; suggest(); }
      if (found.image && !image.value.trim()) { image.value = found.image; autoImage = found.image; }
      preview.replaceChildren(previewThumb(u, image.value.trim(), () => {
        // The picture didn't load: leave the field empty rather than keep a broken picture.
        if (autoImage && image.value.trim() === autoImage) image.value = '';
        preview.replaceChildren();
      }));
    }
  };
  let autoImage = '';
  if (!link && people.length) setTimeout(suggest, 0);
  url.addEventListener('change', lookUp);
  url.addEventListener('paste', () => setTimeout(lookUp, 0));
  image.addEventListener('change', () => { const u = normalizeUrl(url.value); preview.replaceChildren(u ? previewThumb(u, image.value.trim()) : ''); });
  const preview = h('div.lib-form-preview', v.url ? previewThumb(v.url, v.image_url) : null);
  // An older link with no picture yet: look for one when the admin opens it.
  if (link && link.kind !== 'photo' && v.url && !youTubeId(v.url) && !v.image_url) setTimeout(lookUp, 0);

  const admin = store.isAdmin;
  const isPhoto = link?.kind === 'photo';
  if (isPhoto) url.required = false;
  const takenWhere = h('input', { type: 'text', maxlength: 120, placeholder: 'e.g. Delhi, at the wedding', value: v.taken_where || '' });
  const takenWhen = h('input', { type: 'text', maxlength: 60, placeholder: 'e.g. December 2019', value: v.taken_when || '' });
  const form = h('form.form.lib-form',
    isPhoto ? null : h('p.form-note', admin
      ? 'Paste the link, give it a short title, pick a topic, and tag anyone in the tree it is about. Your links go into the Library straight away.'
      : `Paste the link, give it a short title, pick a topic, and tag anyone in the tree it is about. The admin checks each link before it appears. Once approved you earn +${LIBRARY_BLESSINGS} blessings.`),
    isPhoto ? null : field('Link (web address) *', url, 'Copy it from the address bar, or from Share → Copy link on YouTube.'),
    isPhoto ? null : preview,
    field('Title *', title),
    h('div.row2', field('Topic', topic, topicHint), isPhoto ? null : field('Where it is from', source)),
    newTopicBox,
    field('A few words about it', note),
    isPhoto ? h('div.row2', field('Where it was taken', takenWhere), field('When it was taken', takenWhen)) : null,
    isPhoto ? h('p.form-note', 'To change the names on the faces, tap Name the faces on the album page.') : field('People in the tree it is about', h('div', chips, picker)),
    isPhoto ? null : h('details.lib-more', h('summary', 'More options'),
      field('Picture link', image, 'Filled in by itself when the website offers a picture. Paste a different picture link to change it, or clear it for no picture.')),
    h('p.form-note', 'Only signed-in family members can see the Library.'),
    h('div.form-actions',
      h('button.btn', { type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button.btn.primary', { type: 'submit' }, link ? 'Save' : admin ? 'Add to the Library' : 'Send for approval')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = isPhoto ? null : normalizeUrl(url.value);
    if (!u && !isPhoto) return toast('That doesn\'t look like a web link. It should start with https://', 'error');
    const img = image.value.trim();
    if (img && !/^https:\/\/\S+$/i.test(img)) return toast('The picture link should start with https://', 'error');
    let topicName = topic.value;
    if (topicName === NEW_TOPIC) {
      topicName = newTopic.value.trim().replace(/\s+/g, ' ');
      if (!topicName) return toast('Please type a name for the new topic, or pick one from the list.', 'error');
      topicName = topicName[0].toUpperCase() + topicName.slice(1);
      const same = allTopics().find((t) => t.toLowerCase() === topicName.toLowerCase());
      if (same) topicName = same;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await saveLink(isPhoto
        ? { title: title.value.trim(), topic: topicName, note: note.value.trim() || null, taken_where: takenWhere.value.trim() || null, taken_when: takenWhen.value.trim() || null }
        : {
          url: u, title: title.value.trim(), source: source.value.trim() || null, topic: topicName,
          note: note.value.trim() || null, person_ids: people, visibility: 'family', image_url: img || null,
        }, link?.id);
      m.close();
      toast(link ? 'Saved.' : admin ? 'Added to the Library.' : `Sent. It appears in the Library once the admin approves it, and you'll get +${LIBRARY_BLESSINGS} blessings.`, 'ok');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
  const m = modal(isPhoto ? 'Edit photo' : link ? 'Edit library link' : admin ? 'Add a link to the Library' : 'Suggest a link for the Library', form, { guard: true });
  setTimeout(() => (link ? title : url).focus(), 50);
  return m;
}

function previewThumb(u, img, onFail) {
  const t = thumbOf({ url: u, image_url: img || null });
  return t ? h('img', { src: t, alt: '', loading: 'lazy', onerror: (e) => { e.target.remove(); onFail?.(); } }) : '';
}

// The preview picture and title of another site's page, found by the
// link-preview helper. Nothing comes back if the site doesn't offer one.
async function linkPreview(u) {
  if (store.preview || !store.sb) return {};
  try {
    const { data, error } = await store.sb.functions.invoke('link-preview', { body: { url: u } });
    if (error || !data) return {};
    return { image: /^https:\/\/\S+$/i.test(data.image || '') ? data.image : null, title: (data.title || '').slice(0, 200) || null };
  } catch { return {}; }
}

// ---------------------------------------------------------------- cards

function card(link, { onChange, onPerson, tools = true }) {
  if (link.kind === 'photo') return photoCard(link, { onChange, onPerson, tools });

  const kind = kindOf(link);
  const yt = youTubeId(link.url);
  const thumb = thumbOf(link);
  const site = link.source || siteName(link.url);
  const media = h('div.lib-media' + (thumb ? '' : '.no-thumb'),
    thumb
      ? h('img', { src: thumb, alt: '', loading: 'lazy', onerror: (e) => { e.target.remove(); media.classList.add('no-thumb'); } })
      : null,
    headlineTile(link, kind),
    yt ? h('button.lib-play', { type: 'button', 'aria-label': `Play ${link.title}`, onclick: () => {
      const start = new URL(link.url).searchParams.get('t');
      const secs = start ? parseInt(start, 10) || 0 : 0;
      media.replaceChildren(h('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&rel=0${secs ? `&start=${secs}` : ''}`,
        title: link.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
      }));
    } }, h('span', '▶')) : h('a.lib-media-link', { href: link.url, target: '_blank', rel: 'noopener', 'aria-label': `Open ${link.title}`, tabindex: -1 }));

  const people = (link.person_ids || []).map((id) => store.fam.byId.get(id)).filter(Boolean);
  const actions = cardActions(link, onChange, tools);
  return h('article.lib-card', { 'data-id': link.id },
    media,
    h('div.lib-body',
      cardTags(link, kind),
      h('h3.lib-title', h('a', { href: link.url, target: '_blank', rel: 'noopener' }, link.title)),
      site ? h('p.lib-source', site) : null,
      link.note ? h('p.lib-note', link.note) : null,
      peopleLine(people, onPerson),
      link.status === 'declined' && link.review_note ? h('p.muted.small', `Admin's note: ${link.review_note}`) : null,
      h('div.lib-foot',
        h('a.lib-open', { href: link.url, target: '_blank', rel: 'noopener' }, yt ? 'Watch on YouTube ↗' : 'Open ↗'),
        actions.length ? h('span.lib-actions', actions) : null)));
}

// No picture from the website: show the headline, newspaper style, with the
// site's own small icon and name, so every card still has something to see.
function headlineTile(link, kind) {
  const host = siteName(link.url);
  let hue = 0;
  for (const c of host) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  return h('span.lib-tile.lib-headline', { style: `--hl-hue: ${hue}` },
    h('span.lib-hl-site',
      h('img.lib-hl-icon', { src: `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }),
      h('span', host)),
    h('span.lib-hl-title', link.title),
    h('span.lib-hl-kind', `${KIND_ICON[kind]} ${kind}`));
}

// Older links without a picture: when the admin opens the Library, look up
// each one's preview picture and save it (a few at a time, each link at most
// once a month on this device). Links whose website offers none keep the headline.
const TRIED_KEY = 'library-pictures-tried';
async function fillMissingPictures(links, onFound) {
  if (!store.isAdmin || store.preview || !store.sb) return;
  let tried = {};
  try { tried = JSON.parse(localStorage.getItem(TRIED_KEY) || '{}') || {}; } catch { /* private window */ }
  const now = Date.now();
  const todo = links.filter((l) => !l.image_url && l.url && !youTubeId(l.url) && !(tried[l.id] > now - 30 * 864e5)).slice(0, 12);
  for (const l of todo) {
    const found = await linkPreview(l.url);
    tried[l.id] = now;
    if (!found.image) continue;
    const { data, error } = await store.sb.from('library_links').update({ image_url: found.image }).eq('id', l.id).select('id');
    if (error || !data?.length) continue;
    l.image_url = found.image;
    onFound(l);
  }
  try { localStorage.setItem(TRIED_KEY, JSON.stringify(tried)); } catch { /* fine */ }
}

function cardTags(link, kind) {
  return h('p.lib-tags',
    h('span.tag.lib-topic', link.topic),
    h('span.tag', kind),
    link.status === 'pending' ? h('span.tag.warn', 'Waiting for approval') : null,
    link.status === 'declined' ? h('span.tag.warn', 'Declined') : null);
}

function peopleLine(people, onPerson, label = 'About: ') {
  return people.length ? h('p.lib-people', h('span.muted', label), people.map((p, i) => [i ? ', ' : '',
    h('button.link', { type: 'button', onclick: () => onPerson(p.id) }, fullName(p))])) : null;
}

// A group photo: its picture opens big, with names on the faces.
function photoCard(link, { onChange, onPerson, tools, album = null }) {
  const open = () => (album ? openAlbum(album, link.id) : openPhotoViewer(link));
  const media = h('div.lib-media.lib-photo-media.no-thumb',
    h('span.lib-tile', h('span.lib-tile-icon', KIND_ICON.Photo), h('span', 'Family photo')),
    h('button.lib-media-link', { type: 'button', 'aria-label': `Open the photo ${link.title}`, onclick: open }));
  libraryPhotoUrl(link).then((u) => {
    if (!u) return;
    media.prepend(h('img', { src: u, alt: '', loading: 'lazy', onload: () => media.classList.remove('no-thumb') }));
  }).catch(() => {});
  const named = (link.faces || []).map((f) => store.fam.byId.get(f.person_id)).filter(Boolean);
  const actions = cardActions(link, onChange, tools);
  return h('article.lib-card', { 'data-id': link.id },
    media,
    h('div.lib-body',
      cardTags(link, 'Photo'),
      h('h3.lib-title', h('button.link', { type: 'button', onclick: open }, link.title)),
      link.note ? h('p.lib-note', link.note) : null,
      peopleLine(named, onPerson, 'In this photo: '),
      link.status === 'declined' && link.review_note ? h('p.muted.small', `Admin's note: ${link.review_note}`) : null,
      h('div.lib-foot',
        h('button.linkish.lib-open', { type: 'button', onclick: open }, named.length ? 'See who is who' : 'Open the photo'),
        actions.length ? h('span.lib-actions', actions) : null)));
}

function cardActions(link, onChange, tools) {
  const isMine = store.signedIn && link.submitted_by === store.session?.user.id;
  const actions = [];
  if (!tools) { /* the Review page has its own buttons */ } else if (store.isAdmin) {
    actions.push(h('button.btn.small.ghost', { type: 'button', onclick: () => openLibraryForm({ link, onDone: onChange }) }, 'Edit'));
    actions.push(h('button.btn.small.ghost.danger', { type: 'button', onclick: async () => {
      if (!(await confirmDialog(`Remove "${link.title}" from the Library? This can't be undone, but you can add the link again later.`, 'Remove'))) return;
      try { await removeLink(link); toast('Removed from the Library.'); onChange(); } catch (e) { toast(e.message, 'error'); }
    } }, 'Remove'));
  } else if (isMine && link.status === 'pending') {
    actions.push(h('button.btn.small.ghost', { type: 'button', onclick: async () => {
      if (!(await confirmDialog('Withdraw this suggestion?', 'Withdraw'))) return;
      try { await removeLink(link); toast('Withdrawn.'); onChange(); } catch (e) { toast(e.message, 'error'); }
    } }, 'Withdraw'));
  }
  return actions;
}

const goToPerson = (id) => {
  const fam = store.fam;
  const root = fam.primaryParentLink(id)?.parent_id || id;
  location.hash = `#/tree/${root}?p=${id}`;
};

// ---------------------------------------------------------------- page

export async function renderLibrary(page, { person = null, photo = null, onSignIn } = {}) {
  clear(page, h('h1', 'Family Library'), h('p.muted', 'Loading…'));
  const all = await loadLibrary(true);
  const signedIn = store.signedIn && !store.preview;
  const meId = store.session?.user.id;
  // Group photos live in the Family Album; the rest are links.
  const album = all.filter((l) => l.status === 'approved' && l.kind === 'photo')
    .sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)));
  const live = all.filter((l) => l.status === 'approved' && l.kind !== 'photo');
  const mineWaiting = all.filter((l) => l.status === 'pending' && l.submitted_by === meId);
  const waitingForAdmin = store.isAdmin ? all.filter((l) => l.status === 'pending').length : 0;
  const about = person && store.fam.byId.get(person);

  let topic = 'All';
  let query = '';
  const grid = h('div.lib-grid');
  const count = h('p.muted.small.lib-count');
  const refresh = () => renderLibrary(page, { person, onSignIn });
  const shown = photo && all.find((l) => l.id === photo && l.kind === 'photo');
  if (shown) setTimeout(() => (album.includes(shown) ? openAlbum(album, shown.id) : openPhotoViewer(shown)), 0);
  const draw = () => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = live.filter((l) => {
      if (about && !(l.person_ids || []).includes(person)) return false;
      if (topic !== 'All' && l.topic !== topic) return false;
      if (!words.length) return true;
      const names = (l.person_ids || []).map((id) => store.fam.byId.get(id)).filter(Boolean).map((p) => fullName(p)).join(' ');
      const text = [l.title, l.note, l.source, l.topic, siteName(l.url), names].join(' ').toLowerCase();
      return words.every((w) => text.includes(w));
    });
    count.textContent = live.length ? `${list.length} of ${live.length} links` : '';
    clear(grid, list.length
      ? list.map((l) => card(l, { onChange: refresh, onPerson: goToPerson }))
      : h('p.empty.lib-empty', live.length ? 'Nothing matches. Try another word or topic.' : 'The Library is empty so far. Be the first to add a link!'));
  };

  const topics = ['All', ...TOPICS.filter((t) => live.some((l) => l.topic === t)), ...new Set(live.map((l) => l.topic).filter((t) => !TOPICS.includes(t)))];
  const chipRow = h('div.lib-topics', { role: 'group', 'aria-label': 'Topics' }, topics.map((t) =>
    h('button', { type: 'button', 'aria-pressed': String(t === topic), onclick: (e) => {
      topic = t;
      for (const b of chipRow.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      draw();
    } }, t, t !== 'All' ? h('small', ` ${live.filter((l) => l.topic === t).length}`) : null)));
  const search = h('input.lib-search', { type: 'search', placeholder: 'Search the Library…', 'aria-label': 'Search the Library' });
  search.addEventListener('input', () => { query = search.value; draw(); });

  const addBtn = signedIn
    ? h('button.btn.primary', { type: 'button', onclick: () => openLibraryForm({ prefill: about ? { person_ids: [about.id] } : {}, onDone: refresh }) }, store.isAdmin ? '+ Add a link' : '+ Suggest a link')
    : store.preview ? null : h('button.btn', { type: 'button', onclick: () => onSignIn?.() }, 'Sign in to suggest a link');

  draw();
  fillMissingPictures(live, (l) => {
    const old = grid.querySelector(`.lib-card[data-id="${CSS.escape(l.id)}"]`);
    if (old) old.replaceWith(card(l, { onChange: refresh, onPerson: goToPerson }));
  });
  clear(page,
    h('div.lib-head',
      h('div', h('h1', 'Family Library'),
        h('p.muted', LIB.blurb,
          h('a', { href: 'help.html#library' }, 'How to add a link'))),
      addBtn),
    waitingForAdmin ? h('p.notice.lib-notice', `${waitingForAdmin} suggested link${waitingForAdmin > 1 ? 's are' : ' is'} waiting for your approval. `, h('a', { href: '#/review' }, 'Review them')) : null,
    mineWaiting.length ? h('section.lib-mine',
      h('h2', 'Your suggestions waiting for approval'),
      h('p.muted.small', 'Only you and the admin can see these until they are approved.'),
      h('div.lib-grid', mineWaiting.map((l) => card(l, { onChange: refresh, onPerson: goToPerson })))) : null,
    about ? h('p.lib-about', 'Showing links about ', h('strong', fullName(about)), '. ', h('a', { href: '#/library' }, 'Show the whole Library')) : null,
    signedIn ? albumTile(album, about, (row) => renderLibrary(page, { person, photo: row.status === 'approved' ? row.id : null, onSignIn })) : null,
    live.length ? h('div.lib-filters', search, chipRow) : null,
    count,
    grid);
}

// The Family Album's place on the Library page: its cover, with the first few photos.
function albumTile(album, about, onAdded) {
  const list = about ? album.filter((l) => (l.person_ids || []).includes(about.id)) : album;
  const thumbs = h('div.album-tile-thumbs', list.slice(-4).reverse().map((l) => {
    const im = h('img', { alt: '', loading: 'lazy' });
    libraryPhotoUrl(l).then((u) => { if (u) im.src = u; }).catch(() => {});
    return im;
  }));
  return h('section.album-tile',
    h('button.album-tile-open', { type: 'button', disabled: !list.length, onclick: () => openAlbum(list) },
      h('span.album-tile-book', { 'aria-hidden': 'true' }, '📖'),
      h('span.album-tile-text',
        h('strong', 'Family Album'),
        h('span', list.length
          ? `${list.length} photo${list.length === 1 ? '' : 's'}${about ? ` with ${shortName(about)}` : ''}. Open it like a book; point at a face to see who it is.`
          : 'No photos yet. Add the first one: choose a family photo, name the people in it if you like, and say where and when it was taken.')),
      list.length ? thumbs : null),
    h('div.album-tile-add',
      h('button.btn.primary', { type: 'button', onclick: async () => {
        const { openAddToAlbum } = await import('./album-add.js');
        openAddToAlbum({ onDone: onAdded });
      } }, '+ Add photo to album')));
}

// ---------------------------------------------------------------- person card

// "In the Library" on a person's card: links tagged with this person.
export function personLibrary(id) {
  const box = h('section.lib-person', { hidden: true });
  // The Library is for signed-in family members only.
  if (store.preview || !store.signedIn) return box;
  linksAbout(id).then((links) => {
    const p = store.fam.byId.get(id);
    const add = store.signedIn ? h('button.btn.small.ghost', { type: 'button', onclick: () => openLibraryForm({ prefill: { person_ids: [id] } }) }, `+ Add a link about ${shortName(p)}`) : null;
    if (!links.length && !add) return;
    clear(box,
      h('h3', 'In the Library'),
      links.length ? h('ul.lib-person-list', links.slice(0, 5).map((l) => h('li',
        h('span.lib-k', { 'aria-hidden': 'true' }, KIND_ICON[kindOf(l)]),
        l.kind === 'photo'
          ? h('button.link', { type: 'button', onclick: () => openPhotoViewer(l) }, l.title)
          : h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.title),
        l.source ? h('span.muted.small', ` · ${l.source}`) : null))) : h('p.muted.small', 'No videos, articles or photos about them yet.'),
      links.length ? h('a.small', { href: `#/library?person=${id}` }, links.length > 5 ? `See all ${links.length} in the Library` : 'See in the Library') : null,
      add);
    box.hidden = false;
  }).catch(() => {});
  return box;
}

// ---------------------------------------------------------------- review

// The admin's list of suggested links, at the top of the Review page.
export async function libraryReviewSection(onChange, nameOf = () => 'A family member') {
  if (!store.isAdmin) return null;
  const waiting = (await loadLibrary(true)).filter((l) => l.status === 'pending');
  if (!waiting.length) return null;
  return h('section.lib-review',
    h('h2', `Library links suggested (${waiting.length})`),
    waiting.map((l) => {
      const note = h('input', { type: 'text', placeholder: 'Note to the member (optional)' });
      const buttons = h('div.form-actions',
        h('button.btn', { type: 'button', onclick: () => openLibraryForm({ link: l, onDone: onChange }) }, 'Edit first'),
        h('button.btn.danger', { type: 'button', onclick: async () => {
          try { await setStatus(l, 'declined', note.value.trim()); toast('Declined.'); onChange(); } catch (e) { toast(e.message, 'error'); }
        } }, 'Decline'),
        h('button.btn.primary', { type: 'button', onclick: async () => {
          try { await setStatus(l, 'approved', note.value.trim()); toast(`Added to the Library. +${LIBRARY_BLESSINGS} blessings for ${nameOf(l.submitted_by)}.`, 'ok'); onChange(); } catch (e) { toast(e.message, 'error'); }
        } }, 'Approve'));
      return h('article.req-card.lib-req',
        h('p.muted.small', `${nameOf(l.submitted_by)} · ${formatWhen(l.submitted_at)}`),
        card(l, { onChange, onPerson: goToPerson, tools: false }),
        note, buttons);
    }));
}
