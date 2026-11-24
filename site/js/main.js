// App start-up, routing and the header.
import { navItems, fitHeader } from './header.js';
import { store, init, sendLoginLink, verifyCode, signOut, pendingCount, listRequests, logView } from './data.js';
import { config } from './config.js';
import { fullName, shortName, searchPeople, relationHint } from './model.js';
import { h, clear, toast, modal, field } from './ui.js';
import { TreeView } from './tree.js';
import { renderOutline } from './outline.js';
import { renderPanel } from './panel.js';
import { openPersonForm } from './forms.js';
import { welcomeToLinkedBox } from './claim-gate.js';
import { renderReview, renderMine, renderAdmin } from './admin.js';
import { renderInvite } from './invite.js';
import { renderDashboard } from './dashboard.js';
import { renderBlessings, renderCorner, maybeShowBlessingsIntro, maybeShowHistorianCongrats, maybeShowFounderThanks } from './blessings.js';
import { renderExport } from './export.js';
import { renderBook } from './book.js';
import { renderAi } from './ai.js';
import { downloadGedcom } from './gedcom.js';
import { countView } from './count.js';
import { renderLibrary } from './library.js';
import { renderFaces } from './faces.js';
import { openViewAsPicker, renderViewAsBanner, exitViewAs, resumeViewAs } from './view-as.js';

const $ = (id) => document.getElementById(id);
const state = { view: 'tree', root: null, selected: null };
let tree;

