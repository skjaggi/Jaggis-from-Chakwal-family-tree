// Family book maker (admins only while it is being tested).
//
// Pick a design (Classic, Heritage or Modern), a page size up to 12 x 12 in,
// and where the book starts (the whole tree or one branch). The book builds
// itself from the tree: a cover, an "About this book" page, the family tree
// chart, then for each generation a divider page and one page per person or
// couple (photo, years, places, work, family, Notes / Story).
//
// Everything on a page can then be changed on screen: click any text to edit
// it, click a photo to replace it, add story, photo and quote pages, move or
// hide pages. Changes are saved as "edits" on top of the tree (in the
// book_drafts table), so "Rebuild from the tree" picks up new people and
// details without losing them. Warnings show photos that may print blurry
// and text that does not fit its page. "Make the print-ready PDF" prints the
// pages at their real size (with optional printer's bleed); choose "Save as
// PDF" in the print window.
import { store } from './data.js';
import { config } from './config.js';
import { family } from './family.js';
import { fullName, lifeLine, KIND_LABEL } from './model.js';
import { h, clear, toast, modal, confirmDialog, initials, formatWhen } from './ui.js';
import { branchesOf } from './branches.js';

export const TEMPLATES = {
  heritage: { name: 'Heritage', blurb: family.bookHeritageBlurb },
  classic: { name: 'Classic', blurb: 'White pages, black serif type and fine rules. Quiet and timeless.' },
  modern: { name: 'Modern', blurb: 'Clean type, large photos and bold teal bands.' },
};
export const SIZES = {
  sq12: { name: '12 × 12 in square (coffee table)', w: 12, h: 12 },
  sq10: { name: '10 × 10 in square', w: 10, h: 10 },
  sq8: { name: '8 × 8 in square', w: 8, h: 8 },
  letter: { name: '8.5 × 11 in, portrait', w: 8.5, h: 11 },
  land: { name: '11 × 8.5 in, landscape', w: 11, h: 8.5 },
};
const BLEED = 0.125; // inches the printer trims off each edge
const COPYRIGHT = family.copyright;
const SITE = family.siteAddress;
const FONTS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=EB+Garamond:ital@0;1&family=Inter:wght@400;500;600;700&family=Lora:ital@0;1&family=Noto+Sans+Devanagari&family=Noto+Sans+Gurmukhi&display=swap';
const BUCKET = 'book-photos';
const EXTRA_TYPES = { story: 'Story page', photo: 'Photo page', quote: 'Quote page' };
// Person and couple pages take turns between these layouts, so no two pages
// in a row look the same. Any page can be switched to another one.
export const FAMILY_LAYOUTS = [
  { id: 'left', name: 'Photo left' },
  { id: 'top', name: 'Wide photo on top' },
  { id: 'right', name: 'Photo right' },
  { id: 'portrait', name: 'Round portrait, centred' },
  { id: 'band', name: 'Photo band with story beside' },
];
// Each generation's title page has a tree of photos: everyone in that
// generation, grouped under their parent. The style changes from one
// generation to the next; any page can be switched to another style.
export const TREE_STYLES = [
  { id: 'banyan', name: 'Banyan: round photos on a big tree' },
  { id: 'medallion', name: 'Medallions with gold rings' },
  { id: 'arch', name: 'Arched frames' },
  { id: 'snapshot', name: 'Snapshots' },
  { id: 'leaf', name: 'Leaves' },
  { id: 'ribbon', name: 'Ribbons' },
];

