// Anonymous visitor counter (GoatCounter: free, no cookies, no personal data).
// Counts only the kind of page (tree, list, an ancestor page…), never which
// living person was opened. Does nothing until config.goatcounter is set.
// Signed-in family members are not counted here: their visits are in the
// admin's "Visits by family members" report instead.
import { config } from './config.js';

let queue = [];
let loading = false;

// True when this browser holds a family member's sign-in (the site's own
// Supabase session), on the tree itself or on the Help and ancestor pages.
function signedIn() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) return true;
    }
  } catch { /* storage blocked: treat as a public visitor */ }
  return false;
}

export function countView(path, title) {
  const code = config.goatcounter;
  if (!code || /^(localhost|127\.)/.test(location.hostname) || signedIn()) return;
  queue.push({ path, title: title || document.title });
  if (window.goatcounter?.count) return flush();
  if (loading) return;
  loading = true;
  window.goatcounter = { no_onload: true };
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
  s.onload = flush;
  document.head.append(s);
}

function flush() {
  const items = queue;
  queue = [];
  for (const it of items) {
    try { window.goatcounter.count(it); } catch { /* counter blocked: fine */ }
  }
}