// Routes: #/tree/<rootId>, #/outline/<rootId>, #/review, #/mine, #/members, #/invite; ?p=<personId>
function parseHash() {
  let raw = location.hash.replace(/^#\/?/, '');
  if (/^(access_token|error|type)=/.test(raw)) raw = ''; // sign-in redirect, handled by Supabase
  const [path, query = ''] = raw.split('?');
  const [view, root] = path.split('/');
  state.view = ['tree', 'outline', 'review', 'mine', 'members', 'invite', 'dashboard', 'export', 'blessings', 'library', 'book', 'ai', 'faces'].includes(view) ? view : 'tree';
  state.root = root && store.fam.byId.has(root) ? root : store.fam.defaultRootId;
  const params = new URLSearchParams(query);
  state.query = params;
  const p = params.get('p');
  state.selected = p && store.fam.byId.has(p) ? p : null;
}

function go({ view = state.view, root = state.root, selected = state.selected } = {}, replace = false) {
  const base = ['tree', 'outline'].includes(view) ? `#/${view}/${root}` : `#/${view}`;
  const hash = base + (selected && ['tree', 'outline'].includes(view) ? `?p=${selected}` : '');
  if (hash === location.hash) return route();
  if (replace) {
    history.replaceState(null, '', hash);
    route();
  } else {
    location.hash = hash;
  }
}

let lastRoot = null;
let lastView = null;
let needsRedraw = false;
// Signed-in members with a claimed box open the tree on their own line (the
// path down to them, them and everyone below; other branches closed). This
// happens on the first look at the main tree, and again right after signing
// in or having a claim approved. `lineFor` remembers whose line was opened.
let lineFor = null;
// Their claimed box, or else the box their invitation is linked to (so the
// admin's "View as" opens on that member's branch too).
function myLineId() {
  if (!store.signedIn || store.preview) return null;
  const id = store.claimedId || store.profile?.person_id || null;
  return id && store.fam.byId.has(id) ? id : null;
}
// A member's chosen starting person is remembered in this browser (per
// account) and used the next time they open the site. Picking the top
// ancestor clears it. Never saved or used while the admin is "Viewing as".
const startKey = () => {
  const id = store.session?.user?.id;
  return id && !store.viewAs && !store.preview ? `start-from:${id}` : null;
};
function savedStart() {
  const k = startKey();
  if (!k) return null;
  let id = null;
  try { id = localStorage.getItem(k); } catch { /* storage blocked */ }
  return id && store.fam.byId.has(id) && id !== store.fam.defaultRootId ? id : null;
}
function chooseStart(id, extra = {}) {
  const k = startKey();
  try {
    if (k && id === store.fam.defaultRootId) localStorage.removeItem(k);
    else if (k) localStorage.setItem(k, id);
  } catch { /* storage blocked */ }
  go({ root: id, selected: null, ...extra });
}
let restoredFor = null;
async function route() {
  parseHash();
  // First look at the tree after signing in: start from their saved choice.
  const who = store.signedIn ? startKey() : null;
  if (who && who !== restoredFor) {
    restoredFor = who;
    const saved = savedStart();
    if (saved && state.root === store.fam.defaultRootId && !state.selected && ['tree', 'outline'].includes(state.view)) {
      history.replaceState(null, '', `#/${state.view}/${saved}`);
      parseHash();
      lineFor = myLineId(); // their saved start wins over opening their own line
    }
  }
  // "&edit=1" (from the Dashboard's missing-field lists): open the card and its edit form.
  if (/[?&]edit=1\b/.test(location.hash)) {
    history.replaceState(null, '', location.hash.replace(/&edit=1\b|\?edit=1&?/, (m) => (m.startsWith('?') && m.endsWith('&') ? '?' : '')));
    const person = state.selected && store.fam.byId.get(state.selected);
    if (person && store.signedIn) setTimeout(() => openPersonForm({ mode: 'edit', person }), 250);
  }
  logView(state.view, state.selected);
  countView(`${location.pathname}#/${state.view}`, `${config.siteTitle}: ${state.view}`);
  const isTreeish = state.view === 'tree' || state.view === 'outline';
  document.body.dataset.view = state.view;
  for (const a of document.querySelectorAll('[data-nav]')) {
    a.classList.toggle('active', a.dataset.nav === state.view);
    // Tree and List keep the current starting person and selection.
    if (isTreeish && (a.dataset.nav === 'tree' || a.dataset.nav === 'outline')) {
      a.href = `#/${a.dataset.nav}/${state.root}${state.selected ? `?p=${state.selected}` : ''}`;
    }
  }
  $('page').hidden = isTreeish;
  $('tree-area').hidden = !isTreeish;

  if (!isTreeish) {
    lastView = state.view;
    $('panel').hidden = true;
    document.body.classList.remove('panel-open');
    const page = $('page');
    if (state.view === 'dashboard') return renderDashboard(page);
    if (state.view === 'export') return renderExport(page);
    if (state.view === 'library') return renderLibrary(page, { person: state.query.get('person'), photo: state.query.get('photo'), onSignIn: openSignIn });
    // A shared family book link opens for anyone who has it.
    if (state.view === 'book' && state.query.get('view')) return renderBook(page, state.query);
    if (!store.signedIn) {
      clear(page, h('h1', 'Please sign in'), h('p', 'This page is for family members.'), h('button.btn.primary', { type: 'button', onclick: openSignIn }, 'Sign in'));
      return;
    }
    if (state.view === 'review') return store.signedIn ? renderReview(page) : clear(page, h('p', 'Only the admin, and family members who look after a part of the tree, can review changes.'));
    if (state.view === 'members') return store.isAdmin ? renderAdmin(page) : clear(page, h('p', 'Only the admin can manage members.'));
    if (state.view === 'mine') return renderMine(page);
    if (state.view === 'invite') return renderInvite(page);
    if (state.view === 'blessings') return renderBlessings(page);
    if (state.view === 'book') return renderBook(page, state.query);
    if (state.view === 'ai') return renderAi(page, state.query);
    if (state.view === 'faces') return renderFaces(page);
    return;
  }

  renderBreadcrumbs();
  $('tree-canvas').hidden = state.view !== 'tree';
  $('outline').hidden = state.view !== 'outline';
  $('tree-tools').hidden = state.view !== 'tree';
  if (state.view === 'tree') {
    const mine = myLineId();
    if (mine && mine !== lineFor && !state.selected && state.root === store.fam.defaultRootId) {
      // Their box is not under the main tree: show the usual view rather than
      // leaving the previous person's line open.
      if (!tree.openLine(state.root, mine)) tree.setRoot(state.root);
      lineFor = mine;
      needsRedraw = false;
    } else if (!mine && lineFor && !state.selected && state.root === store.fam.defaultRootId) {
      // Signed out, or now looking as someone without a box: back to the usual view.
      lineFor = null;
      tree.setRoot(state.root);
      needsRedraw = false;
    } else if (tree.rootId !== state.root) tree.setRoot(state.root);
    else if (needsRedraw || lastView !== 'tree') {
      tree.render();
      if (lastView !== 'tree') tree.fit();
    }
    needsRedraw = false;
    if (state.selected) {
      tree.select(state.selected);
      if (!tree.reveal(state.selected)) tree.select(state.selected);
    } else tree.select(null);
  } else {
    renderOutline($('outline'), state.root, { onSelect: selectPerson, selectedId: state.selected });
  }
  lastRoot = state.root;
  lastView = state.view;
  renderSide();
}

function renderSide() {
  const panel = $('panel');
  if (!state.selected) {
    panel.hidden = true;
    document.body.classList.remove('panel-open');
    return;
  }
  panel.hidden = false;
  document.body.classList.add('panel-open');
  renderPanel(panel, state.selected, {
    onSelect: selectPerson,
    onRoot: (id) => chooseStart(id, { selected: id }),
    onClose: () => go({ selected: null }),
    onSignIn: openSignIn,
  });
  panel.scrollTop = 0;
}

function selectPerson(id) {
  go({ selected: id });
}

function renderBreadcrumbs() {
  const fam = store.fam;
  const chain = fam.lineage(state.root);
  const crumbs = $('crumbs');
  const path = (ids) => ids.map((id, i) => {
    const p = fam.byId.get(id);
    const last = i === ids.length - 1 && id === state.root;
    return [i ? h('span.sep', '›') : null,
      last ? h('strong', shortName(p)) : h('button.link', { type: 'button', title: `Start the tree from ${shortName(p)}`, onclick: () => go({ root: id, selected: null }) }, shortName(p))];
  });
  const whole = state.root !== fam.defaultRootId
    ? h('button.btn.small', { type: 'button', onclick: () => go({ root: fam.defaultRootId, selected: null }) }, 'Whole tree') : null;
  // Visitors: the plain "Showing from" path.
  if (!store.signedIn) {
    clear(crumbs, h('span.muted', 'Showing from: '), path(chain), whole);
    addTrail(crumbs);
    return;
  }
  // Members: the line of ancestors above, then a drop-down to pick where the
  // tree starts, then how many generations are above the chosen person.
  const above = chain.length - 1;
  const first = (id) => fam.byId.get(id)?.given_name || shortName(fam.byId.get(id));
  clear(crumbs,
    h('span.muted', 'Start tree from '),
    above > 0 ? h('span.start-path', chain.slice(0, -1).map((id, i) => [i ? h('span.sep', '›') : null,
      h('button.link', { type: 'button', title: `Start the tree from ${shortName(fam.byId.get(id))}`, onclick: () => chooseStart(id) }, first(id))]),
    h('span.sep', '›')) : null,
    startPicker(fam),
    h('span.start-gen', `Gen ${fam.byId.get(state.root)?.generation ?? chain.length}`,
      above > 0 ? ` · ${above} generation${above === 1 ? '' : 's'} above` : null));
  addTrail(crumbs);
}

// The tree's "you are here" path (the generation of the person in the middle
// of the screen and their line) shares this one line, so the tree gets the
// room. The List view doesn't need it.
function addTrail(crumbs) {
  if (!tree?.trail) return;
  tree.trail.hidden = state.view !== 'tree';
  crumbs.append(tree.trail);
}

// A drop-down of everyone who has children, grouped by generation and in
// alphabetical order within each. Two people with the same name in one
// generation get their parent's name to tell them apart.
function startPicker(fam) {
  const people = [];
  const seen = new Set();
  const walk = (id, depth) => {
    if (seen.has(id)) return;
    seen.add(id);
    const kids = fam.treeChildren(id);
    if (!kids.length) return;
    const p = fam.byId.get(id);
    people.push({ p, gen: p.generation ?? depth + 1 });
    for (const c of kids) walk(c.id, depth + 1);
  };
  walk(fam.defaultRootId, 0);
  // A starting person outside the main tree (or with no children) stays listed.
  if (!people.some((x) => x.p.id === state.root)) {
    const p = fam.byId.get(state.root);
    people.push({ p, gen: p.generation ?? fam.lineage(p.id).length });
  }
  const gens = [...new Set(people.map((x) => x.gen))].sort((a, b) => a - b);
  const label = (x, list) => {
    const name = shortName(x.p);
    if (list.filter((y) => shortName(y.p) === name).length < 2) return name;
    const parent = fam.byId.get(fam.primaryParentLink(x.p.id)?.parent_id);
    return parent ? `${name} (child of ${parent.given_name})` : name;
  };
  return h('select', {
    id: 'start-from',
    'aria-label': 'Start the tree from',
    onchange: (e) => chooseStart(e.target.value),
  }, gens.map((g) => {
    const list = people.filter((x) => x.gen === g).sort((a, b) => shortName(a.p).localeCompare(shortName(b.p)));
    return h('optgroup', { label: `Generation ${g}` },
      list.map((x) => h('option', { value: x.p.id, selected: x.p.id === state.root }, label(x, list))));
  }));
}

// ---------------------------------------------------------------- search

function setupSearch() {
  const input = $('search');
  const list = $('search-results');
  let results = [];
  let active = -1;
  const close = () => {
    list.hidden = true;
    active = -1;
  };
  const show = () => {
    results = searchPeople(store.fam, input.value);
    active = -1;
    if (!input.value.trim()) return close();
    clear(list, results.length
      ? results.map((p, i) => h('li', { role: 'option', id: `sr-${i}` },
        h('button', { type: 'button', tabindex: -1, onmousedown: (e) => e.preventDefault(), onclick: () => pick(p) },
          h('strong', fullName(p)), h('span.muted', ` ${relationHint(store.fam, p.id)}`))))
      : h('li.muted.none', 'Nobody found. Try another spelling.'));
    list.hidden = false;
  };
  const pick = (p) => {
    input.value = '';
    close();
    input.blur();
    // If the person isn't under the current root, show the whole tree.
    const inView = store.fam.lineage(p.id).includes(state.root);
    go({ root: inView ? state.root : store.fam.defaultRootId, selected: p.id, view: ['tree', 'outline'].includes(state.view) ? state.view : 'tree' });
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', () => input.value && show());
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === active));
      input.setAttribute('aria-activedescendant', `sr-${active}`);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const p = results[active >= 0 ? active : 0];
      if (p) pick(p);
    } else if (e.key === 'Escape') {
      close();
    }
  });
}