// ------------------------------------------------------------------ storage
// The book_drafts table (admins only). Without a database (the preview
// site) drafts stay in this browser instead.
const local = {
  all() { try { return JSON.parse(localStorage.getItem('book-drafts') || '[]'); } catch { return []; } },
  put(list) { try { localStorage.setItem('book-drafts', JSON.stringify(list)); } catch { /* full or blocked */ } },
};
const db = {
  async list() {
    if (store.preview) return local.all();
    const { data, error } = await store.sb.from('book_drafts').select('id,title,data,updated_at').order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  },
  async create(title, data) {
    const row = { title, data };
    if (store.preview) {
      const r = { id: crypto.randomUUID(), ...row, updated_at: new Date().toISOString() };
      local.put([r, ...local.all()]);
      return r;
    }
    const { data: r, error } = await store.sb.from('book_drafts').insert(row).select().single();
    if (error) throw error;
    return r;
  },
  async save(id, title, data) {
    if (store.preview) {
      local.put(local.all().map((r) => (r.id === id ? { ...r, title, data, updated_at: new Date().toISOString() } : r)));
      return;
    }
    const { error } = await store.sb.from('book_drafts').update({ title, data, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  },
  async remove(id) {
    if (store.preview) return local.put(local.all().filter((r) => r.id !== id));
    const { error } = await store.sb.from('book_drafts').delete().eq('id', id);
    if (error) throw error;
  },
};

// Share links (book_shares): a finished, read-only copy of a book that
// anyone with its secret link can open (#/book?view=<token>). Admins make,
// refresh and delete them; everyone else can only open one by its token,
// through the shared_book() function. In the preview site they stay in this
// browser.
const SHARE_BUCKET = 'book-shared';
const localShares = {
  all() { try { return JSON.parse(localStorage.getItem('book-shares') || '[]'); } catch { return []; } },
  put(list) { try { localStorage.setItem('book-shares', JSON.stringify(list)); } catch { /* full or blocked */ } },
};
const shares = {
  // The share link of a book, if it has one: { token, updated_at, snapshot }.
  async of(bookId) {
    if (store.preview) return localShares.all().find((r) => r.book_id === bookId) || null;
    const { data, error } = await store.sb.from('book_shares').select('token,updated_at,snapshot').eq('book_id', bookId).order('created_at', { ascending: false }).limit(1);
    if (error) throw error;
    return data?.[0] || null;
  },
  async save(bookId, token, title, snapshot) {
    const at = new Date().toISOString();
    if (store.preview) {
      const rest = localShares.all().filter((r) => r.token !== token);
      localShares.put([...rest, { token, book_id: bookId, title, snapshot, updated_at: at }]);
      return;
    }
    const { error } = await store.sb.from('book_shares').upsert({ token, book_id: bookId, title, snapshot, updated_at: at });
    if (error) throw error;
  },
  async remove(token, photos = []) {
    if (store.preview) return localShares.put(localShares.all().filter((r) => r.token !== token));
    if (photos.length) await store.sb.storage.from(SHARE_BUCKET).remove(photos).catch(() => {});
    const { error } = await store.sb.from('book_shares').delete().eq('token', token);
    if (error) throw error;
  },
  async open(token) {
    if (store.preview) return localShares.all().find((r) => r.token === token) || null;
    const { data, error } = await store.sb.rpc('shared_book', { t: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) || null;
  },
};
const shareLink = (token) => `${location.origin}${location.pathname}#/book?view=${token}`;

// Photos uploaded for a book (never shown on the website itself).
const photoUrlCache = new Map();
async function uploadPhoto(bookId, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
  const path = `${bookId}/${crypto.randomUUID()}.${ext}`;
  if (store.preview) {
    photoUrlCache.set(path, URL.createObjectURL(file));
    return path;
  }
  const { error } = await store.sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = await store.sb.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 6);
  if (data?.signedUrl) photoUrlCache.set(path, data.signedUrl);
  return path;
}
async function loadPhotoUrls(data) {
  const paths = [];
  for (const e of Object.values(data.edits || {})) for (const v of Object.values(e.ph || {})) if (v?.path && !photoUrlCache.has(v.path)) paths.push(v.path);
  if (!paths.length || store.preview) return;
  const { data: urls } = await store.sb.storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 6);
  (urls || []).forEach((r, i) => { if (r?.signedUrl) photoUrlCache.set(paths[i], r.signedUrl); });
}

// ------------------------------------------------------------------ building the book from the tree

// Everyone descended from the starting person (through the parent each child
// is drawn under), generation by generation.
function descendants(fam, rootId) {
  const out = [];
  const seen = new Set();
  let level = [rootId];
  let depth = 0;
  while (level.length) {
    const next = [];
    for (const id of level) {
      if (seen.has(id) || !fam.byId.has(id)) continue;
      seen.add(id);
      out.push({ id, depth });
      for (const c of fam.treeChildren(id)) next.push(c.id);
    }
    level = next;
    depth++;
  }
  return out;
}

function genOf(fam, rootId, id, depth) {
  const p = fam.byId.get(id);
  const rootGen = fam.byId.get(rootId)?.generation;
  return p.generation ?? (rootGen != null ? rootGen + depth : depth + 1);
}

// Who gets a page of their own. With "skip" on, someone with no photo, no
// story, no spouse and no children is only listed on their parents' page.
function hasOwnPage(fam, id, gen) {
  const d = fam.details.get(id);
  return gen <= 4 || store.photoUrls.has(id) || !!d?.notes || fam.spouses(id).length > 0 || fam.treeChildren(id).length > 0;
}

function placeYears(d, which) {
  const year = (v) => (v ? String(v).match(/\d{4}s?/)?.[0] : '') || '';
  const y = year(which === 'birth' ? d?.birth_date : d?.death_date);
  const place = which === 'birth' ? d?.birth_place : d?.death_place;
  return [y, place].filter(Boolean).join(', ');
}

function autoPages(fam, s) {
  const rootId = fam.byId.has(s.rootId) ? s.rootId : fam.defaultRootId;
  const list = descendants(fam, rootId);
  const blood = new Set(list.map((x) => x.id));
  const pages = [{ key: 'cover', type: 'cover', label: 'Cover' }, { key: 'intro', type: 'intro', label: 'About this book' }];
  // The tree chart, split over as many pages as it needs.
  const rows = chartRows(fam, rootId);
  const size = SIZES[s.size] || SIZES.sq12;
  // Normally the whole chart goes on one page, its type sized to fill it
  // (fitCharts). Only a very large tree, too big even at 5.5 pt type in
  // three columns, is split over more pages.
  const cols = 3;
  const lineIn = (5.5 * 1.32) / 72;
  const usable = size.h - 2 * margin(size) - 1.2; // heading and footer
  const perPage = Math.max(10, Math.floor((usable / lineIn) * 0.85)) * cols;
  for (let i = 0, n = 1; i < rows.length; i += perPage, n++) {
    pages.push({ key: `chart:${n}`, type: 'chart', label: `Family tree chart${rows.length > perPage ? ` (${n})` : ''}`, rows: rows.slice(i, i + perPage), cont: n > 1, cols });
  }
  const byGen = new Map();
  const allByGen = new Map();
  for (const x of list) {
    const g = genOf(fam, rootId, x.id, x.depth);
    (allByGen.get(g) || allByGen.set(g, []).get(g)).push(x.id);
    if (s.skipEmpty !== false && !hasOwnPage(fam, x.id, g)) continue;
    (byGen.get(g) || byGen.set(g, []).get(g)).push(x.id);
  }
  let famIndex = 0;
  [...allByGen.keys()].sort((a, b) => a - b).forEach((g, gi) => {
    const ids = byGen.get(g) || [];
    pages.push({ key: `gen:${g}`, type: 'gen', label: `Generation ${g}`, gen: g, ids, all: allByGen.get(g), gi, blood });
    for (const id of ids) pages.push({ key: `fam:${id}`, type: 'family', label: fullName(fam.byId.get(id), { title: false }), id, gen: g, blood, layoutAuto: FAMILY_LAYOUTS[famIndex++ % FAMILY_LAYOUTS.length].id });
  });
  pages.push({ key: 'end', type: 'end', label: 'Back page' });
  const gens = [...new Set(list.map((x) => genOf(fam, rootId, x.id, x.depth)))];
  return { pages, rootId, count: list.length + list.reduce((n, x) => n + fam.spouses(x.id).filter((sp) => !blood.has(sp.person.id)).length, 0), gens: gens.length };
}

function chartRows(fam, rootId) {
  const rows = [];
  const seen = new Set();
  const walk = (id, depth) => {
    if (seen.has(id)) return;
    seen.add(id);
    const p = fam.byId.get(id);
    rows.push({ id, depth, name: fullName(p, { title: false }), years: lifeLine(p, fam.details.get(id)), spouses: fam.spouses(id).map((x) => fullName(x.person, { title: false })).join(', ') });
    for (const c of fam.treeChildren(id)) walk(c.id, depth + 1);
  };
  walk(rootId, 0);
  return rows;
}

const countWord = (n) => (['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][n] || String(n));
const margin = (size) => Math.max(0.5, Math.min(size.w, size.h) * 0.065);
const base = (size) => 6 + Math.min(size.w, size.h) * 0.58; // body text size in points

// The pages in the order the admin arranged them; new pages from the tree
// slot in after the page they follow in the automatic order.
function arrange(auto, data) {
  const autoKeys = auto.map((p) => p.key);
  const extraKeys = (data.extra || []).map((x) => x.key);
  const all = new Set([...autoKeys, ...extraKeys]);
  const out = (data.order || []).filter((k) => all.has(k));
  if (!out.length) out.push(...autoKeys);
  autoKeys.forEach((k, i) => {
    if (out.includes(k)) return;
    const at = i ? out.indexOf(autoKeys[i - 1]) + 1 : 0;
    out.splice(at, 0, k);
  });
  for (const k of extraKeys) if (!out.includes(k)) out.push(k);
  return out;
}

// ------------------------------------------------------------------ page rendering

let B = null;          // the open book: { id, title, data }
let view = null;       // { fam, auto, byKey, order, rootId, count, gens }
let saveTimer = null;
let saving = Promise.resolve();

const edits = (key) => (B.data.edits ||= {})[key] || {};
const isGone = (key, id) => !!edits(key).gone?.includes(id);
const setEdit = (key, fn) => {
  const e = { ...edits(key) };
  fn(e);
  if (Object.keys(e.f || {}).length === 0) delete e.f;
  if (Object.keys(e.ph || {}).length === 0) delete e.ph;
  if (!e.hidden) delete e.hidden;
  if (e.adds && !e.adds.length) delete e.adds;
  if (e.gone && !e.gone.length) delete e.gone;
  if (Object.keys(e).length) B.data.edits[key] = e;
  else delete B.data.edits[key];
  queueSave();
};

// An editable piece of text: the tree's words unless the admin changed them.
function text(key, field, auto, { tag = 'div', cls = '', ph = 'Click to add text', edit }) {
  if (isGone(key, `f:${field}`)) return null;
  const own = edits(key).f?.[field];
  const value = own ?? auto ?? '';
  const el = h(`${tag}.bp-ed${cls ? `.${cls}` : ''}`, value);
  if (own != null && own !== (auto ?? '')) el.classList.add('edited');
  if (!edit) return value ? el : null;
  el.setAttribute('contenteditable', 'plaintext-only');
  if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
  el.dataset.ph = ph;
  el.dataset.delKey = key;
  el.dataset.del = `f:${field}`;
  el.spellcheck = true;
  el.addEventListener('blur', () => {
    const v = el.innerText.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (v === (edits(key).f?.[field] ?? auto ?? '').trim()) return;
    setEdit(key, (e) => {
      e.f = { ...(e.f || {}) };
      if (v === (auto ?? '').trim()) delete e.f[field];
      else e.f[field] = v;
    });
    el.classList.toggle('edited', v !== (auto ?? '').trim());
    checkPage(el.closest('.bp'));
  });
  el.addEventListener('input', () => checkPage(el.closest('.bp')));
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') el.blur(); });
  return el;
}

function photoSrc(key, slot, autoPersonId) {
  const o = edits(key).ph?.[slot];
  if (o?.none) return null;
  if (o?.path) return photoUrlCache.get(o.path) || null;
  if (o?.person) return store.photoUrls.get(o.person) || null;
  return autoPersonId ? store.photoUrls.get(autoPersonId) || null : null;
}

// Photo frames. With "Mixed photo frames" on (the default), each photo gets
// its own frame and a slight tilt, picked from its page and place so it stays
// the same every time. Any photo can be tilted, moved, made bigger or smaller,
// or given another frame by hand (edits.pf[slot]: x and y as fractions of the
// page, s size, r tilt in degrees, fr frame).
export const FRAMES = [
  { id: 'white', name: 'White border' },
  { id: 'snapshot', name: 'Snapshot' },
  { id: 'gold', name: 'Gold line' },
  { id: 'tape', name: 'Taped' },
  { id: 'corners', name: 'Album corners' },
  { id: 'rounded', name: 'Rounded' },
  { id: 'shadow', name: 'No border' },
];
const TILTS = [-3, -2, -1.2, 0, 1.2, 2, 3];
const hash = (t) => { let x = 2166136261; for (const c of t) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
function frameLook(key, slot, cls) {
  const own = edits(key).pf?.[slot] || {};
  const mixed = B.data.settings.mixFrames !== false;
  const n = hash(`${key}|${slot}`);
  // The cover and full-page photos stay straight and frameless unless changed by hand.
  const auto = mixed && !/bp-(cover|full)-ph/.test(cls);
  const fr = own.fr || (auto ? FRAMES[n % FRAMES.length].id : '');
  const r = own.r ?? (auto ? TILTS[(n >>> 8) % TILTS.length] : 0);
  return { fr, r, x: own.x || 0, y: own.y || 0, s: own.s || 1 };
}
const frameTransform = ({ x, y, r, s: sc }) => (x || y || r || sc !== 1
  ? `translate(calc(var(--pw) * ${x}), calc(var(--ph) * ${y})) rotate(${r}deg) scale(${sc})` : '');
function setFrame(key, slot, fn) {
  setEdit(key, (e) => {
    e.pf = { ...(e.pf || {}) };
    const v = { ...(e.pf[slot] || {}) };
    fn(v);
    for (const k of Object.keys(v)) if (v[k] == null) delete v[k];
    if (Object.keys(v).length) e.pf[slot] = v;
    else delete e.pf[slot];
    if (!Object.keys(e.pf).length) delete e.pf;
  });
}

// A photo frame. Clicking it (while editing) opens the photo chooser.
function photo(key, slot, autoPersonId, { cls = '', label = '', edit, monogram = '' }) {
  if (isGone(key, `p:${slot}`)) return null;
  const src = photoSrc(key, slot, autoPersonId);
  const look = frameLook(key, slot, cls);
  const frame = h(`div.bp-photo${cls ? `.${cls}` : ''}${look.fr ? `.fr-${look.fr}` : ''}`, { 'data-slot': slot },
    src ? h('img', { src, alt: label })
      : h('div.bp-mono', monogram || ''),
    ['tape', 'corners'].includes(look.fr) ? h('span.bp-fr') : null);
  frame.style.transform = frameTransform(look);
  if (!src) frame.classList.add('empty');
  if (edit) frame.append(...photoTools(key, slot, frame, look));
  if (edit) {
    frame.classList.add('clickable');
    frame.dataset.delKey = key;
    frame.dataset.del = `p:${slot}`;
    frame.title = 'Click to replace this photo';
    frame.append(h('span.bp-photo-hint', src ? 'Replace photo' : 'Add a photo'));
    frame.addEventListener('click', () => choosePhoto(key, slot, autoPersonId, label));
    const img = frame.querySelector('img');
    if (img) img.addEventListener('load', () => checkPage(frame.closest('.bp')));
  }
  return frame;
}

// The small buttons on a photo while editing: move, tilt, frame, size, reset.
function photoTools(key, slot, frame, look) {
  const stop = (e) => { e.stopPropagation(); };
  const btn = (txt, title, onclick) => h('button.bp-pt', { type: 'button', title, 'aria-label': title, onpointerdown: stop, onclick: (e) => { e.stopPropagation(); onclick(); } }, txt);
  const redo = () => rerenderPage(key);
  const nextFrame = () => setFrame(key, slot, (v) => { const i = FRAMES.findIndex((f) => f.id === look.fr); v.fr = FRAMES[(i + 1) % FRAMES.length].id; });
  const changed = !!edits(key).pf?.[slot];
  return [h('span.bp-ptools', { onclick: stop },
    h('button.bp-pt.bp-pt-move', { type: 'button', title: 'Drag to move this photo', 'aria-label': 'Move photo', onpointerdown: (e) => dragPhoto(e, key, slot, frame, look, 'move'), onclick: stop }, '✥'),
    btn('↺', 'Tilt left', () => { setFrame(key, slot, (v) => { v.r = Math.round(((v.r ?? look.r) - 2) * 10) / 10; }); redo(); }),
    btn('↻', 'Tilt right', () => { setFrame(key, slot, (v) => { v.r = Math.round(((v.r ?? look.r) + 2) * 10) / 10; }); redo(); }),
    btn('▢', `Frame: ${FRAMES.find((f) => f.id === look.fr)?.name || 'Plain'}. Click for the next frame`, () => { nextFrame(); redo(); }),
    changed ? btn('⟲', 'Put this photo back as it was', () => { setFrame(key, slot, (v) => { for (const k of Object.keys(v)) delete v[k]; }); redo(); }) : null),
  h('span.bp-pt-grip', { title: 'Drag to make the photo bigger or smaller', onpointerdown: (e) => dragPhoto(e, key, slot, frame, look, 'size'), onclick: stop })];
}

// Drag a photo to move it, or its corner to make it bigger or smaller. The
// page is drawn scaled down, so moves are measured against its size on screen.
function dragPhoto(e, key, slot, frame, look, mode) {
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget;
  const page = frame.closest('.bp').getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  const v = { ...look };
  const start = { px: e.clientX, py: e.clientY, x: v.x, y: v.y, s: v.s, w: fr.width };
  frame.classList.add('dragging');
  handle.setPointerCapture?.(e.pointerId);
  const move = (ev) => {
    if (mode === 'move') {
      v.x = Math.max(-0.9, Math.min(0.9, start.x + (ev.clientX - start.px) / page.width));
      v.y = Math.max(-0.9, Math.min(0.9, start.y + (ev.clientY - start.py) / page.height));
    } else {
      v.s = Math.max(0.3, Math.min(3, start.s * (1 + ((ev.clientX - start.px) + (ev.clientY - start.py)) / start.w)));
    }
    frame.style.transform = frameTransform(v);
  };
  const up = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    frame.classList.remove('dragging');
    setFrame(key, slot, (o) => { o.x = +v.x.toFixed(4) || null; o.y = +v.y.toFixed(4) || null; o.s = v.s === 1 ? null : +v.s.toFixed(3); });
    rerenderPage(key);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

function runFoot(n, edit) {
  return h('div.bp-foot', h('span.bp-num', n ? String(n) : ''), h('span.bp-run', B.title));
}

function renderPage(page, { edit = false, n = 0 } = {}) {
  const s = B.data.settings;
  const fam = view.fam;
  const key = page.key;
  let body;
  if (page.type === 'cover') {
    const root = fam.byId.get(view.rootId);
    // Up to four photos from the earliest generations.
    const withPhotos = descendants(fam, view.rootId).map((x) => x.id).filter((id) => store.photoUrls.has(id)).slice(0, 4);
    const strip = [0, 1, 2, 3].map((i) => photo(key, `c${i}`, withPhotos[i], { cls: 'bp-cover-ph', edit, label: 'Cover photo' }))
      .filter((el) => el && (edit || !el.classList.contains('empty')));
    body = [
      h('div.bp-cover-frame'),
      h('img.bp-cover-logo', { src: family.logo.large, alt: family.logo.alt }),
      text(key, 'title', config.siteTitle || 'Our family', { tag: 'h1', cls: 'bp-cover-title', edit, ph: 'Book title' }),
      text(key, 'sub', `${countWord(view.gens)} generations from ${fullName(root)}`, { cls: 'bp-cover-sub', edit, ph: 'Subtitle' }),
      strip.length ? h('div.bp-cover-strip', strip) : null,
      text(key, 'edition', '', { cls: 'bp-cover-edition', edit, ph: 'Optional: a family edition line, for example "The Sunil Jaggi Family Edition"' }),
    ];
  } else if (page.type === 'intro') {
    const root = fam.byId.get(view.rootId);
    const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const auto = `This book was made from the ${config.siteTitle || 'family'} family tree on ${today}. It begins with ${fullName(root)} and follows ${countWord(view.gens).toLowerCase()} generations of descendants and the people they married: ${view.count} people in all.\n\nThe family tree online grows every week. Visit ${SITE} for the newest details, photos and stories.`;
    body = [
      h('div.bp-kicker', 'Welcome'),
      text(key, 'title', 'About this book', { tag: 'h1', cls: 'bp-title', edit }),
      h('div.bp-rule'),
      text(key, 'story', auto, { cls: 'bp-story.fit', edit, ph: 'A few words about this book' }),
      text(key, 'quote', '', { cls: 'bp-quote', edit, ph: 'Optional: a saying or quote (Hindi and Punjabi script work too)' }),
      text(key, 'quoteBy', '', { cls: 'bp-quote-by', edit, ph: 'Optional: who said it, or its English meaning' }),
    ];
  } else if (page.type === 'chart') {
    body = [
      text(key, 'title', page.cont ? 'The family tree (continued)' : 'The family tree', { tag: 'h1', cls: 'bp-title', edit }),
      h('div.bp-rule'),
      h(`div.bp-chart.fit.cols-${page.cols}`, page.rows.map((r) => {
        const br = branchesOf(fam).of.get(r.id);
        return h('div.bp-row', { style: `--d:${r.depth}`, 'data-branch': br?.slot ?? null },
          h('span.bp-row-name', r.name), r.years ? h('span.bp-row-years', ` ${r.years}`) : null,
          r.spouses ? h('span.bp-row-sp', ` ⚭ ${r.spouses}`) : null);
      })),
    ];
  } else if (page.type === 'gen') {
    const style = edits(key).style || TREE_STYLES[page.gi % TREE_STYLES.length].id;
    body = [
      h('div.bp-gen-head',
        h('div.bp-gen-num', String(page.gen)),
        h('div',
          text(key, 'title', `Generation ${page.gen}`, { tag: 'h1', cls: 'bp-gen-title', edit }),
          text(key, 'story', '', { cls: 'bp-gen-intro', edit, ph: 'Optional: a few words about this generation' }))),
      photoTree(page, style, { edit }),
    ];
  } else if (page.type === 'family') {
    body = familyPage(page, { edit });
  } else if (page.type === 'end') {
    body = [
      h('img.bp-end-logo', { src: family.logo.small, alt: '' }),
      text(key, 'story', `Made with love from the family tree at ${SITE}.\nAdd your stories and photos there, so the next edition has them too.`, { cls: 'bp-end-text', edit }),
      h('div.bp-end-copy', h('img', { src: family.companyMark.src, alt: family.companyMark.alt }), h('span', COPYRIGHT)),
    ];
  } else if (page.type === 'story') {
    body = [
      text(key, 'title', '', { tag: 'h1', cls: 'bp-title', edit, ph: 'Story title' }),
      h('div.bp-rule'),
      h('div.bp-story-wrap',
        photo(key, 'p', null, { cls: 'bp-story-ph', edit, label: 'Story photo' }),
        text(key, 'caption', '', { cls: 'bp-caption', edit, ph: 'Optional: photo caption (names, place, year)' })),
      text(key, 'story', '', { cls: 'bp-story.fit', edit, ph: 'Write or paste the story here' }),
      text(key, 'by', '', { cls: 'bp-quote-by', edit, ph: 'Optional: shared by …' }),
    ];
  } else if (page.type === 'more') {
    // The rest of a long story, carried on from the person's page.
    const fp = view.byKey.get(page.famKey);
    body = [
      h('div.bp-kicker', 'Continued'),
      h('h1.bp-name', labelOf(page.famKey)),
      h('div.bp-rule'),
      h('div.bp-ed.bp-story.fit', fp ? storyPart(fp, page.part) : ''),
      contNote(),
    ];
  } else if (page.type === 'photo') {
    body = [
      photo(key, 'p', null, { cls: 'bp-full-ph', edit, label: 'Photo' }),
      text(key, 'caption', '', { cls: 'bp-caption', edit, ph: 'Caption: names, place and year' }),
    ];
  } else if (page.type === 'quote') {
    body = [
      h('div.bp-quote-page',
        text(key, 'quote', '', { cls: 'bp-big-quote', edit, ph: 'The saying, in any script (English, हिन्दी, ਪੰਜਾਬੀ)' }),
        text(key, 'meaning', '', { cls: 'bp-quote-mean', edit, ph: 'Optional: what it means in English' }),
        text(key, 'by', '', { cls: 'bp-quote-by', edit, ph: 'Optional: who used to say it' })),
    ];
  }
  const showFoot = !['cover'].includes(page.type);
  const more = page.type === 'family' ? (flow.get(key)?.length || 0) > 0 : page.type === 'more' && page.part < (flow.get(page.famKey)?.length || 0);
  const pageEl = h(`div.bp.t-${page.type}${more ? '.has-more' : ''}`, { 'data-key': key },
    h('div.bp-inner', body, addedItems(key, { edit }), showFoot ? runFoot(n, edit) : null, placedItems(key, { edit })));
  if (page.type === 'family') {
    const br = branchesOf(fam).of.get(page.id);
    if (br?.slot) pageEl.dataset.branch = br.slot;
  }
  return pageEl;
}

// Two interlocked wedding rings, drawn in the page's accent colour.
const RINGS = () => {
  const el = document.createElement('span');
  el.className = 'bp-rings';
  el.innerHTML = '<svg viewBox="0 0 64 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.2"><circle cx="24" cy="22" r="14"/><circle cx="40" cy="22" r="14"/><path d="M36 6l4-5 4 5" stroke-width="2.4" stroke-linejoin="round"/></svg>';
  return el;
};

// The story on a person's page: their own Notes / Story, then their husband's
// or wife's (who has no page of their own), each in a paragraph.
function familyStoryAuto(page) {
  const fam = view.fam;
  const d = fam.details.get(page.id) || {};
  const spouses = fam.spouses(page.id).filter((x) => !page.blood.has(x.person.id));
  return [d.notes, ...spouses.map((sp) => { const n = fam.details.get(sp.person.id)?.notes; return n ? `${sp.person.given_name}: ${n}` : ''; })].filter(Boolean).join('\n\n');
}
const familyStory = (page) => (edits(page.key).f?.story ?? familyStoryAuto(page)).trim();

// A story too long for its page carries on, automatically, on "continued"
// pages right after it. flow holds where each one is cut (character
// offsets into the story), measured on screen by flowStories().
const flow = new Map(); // family page key -> [cut, cut, ...]
const storyPart = (page, i) => {
  const full = familyStory(page);
  const cuts = flow.get(page.key) || [];
  return full.slice(i ? cuts[i - 1] : 0, i < cuts.length ? cuts[i] : full.length).trim();
};
const contNote = () => h('div.bp-cont-note', 'Continued on the next page');

function familyPage(page, { edit }) {
  const fam = view.fam;
  const key = page.key;
  const p = fam.byId.get(page.id);
  const d = fam.details.get(page.id) || {};
  const parent = fam.primaryParentLink(page.id);
  const rel = p.gender === 'male' ? 'son' : p.gender === 'female' ? 'daughter' : 'child';
  const kicker = [`Generation ${page.gen}`, parent ? `${rel} of ${fullName(fam.byId.get(parent.parent_id), { title: false })}` : ''].filter(Boolean).join(' · ');
  const spouses = fam.spouses(page.id).filter((x) => !page.blood.has(x.person.id));
  const allSpouses = fam.spouses(page.id);
  const kids = fam.children(page.id).map(({ person: c, link }) => fullName(c, { title: false }) + (KIND_LABEL[link.kind] ? ` (${KIND_LABEL[link.kind]})` : ''));
  const facts = [
    ['Born', placeYears(d, 'birth')],
    ['Passed away', p.is_living === false ? placeYears(d, 'death') : ''],
    ['Work', d.profession],
    [allSpouses.length > 1 ? 'Married' : 'Married', allSpouses.map(({ person: s, union: u }) => `${fullName(s, { title: false })}${u.status && u.status !== 'married' ? ` (${u.status})` : ''}`).join('; ')],
    [kids.length === 1 ? 'Child' : 'Children', kids.join(', ')],
  ].filter(([, v]) => v);
  const factsAuto = facts.map(([k, v]) => `${k}: ${v}`).join('\n');
  const own = edits(key).f?.facts;
  const factsGone = isGone(key, 'f:facts');
  const factsEl = !factsGone && (edit || own == null)
    ? h('dl.bp-facts', edit ? { 'data-del-key': key, 'data-del': 'f:facts' } : {}, facts.map(([k, v]) => [h('dt', k), h('dd', v)]))
    : null;
  const layout = edits(key).layout || page.layoutAuto || 'left';
  return [
    h('div.bp-kicker', kicker),
    h(`div.bp-fam.lay-${layout}`,
      // A married person's photo and their husband's or wife's photo, the
      // same size, joined by a pair of wedding rings.
      h(`div.bp-fam-photos${spouses.length ? `.bp-couple.n${Math.min(spouses.length, 2)}` : ''}`,
        (spouses.length ? (...kids) => [h('div.bp-cp', kids)] : (...kids) => kids)(
          photo(key, 'photo', page.id, { cls: 'bp-main-ph', edit, label: fullName(p), monogram: initials(p.given_name) }),
          spouses.length ? text(key, 'mainname', fullName(p, { title: false }), { cls: 'bp-sp-name', edit }) : null,
          text(key, 'caption', '', { cls: 'bp-caption', edit, ph: 'Optional: photo caption' })),
        spouses.slice(0, 2).map((sp, i) => {
          const u = sp.union || {};
          const yr = /^(\d{4})/.exec(u.start_date || '')?.[1];
          const word = u.status === 'divorced' ? 'Married (later divorced)' : u.status && !['married', 'widowed'].includes(u.status) ? 'Partners' : 'Married';
          return [
            isGone(key, `f:ring${i}`) ? null : h('div.bp-ring', edit ? { 'data-del-key': key, 'data-del': `f:ring${i}` } : {}, RINGS(),
              text(key, `ring${i}`, yr ? `${word} ${yr}` : word, { cls: 'bp-ring-word', edit })),
            h('div.bp-cp.bp-spouse',
              photo(key, `sp${i}`, sp.person.id, { cls: 'bp-sp-ph', edit, label: fullName(sp.person), monogram: initials(sp.person.given_name) }),
              h('div.bp-sp-text',
                text(key, `spname${i}`, fullName(sp.person), { cls: 'bp-sp-name', edit }),
                text(key, `spline${i}`, [lifeLine(sp.person, fam.details.get(sp.person.id)), fam.details.get(sp.person.id)?.birth_place].filter(Boolean).join(' · '), { cls: 'bp-sp-line', edit, ph: 'Years and place' }))),
          ];
        })),
      h('div.bp-fam-text',
        text(key, 'name', fullName(p), { tag: 'h1', cls: 'bp-name', edit }),
        text(key, 'years', lifeLine(p, d), { cls: 'bp-years', edit, ph: 'Years' }),
        own != null ? text(key, 'facts', factsAuto, { cls: 'bp-facts-text', edit }) : factsEl,
        edit && own == null && !factsGone ? h('button.bp-mini', { type: 'button', onclick: (e) => { e.stopPropagation(); setEdit(key, (x) => { x.f = { ...(x.f || {}), facts: factsAuto }; }); rerenderPage(key); } }, 'Edit these lines') : null,
        h('div.bp-rule'),
        text(key, 'headline', '', { tag: 'h2', cls: 'bp-headline', edit, ph: 'Optional: a short headline, like a favourite saying' }),
        storyEl(page, edit),
        text(key, 'by', '', { cls: 'bp-quote-by', edit, ph: 'Optional: shared by …' }))),
  ];
}

// The story box on a person's page. When the story goes on to a "continued"
// page, the box shows only the first part, but editing it edits the whole story.
function storyEl(page, edit) {
  const key = page.key;
  const el = text(key, 'story', familyStoryAuto(page), { cls: 'bp-story.fit', edit, ph: 'Add a story or memory' });
  if (!el) return null;
  const showPart = () => { if (flow.get(key)?.length) el.textContent = storyPart(page, 0); };
  showPart();
  if (edit) {
    el.addEventListener('focus', () => { if (flow.get(key)?.length) el.textContent = familyStory(page); });
    el.addEventListener('blur', () => { showPart(); afterRender(); });
  }
  return [el, contNote()];
}

// Photos and text boxes the admin added to a page ("+ Photo", "+ Text").
// New ones sit below the page's own content: photos side by side with a
// caption each, text boxes underneath. Once dragged by their ✥ handle they
// stay where they were put (x, y and width as fractions of the page area).
function removeAdd(key, id) {
  setEdit(key, (x) => {
    x.adds = (x.adds || []).filter((a) => a.id !== id);
    if (x.f) delete x.f[`a:${id}`];
    if (x.ph) delete x.ph[`a:${id}`];
  });
}

function addEl(key, a, { edit }) {
  const el = a.t === 'photo'
    ? h('figure.bp-add-ph.bp-item', { 'data-add': a.id },
      photo(key, `a:${a.id}`, null, { cls: 'bp-add-frame', edit, label: 'Added photo' }),
      text(key, `a:${a.id}`, '', { cls: 'bp-caption', edit, ph: 'Caption: names, place, year' }))
    : h('div.bp-add-text.bp-item', { 'data-add': a.id },
      text(key, `a:${a.id}`, '', { cls: 'bp-add-ed', edit, ph: 'Write here: a memory, a saying, a note' }));
  if (a.x != null) {
    el.classList.add('placed');
    el.style.left = `${a.x * 100}%`;
    el.style.top = `${a.y * 100}%`;
    el.style.width = `${a.w * 100}%`;
  }
  if (edit) {
    el.append(
      h('button.bp-move', { type: 'button', title: 'Drag to move this anywhere on the page', 'aria-label': 'Move', onpointerdown: (e) => dragItem(e, key, a.id, 'move') }, '✥'),
      h('button.bp-del', { type: 'button', title: 'Remove this from the page', 'aria-label': 'Remove', onclick: (e) => { e.stopPropagation(); removeAdd(key, a.id); rerenderPage(key); } }, '×'),
      h('span.bp-grip', { title: 'Drag to make it bigger or smaller', onpointerdown: (e) => dragItem(e, key, a.id, 'size') }));
  }
  return el;
}

function addedItems(key, { edit }) {
  const adds = (edits(key).adds || []).filter((a) => a.x == null);
  if (!adds.length) return null;
  const photos = adds.filter((a) => a.t === 'photo');
  const texts = adds.filter((a) => a.t === 'text');
  return h('div.bp-adds',
    photos.length ? h(`div.bp-add-photos.n${Math.min(photos.length, 4)}`, photos.map((a) => addEl(key, a, { edit }))) : null,
    texts.map((a) => addEl(key, a, { edit })));
}

function placedItems(key, { edit }) {
  const adds = (edits(key).adds || []).filter((a) => a.x != null);
  return h('div.bp-float', adds.map((a) => addEl(key, a, { edit })));
}

// Drag an added photo or text box (by its ✥ handle) or resize it (by its
// corner). The page is drawn scaled down, so pointer moves are measured
// against the page area's size on screen.
function dragItem(e, key, id, mode) {
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget;
  const item = handle.closest('.bp-item');
  const area = item.closest('.bp-inner');
  const layer = area.querySelector(':scope > .bp-float');
  const ar = area.getBoundingClientRect();
  const ir = item.getBoundingClientRect();
  let x = (ir.left - ar.left) / ar.width;
  let y = (ir.top - ar.top) / ar.height;
  let w = ir.width / ar.width;
  if (!item.classList.contains('placed')) {
    item.classList.add('placed');
    layer.append(item);
  }
  const place = () => {
    w = Math.min(1, Math.max(0.08, w));
    x = Math.min(1 - w, Math.max(0, x));
    y = Math.min(0.97, Math.max(0, y));
    item.style.left = `${x * 100}%`;
    item.style.top = `${y * 100}%`;
    item.style.width = `${w * 100}%`;
  };
  place();
  const start = { px: e.clientX, py: e.clientY, x, y, w };
  item.classList.add('dragging');
  handle.setPointerCapture?.(e.pointerId);
  const move = (ev) => {
    const dx = (ev.clientX - start.px) / ar.width;
    const dy = (ev.clientY - start.py) / ar.height;
    if (mode === 'move') { x = start.x + dx; y = start.y + dy; } else { w = start.w + dx; }
    place();
  };
  const up = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    item.classList.remove('dragging');
    setEdit(key, (ed) => { ed.adds = (ed.adds || []).map((a) => (a.id === id ? { ...a, x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4) } : a)); });
    checkPage(item.closest('.bp'));
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

// One "Delete" button that floats over whichever text or photo the pointer
// (or keyboard focus) is on, anywhere in the book.
let delBtn = null;
let delTarget = null;
let delHide = null;
function setupDelete(pagesEl) {
  delBtn?.remove();
  delBtn = h('button.bk-del-float', { type: 'button', title: 'Delete this from the page (Undo changes brings it back)', 'aria-label': 'Delete this' }, '🗑 Delete');
  document.body.append(delBtn);
  const show = (el) => {
    clearTimeout(delHide);
    delTarget = el;
    const r = el.getBoundingClientRect();
    // Just outside the item's right edge, so it never covers what you click;
    // above its corner when there is no room on the right.
    const right = r.right + 92 < innerWidth;
    delBtn.style.top = `${Math.max(4, right ? r.top : r.top - 28)}px`;
    delBtn.style.left = `${right ? r.right + 6 : Math.max(4, r.right - 84)}px`;
    delBtn.classList.add('on');
  };
  const hideSoon = () => { clearTimeout(delHide); delHide = setTimeout(() => { delBtn?.classList.remove('on'); delTarget = null; }, 350); };
  const find = (t) => t?.closest?.('[data-del]');
  pagesEl.addEventListener('pointerover', (e) => { const el = find(e.target); if (el) show(el); });
  pagesEl.addEventListener('pointerout', (e) => { if (find(e.target) && !find(e.relatedTarget)) hideSoon(); });
  pagesEl.addEventListener('focusin', (e) => { const el = find(e.target); if (el) show(el); });
  pagesEl.addEventListener('scroll', hideSoon, { passive: true });
  addEventListener('scroll', hideSoon, { passive: true });
  delBtn.addEventListener('pointerover', () => clearTimeout(delHide));
  delBtn.addEventListener('pointerout', hideSoon);
  delBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the text's focus
  delBtn.addEventListener('click', () => {
    const el = delTarget;
    if (!el?.isConnected) return;
    const key = el.dataset.delKey;
    const id = el.dataset.del;
    delBtn.classList.remove('on');
    const add = /^[fp]:a:(.+)$/.exec(id);
    if (add) removeAdd(key, add[1]);
    else setEdit(key, (x) => { x.gone = [...new Set([...(x.gone || []), id])]; });
    rerenderPage(key);
    toast(add ? 'Removed from the page.' : 'Deleted. "Undo changes" above the page brings it back.');
  });
}

function addItem(key, t) {
  const id = crypto.randomUUID().slice(0, 6);
  setEdit(key, (x) => { x.adds = [...(x.adds || []), { id, t }]; });
  rerenderPage(key);
  if (t === 'photo') {
    const page = view.byKey.get(key);
    choosePhoto(key, `a:${id}`, null, page?.label || '');
  } else {
    setTimeout(() => document.querySelector(`.bk-page[data-key="${CSS.escape(key)}"] .bp-add-text:last-child .bp-ed`)?.focus(), 50);
  }
}

// The photo tree on a generation's title page: everyone in the generation
// (round photo or initials, and their name), grouped under their parent from
// the generation before. Its size shrinks to fit the page (see fitTrees).
function photoTree(page, style, { edit }) {
  const fam = view.fam;
  // Children are grouped under their parents: the blood parent, with the
  // other parent (their spouse) beside them when the tree has one.
  const groups = new Map();
  for (const id of page.all) {
    const par = fam.primaryParentLink(id)?.parent_id || '';
    let other = '';
    if (par) {
      const sps = fam.spouses(par).filter((x) => x.person).map((x) => x.person.id);
      other = fam.parentLinks(id).map((l) => l.parent_id).find((x) => x !== par && sps.includes(x)) || (sps.length === 1 ? sps[0] : '');
    }
    const k = `${par}|${other}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(id);
  }
  const short = (p) => fullName(p, { title: false }).replace(new RegExp(`\\s+${family.surname}$`), '');
  const node = (id, cls = '') => {
    const p = fam.byId.get(id);
    const src = store.photoUrls.get(id);
    return h(`div.pt-node${cls}`, { 'data-id': id },
      h('div.pt-ph', src ? h('img', { src, alt: '' }) : h('span.pt-mono', initials(p.given_name))),
      h('div.pt-name', short(p)));
  };
  const n = page.all.length;
  const tree = h(`div.bp-ptree.pt-${style}.fit`, { style: `--n:${n}` },
    h('div.pt-groups', [...groups.entries()].map(([k, kids]) => {
      const [par, other] = k.split('|');
      return h('div.pt-group',
      par ? (other && fam.byId.has(other)
        ? h('div.pt-couple', node(par, '.pt-parent'), node(other, '.pt-parent.pt-spouse'))
        : node(par, '.pt-parent')) : null,
      par ? h('div.pt-stem') : null,
      h('div.pt-kids', kids.map((id) => node(id))));
    })));
  const size = SIZES[B.data.settings.size] || SIZES.sq12;
  // A first guess at the photo size; fitTrees() shrinks it if needed.
  const area = (size.w - 2 * margin(size)) * (size.h - 2 * margin(size) - 2.4);
  const guess = Math.max(0.42, Math.min(2.4, Math.sqrt(area / ((n + groups.size * 0.5) * 1.6))));
  tree.style.setProperty('--node', `${guess.toFixed(2)}in`);
  return tree;
}

// Size the tree chart's type to fill its page: the largest type that fits,
// in one, two or three columns (fewer columns when it makes little difference).
function fitCharts(root) {
  for (const el of root.querySelectorAll('.bp-chart')) {
    const size = SIZES[B.data.settings.size] || SIZES.sq12;
    const max = base(size) * 1.5;
    const fits = () => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    let best = null;
    for (const cols of [1, 2, 3]) {
      el.style.columnCount = String(cols);
      let lo = 4, hi = max;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}pt`;
        if (fits()) lo = mid; else hi = mid;
      }
      if (!best || lo > best.fs * 1.08) best = { cols, fs: lo };
    }
    el.style.columnCount = String(best.cols);
    el.style.fontSize = `${Math.max(4, best.fs - 0.05).toFixed(2)}pt`;
  }
}

// Shrink each photo tree until it fits its page.
function fitTrees(root) {
  fitCharts(root);
  for (const t of root.querySelectorAll('.bp-ptree')) {
    let size = parseFloat(t.style.getPropertyValue('--node')) || 1;
    for (let i = 0; i < 16 && (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1) && size > 0.3; i++) {
      size *= 0.9;
      t.style.setProperty('--node', `${size.toFixed(3)}in`);
    }
  }
}

// ------------------------------------------------------------------ warnings

const issues = new Map(); // key -> [messages]
function checkPage(pageEl) {
  if (!pageEl) return;
  const key = pageEl.dataset.key;
  const list = [];
  fitTrees(pageEl);
  const fits = [...pageEl.querySelectorAll('.fit'), pageEl.querySelector('.bp-inner')];
  if (fits.some((el) => el && overflows(el))) list.push('Text is too long for this page. Shorten it, or move part of it to a new story page.');
  for (const img of pageEl.querySelectorAll('.bp-photo img')) {
    if (!img.complete || !img.naturalWidth) continue;
    const fw = img.offsetWidth / 96;
    const fh = img.offsetHeight / 96;
    if (!fw || !fh) continue;
    const dpi = Math.round(Math.min(img.naturalWidth / fw, img.naturalHeight / fh));
    img.closest('.bp-photo').classList.toggle('low-res', dpi < 150);
    if (dpi < 150) list.push(`A photo is small for its frame (about ${dpi} dots per inch; 150 or more prints well, 300 is best). It may print blurry. Use a larger scan if you have one.`);
  }
  pageEl.classList.toggle('has-issue', list.length > 0);
  const wrap = pageEl.closest('.bk-page');
  const box = wrap?.querySelector('.bk-issues');
  if (box) clear(box, list.map((m) => h('div', `⚠ ${m}`)));
  if (list.length) issues.set(key, list);
  else issues.delete(key);
  renderIssueSummary();
}

let issueTimer;
function renderIssueSummary() {
  clearTimeout(issueTimer);
  issueTimer = setTimeout(() => {
    const el = document.getElementById('bk-issue-sum');
    if (!el) return;
    const keys = view.order.filter((k) => issues.has(k) && !edits(k).hidden);
    clear(el, keys.length
      ? [h('strong', `⚠ ${keys.length} page${keys.length === 1 ? '' : 's'} to check`), h('ul', keys.map((k) => h('li', h('button.linkish', { type: 'button', onclick: () => scrollToPage(k) }, `Page ${pageNumber(k) || '–'}: ${labelOf(k)}`))))]
      : h('span.ok', '✓ No warnings: every photo is sharp enough and all text fits.'));
  }, 150);
}

// ------------------------------------------------------------------ the editor

const labelOf = (k) => {
  const own = edits(k).f;
  const p = view.byKey.get(k);
  if (!p) return k;
  if (p.type === 'family') return own?.name || p.label;
  if (p.type === 'more') return `${labelOf(p.famKey)} (continued)`;
  if (['story', 'photo', 'quote'].includes(p.type)) return own?.title || own?.caption?.slice(0, 40) || own?.quote?.slice(0, 40) || EXTRA_TYPES[p.type];
  return own?.title || p.label;
};
const visibleOrder = () => view.order.filter((k) => !edits(k).hidden);
const pageNumber = (k) => { const i = visibleOrder().indexOf(k); return i > 0 ? i + 1 : (i === 0 ? 1 : 0); };

function computeView() {
  const fam = store.fam;
  const s = B.data.settings;
  const { pages, rootId, count, gens } = autoPages(fam, s);
  const extra = (B.data.extra || []).map((x) => ({ key: x.key, type: x.type, label: EXTRA_TYPES[x.type], extra: true }));
  const byKey = new Map([...pages, ...extra].map((p) => [p.key, p]));
  view = { fam, auto: pages, byKey, order: withMore(arrange(pages, B.data), byKey), rootId, count, gens };
}

// The page order with each long story's "continued" pages right after it.
// They are made from the measurements, so they are never saved in the order.
function withMore(order, byKey) {
  const out = [];
  for (const k of order) {
    if (k.startsWith('more:')) continue;
    out.push(k);
    const page = byKey.get(k);
    if (page?.type !== 'family' || edits(k).hidden) continue;
    (flow.get(k) || []).forEach((_, i) => {
      const key = `more:${page.id}:${i + 1}`;
      byKey.set(key, { key, type: 'more', famKey: k, part: i + 1, label: 'Story continued' });
      out.push(key);
    });
  }
  return out;
}
const savedOrder = () => view.order.filter((k) => !k.startsWith('more:'));

// Measures every person's story on screen. One that does not fit is cut at
// the end of the last sentence (or word) that fits, and the rest goes on a
// "continued" page; a page that is still too full is cut again.
// Text in two columns spills sideways into a third column, so width counts too.
const overflows = (el) => el.scrollHeight > el.clientHeight + 2 || (el.classList.contains('fit') && el.scrollWidth > el.clientWidth + 2);
const fitsNow = (bp) => ![...bp.querySelectorAll('.fit'), bp.querySelector('.bp-inner')].some((el) => el && overflows(el));
function longestFit(bp, el, text) {
  const ends = [];
  for (const m of text.matchAll(/\S+/g)) ends.push(m.index + m[0].length);
  let lo = 0, hi = ends.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.textContent = text.slice(0, ends[mid]);
    if (fitsNow(bp)) { best = ends[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  if (!best) return ends[0] || text.length; // not even one word fits: move on anyway
  // Rather end the page at a paragraph or sentence, if that loses little.
  const head = text.slice(0, best);
  const para = head.lastIndexOf('\n\n');
  if (para > best * 0.75) return para;
  const sentence = Math.max(...[...head.matchAll(/[.!?]["”’)]?(?=\s)/g)].map((m) => m.index + m[0].length), -1);
  return sentence > best * 0.8 ? sentence : best;
}
let flowLoops = 0;
function flowStories() {
  const list = document.getElementById('bk-pages');
  if (!list || !view || B?.readOnly) return;
  let changed = false;
  for (const wrap of list.querySelectorAll('.bk-page[data-key^="fam:"]')) {
    const key = wrap.dataset.key;
    const page = view.byKey.get(key);
    const first = wrap.querySelector('.bp-fam-text .bp-story');
    if (!page || !first || edits(key).hidden) { if (flow.delete(key)) changed = true; continue; }
    if (document.activeElement === first) continue; // being edited: measured when done
    const full = familyStory(page);
    const cuts = [];
    let start = 0;
    for (let j = 0; j < 30; j++) {
      const bp = j ? list.querySelector(`.bk-page[data-key="more:${CSS.escape(page.id)}:${j}"] .bp`) : wrap.querySelector('.bp');
      const el = j ? bp?.querySelector('.bp-story') : first;
      if (!el) break; // that page is made on the next pass, then measured
      while (/\s/.test(full[start] || '')) start++;
      const rest = full.slice(start);
      const keep = el.textContent;
      const had = bp.classList.contains('has-more');
      el.textContent = rest;
      bp.classList.remove('has-more');
      const fits = fitsNow(bp);
      if (!fits) {
        bp.classList.add('has-more');
        start += longestFit(bp, el, rest);
        cuts.push(start);
      }
      el.textContent = keep;
      bp.classList.toggle('has-more', had);
      if (fits) break;
    }
    if ((flow.get(key) || []).join() !== cuts.join()) {
      if (cuts.length) flow.set(key, cuts);
      else flow.delete(key);
      changed = true;
    }
  }
  if (!changed) { flowLoops = 0; return; }
  if (flowLoops++ > 12) return; // never keep re-laying out forever
  computeView();
  renderPages();
}

function queueSave() {
  if (B?.readOnly) return;
  const st = document.getElementById('bk-saved');
  if (st) st.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const id = B.id;
    saving = saving.then(() => db.save(id, B.title, B.data))
      .then(() => { const el = document.getElementById('bk-saved'); if (el) el.textContent = `Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; })
      .catch((e) => { toast(`Could not save the book: ${e.message}`, 'error'); const el = document.getElementById('bk-saved'); if (el) el.textContent = 'Not saved'; });
  }, 700);
}

function sizeVars(el, settings = B.data.settings) {
  const size = SIZES[settings.size] || SIZES.sq12;
  const bleed = settings.bleed ? BLEED : 0;
  el.style.setProperty('--pw', `${size.w}in`);
  el.style.setProperty('--ph', `${size.h}in`);
  el.style.setProperty('--bleed', `${bleed}in`);
  el.style.setProperty('--m', `${margin(size)}in`);
  el.style.setProperty('--base', `${base(size)}pt`);
  el.classList.remove(...[...el.classList].filter((c) => c.startsWith('tpl-') || c.startsWith('shape-')));
  el.classList.add(`tpl-${settings.template}`, `shape-${size.w === size.h ? 'square' : size.w > size.h ? 'land' : 'portrait'}`);
  el.classList.toggle('has-bleed', !!bleed);
  return { size, bleed };
}

function loadFonts() {
  if (document.getElementById('book-fonts')) return;
  document.head.append(h('link', { id: 'book-fonts', rel: 'stylesheet', href: FONTS }));
}

function scaleAll() {
  const list = document.getElementById('bk-pages');
  if (!list) return;
  const size = SIZES[B.data.settings.size] || SIZES.sq12;
  const bleed = B.data.settings.bleed ? BLEED : 0;
  const pw = (size.w + 2 * bleed) * 96;
  const ph = (size.h + 2 * bleed) * 96;
  const avail = Math.max(240, list.clientWidth - 8);
  const s = Math.min(1, avail / pw, 820 / pw);
  for (const box of list.querySelectorAll('.bk-scale')) {
    box.style.width = `${pw * s}px`;
    box.style.height = `${ph * s}px`;
    box.firstElementChild.style.transform = `scale(${s})`;
    box.firstElementChild.style.setProperty('--ui', String(1 / s)); // keeps the editing handles a usable size on screen
  }
}

function scrollToPage(k) {
  const el = document.querySelector(`.bk-page[data-key="${CSS.escape(k)}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el?.classList.add('flash');
  setTimeout(() => el?.classList.remove('flash'), 1200);
}

function moveKey(k, delta) {
  const order = savedOrder();
  const i = order.indexOf(k);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  B.data.order = order;
  view.order = withMore(order, view.byKey);
  queueSave();
  renderPages();
  scrollToPage(k);
}

function addPage(type, afterKey) {
  const key = `x:${crypto.randomUUID().slice(0, 8)}`;
  (B.data.extra ||= []).push({ key, type });
  const order = savedOrder();
  const after = afterKey?.startsWith('more:') ? view.byKey.get(afterKey)?.famKey : afterKey;
  const at = after ? order.indexOf(after) + 1 : order.length - 1;
  order.splice(at, 0, key);
  B.data.order = order;
  computeView();
  queueSave();
  renderPages();
  setTimeout(() => scrollToPage(key), 50);
}

function addPageMenu(afterKey) {
  const m = modal('Add a page', [
    h('p.muted.small', afterKey ? `It goes after "${labelOf(afterKey)}". You can move it later.` : 'It goes before the back page. You can move it later.'),
    h('div.bk-add-choices', Object.entries({
      story: ['📖', 'Story page', 'A title, an optional photo and a longer story or memory.'],
      photo: ['🖼', 'Photo page', 'One large photo with a caption: names, place and year.'],
      quote: ['❝', 'Quote page', 'A saying in English, Hindi or Punjabi, with its meaning.'],
    }).map(([type, [icon, name, blurb]]) => h('button.bk-add-choice', { type: 'button', onclick: () => { m.close(); addPage(type, afterKey); } },
      h('span.bk-add-icon', icon), h('strong', name), h('span.muted.small', blurb)))),
  ]);
}

async function removeExtra(k) {
  if (!await confirmDialog(`Delete the page "${labelOf(k)}" and what was written on it?`, 'Delete page')) return;
  B.data.extra = (B.data.extra || []).filter((x) => x.key !== k);
  delete B.data.edits[k];
  B.data.order = view.order.filter((x) => x !== k);
  computeView();
  queueSave();
  renderPages();
}

async function choosePhoto(key, slot, autoPersonId, label) {
  const fileIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  const results = h('div.bk-photo-results');
  const search = h('input', { type: 'search', placeholder: 'Type a name…', 'aria-label': 'Find a person in the tree' });
  const set = (v) => { setEdit(key, (e) => { e.ph = { ...(e.ph || {}) }; if (v) e.ph[slot] = v; else delete e.ph[slot]; }); rerenderPage(key); };
  const m = modal('Change this photo', [
    h('p.muted.small', 'Choose a large, clear scan: at least 1,800 pixels across for a full-page photo on a 12 × 12 book. The book keeps its own copy; the website is not changed.'),
    h('div.form-actions.left',
      h('button.btn.primary', { type: 'button', onclick: () => fileIn.click() }, 'Upload a photo…'),
      autoPersonId ? h('button.btn', { type: 'button', onclick: () => { set(null); m.close(); } }, 'Use the photo from the tree') : null,
      h('button.btn', { type: 'button', onclick: () => { set({ none: true }); m.close(); } }, 'No photo here')),
    fileIn,
    h('h3.bk-sub-h', 'Or use someone\'s photo from the tree'),
    search, results,
  ]);
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return toast('That photo is larger than 15 MB. Please use a smaller copy.', 'error');
    try {
      toast('Uploading the photo…');
      const path = await uploadPhoto(B.id, f);
      set({ path });
      m.close();
      toast('Photo added to the book.');
    } catch (e) { toast(`Could not upload the photo: ${e.message}`, 'error'); }
  });
  const withPhotos = [...store.fam.byId.values()].filter((p) => store.photoUrls.has(p.id));
  const show = () => {
    const q = search.value.trim().toLowerCase();
    const list = withPhotos.filter((p) => !q || fullName(p).toLowerCase().includes(q)).slice(0, 24);
    clear(results, list.length ? list.map((p) => h('button.bk-photo-pick', { type: 'button', onclick: () => { set({ person: p.id }); m.close(); } },
      h('img', { src: store.photoUrls.get(p.id), alt: '' }), h('span', fullName(p, { title: false }))))
      : h('p.muted.small', 'Nobody with a photo matches.'));
  };
  search.addEventListener('input', show);
  show();
}

function rerenderPage(key) {
  const wrap = document.querySelector(`.bk-page[data-key="${CSS.escape(key)}"]`);
  if (!wrap) return renderPages();
  wrap.replaceWith(pageCard(key));
  scaleAll();
  afterRender();
}

function pageCard(k) {
  const page = view.byKey.get(k);
  if (page.type === 'more') {
    const box = h('div.bk-scale', h('div.bk-doc', renderPage(page, { edit: false, n: pageNumber(k) })));
    sizeVars(box.firstElementChild);
    return h('div.bk-page.bk-more', { 'data-key': k },
      h('div.bk-page-bar',
        h('span.bk-page-no', `Page ${pageNumber(k)}`),
        h('span.bk-page-label', labelOf(k)),
        h('span.bk-tag', 'Automatic'),
        h('span.muted.small', `The story was too long for page ${pageNumber(page.famKey)}, so it carries on here. Edit it on that page.`)),
      box,
      h('div.bk-issues'));
  }
  const hidden = !!edits(k).hidden;
  const n = pageNumber(k);
  const i = view.order.indexOf(k);
  const edited = !!(edits(k).f || edits(k).ph || edits(k).pf || edits(k).adds || edits(k).layout || edits(k).style || edits(k).gone);
  const el = renderPage(page, { edit: !hidden, n });
  const box = h('div.bk-scale', h('div.bk-doc', el));
  sizeVars(box.firstElementChild);
  return h(`div.bk-page${hidden ? '.is-hidden' : ''}`, { 'data-key': k },
    h('div.bk-page-bar',
      h('span.bk-page-no', hidden ? 'Hidden' : `Page ${n}`),
      h('span.bk-page-label', labelOf(k)),
      page.extra ? h('span.bk-tag', 'Added') : edited ? h('span.bk-tag', 'Edited') : null,
      h('span.bk-page-tools',
        h('button.icon-btn', { type: 'button', title: 'Move up', 'aria-label': 'Move page up', disabled: i <= 0, onclick: () => moveKey(k, -1) }, '↑'),
        h('button.icon-btn', { type: 'button', title: 'Move down', 'aria-label': 'Move page down', disabled: i >= view.order.length - 1, onclick: () => moveKey(k, 1) }, '↓'),
        h('button.btn.small', { type: 'button', onclick: () => { setEdit(k, (e) => { e.hidden = !hidden; }); computeView(); renderPages(); } }, hidden ? 'Show' : 'Hide'),
        edited && !page.extra ? h('button.btn.small', { type: 'button', title: 'Go back to what the tree says, for this page', onclick: async () => {
          if (!await confirmDialog(`Undo every change on "${labelOf(k)}" and go back to what the tree says?`, 'Undo changes')) return;
          setEdit(k, (e) => { delete e.f; delete e.ph; delete e.pf; delete e.adds; delete e.layout; delete e.style; delete e.gone; });
          rerenderPage(k);
        } }, 'Undo changes') : null,
        hidden ? null : h('button.btn.small', { type: 'button', title: 'Add another photo to this page', onclick: () => addItem(k, 'photo') }, '+ Photo'),
        hidden ? null : h('button.btn.small', { type: 'button', title: 'Add a text box to this page', onclick: () => addItem(k, 'text') }, '+ Text'),
        page.type === 'family' && !hidden ? h('select.bk-mini-sel', { 'aria-label': 'Page layout', title: 'Page layout', onchange: (e) => { setEdit(k, (x) => { if (e.target.value === page.layoutAuto) delete x.layout; else x.layout = e.target.value; }); rerenderPage(k); } },
          FAMILY_LAYOUTS.map((l) => h('option', { value: l.id, selected: l.id === (edits(k).layout || page.layoutAuto) }, `Layout: ${l.name}`))) : null,
        page.type === 'gen' && !hidden ? h('select.bk-mini-sel', { 'aria-label': 'Photo tree style', title: 'Photo tree style', onchange: (e) => { setEdit(k, (x) => { x.style = e.target.value; }); rerenderPage(k); } },
          TREE_STYLES.map((t) => h('option', { value: t.id, selected: t.id === (edits(k).style || TREE_STYLES[page.gi % TREE_STYLES.length].id) }, `Tree: ${t.name}`))) : null,
        h('button.btn.small', { type: 'button', onclick: () => addPageMenu(k) }, '+ Page after'),
        page.extra ? h('button.btn.small.danger', { type: 'button', onclick: () => removeExtra(k) }, 'Delete') : null)),
    hidden ? h('p.muted.small.bk-hidden-note', 'This page is hidden: it will not be in the PDF.') : null,
    hidden ? null : box,
    h('div.bk-issues'));
}

function renderPages() {
  const list = document.getElementById('bk-pages');
  const nav = document.getElementById('bk-nav');
  if (!list) return;
  issues.clear();
  clear(list, view.order.map(pageCard));
  if (nav) {
    clear(nav, view.order.map((k) => h(`button.bk-nav-item${edits(k).hidden ? '.is-hidden' : ''}`, { type: 'button', onclick: () => scrollToPage(k) },
      h('span.bk-nav-no', edits(k).hidden ? '–' : String(pageNumber(k))), h('span', labelOf(k)))));
  }
  const vis = visibleOrder().length;
  const cnt = document.getElementById('bk-count');
  if (cnt) clear(cnt, h('strong', `${vis} page${vis === 1 ? '' : 's'}`), vis % 2 ? h('span.muted.small', ' Printers usually need an even number of pages: add or hide one.') : null);
  scaleAll();
  afterRender();
}

function afterRender() {
  const run = () => { flowStories(); document.querySelectorAll('#bk-pages .bp').forEach(checkPage); };
  requestAnimationFrame(run);
  document.fonts?.ready.then(run);
  setTimeout(run, 1500);
}

// ------------------------------------------------------------------ book preview

// The whole book as a book: the cover on its own, then two pages side by
// side as they will face each other once printed and bound, turned with a
// page-turn (arrows, the keyboard, a click on a page, or a swipe). One page
// at a time on a phone.
// `src` (a shared copy) gives the pages instead of the open book:
// { title, settings, count, page(i), shared: true }.
function openFlipbook(startIndex = 0, src = null) {
  document.querySelector('.bk-flip')?.remove();
  if (!src) {
    const order = visibleOrder();
    src = { title: B.title, settings: B.data.settings, count: order.length, page: (i) => renderPage(view.byKey.get(order[i]), { edit: false, n: i + 1 }) };
  }
  const keys = Array.from({ length: src.count }, (_, i) => i);
  if (!keys.length) return;
  const size = SIZES[src.settings.size] || SIZES.sq12;
  const bleed = src.settings.bleed ? BLEED : 0;
  const pw = (size.w + 2 * bleed) * 96;
  const ph = (size.h + 2 * bleed) * 96;
  const single = () => innerWidth < 760;
  // Spreads: [left, right] page indexes; the cover is a right-hand page.
  const spreads = () => {
    if (single()) return keys.map((_, i) => [i]);
    const out = [[null, 0]];
    for (let i = 1; i < keys.length; i += 2) out.push([i, i + 1 < keys.length ? i + 1 : null]);
    return out;
  };
  let list = spreads();
  let at = Math.max(0, list.findIndex((sp) => sp.includes(startIndex)));
  let busy = false;
  let swiped = false;
  const stage = h('div.bk-flip-stage');
  const where = h('span.bk-flip-where');
  const prevBtn = h('button.bk-flip-arrow.prev', { type: 'button', 'aria-label': 'Previous pages', title: 'Previous (←)', onclick: () => go(-1) }, '‹');
  const nextBtn = h('button.bk-flip-arrow.next', { type: 'button', 'aria-label': 'Next pages', title: 'Next (→)', onclick: () => go(1) }, '›');
  const slider = h('input.bk-flip-slider', { type: 'range', min: 0, max: list.length - 1, value: at, 'aria-label': 'Go to page', oninput: (e) => { at = +e.target.value; draw(); } });
  const close = () => { overlay.remove(); removeEventListener('keydown', onKey); removeEventListener('resize', onResize); document.body.classList.remove('bk-flip-open'); };
  const overlay = h('div.bk-flip', { role: 'dialog', 'aria-modal': 'true', 'aria-label': src.shared ? src.title : 'Book preview' },
    h('div.bk-flip-top',
      h('strong.bk-flip-title', src.title),
      where,
      h('button.btn.small', { type: 'button', onclick: close }, src.shared ? '✕ Close' : '✕ Close preview')),
    h('div.bk-flip-main', prevBtn, stage, nextBtn),
    h('div.bk-flip-bottom', slider, h('span.muted.small', 'Click a page or use ← → to turn pages. Esc closes.')));
  const scale = () => {
    const sw = stage.clientWidth - 8;
    const sh = stage.clientHeight - 8;
    return Math.min(sh / ph, sw / (single() ? pw : 2 * pw));
  };
  // One page, drawn at real size and scaled down, or a blank space.
  const pageBox = (i, s, side) => {
    const box = h(`div.bk-flip-page.${side}`, { style: `width:${pw * s}px;height:${ph * s}px` });
    if (i == null) { box.classList.add('blank'); return box; }
    const doc = h('div.bk-doc', { style: `transform:scale(${s});transform-origin:0 0` }, src.page(i));
    sizeVars(doc, src.settings);
    box.append(doc);
    if (side !== 'leaf') box.addEventListener('click', () => { if (!swiped) go(side === 'left' && !single() ? -1 : 1); });
    return box;
  };
  // A shared copy was fitted when it was made.
  const fit = (el) => { if (src.shared) return; requestAnimationFrame(() => fitTrees(el)); document.fonts?.ready.then(() => fitTrees(el)); };
  const label = () => {
    const sp = list[at].filter((x) => x != null).map((x) => x + 1);
    where.textContent = sp.length > 1 ? `Pages ${sp[0]}–${sp[1]} of ${keys.length}` : `Page ${sp[0]} of ${keys.length}`;
    prevBtn.disabled = at === 0;
    nextBtn.disabled = at === list.length - 1;
    slider.value = at;
  };
  const spread = (sp, s) => {
    const row = h('div.bk-flip-spread');
    if (single()) row.append(pageBox(sp[0], s, 'right'));
    else row.append(pageBox(sp[0], s, 'left'), h('div.bk-flip-spine'), pageBox(sp[1], s, 'right'));
    return row;
  };
  const draw = () => {
    const s = scale();
    const row = spread(list[at], s);
    clear(stage, row);
    fit(row);
    label();
  };
  // Turn one leaf: the page being turned rotates about the spine and shows
  // the next (or previous) page on its back.
  const go = (d) => {
    const to = at + d;
    if (busy || to < 0 || to >= list.length) return;
    if (single() || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      at = to;
      draw();
      return;
    }
    busy = true;
    const s = scale();
    const cur = list[at];
    const nxt = list[to];
    // Underneath: the page that stays, and the far page of the new spread.
    const under = d > 0 ? [cur[0], nxt[1]] : [nxt[0], cur[1]];
    const row = spread(under, s);
    const leaf = h(`div.bk-leaf.${d > 0 ? 'fwd' : 'back'}`, { style: `width:${pw * s}px;height:${ph * s}px` },
      h('div.bk-leaf-face.front', pageBox(d > 0 ? cur[1] : cur[0], s, 'leaf')),
      h('div.bk-leaf-face.back', pageBox(d > 0 ? nxt[0] : nxt[1], s, 'leaf')));
    row.append(leaf);
    clear(stage, row);
    fit(row);
    requestAnimationFrame(() => requestAnimationFrame(() => leaf.classList.add('turn')));
    const done = () => { at = to; busy = false; draw(); };
    leaf.addEventListener('transitionend', done, { once: true });
    setTimeout(() => { if (busy) done(); }, 1200);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
  };
  let resizeT;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => { const first = list[at].find((x) => x != null); list = spreads(); slider.max = list.length - 1; at = Math.max(0, list.findIndex((sp) => sp.includes(first))); draw(); }, 120); };
  let sx = null;
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  stage.addEventListener('pointerup', (e) => { if (sx != null && Math.abs(e.clientX - sx) > 50) { swiped = true; setTimeout(() => { swiped = false; }, 350); go(e.clientX < sx ? 1 : -1); } sx = null; }, true);
  addEventListener('keydown', onKey);
  addEventListener('resize', onResize);
  document.body.classList.add('bk-flip-open');
  document.body.append(overlay);
  draw();
  overlay.querySelector('.bk-flip-top button')?.focus();
}

// ------------------------------------------------------------------ sharing by link

// Every page as it looks now, as finished HTML. Photos that are not already
// public (book photos and Family-branch-only photos have addresses that
// expire) are copied into the share's own folder, so the copy keeps working.
async function makeSnapshot(token, progress) {
  const doc = h('div.bk-doc');
  sizeVars(doc);
  visibleOrder().forEach((k, i) => doc.append(renderPage(view.byKey.get(k), { edit: false, n: i + 1 })));
  const holder = h('div.bk-print', doc);
  document.body.append(holder);
  try {
    const imgs = [...holder.querySelectorAll('img')];
    await Promise.all([document.fonts?.ready, ...imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; })))]);
    fitTrees(holder);
    const keep = (u) => !u || /^(img\/|\.\/img\/|data:)/.test(u) || u.includes('/storage/v1/object/public/photos-public/') || u.startsWith(`${location.origin}${location.pathname.replace(/[^/]*$/, '')}img/`);
    const copies = new Map();
    const photos = [];
    const todo = [...new Set(imgs.map((im) => im.getAttribute('src')).filter((u) => !keep(u)))];
    let done = 0;
    const stamp = Date.now().toString(36);
    const copy = async (u, n) => {
      if (store.preview) { copies.set(u, u); return; }
      try {
        const blob = await (await fetch(u)).blob();
        const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[blob.type] || 'jpg';
        const path = `${token}/${stamp}-${n}.${ext}`;
        const { error } = await store.sb.storage.from(SHARE_BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
        if (error) throw error;
        copies.set(u, store.sb.storage.from(SHARE_BUCKET).getPublicUrl(path).data.publicUrl);
        photos.push(path);
      } catch (e) { console.warn('share photo', e); } finally { progress?.(++done, todo.length); }
    };
    for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map((u, j) => copy(u, i + j + 1)));
    for (const im of imgs) {
      const u = im.getAttribute('src');
      if (copies.has(u)) im.setAttribute('src', copies.get(u));
      else if (!keep(u)) im.remove();
      im.removeAttribute('srcset');
    }
    const s = B.data.settings;
    return { settings: { template: s.template, size: s.size, bleed: !!s.bleed }, pages: [...doc.children].map((el) => el.outerHTML), photos };
  } finally { holder.remove(); }
}

// The admin's Share box: make the link, send it, refresh it, or stop it.
async function shareDialog() {
  const body = h('div.bk-share', h('p.loading', 'Checking…'));
  const dlg = modal('Share this book', body, { wide: true });
  let cur = null;
  try { cur = await shares.of(B.id); } catch (e) {
    clear(body, h('p.form-error', `Could not check the share link: ${e.message}. The share links table may not be set up yet.`));
    return;
  }
  const btn = document.getElementById('bk-share-btn');
  const busy = (text) => clear(body, h('p.loading', { id: 'bk-share-busy' }, text));
  const publish = async () => {
    const token = cur?.token || crypto.randomUUID();
    busy('Making the shared copy of every page…');
    try {
      const snap = await makeSnapshot(token, (n, of) => { const el = document.getElementById('bk-share-busy'); if (el) el.textContent = `Copying photos for the shared copy: ${n} of ${of}…`; });
      await shares.save(B.id, token, B.title, snap);
      if (cur?.snapshot?.photos?.length && !store.preview) await store.sb.storage.from(SHARE_BUCKET).remove(cur.snapshot.photos).catch(() => {});
      cur = { token, updated_at: new Date().toISOString(), snapshot: snap };
      if (btn) btn.textContent = '🔗 Shared';
      toast('The shared copy is ready.', 'ok');
    } catch (e) { toast(`Could not share the book: ${e.message}`, 'error'); }
    draw();
  };
  const stop = async () => {
    if (!await confirmDialog('Stop sharing this book? The link stops working for everyone who has it. The book itself stays here, and you can share it again later (with a new link).', 'Stop sharing')) return;
    busy('Removing the shared copy…');
    try {
      await shares.remove(cur.token, cur.snapshot?.photos || []);
      cur = null;
      if (btn) btn.textContent = '🔗 Share';
      toast('Sharing stopped. The old link no longer opens the book.', 'ok');
    } catch (e) { toast(`Could not stop sharing: ${e.message}`, 'error'); }
    draw();
  };
  const warning = h('p.bk-share-warn', '⚠ Anyone who has the link can see every page, without signing in, including Family branch only details and photos of living family members. Send it only to family.');
  function draw() {
    if (!cur) {
      clear(body,
        h('p', 'Make a link that opens this book as a book: two pages side by side, turned with the arrows or a swipe. Anyone who has the link can turn the pages; nobody can change anything.'),
        warning,
        h('p.muted.small', 'The link opens a copy of the book as it is now. When you change the book later, press "Update the shared copy" so the link shows the changes.'),
        h('div.form-actions.left', h('button.btn.primary', { type: 'button', id: 'bk-share-make', onclick: publish }, 'Make a share link')));
      return;
    }
    const link = shareLink(cur.token);
    const text = `Our family book "${B.title}" is ready to look at. Open this link and turn the pages:\n${link}`;
    const enc = encodeURIComponent;
    const pages = cur.snapshot?.pages?.length;
    clear(body,
      h('p.bk-share-on', `✅ Shared${pages ? ` (${pages} pages)` : ''}, copy made ${formatWhen(cur.updated_at)}. Anyone with this link can turn the pages but not change them.`),
      h('div.bk-share-link', h('input', { type: 'text', readonly: true, value: link, id: 'bk-share-url', 'aria-label': 'Share link', onfocus: (e) => e.target.select() })),
      h('div.bk-share-btns',
        navigator.share ? h('button.btn.small', { type: 'button', onclick: () => navigator.share({ title: B.title, text }).catch(() => {}) }, 'Share…') : null,
        h('a.btn.small.primary', { href: `https://wa.me/?text=${enc(text)}`, target: '_blank', rel: 'noopener', id: 'bk-share-wa' }, 'WhatsApp'),
        h('a.btn.small', { href: `mailto:?subject=${enc(`Our family book: ${B.title}`)}&body=${enc(text)}`, id: 'bk-share-mail' }, 'Email'),
        h('button.btn.small', { type: 'button', onclick: async () => {
          try { await navigator.clipboard.writeText(link); toast('Link copied. Paste it into WhatsApp, a text or an email.', 'ok'); } catch { document.getElementById('bk-share-url')?.select(); toast('Could not copy. Select the link and copy it.', 'error'); }
        } }, 'Copy link'),
        h('a.btn.small', { href: link, target: '_blank', rel: 'noopener' }, 'Open it')),
      warning,
      h('div.form-actions.left',
        h('button.btn.small', { type: 'button', id: 'bk-share-update', onclick: publish, title: 'Make the copy again from the book as it is now. The link stays the same.' }, '↻ Update the shared copy'),
        h('button.btn.small.danger', { type: 'button', id: 'bk-share-stop', onclick: stop }, 'Stop sharing')),
      h('p.muted.small', 'People who do not use the site can also get the book as a file: "Make the print-ready PDF" and attach it.'));
  }
  draw();
  return dlg;
}

// Only page markup comes back from a shared copy: drop anything that could run.
function cleanPage(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  for (const el of t.content.querySelectorAll('script,iframe,object,embed,link,meta,base,form,input,textarea,button')) el.remove();
  for (const el of t.content.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'contenteditable' || n === 'srcdoc' || (['href', 'src', 'xlink:href', 'action'].includes(n) && /^\s*(javascript|vbscript|data:text)/i.test(a.value))) el.removeAttribute(a.name);
    }
  }
  return t.content;
}

// #/book?view=<token>: the shared copy, for anyone with the link.
async function openShared(container, token) {
  loadFonts();
  if (document.querySelector(`.bk-flip[data-token="${CSS.escape(token)}"]`)) return;
  clear(container, h('p.loading', 'Opening the family book…'));
  let row = null;
  try { if (/^[0-9a-f-]{36}$/i.test(token)) row = await shares.open(token); } catch (e) { console.warn('shared book', e); }
  if (!row?.snapshot?.pages?.length) {
    clear(container, h('div.bk-shared',
      h('h1', 'This book is not shared'),
      h('p', 'The family book at this link is no longer shared, or the link is not complete. Please ask the person who sent it for a new link.'),
      h('p', h('a.btn', { href: '#/tree' }, 'See the family tree'))));
    return;
  }
  const { pages, settings } = row.snapshot;
  const src = { title: row.title, settings: { template: 'heritage', size: 'sq12', ...settings }, count: pages.length, shared: true, page: (i) => cleanPage(pages[i]) };
  const open = () => { openFlipbook(0, src); document.querySelector('.bk-flip')?.setAttribute('data-token', token); };
  clear(container, h('div.bk-shared',
    h('h1', row.title),
    h('p', `A family book from the family tree, ${pages.length} pages. Turn the pages with the arrows, the arrow keys or a swipe.`),
    h('p', h('button.btn.primary', { type: 'button', id: 'bk-shared-open', onclick: open }, '📖 Open the book')),
    row.updated_at ? h('p.muted.small', `Last updated ${formatWhen(row.updated_at)}.`) : null));
  open();
}

// ------------------------------------------------------------------ print

function printBook() {
  const { size, bleed } = { size: SIZES[B.data.settings.size] || SIZES.sq12, bleed: B.data.settings.bleed ? BLEED : 0 };
  const W = size.w + 2 * bleed;
  const H = size.h + 2 * bleed;
  document.getElementById('bk-print-size')?.remove();
  document.getElementById('bk-print')?.remove();
  document.head.append(h('style', { id: 'bk-print-size' }, `@media print { @page { size: ${W}in ${H}in; margin: 0; } }`));
  const doc = h('div.bk-doc.printing');
  sizeVars(doc);
  visibleOrder().forEach((k, i) => doc.append(renderPage(view.byKey.get(k), { edit: false, n: i + 1 })));
  const holder = h('div.bk-print', { id: 'bk-print' }, doc);
  document.body.append(holder);
  fitTrees(holder);
  document.body.classList.add('printing-book');
  const imgs = [...holder.querySelectorAll('img')];
  const done = () => {
    document.body.classList.remove('printing-book');
    holder.remove();
  };
  window.addEventListener('afterprint', done, { once: true });
  Promise.all([document.fonts?.ready, ...imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; })))])
    .then(() => { fitTrees(holder); setTimeout(() => window.print(), 150); });
}

