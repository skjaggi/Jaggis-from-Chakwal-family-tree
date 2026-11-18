// The top bar on pages outside the family tree itself (Help and the
// Ancestors pages), so it matches the tree exactly: search, the full menu for
// whoever is signed in (admin items for the admin only), the light/dark
// switch, Sign in or Sign out, and the member's chip with blessings and badges.
//
// The page's own HTML already holds the visitors' menu, so search engines and
// browsers without JavaScript still get working links. Visitors who have never
// signed in don't download the family data unless they use the search box.
import { store, init, signOut, pendingCount } from './data.js';
import { searchPeople, fullName, relationHint } from './model.js';
import { h, clear, toast } from './ui.js';
import { navItems, fitHeader } from './header.js';
import { renderCorner } from './blessings.js';

const $ = (id) => document.getElementById(id);
// The site's top folder, wherever this page is (help.html or people/…).
const base = new URL('../', import.meta.url).href;
const active = document.body.dataset.page || null;
let loading = null;

function hasSavedSignIn() {
  try { return Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)); } catch { return false; }
}

function load() {
  loading ||= init().then(() => {
    store.onChange(render);
    return render();
  }).catch((e) => console.warn('header', e));
  return loading;
}

async function render() {
  const signed = store.signedIn;
  const count = signed ? await pendingCount().catch(() => 0) : 0;
  clear($('nav'), navItems({
    base,
    active,
    count,
    onSignIn: () => { location.href = `${base}#/tree?signin=1`; },
    onSignOut: async () => {
      await signOut();
      toast('Signed out.');
    },
  }));
  const who = $('who');
  who.textContent = signed ? `Signed in as ${store.profile?.display_name || store.session.user.email}${store.isAdmin ? ' (admin)' : store.claimedId ? ' (branch admin)' : ''}` : '';
  if (signed) await renderCorner(who, base).catch(() => false);
  fitHeader();
}

function setupSearch() {
  const input = $('search');
  const list = $('search-results');
  if (!input || !list) return;
  let results = [];
  let active = -1;
  const close = () => { list.hidden = true; active = -1; };
  const show = async () => {
    if (!input.value.trim()) return close();
    if (!store.fam) {
      clear(list, h('li.muted.none', 'Loading the family…'));
      list.hidden = false;
      await load();
      if (!store.fam) return clear(list, h('li.muted.none', 'The family could not be loaded. Please try again.'));
    }
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
  const pick = (p) => { location.href = `${base}#/tree/${store.fam.defaultRootId}?p=${p.id}`; };
  input.addEventListener('input', show);
  input.addEventListener('focus', () => { load(); if (input.value) show(); });
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
      input.value = '';
      close();
    }
  });
}

render();
setupSearch();
if (hasSavedSignIn()) load();