// ---------------------------------------------------------------- sign in

function openSignIn() {
  if (store.preview) {
    toast('Sign-in turns on once the database is connected.');
    return;
  }
  let remembered = '';
  try { remembered = localStorage.getItem('signin-email') || ''; } catch {}
  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', placeholder: 'you@example.com', value: remembered });
  const code = h('input', { type: 'text', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '7-digit code', maxlength: 10 });
  const codeBtn = h('button.btn.primary', { type: 'button', onclick: async () => {
    if (!email.value.includes('@')) return toast('Please enter your email address first.', 'error');
    if (!/^\d{6,10}$/.test(code.value.trim())) return toast('Please type the code from the newest email.', 'error');
    codeBtn.disabled = true;
    try {
      await verifyCode(email.value, code.value);
      m.close();
      toast('You are signed in.', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
    codeBtn.disabled = false;
  } }, 'Sign in with code');
  const step2 = h('div', { hidden: true },
    h('p.form-note', 'Open the newest email from us. Either type its code here, or tap its link on this same phone or computer. Only the newest email works.'),
    field('Code from the email', code),
    h('div.form-actions', codeBtn));
  const sendBtn = h('button.btn.primary', { type: 'submit' }, 'Email me a sign-in link');
  const haveCode = h('button.link', { type: 'button', onclick: () => {
    step2.hidden = false;
    haveCode.hidden = true;
    code.focus();
  } }, 'I already have a code');
  const form = h('form.form',
    h('p.form-note', `Signing in is for invited family members. You only need to do it once on each phone or computer. `, h('a', { href: 'help.html#sign-in', target: '_blank' }, 'How it works')),
    field('Your email', email),
    h('div.form-actions', haveCode, sendBtn),
    step2);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!email.value.includes('@')) return toast('Please enter your email address.', 'error');
    sendBtn.disabled = true;
    try {
      await sendLoginLink(email.value);
      try { localStorage.setItem('signin-email', email.value.trim().toLowerCase()); } catch {}
      step2.hidden = false;
      haveCode.hidden = true;
      sendBtn.textContent = 'Send a new email';
      toast('Sign-in email sent. Use the newest one.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
    sendBtn.disabled = false;
  });
  const m = modal('Sign in', form);
  setTimeout(() => email.focus(), 50);
}

async function renderHeader() {
  const nav = $('nav');
  const signed = store.signedIn;
  let count = 0;
  if (signed) count = await pendingCount().catch(() => 0);
  clear(nav, navItems({
    root: state.root,
    count,
    onSignIn: openSignIn,
    onSignOut: async () => {
      await signOut();
      toast('Signed out.');
    },
    onViewAs: pickViewAs,
  }));
  for (const a of nav.querySelectorAll('[data-nav]')) a.classList.toggle('active', a.dataset.nav === state.view);
  $('who').textContent = store.viewAs ? `Viewing as ${store.profile?.display_name || store.profile?.email}` : signed ? `Signed in as ${store.profile?.display_name || store.session.user.email}${store.isAdmin ? ' (admin)' : store.claimedId ? ' (branch admin)' : ''}` : '';
  // Once they've claimed their box: their photo, blessings and badges instead.
  if (signed) await renderCorner($('who')).catch(() => false);
  fitHeader();
  renderViewAsBanner($('viewas-banner'), { onSwitch: pickViewAs, onExit: leaveViewAs });
  // Pop-ups are remembered per browser, so they stay off while viewing as someone.
  if (signed && !store.viewAs && !maybeShowFounderThanks() && !maybeShowBlessingsIntro()) maybeShowHistorianCongrats().catch(() => false);
  $('preview-banner').hidden = !store.preview;
  await renderClaimBanner();
}

// Admin only: look at the site as a member sees it, starting from the tree
// view they would land on after signing in.
function pickViewAs() {
  openViewAsPicker((u) => {
    toast(`Now viewing as ${u.display_name || u.email}. Nothing is saved or sent.`, 'ok');
    go({ view: 'tree', root: store.fam.defaultRootId, selected: null });
  });
}

function leaveViewAs() {
  exitViewAs();
  toast('Back to your own view.', 'ok');
  go({ view: 'tree', root: store.fam.defaultRootId, selected: null });
}

// Signed-in members who haven't claimed their own box see a reminder at the
// top of every page until they do. "Later" hides it for this visit only.
async function renderClaimBanner() {
  const box = $('claim-banner');
  const later = (() => { try { return sessionStorage.getItem('claim-later') === '1'; } catch { return false; } })();
  if (!store.signedIn || store.preview || store.claimedId || later) { box.hidden = true; return; }
  const mine = await listRequests({ status: 'pending', mine: true }).catch(() => []);
  const waiting = mine.find((r) => r.kind === 'claim_person');
  const linked = store.profile?.person_id && store.fam.byId.get(store.profile.person_id);
  const goTo = (id) => go({ view: 'tree', root: store.fam.primaryParentLink(id)?.parent_id || id, selected: id });
  const laterBtn = h('button.linkish', { type: 'button', onclick: () => {
    try { sessionStorage.setItem('claim-later', '1'); } catch { /* ignore */ }
    box.hidden = true;
  } }, 'Later');
  if (waiting) {
    const p = store.fam.byId.get(waiting.target_person_id);
    clear(box, h('span', h('strong', 'Almost there: '), `you asked to claim ${p ? fullName(p) : 'your box'}. The person who invited you, or the admin, will confirm it soon.`));
    box.className = 'banner claim-banner waiting';
  } else if (linked) {
    clear(box,
      h('span', h('strong', 'Important: claim your box. '), `Your invitation is linked to ${fullName(linked)}. Open your box and tap `, h('strong', 'This is me'), '. Then your changes to your own family appear right away.'),
      h('span.claim-actions', h('button.btn.small.primary', { type: 'button', onclick: () => goTo(linked.id) }, 'Go to my box'), laterBtn));
    box.className = 'banner claim-banner';
  } else {
    clear(box,
      h('span', h('strong', 'Important: claim your box. '), 'Search for your name, open your box and tap ', h('strong', 'This is me'), '. Not in the tree yet? Add yourself under your parent first, then claim your box.'),
      h('span.claim-actions',
        h('button.btn.small.primary', { type: 'button', onclick: () => $('search').focus() }, 'Find my name'),
        h('a.btn.small', { href: 'help.html#this-is-me' }, 'How'), laterBtn));
    box.className = 'banner claim-banner';
  }
  box.hidden = false;
}

// ---------------------------------------------------------------- start

// After tapping a sign-in link, Supabase sends people back with either a
// session or an error in the address. Read it before Supabase tidies it away.
function readSignInResult() {
  const params = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1));
  if (params.get('access_token')) return { ok: true };
  const code = params.get('error_code') || params.get('error');
  if (!code) return null;
  const desc = (params.get('error_description') || '').replace(/\+/g, ' ');
  if (code === 'otp_expired' || /expired|invalid/i.test(desc)) {
    return { error: 'That sign-in link has expired or was already used. Please ask for a new one.' };
  }
  return { error: `Sign-in did not work: ${desc || code}` };
}

