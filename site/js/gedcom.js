// GEDCOM 5.5.1 export: the standard file that other genealogy programs import.
// Exports what the current viewer is allowed to see.
import { store } from './data.js';
import { config } from './config.js';

export function buildGedcom() {
  const fam = store.fam;
  const lines = [];
  const L = (level, tag, value) => {
    const v = value === undefined || value === null ? '' : String(value).replace(/\r?\n/g, ' ');
    lines.push(`${level} ${tag}${v ? ' ' + v : ''}`);
  };
  const note = (level, tag, text) => {
    const parts = String(text).split(/\r?\n/);
    L(level, tag, parts[0]);
    for (const more of parts.slice(1)) L(level + 1, 'CONT', more);
  };
  const today = new Date();
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  L(0, 'HEAD');
  L(1, 'SOUR', 'JAGGI_FAMILY_TREE');
  L(2, 'NAME', config.siteTitle);
  L(1, 'DATE', `${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`);
  L(1, 'GEDC');
  L(2, 'VERS', '5.5.1');
  L(2, 'FORM', 'LINEAGE-LINKED');
  L(1, 'CHAR', 'UTF-8');

  const indi = new Map();
  let n = 0;
  for (const p of fam.byId.values()) indi.set(p.id, `@I${++n}@`);

  // Families: one per union, plus one per parent (or parent pair) with children
  // but no recorded union.
  const fams = [];
  const famKey = new Map();
  const addFam = (a, b, union) => {
    const key = [a, b].filter(Boolean).sort().join('+');
    if (famKey.has(key)) return famKey.get(key);
    const f = { id: `@F${fams.length + 1}@`, a, b, union, children: [] };
    fams.push(f);
    famKey.set(key, f);
    return f;
  };
  for (const p of fam.byId.values()) for (const u of fam.unionsOf(p.id)) addFam(u.partner_a, u.partner_b, u);
  for (const c of fam.byId.values()) {
    const links = fam.parentLinks(c.id);
    if (!links.length) continue;
    const confirmed = links.filter((l) => l.confidence === 'confirmed');
    const use = confirmed.length ? confirmed : [fam.primaryParentLink(c.id)];
    const ids = [...new Set(use.map((l) => l.parent_id))].slice(0, 2);
    const f = addFam(ids[0], ids[1], null);
    f.children.push({ id: c.id, link: use[0] });
  }

  const famsOf = new Map();
  const famcOf = new Map();
  for (const f of fams) {
    for (const x of [f.a, f.b].filter(Boolean)) (famsOf.get(x) || famsOf.set(x, []).get(x)).push(f.id);
    for (const c of f.children) famcOf.set(c.id, { fam: f.id, link: c.link });
  }

  for (const p of fam.byId.values()) {
    const d = fam.details.get(p.id);
    L(0, indi.get(p.id), 'INDI');
    L(1, 'NAME', `${p.given_name} /${p.surname || ''}/`);
    if (p.title) L(2, 'NPFX', p.title);
    L(2, 'GIVN', p.given_name);
    if (p.surname) L(2, 'SURN', p.surname);
    if (p.other_names) note(1, 'NOTE', `Other names: ${p.other_names}`);
    L(1, 'SEX', p.gender === 'male' ? 'M' : p.gender === 'female' ? 'F' : 'U');
    if (d?.birth_date || d?.birth_place) {
      L(1, 'BIRT');
      if (d.birth_date) L(2, 'DATE', d.birth_date);
      if (d.birth_place) L(2, 'PLAC', d.birth_place);
    }
    if (p.is_living === false || d?.death_date || d?.death_place) {
      L(1, 'DEAT', d?.death_date || d?.death_place ? '' : 'Y');
      if (d?.death_date) L(2, 'DATE', d.death_date);
      if (d?.death_place) L(2, 'PLAC', d.death_place);
    }
    if (d?.profession) L(1, 'OCCU', d.profession);
    if (d?.notes) note(1, 'NOTE', d.notes);
    if (d?.uncertainty) note(1, 'NOTE', `Uncertain: ${d.uncertainty}`);
    if (d?.sources) note(1, 'SOUR', d.sources);
    const fc = famcOf.get(p.id);
    if (fc) {
      L(1, 'FAMC', fc.fam);
      if (fc.link && fc.link.kind !== 'biological') L(2, 'PEDI', { adoptive: 'adopted', foster: 'foster', step: 'step' }[fc.link.kind] || 'birth');
      if (fc.link?.confidence === 'uncertain') note(2, 'NOTE', fc.link.note || 'Parent not confirmed');
    }
    for (const f of famsOf.get(p.id) || []) L(1, 'FAMS', f);
  }

  for (const f of fams) {
    L(0, f.id, 'FAM');
    const [a, b] = [f.a, f.b].map((x) => x && fam.byId.get(x));
    // GEDCOM 5.5.1 has HUSB / WIFE slots; fall back to order when gender is unknown.
    const husb = [a, b].find((x) => x?.gender === 'male') || (a?.gender !== 'female' ? a : b);
    const wife = [a, b].find((x) => x && x !== husb);
    if (husb) L(1, 'HUSB', indi.get(husb.id));
    if (wife) L(1, 'WIFE', indi.get(wife.id));
    if (f.union) {
      L(1, 'MARR', f.union.start_date ? '' : 'Y');
      if (f.union.start_date) L(2, 'DATE', f.union.start_date);
      if (f.union.status === 'divorced') {
        L(1, 'DIV', f.union.end_date ? '' : 'Y');
        if (f.union.end_date) L(2, 'DATE', f.union.end_date);
      }
    }
    for (const c of f.children) L(1, 'CHIL', indi.get(c.id));
  }
  L(0, 'TRLR');
  return lines.join('\r\n') + '\r\n';
}

export function downloadGedcom() {
  const blob = new Blob([buildGedcom()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jaggi-family-tree-${new Date().toISOString().slice(0, 10)}.ged`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
