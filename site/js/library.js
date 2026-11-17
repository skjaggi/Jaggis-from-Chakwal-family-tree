// The family Library: links to videos, articles and other writing about the
// Jaggis of Chakwal, in one place. Any signed-in family member can suggest a
// link; it shows once the admin approves it (the admin's own go live at once).
// A link can be tagged with people in the tree, so it also shows on their card.
import { store } from './data.js';
import { fullName, shortName } from './model.js';
import { h, clear, toast, modal, field, select, confirmDialog, formatWhen } from './ui.js';
import { personPicker } from './forms.js';
import { forgetBlessings } from './blessings.js';

export const TOPICS = ['Chakwal history', 'Partition 1947', 'Arya High School', 'Family members', 'Places today', 'Other'];
export const LIBRARY_BLESSINGS = 3;

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
  if (youTubeId(link.url) || /vimeo\.com|facebook\.com\/.*\/videos|dailymotion/i.test(link.url)) return 'Video';
  if (/\.pdf(\?|#|$)/i.test(link.url)) return 'Document';
  if (/books\.google|archive\.org\/details/i.test(link.url)) return 'Book';
  return 'Article';
}

const KIND_ICON = { Video: '▶', Article: '📰', Document: '📄', Book: '📖' };

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
    ? store.sb.from('library_links').update(fields).eq('id', id)
    : store.sb.from('library_links').insert({ ...fields, status: store.isAdmin ? 'approved' : 'pending', submitted_by: store.session.user.id });
  const { error } = await q;
  if (error) {
    if (/library_links_url_once|duplicate/i.test(error.message)) throw new Error('This link is already in the Library, or waiting for approval.');
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
  const { error } = await store.sb.from('library_links').delete().eq('id', link.id);
  if (error) throw error;
  forgetLibrary();
}

// ---------------------------------------------------------------- form

// Add, suggest or edit a link. prefill can carry person_ids (from a person's card).
export function openLibraryForm({ link = null, prefill = {}, onDone = () => {} } = {}) {
  if (!store.signedIn || store.preview) return toast('Please sign in first. Only family members can add links.', 'error');
  const v = { ...prefill, ...(link || {}) };
  const url = h('input', { name: 'url', type: 'url', required: true, inputmode: 'url', placeholder: 'https://www.youtube.com/watch?v=…', value: v.url || '' });
  const title = h('input', { name: 'title', type: 'text', required: true, maxlength: 200, placeholder: 'e.g. Chakwal before Partition', value: v.title || '' });
  const source = h('input', { name: 'source', type: 'text', maxlength: 120, placeholder: 'e.g. YouTube, Dawn newspaper, a family member', value: v.source || '' });
  const topic = select('topic', TOPICS.map((t) => [t, t]), v.topic || 'Chakwal history');
  const note = h('textarea', { name: 'note', rows: 3, maxlength: 2000, placeholder: 'What is it about, and why does it matter to the family?' });
  note.value = v.note || '';
  const vis = select('visibility', [['public', 'Everyone (the Library is public)'], ['family', 'Family members only (signed in)']], v.visibility || 'public');
  const image = h('input', { name: 'image_url', type: 'url', placeholder: 'https://… (optional, for articles)', value: v.image_url || '' });

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
    picker.querySelector('input').value = '';
  }, { placeholder: 'Type a name to tag someone' });

  // Fill in what we can from the link itself.
  let lastLooked = '';
  const lookUp = async () => {
    const u = normalizeUrl(url.value);
    if (!u || u === lastLooked) return;
    lastLooked = u;
    if (!source.value.trim()) source.value = siteName(u);
    if (youTubeId(u) && !title.value.trim()) {
      try {
        const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`);
        if (r.ok) {
          const j = await r.json();
          if (!title.value.trim() && j.title) title.value = j.title.slice(0, 200);
          if (j.author_name && (!source.value.trim() || source.value === 'YouTube')) source.value = `YouTube: ${j.author_name}`.slice(0, 120);
        }
      } catch { /* type the title by hand */ }
    }
    preview.replaceChildren(previewThumb(u));
  };
  url.addEventListener('change', lookUp);
  url.addEventListener('paste', () => setTimeout(lookUp, 0));
  const preview = h('div.lib-form-preview', v.url ? previewThumb(v.url) : null);

  const admin = store.isAdmin;
  const form = h('form.form.lib-form',
    h('p.form-note', admin
      ? 'Paste the link, give it a short title, pick a topic, and tag anyone in the tree it is about. Your links go into the Library straight away.'
      : `Paste the link, give it a short title, pick a topic, and tag anyone in the tree it is about. The admin checks each link before it appears. Once approved you earn +${LIBRARY_BLESSINGS} blessings.`),
    field('Link (web address) *', url, 'Copy it from the address bar, or from Share → Copy link on YouTube.'),
    preview,
    field('Title *', title),
    h('div.row2', field('Topic', topic), field('Where it is from', source)),
    field('A few words about it', note),
    field('People in the tree it is about', h('div', chips, picker)),
    h('details.lib-more', h('summary', 'More options'),
      field('Who can see it', vis),
      field('Picture link', image, 'Videos from YouTube get their picture automatically.')),
    h('div.form-actions',
      h('button.btn', { type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button.btn.primary', { type: 'submit' }, link ? 'Save' : admin ? 'Add to the Library' : 'Send for approval')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = normalizeUrl(url.value);
    if (!u) return toast('That doesn\'t look like a web link. It should start with https://', 'error');
    const img = image.value.trim();
    if (img && !/^https:\/\/\S+$/i.test(img)) return toast('The picture link should start with https://', 'error');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await saveLink({
        url: u, title: title.value.trim(), source: source.value.trim() || null, topic: topic.value,
        note: note.value.trim() || null, person_ids: people, visibility: vis.value, image_url: img || null,
      }, link?.id);
      m.close();
      toast(link ? 'Saved.' : admin ? 'Added to the Library.' : `Sent. It appears in the Library once the admin approves it, and you'll get +${LIBRARY_BLESSINGS} blessings.`, 'ok');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
  const m = modal(link ? 'Edit library link' : admin ? 'Add a link to the Library' : 'Suggest a link for the Library', form, { guard: true });
  setTimeout(() => (link ? title : url).focus(), 50);
  return m;
}

function previewThumb(u) {
  const t = thumbOf({ url: u });
  return t ? h('img', { src: t, alt: '', loading: 'lazy' }) : null;
}

// ---------------------------------------------------------------- cards

function card(link, { onChange, onPerson, tools = true }) {
  const kind = kindOf(link);
  const yt = youTubeId(link.url);
  const thumb = thumbOf(link);
  const site = link.source || siteName(link.url);
  const media = h('div.lib-media' + (thumb ? '' : '.no-thumb'),
    thumb
      ? h('img', { src: thumb, alt: '', loading: 'lazy', onerror: (e) => { e.target.remove(); media.classList.add('no-thumb'); } })
      : null,
    h('span.lib-tile', h('span.lib-tile-icon', KIND_ICON[kind]), h('span', siteName(link.url))),
    yt ? h('button.lib-play', { type: 'button', 'aria-label': `Play ${link.title}`, onclick: () => {
      const start = new URL(link.url).searchParams.get('t');
      const secs = start ? parseInt(start, 10) || 0 : 0;
      media.replaceChildren(h('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&rel=0${secs ? `&start=${secs}` : ''}`,
        title: link.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
      }));
    } }, h('span', '▶')) : h('a.lib-media-link', { href: link.url, target: '_blank', rel: 'noopener', 'aria-label': `Open ${link.title}`, tabindex: -1 }));

  const people = (link.person_ids || []).map((id) => store.fam.byId.get(id)).filter(Boolean);
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
  return h('article.lib-card', { 'data-id': link.id },
    media,
    h('div.lib-body',
      h('p.lib-tags',
        h('span.tag.lib-topic', link.topic),
        h('span.tag', kind),
        link.visibility === 'family' ? h('span.tag.lock', 'Family only') : null,
        link.status === 'pending' ? h('span.tag.warn', 'Waiting for approval') : null,
        link.status === 'declined' ? h('span.tag.warn', 'Declined') : null),
      h('h3.lib-title', h('a', { href: link.url, target: '_blank', rel: 'noopener' }, link.title)),
      site ? h('p.lib-source', site) : null,
      link.note ? h('p.lib-note', link.note) : null,
      people.length ? h('p.lib-people', h('span.muted', 'About: '), people.map((p, i) => [i ? ', ' : '',
        h('button.link', { type: 'button', onclick: () => onPerson(p.id) }, fullName(p))])) : null,
      link.status === 'declined' && link.review_note ? h('p.muted.small', `Admin's note: ${link.review_note}`) : null,
      h('div.lib-foot',
        h('a.lib-open', { href: link.url, target: '_blank', rel: 'noopener' }, yt ? 'Watch on YouTube ↗' : 'Open ↗'),
        actions.length ? h('span.lib-actions', actions) : null)));
}

const goToPerson = (id) => {
  const fam = store.fam;
  const root = fam.primaryParentLink(id)?.parent_id || id;
  location.hash = `#/tree/${root}?p=${id}`;
};

// ---------------------------------------------------------------- page

export async function renderLibrary(page, { person = null, onSignIn } = {}) {
  clear(page, h('h1', 'Family Library'), h('p.muted', 'Loading…'));
  const all = await loadLibrary(true);
  const signedIn = store.signedIn && !store.preview;
  const meId = store.session?.user.id;
  const live = all.filter((l) => l.status === 'approved');
  const mineWaiting = all.filter((l) => l.status === 'pending' && l.submitted_by === meId);
  const waitingForAdmin = store.isAdmin ? all.filter((l) => l.status === 'pending').length : 0;
  const about = person && store.fam.byId.get(person);

  let topic = 'All';
  let query = '';
  const grid = h('div.lib-grid');
  const count = h('p.muted.small.lib-count');
  const refresh = () => renderLibrary(page, { person, onSignIn });
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
  clear(page,
    h('div.lib-head',
      h('div', h('h1', 'Family Library'),
        h('p.muted', 'Videos, articles and other writing about the Jaggis of Chakwal and the places our family comes from, collected by the family. ',
          h('a', { href: 'help.html#library' }, 'How to add a link'))),
      addBtn),
    waitingForAdmin ? h('p.notice.lib-notice', `${waitingForAdmin} suggested link${waitingForAdmin > 1 ? 's are' : ' is'} waiting for your approval. `, h('a', { href: '#/review' }, 'Review them')) : null,
    mineWaiting.length ? h('section.lib-mine',
      h('h2', 'Your suggestions waiting for approval'),
      h('p.muted.small', 'Only you and the admin can see these until they are approved.'),
      h('div.lib-grid', mineWaiting.map((l) => card(l, { onChange: refresh, onPerson: goToPerson })))) : null,
    about ? h('p.lib-about', 'Showing links about ', h('strong', fullName(about)), '. ', h('a', { href: '#/library' }, 'Show the whole Library')) : null,
    live.length ? h('div.lib-filters', search, chipRow) : null,
    count,
    grid);
}

// ---------------------------------------------------------------- person card

// "In the Library" on a person's card: links tagged with this person.
export function personLibrary(id) {
  const box = h('section.lib-person', { hidden: true });
  if (store.preview) return box;
  linksAbout(id).then((links) => {
    const p = store.fam.byId.get(id);
    const add = store.signedIn ? h('button.btn.small.ghost', { type: 'button', onclick: () => openLibraryForm({ prefill: { person_ids: [id] } }) }, `+ Add a link about ${shortName(p)}`) : null;
    if (!links.length && !add) return;
    clear(box,
      h('h3', 'In the Library'),
      links.length ? h('ul.lib-person-list', links.slice(0, 5).map((l) => h('li',
        h('span.lib-k', { 'aria-hidden': 'true' }, KIND_ICON[kindOf(l)]),
        h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.title),
        l.source ? h('span.muted.small', ` · ${l.source}`) : null))) : h('p.muted.small', 'No videos or articles about them yet.'),
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