async function start() {
  const signIn = readSignInResult();
  document.title = config.siteTitle;
  $('site-title').textContent = config.siteTitle;
  try {
    await init();
  } catch (e) {
    console.error(e);
    clear($('loading'), h('p', 'The family tree could not be loaded. Please check your connection and reload.'), h('p.muted.small', e.message));
    return;
  }
  // An admin who was viewing as a member in this tab carries on after a reload.
  await resumeViewAs().catch((e) => console.warn('view as', e));
  $('loading').remove();
  if (signIn?.error) toast(signIn.error, 'error');
  else if (signIn?.ok) toast(store.signedIn ? 'You are signed in.' : 'The sign-in link could not be used. Please ask for a new one.', store.signedIn ? 'ok' : 'error');
  if (location.search.includes('error')) history.replaceState(null, '', location.pathname + location.hash);
  tree = new TreeView($('tree-canvas'), {
    onSelect: selectPerson,
    onBackground: () => state.selected && go({ selected: null }),
    // The pencil on a box: open that person and their edit form straight away.
    onEdit: (id) => {
      selectPerson(id);
      const person = store.fam.byId.get(id);
      if (person) openPersonForm({ mode: 'edit', person });
    },
  });
  await tree.mount();
  $('zoom-in').onclick = () => tree.zoomBy(1.3);
  $('zoom-out').onclick = () => tree.zoomBy(1 / 1.3);
  $('zoom-fit').onclick = () => tree.fit();
  $('expand-all').onclick = () => tree.expandAll();
  $('collapse-all').onclick = () => tree.collapseAll();
  setupSearch();
  // The side panel starts just under the top bar, whose height changes when the menu wraps.
  const bar = document.querySelector('.topbar');
  if (bar && 'ResizeObserver' in window) new ResizeObserver(() => document.documentElement.style.setProperty('--panel-top', `${bar.getBoundingClientRect().bottom}px`)).observe(bar);
  window.addEventListener('hashchange', route);
  store.onChange(async () => {
    await renderHeader();
    needsRedraw = true; // redraw with new data, keeping what is open
    route();
  });
  parseHash();
  await renderHeader();
  if (!location.hash || /^#(access_token|error)/.test(location.hash)) go({ view: 'tree', root: savedStart() || store.fam.defaultRootId, selected: null }, true);
  else route();
  // "Sign in" on the Help and Ancestors pages lands here with ?signin=1.
  if (/[?&]signin=1\b/.test(location.hash)) {
    history.replaceState(null, '', location.hash.replace(/[?&]signin=1\b/, ''));
    if (!store.signedIn && !store.preview) openSignIn();
  }
  // "View as" on the Help and Ancestors pages lands here with ?viewas=1.
  if (/[?&]viewas=1\b/.test(location.hash)) {
    history.replaceState(null, '', location.hash.replace(/[?&]viewas=1\b/, ''));
    if (store.isRealAdmin) pickViewAs();
  }
  // Invitees whose invitation names their box land on it, ready to claim it.
  if (!store.viewAs) welcomeToLinkedBox((id) => go({ view: 'tree', root: store.fam.primaryParentLink(id)?.parent_id || id, selected: id }));
}

start();
