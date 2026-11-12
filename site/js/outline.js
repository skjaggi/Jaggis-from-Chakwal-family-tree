// Indented list view of the tree: easier on small phones and for screen readers.
import { store } from './data.js';
import { fullName, shortName, lifeLine } from './model.js';
import { h, clear } from './ui.js';

export function renderOutline(container, rootId, { onSelect, selectedId }) {
  const fam = store.fam;
  const seen = new Set();
  const item = (id, depth) => {
    seen.add(id);
    const p = fam.byId.get(id);
    const kids = fam.treeChildren(id).filter((c) => !seen.has(c.id));
    const spouses = fam.spouses(id).map((s) => shortName(s.person) + (s.union.status === 'divorced' ? ' (divorced)' : '')).join(', ');
    const pl = fam.primaryParentLink(id);
    const life = lifeLine(p, fam.details.get(id));
    const row = h('button.outline-row' + (id === selectedId ? '.selected' : ''), { type: 'button', 'data-id': id, onclick: (e) => {
      e.preventDefault(); // open the person without folding the list
      onSelect(id);
    } },
      h('span.o-name', fullName(p)),
      pl?.confidence === 'uncertain' ? h('span.tag.warn', 'parent unconfirmed') : null,
      pl && pl.kind !== 'biological' ? h('span.tag', pl.kind) : null,
      spouses ? h('span.o-spouse', `⚭ ${spouses}`) : null,
      life ? h('span.o-life', life) : null);
    if (!kids.length) return h('li', row);
    const details = h('details', { open: depth < 2 },
      h('summary', row, h('span.o-count', `${kids.length}`)),
      h('ul', kids.map((c) => item(c.id, depth + 1))));
    return h('li', details);
  };
  clear(container, h('ul.outline', item(rootId, 0)));
  if (selectedId) {
    const el = container.querySelector(`[data-id="${selectedId}"]`);
    if (el) {
      for (let d = el.closest('details'); d; d = d.parentElement.closest('details')) d.open = true;
      el.scrollIntoView({ block: 'center' });
    }
  }
}
