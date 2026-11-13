// Anonymous visitor counter (GoatCounter: free, no cookies, no personal data).
// Counts only the kind of page (tree, list, an ancestor page…), never which
// living person was opened. Does nothing until config.goatcounter is set.
import { config } from './config.js';

let queue = [];
let loading = false;

export function countView(path, title) {
  const code = config.goatcounter;
  if (!code || /^(localhost|127\.)/.test(location.hostname)) return;
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