// ------------------------------------------------------------------ screens

function startOptions(fam, selected) {
  const people = [...fam.byId.values()].filter((p) => fam.treeChildren(p.id).length && !fam.isMarriedIn(p.id))
    .sort((a, b) => (a.generation ?? 99) - (b.generation ?? 99));
  const byGen = new Map();
  for (const p of people) (byGen.get(p.generation ?? '?') || byGen.set(p.generation ?? '?', []).get(p.generation ?? '?')).push(p);
  return [...byGen.entries()].map(([g, list]) => h('optgroup', { label: `Generation ${g}` },
    list.map((p) => h('option', { value: p.id, selected: p.id === selected }, p.id === fam.defaultRootId ? `${fullName(p, { title: false })} (whole tree)` : fullName(p, { title: false })))));
}

function templateCards(name, value) {
  return h('div.bk-tpls', Object.entries(TEMPLATES).map(([k, t]) => h('label.bk-tpl',
    h('input', { type: 'radio', name, value: k, checked: k === value }),
    h(`span.bk-tpl-swatch.tpl-${k}`, h('span.sw-a'), h('span.sw-b'), h('span.sw-c', 'Aa')),
    h('strong', t.name), h('span.muted.small', t.blurb))));
}

export async function renderBook(container, query) {
  const shared = query?.get('view');
  if (shared) return openShared(container, shared);
  if (!store.isAdmin) {
    clear(container, h('h1', 'Family book maker'), h('p', 'The book maker is being tested by the admins. It will open to everyone later.'));
    return;
  }
  loadFonts();
  const id = query?.get('b');
  if (id) return openBook(container, id);
  clear(container, h('h1', 'Family book maker'), h('p.loading', 'Loading your books…'));
  let books = [];
  try { books = await db.list(); } catch (e) {
    clear(container, h('h1', 'Family book maker'), h('p.form-error', `Could not load the books: ${e.message}. The book drafts table may not be set up yet.`));
    return;
  }
  const fam = store.fam;
  const form = h('form.bk-new',
    h('label.field', h('span.field-label', 'Book title (only for this list)'), h('input', { name: 'title', required: true, value: `${config.siteTitle || 'Family'} book`, maxlength: 200 })),
    h('fieldset.bk-fs', h('legend', 'Design'), templateCards('template', 'heritage')),
    h('div.bk-row2',
      h('label.field', h('span.field-label', 'Page size'), h('select', { name: 'size' }, Object.entries(SIZES).map(([k, s]) => h('option', { value: k, selected: k === 'sq12' }, s.name)))),
      h('label.field', h('span.field-label', 'Start the book from'), h('select', { name: 'root' }, startOptions(fam, fam.defaultRootId)),
        h('span.field-hint', 'The whole tree, or one branch: that person, everyone below them and the people they married.'))),
    h('label.check', h('input', { type: 'checkbox', name: 'skip', checked: true }), ' Give a page only to people with a photo, a story, a spouse or children (others are listed on their parents\' page)'),
    h('label.check', h('input', { type: 'checkbox', name: 'bleed', checked: false }), ' Add printer\'s bleed (0.125 in on each side, for print shops such as Lulu or Blurb)'),
    h('div.form-actions.left', h('button.btn.primary', { type: 'submit' }, 'Build the book')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const data = { settings: { template: f.get('template'), size: f.get('size'), rootId: f.get('root'), skipEmpty: !!f.get('skip'), bleed: !!f.get('bleed') }, edits: {}, extra: [], order: [] };
    try {
      const row = await db.create(String(f.get('title')).trim() || 'Family book', data);
      location.hash = `#/book?b=${row.id}`;
    } catch (err) { toast(`Could not create the book: ${err.message}`, 'error'); }
  });
  clear(container,
    h('h1', 'Family book maker'),
    h('p', 'Make a printed family book from the tree. Pick a design and size, and the book builds itself: a cover, the family tree chart, then a page for each person or couple, generation by generation. Then change any text, replace photos, add stories and move or hide pages. When it looks right, make the print-ready PDF.'),
    h('p.muted.small', 'For admins while it is being tested. The book includes the private (Family branch only) details you can see, so keep the PDF within the family.'),
    books.length ? h('section.dash-card.bk-list',
      h('h2', 'Your books'),
      h('ul', books.map((b) => h('li',
        h('a', { href: `#/book?b=${b.id}` }, b.title),
        h('span.muted.small', ` · ${TEMPLATES[b.data?.settings?.template]?.name || ''} · ${SIZES[b.data?.settings?.size]?.name || ''} · changed ${formatWhen(b.updated_at)}`),
        h('button.linkish.danger', { type: 'button', onclick: async () => {
          if (!await confirmDialog(`Delete the book "${b.title}" and all the changes made in it? The family tree itself is not touched.`, 'Delete book')) return;
          try { await db.remove(b.id); renderBook(container, new URLSearchParams()); } catch (err) { toast(err.message, 'error'); }
        } }, 'Delete'))))) : null,
    h('section.dash-card.bk-new-card', h('h2', 'Make a new book'), form));
}

