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
  return [
    tab('tree', `${base}#/tree${r ? `/${r}` : ''}`, 'Tree'),
    tab('outline', `${base}#/outline${r ? `/${r}` : ''}`, 'List'),
    tab('dashboard', `${base}#/dashboard`, 'Dashboard'),
    signed ? tab('mine', `${base}#/mine`, 'My changes') : null,
    signed ? tab('invite', `${base}#/invite`, 'Invite') : null,
    signed && !store.preview ? tab('blessings', `${base}#/blessings`, 'Blessings') : null,
    store.isAdmin || store.claimedId || count ? tab('review', `${base}#/review`, 'Review', {}, count ? h('span.count', String(count)) : null) : null,
    store.isAdmin ? tab('members', `${base}#/members`, 'Members') : null,
    tab('ancestors', `${base}people/`, 'Ancestors', { title: 'Family members who have passed away, one page each' }),
    // The Library is for signed-in family members only.
    signed || store.preview ? tab('library', `${base}#/library`, 'Library', { title: family.library.menuTitle }) : null,
    signed && !store.preview ? tab('faces', `${base}#/faces`, 'Faces', { title: 'Pick out each face in a group photo and use it as that person\'s tree photo' }) : null,
    tab('help', `${base}help.html`, 'Help'),
    tab('export', `${base}#/export`, 'Export', { title: 'Download the tree as a PDF or a GEDCOM file' }),
    // Admins only while it is being tested.
    store.isAdmin ? tab('book', `${base}#/book`, 'Book', { title: 'Make a printed family book from the tree' }) : null,
    store.isAdmin && !store.preview ? tab('ai', `${base}#/ai`, 'Ask AI', { title: 'Ask questions about the family, and search the web about ancestors (pilot)' }) : null,
    // Admin only (and only on the tree pages): preview the site as a member.
    onViewAs && store.isRealAdmin ? h('button.linkish.viewas-btn', { type: 'button', title: 'See the site as a family member sees it (a preview: nothing is saved)', onclick: onViewAs }, '👁 View as') : null,
    themeButton(),
    signed
      ? h('button.linkish', { type: 'button', onclick: onSignOut }, 'Sign out')
      : h('button.btn.small.primary', { type: 'button', onclick: onSignIn }, 'Sign in'),
  ];
}

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
