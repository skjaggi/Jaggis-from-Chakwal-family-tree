// The top bar's menu, the same on every page: the family tree itself, the
// Help page and the Ancestors pages. `base` is the way back to the site's
// top folder ('' on the tree and Help, '../' on an Ancestors page), so every
// link works from wherever the page is. `active` names the highlighted item.
import { family } from './family.js';
import { store } from './data.js';
import { currentTheme, toggleTheme } from './theme.js';
import { h } from './ui.js';

export function navItems({ base = '', active = null, root = null, count = 0, onSignIn, onSignOut, onViewAs = null }) {
  const signed = store.signedIn;
  const r = root || store.fam?.defaultRootId || '';
  const tab = (key, href, label, extra = {}, ...more) =>
    h('a', { href, 'data-nav': key, ...(key === active ? { class: 'active', 'aria-current': 'page' } : {}), ...extra }, label, ...more);
  const badge = () => (count ? h('span.count', String(count)) : null);
  const items = {
    tree: () => tab('tree', `${base}#/tree${r ? `/${r}` : ''}`, 'Tree'),
    outline: () => tab('outline', `${base}#/outline${r ? `/${r}` : ''}`, 'List'),
    library: () => tab('library', `${base}#/library`, 'Library', { title: family.library.menuTitle }),
    help: () => tab('help', `${base}help.html`, 'Help'),
    dashboard: () => tab('dashboard', `${base}#/dashboard`, 'Dashboard'),
    ancestors: () => tab('ancestors', `${base}people/`, 'Ancestors', { title: 'Family members who have passed away, one page each' }),
    faces: () => (signed && !store.preview ? tab('faces', `${base}#/faces`, 'Faces in a group photo') : null),
    export: () => tab('export', `${base}#/export`, 'Export (PDF or GEDCOM)', { title: 'Download the tree as a PDF or a GEDCOM file' }),
    review: () => (store.isAdmin || store.claimedId || count ? tab('review', `${base}#/review`, 'Review', {}, badge()) : null),
    mine: () => (signed ? tab('mine', `${base}#/mine`, 'My changes') : null),
    blessings: () => (signed && !store.preview ? tab('blessings', `${base}#/blessings`, 'My blessings') : null),
    invite: () => (signed ? tab('invite', `${base}#/invite`, 'Invite a relative') : null),
    members: () => (store.isAdmin ? tab('members', `${base}#/members`, 'Members') : null),
    book: () => (store.isAdmin ? tab('book', `${base}#/book`, 'Book maker', { title: 'Make a printed family book from the tree' }) : null),
    ai: () => (store.isAdmin && !store.preview ? tab('ai', `${base}#/ai`, 'Ask AI', { title: 'Ask questions about the family, and search the web about ancestors (pilot)' }) : null),
    viewas: () => (onViewAs && store.isRealAdmin ? h('button.linkish.viewas-btn', { type: 'button', title: 'See the site as a family member sees it (a preview: nothing is saved)', onclick: onViewAs }, '👁 View as a member') : null),
    theme: () => themeButton(),
    signout: () => h('button.linkish', { type: 'button', onclick: onSignOut }, 'Sign out'),
  };
  const make = (keys) => keys.map((k) => items[k]()).filter(Boolean);
  const more = ['dashboard', 'ancestors', 'faces', 'export', ...(signed ? [] : ['theme'])];
  const mine = ['mine', 'blessings', 'invite', 'theme', 'signout'];
  const admin = ['members', 'book', 'ai', 'viewas'];
  const showAdmin = store.isAdmin || store.isRealAdmin;
  // Wide screens: the everyday pages, then small drop-downs.
  const wide = [
    ...make(['tree', 'outline', 'library', 'help']).map((e) => (e.classList.add('wide-nav'), e)),
    dropdown('More', make(more), active, 'wide-nav'),
    signed ? dropdown('My account', make(mine), active, 'wide-nav') : null,
    showAdmin ? dropdown('Admin', make(admin), active, 'wide-nav') : null,
  ];
  // Phones: three pages, then one big "Menu" sheet with everything else.
  const section = (title, keys) => { const list = make(keys); return list.length ? h('div.menu-section', h('div.menu-heading', title), ...list) : null; };
  const phone = [
    ...make(['tree', 'outline', 'library']).map((e) => (e.classList.add('phone-nav'), e)),
    dropdown(h('span', '☰ Menu', count ? h('span.count', String(count)) : null), [
      section('More pages', ['review', 'help', ...more]),
      signed ? section('Me', mine) : null,
      showAdmin ? section('Admin', admin) : null,
    ].filter(Boolean), active, 'phone-nav sheet'),
  ];
  return [
    ...wide.slice(0, 4),
    // Review keeps its own place on top: it is daily work and shows a count.
    (() => { const e = items.review(); if (e) e.classList.add('wide-nav'); return e; })(),
    ...wide.slice(4),
    ...phone,
    signed ? null : h('button.btn.small.primary', { type: 'button', onclick: onSignIn }, 'Sign in'),
  ].filter(Boolean);
}

// A small drop-down menu (a <details>, so it works without extra code). It
// is highlighted when the page you are on is inside it, and closes when you
// pick something or tap anywhere else.
function dropdown(label, children, active, cls = '') {
  const holds = children.some((c) => c.querySelector?.(`[data-nav="${active}"]`) || c.dataset?.nav === active);
  const d = h(`details.menu${cls ? '.' + cls.split(' ').join('.') : ''}`, {},
    h('summary', { class: holds ? 'active' : '' }, label, h('span.caret', { 'aria-hidden': 'true' }, ' ▾')),
    h('div.menu-list', ...children));
  d.addEventListener('click', (e) => { if (e.target.closest('a, button')) d.open = false; });
  return d;
}
addEventListener('click', (e) => {
  for (const d of document.querySelectorAll('details.menu[open]')) if (!d.contains(e.target)) d.open = false;
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') for (const d of document.querySelectorAll('details.menu[open]')) d.open = false;
});

// Light/dark switch in the menu. The label names the look you switch to.
export function themeButton() {
  const label = () => (currentTheme() === 'dark' ? '☀ Light' : '☾ Dark');
  const b = h('button.linkish.theme-toggle', { type: 'button', title: 'Switch between light and dark colours (remembered on this device)', onclick: () => {
    toggleTheme();
    b.textContent = label();
  } }, label());
  return b;
}

// The member's chip sits under the menu at the top right. When the menu is too
// long to share the first row with the search box, it gets a row of its own
// and the chip moves up beside the search box instead (.stacked), so the chip
// never needs a row of its own.
export function fitHeader() {
  const bar = document.querySelector('.topbar');
  const right = bar?.querySelector('.top-right');
  const who = document.getElementById('who');
  if (!right || !who) return;
  bar.classList.remove('stacked');
  if (!who.childNodes.length || getComputedStyle(right).display === 'contents') return;
  if (right.offsetTop > bar.querySelector('.brand').offsetTop + 10) bar.classList.add('stacked');
}
let fitQueued = false;
addEventListener('resize', () => {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => { fitQueued = false; fitHeader(); });
});
