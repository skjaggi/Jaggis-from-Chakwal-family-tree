// Export page: a printable family book (saved as PDF from the print dialog)
// and the GEDCOM file for genealogy programs. Both contain only what the
// person exporting is allowed to see.
import { store } from './data.js';
import { config } from './config.js';
import { fullName, lifeLine, KIND_LABEL } from './model.js';
import { h, clear, initials } from './ui.js';
import { downloadGedcom } from './gedcom.js';
import { branchesOf } from './branches.js';

function placeLine(d) {
  const parts = [];
  if (d?.birth_place) parts.push(`born in ${d.birth_place}`);
  if (d?.death_place) parts.push(`died in ${d.death_place}`);
  return parts.join(' · ');
}

// The tree as an indented chart: each person, their spouse(s), then children.
function treeChart(fam, rootId) {
  const seen = new Set();
  const node = (id) => {
    if (seen.has(id)) return null;
    seen.add(id);
    const p = fam.byId.get(id);
    const d = fam.details.get(id);
    const spouses = fam.spouses(id).map((s) => fullName(s.person)).join(', ');
    const kids = fam.children(id).filter(({ person: c }) => fam.primaryParentLink?.(c.id)?.parent_id === id || !fam.primaryParentLink);
    const br = branchesOf(fam).of.get(id);
    return h('li', { 'data-branch': br?.slot ?? null },
      h('span.bk-name', fullName(p)),
      lifeLine(p, d) ? h('span.bk-years', ` ${lifeLine(p, d)}`) : null,
      spouses ? h('span.bk-spouse', ` ⚭ ${spouses}`) : null,
      kids.length ? h('ul', kids.map(({ person: c }) => node(c.id))) : null);
  };
  return h('ul.bk-tree', node(rootId));
}

function directory(fam) {
  const people = [...fam.byId.values()].sort((a, b) => (a.generation ?? 99) - (b.generation ?? 99)
    || (a.surname || '').localeCompare(b.surname || '') || (a.given_name || '').localeCompare(b.given_name || ''));
  const byGen = new Map();
  for (const p of people) (byGen.get(p.generation ?? '?') || byGen.set(p.generation ?? '?', []).get(p.generation ?? '?')).push(p);
  return [...byGen.entries()].map(([gen, list]) => h('section.bk-gen',
    h('h3', gen === '?' ? 'Generation not known' : `Generation ${gen}`),
    h('div.bk-people', list.map((p) => {
      const d = fam.details.get(p.id);
      const photo = store.photoUrls.get(p.id);
      const parents = fam.parents(p.id).map(({ person: q, link }) => `${fullName(q)}${KIND_LABEL[link.kind] ? ` (${KIND_LABEL[link.kind]})` : ''}${link.confidence === 'uncertain' ? ' (not confirmed)' : ''}`);
      const spouses = fam.spouses(p.id).map(({ person: q, union: u }) => `${fullName(q)}${u.status && u.status !== 'married' ? ` (${u.status})` : ''}`);
      const children = fam.children(p.id).map(({ person: c }) => fullName(c, { title: false }));
      const rows = [
        ['Parents', parents.join(' and ')], ['Spouse', spouses.join(', ')], ['Children', children.join(', ')],
        ['Places', placeLine(d)], ['Profession', d?.profession], ['Notes', d?.notes], ['Uncertain', d?.uncertainty],
      ].filter(([, v]) => v);
      return h('article.bk-person',
        photo ? h('img.bk-photo', { src: photo, alt: '' }) : h('div.bk-initials', initials(p.given_name)),
        h('div',
          h('div.bk-pname', fullName(p), lifeLine(p, d) ? h('span.bk-years', `  ${lifeLine(p, d)}`) : null),
          h('dl', rows.map(([k, v]) => [h('dt', k), h('dd', v)]))));
    }))));
}

function book(fam, rootId) {
  const root = fam.byId.get(rootId);
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  return h('div.book',
    h('section.bk-cover',
      h('div.bk-mark'),
      h('h1', config.siteTitle || 'Family tree'),
      h('p.bk-sub', `The descendants of ${fullName(root)}`),
      h('p.bk-meta', `${fam.byId.size} people · printed ${today}`),
      h('p.bk-meta', store.signedIn ? 'Includes the private details the person who printed it is allowed to see. Please share with care.' : 'Public details only.')),
    h('section.bk-section', h('h2', 'The family tree'), treeChart(fam, rootId)),
    h('section.bk-section.bk-dir', h('h2', 'Everyone in the tree'), directory(fam)));
}

export function renderExport(container) {
  const fam = store.fam;
  const rootId = fam.defaultRootId;
  const preview = h('div.book-preview');
  const makePdf = () => {
    clear(preview, book(fam, rootId));
    document.body.classList.add('printing');
    // Wait for photos so they appear in the PDF.
    const imgs = [...preview.querySelectorAll('img')];
    Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))))
      .then(() => setTimeout(() => window.print(), 100));
  };
  window.addEventListener('afterprint', () => document.body.classList.remove('printing'), { once: true });
  clear(container,
    h('h1', 'Export the family tree'),
    h('div.export-choices',
      h('section.dash-card',
        h('h2', 'PDF, to print or share'),
        h('p', 'A family book: a cover page, the whole tree as an indented chart, and a page for everyone with their years, places and photo.'),
        h('p.muted.small', 'When the print window opens, choose "Save as PDF" as the printer (on iPhone: Share → Print → pinch out on the preview → Share → Save to Files).'),
        h('button.btn.primary', { type: 'button', onclick: makePdf }, 'Make the PDF')),
      h('section.dash-card',
        h('h2', 'GEDCOM (.ged), for genealogy programs'),
        h('p', 'The standard file that family history programs and sites can import, such as Ancestry, FamilySearch, MyHeritage, Gramps and RootsMagic. It is not meant to be opened directly.'),
        h('button.btn', { type: 'button', onclick: downloadGedcom }, 'Download .ged file'))),
    h('p.muted.small', store.signedIn ? 'Both include the private details you are allowed to see.' : 'Both include public details only. Family members who sign in also get the details of their branch.'),
    preview);
}