async function openBook(container, id) {
  // Already open (the page is being redrawn, for example after the tree
  // reloaded): keep what is in memory, which may have changes still saving.
  if (B?.id !== id) {
    clear(container, h('p.loading', 'Building the book…'));
    let row;
    try { row = (await db.list()).find((b) => b.id === id); } catch (e) { toast(e.message, 'error'); }
    if (!row) {
      clear(container, h('h1', 'Book not found'), h('p', h('a', { href: '#/book' }, 'Back to your books')));
      return;
    }
    B = { id: row.id, title: row.title, data: { settings: {}, edits: {}, extra: [], order: [], ...row.data } };
  }
  B.data.settings = { template: 'heritage', size: 'sq12', skipEmpty: true, bleed: false, ...B.data.settings };
  await loadPhotoUrls(B.data).catch(() => {});
  computeView();
  const s = B.data.settings;
  const setSetting = (k, v) => { s[k] = v; computeView(); queueSave(); renderPages(); };
  const titleIn = h('input.bk-title-in', { value: B.title, 'aria-label': 'Book title', maxlength: 200, onchange: () => { B.title = titleIn.value.trim() || B.title; queueSave(); } });
  const toolbar = h('div.bk-toolbar',
    h('a.btn.small', { href: '#/book' }, '← Books'),
    titleIn,
    h('label.bk-tool', 'Design ', h('select', { onchange: (e) => setSetting('template', e.target.value) }, Object.entries(TEMPLATES).map(([k, t]) => h('option', { value: k, selected: k === s.template }, t.name)))),
    h('label.bk-tool', 'Size ', h('select', { onchange: (e) => setSetting('size', e.target.value) }, Object.entries(SIZES).map(([k, z]) => h('option', { value: k, selected: k === s.size }, z.name)))),
    h('label.bk-tool', 'Starts from ', h('select', { onchange: (e) => setSetting('rootId', e.target.value) }, startOptions(store.fam, view.rootId))),
    h('label.bk-tool.check', { title: 'Untick to leave out the pages of people who have no photo, story, spouse or children yet (they are still in the picture trees and the chart)' }, h('input', { type: 'checkbox', id: 'bk-all-pages', checked: s.skipEmpty === false, onchange: (e) => setSetting('skipEmpty', !e.target.checked) }), ' A page for everyone'),
    h('label.bk-tool.check', { title: 'Each photo gets its own frame and a slight tilt, like photos in an album. Untick for plain, straight photos (photos you tilted or moved by hand stay as you left them).' }, h('input', { type: 'checkbox', id: 'bk-mix-frames', checked: s.mixFrames !== false, onchange: (e) => setSetting('mixFrames', e.target.checked) }), ' Mixed photo frames'),
    h('label.bk-tool.check', h('input', { type: 'checkbox', checked: !!s.bleed, onchange: (e) => setSetting('bleed', e.target.checked) }), ' Bleed'),
    h('button.btn.small', { type: 'button', title: 'Add new people and details from the tree. Your changes stay.', onclick: async () => {
      toast('Rebuilding from the tree…');
      computeView();
      renderPages();
      toast('Rebuilt: new people and details from the tree are in, and your changes are kept.');
    } }, '↻ Rebuild from the tree'),
    h('button.btn.small', { type: 'button', onclick: () => addPageMenu(null) }, '+ Add a page'),
    h('button.btn.small', { type: 'button', id: 'bk-share-btn', title: 'Make a link that family can open to turn the pages (read-only)', onclick: shareDialog }, '🔗 Share'),
    h('button.btn.small', { type: 'button', id: 'bk-preview-btn', title: 'See the book as a book: two pages side by side, turn the pages', onclick: () => openFlipbook() }, '📖 Preview as a book'),
    h('button.btn.small.primary', { type: 'button', onclick: printBook }, 'Make the print-ready PDF'),
    h('span.muted.small', { id: 'bk-saved' }, 'Saved'));
  clear(container,
    toolbar,
    h('div.bk-editor',
      h('aside.bk-side',
        h('div.bk-count', { id: 'bk-count' }),
        h('div.bk-issue-sum', { id: 'bk-issue-sum' }),
        h('p.muted.small', 'Click any words on a page to change them, and any photo to replace it. Changes save by themselves.'),
        h('details.bk-nav-wrap', { open: innerWidth > 900 }, h('summary', 'All pages'), h('nav.bk-nav', { id: 'bk-nav' }))),
      h('div.bk-pages', { id: 'bk-pages' })));
  setupDelete(document.getElementById('bk-pages'));
  renderPages();
  shares.of(B.id).then((r) => { const b = document.getElementById('bk-share-btn'); if (r && b) b.textContent = '🔗 Shared'; }).catch(() => {});
}
addEventListener('resize', () => { if (document.getElementById('bk-pages')) scaleAll(); });
