// App start-up, routing and the header.
import { store, init, sendLoginLink, verifyCode, signOut, pendingCount } from './data.js';
import { config } from './config.js';
import { fullName, shortName, searchPeople, relationHint } from './model.js';
import { h, clear, toast, modal, field } from './ui.js';
import { TreeView } from './tree.js';
import { renderOutline } from './outline.js';
import { renderPanel } from './panel.js';
import { renderReview, renderMine, renderAdmin } from './admin.js';
import { renderInvite } from './invite.js';
import { renderDashboard } from './dashboard.js';
import { downloadGedcom } from './gedcom.js';

const $ = (id) => document.getElementById(id);
const state = { view: 'tree', root: null, selected: null };
let tree;

// Routes: #/tree/<rootId>, #/outline/<rootId>, #/review, #/mine, #/members, #/invite; ?p=<personId>
function parseHash() {
  let raw = location.hash.replace(/^#\/?/, '');
  if (/^(access_token|error|type)=/.test(raw)) raw = ''; // sign-in redirect, handled by Supabase
  const [path, query = ''] = raw.split('?');
  const [view, root] = path.split('/');
  state.view = ['tree', 'outline', 'review', 'mine', 'members', 'invite', 'dashboard'].includes(view) ? view : 'tree';
  state.root = root && store.fam.byId.has(root) ? root : store.fam.defaultRootId;
  const p = new URLSearchParams(query).get('p');
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
async function route() {
  parseHash();
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
    if (!store.signedIn) {
      clear(page, h('h1', 'Please sign in'), h('p', 'This page is for family members.'), h('button.btn.primary', { type: 'button', onclick: openSignIn }, 'Sign in'));
      return;
    }
    if (state.view === 'review') return store.isAdmin ? renderReview(page) : clear(page, h('p', 'Only the admin can review changes.'));
    if (state.view === 'members') return store.isAdmin ? renderAdmin(page) : clear(page, h('p', 'Only the admin can manage members.'));
    if (state.view === 'mine') return renderMine(page);
    if (state.view === 'invite') return renderInvite(page);
    return;
  }

  renderBreadcrumbs();
  $('tree-canvas').hidden = state.view !== 'tree';
  $('outline').hidden = state.view !== 'outline';
  $('tree-tools').hidden = state.view !== 'tree';
  if (state.view === 'tree') {
    if (tree.rootId !== state.root) tree.setRoot(state.root);
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
    onRoot: (id) => go({ root: id, selected: id }),
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
  const parts = chain.map((id, i) => {
    const p = fam.byId.get(id);
    const last = i === chain.length - 1;
    return [i ? h('span.sep', '›') : null,
      last ? h('strong', shortName(p)) : h('button.link', { type: 'button', onclick: () => go({ root: id }) }, shortName(p))];
  });
  clear(crumbs,
    h('span.muted', 'Showing from: '), parts,
    state.root !== fam.defaultRootId ? h('button.btn.small', { type: 'button', onclick: () => go({ root: fam.defaultRootId }) }, 'Whole tree') : null);
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
  const code = h('input', { type: 'text', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '6-digit code', maxlength: 10 });
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
  if (store.isAdmin) count = await pendingCount().catch(() => 0);
  clear(nav,
    h('a', { href: `#/tree/${state.root || store.fam.defaultRootId}`, 'data-nav': 'tree' }, 'Tree'),
    h('a', { href: `#/outline/${state.root || store.fam.defaultRootId}`, 'data-nav': 'outline' }, 'List'),
    h('a', { href: '#/dashboard', 'data-nav': 'dashboard' }, 'Dashboard'),
    signed ? h('a', { href: '#/mine', 'data-nav': 'mine' }, 'My changes') : null,
    signed ? h('a', { href: '#/invite', 'data-nav': 'invite' }, 'Invite') : null,
    store.isAdmin ? h('a', { href: '#/review', 'data-nav': 'review' }, 'Review', count ? h('span.count', String(count)) : null) : null,
    store.isAdmin ? h('a', { href: '#/members', 'data-nav': 'members' }, 'Members') : null,
    h('a', { href: 'help.html' }, 'Help'),
    h('button.linkish.wide-only', { type: 'button', onclick: downloadGedcom, title: 'Download the tree as a GEDCOM file' }, 'Export'),
    signed
      ? h('button.linkish', { type: 'button', onclick: async () => {
        await signOut();
        toast('Signed out.');
      } }, 'Sign out')
      : h('button.btn.small.primary', { type: 'button', onclick: openSignIn }, 'Sign in'));
  for (const a of nav.querySelectorAll('[data-nav]')) a.classList.toggle('active', a.dataset.nav === state.view);
  $('who').textContent = signed ? `Signed in as ${store.profile?.display_name || store.session.user.email}${store.isAdmin ? ' (admin)' : ''}` : '';
  $('preview-banner').hidden = !store.preview;
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
  $('loading').remove();
  if (signIn?.error) toast(signIn.error, 'error');
  else if (signIn?.ok) toast(store.signedIn ? 'You are signed in.' : 'The sign-in link could not be used. Please ask for a new one.', store.signedIn ? 'ok' : 'error');
  if (location.search.includes('error')) history.replaceState(null, '', location.pathname + location.hash);
  tree = new TreeView($('tree-canvas'), { onSelect: selectPerson });
  await tree.mount();
  $('zoom-in').onclick = () => tree.zoomBy(1.3);
  $('zoom-out').onclick = () => tree.zoomBy(1 / 1.3);
  $('zoom-fit').onclick = () => tree.fit();
  $('expand-all').onclick = () => tree.expandAll();
  $('collapse-all').onclick = () => tree.collapseAll();
  setupSearch();
  window.addEventListener('hashchange', route);
  store.onChange(async () => {
    await renderHeader();
    needsRedraw = true; // redraw with new data, keeping what is open
    route();
  });
  parseHash();
  await renderHeader();
  if (!location.hash || /^#(access_token|error)/.test(location.hash)) go({ view: 'tree', root: store.fam.defaultRootId, selected: null }, true);
  else route();
}

start();
