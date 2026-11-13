// Family logic that does not touch the network or the page:
// indexes, names, which parent a child is drawn under, search, hierarchy.

export function buildFamily({ people, details, parentChild, unions }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const det = new Map(details.map((d) => [d.person_id, d]));
  const parentsOf = new Map();
  const childrenOf = new Map();
  const unionsOf = new Map();
  const push = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v);
  for (const l of parentChild) {
    if (!byId.has(l.parent_id) || !byId.has(l.child_id)) continue;
    push(parentsOf, l.child_id, l);
    push(childrenOf, l.parent_id, l);
  }
  for (const u of unions) {
    if (!byId.has(u.partner_a) || !byId.has(u.partner_b)) continue;
    push(unionsOf, u.partner_a, u);
    push(unionsOf, u.partner_b, u);
  }
  for (const list of unionsOf.values()) list.sort((a, b) => a.sort_order - b.sort_order);

  const fam = {
    byId,
    details: det,
    parentLinks: (id) => parentsOf.get(id) || [],
    childLinks: (id) => childrenOf.get(id) || [],
    unionsOf: (id) => unionsOf.get(id) || [],
    spouses(id) {
      return this.unionsOf(id).map((u) => ({ union: u, person: byId.get(u.partner_a === id ? u.partner_b : u.partner_a) }));
    },
    parents(id) {
      return this.parentLinks(id).map((l) => ({ link: l, person: byId.get(l.parent_id) }));
    },
    children(id) {
      return this.childLinks(id).map((l) => ({ link: l, person: byId.get(l.child_id) }))
        .sort(bySiblingOrder);
    },
    siblings(id) {
      const seen = new Set([id]);
      const out = [];
      for (const { person: par } of this.parents(id)) {
        for (const { person: c } of this.children(par.id)) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            out.push(c);
          }
        }
      }
      return out;
    },
  };

  // A person "married in" when they have no parents in the tree but a spouse
  // who does. Children are drawn under the parent who is not married in.
  const marriedIn = (id) =>
    fam.parentLinks(id).length === 0 && fam.spouses(id).some((s) => fam.parentLinks(s.person.id).length > 0);
  fam.isMarriedIn = marriedIn;

  // The parent each child is drawn under in the tree.
  const primary = new Map();
  for (const p of people) {
    const links = fam.parentLinks(p.id);
    if (!links.length) continue;
    const score = (l) =>
      (l.confidence === 'confirmed' ? 4 : 0) +
      (marriedIn(l.parent_id) ? 0 : 2) +
      (l.kind === 'biological' ? 1 : 0);
    const best = [...links].sort((a, b) => score(b) - score(a))[0];
    primary.set(p.id, best);
  }
  fam.primaryParentLink = (id) => primary.get(id) || null;
  fam.treeChildren = (id) =>
    people.filter((p) => primary.get(p.id)?.parent_id === id).sort(bySiblingOrder);

  // Default root: the founding ancestor with the most descendants.
  const countDesc = (id, seen = new Set()) => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return fam.treeChildren(id).reduce((n, c) => n + 1 + countDesc(c.id, seen), 0);
  };
  const tops = people.filter((p) => !primary.has(p.id) && !marriedIn(p.id));
  fam.defaultRootId = tops.map((p) => [p.id, countDesc(p.id)]).sort((a, b) => b[1] - a[1])[0]?.[0] || people[0]?.id;

  // The chain of ancestors (through the drawn parent) from the top down to id.
  fam.lineage = (id) => {
    const chain = [];
    const seen = new Set();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      chain.unshift(cur);
      cur = primary.get(cur)?.parent_id;
    }
    return chain;
  };

  return fam;
}

function bySiblingOrder(a, b) {
  const pa = a.person || a;
  const pb = b.person || b;
  // Keep the order people were entered in (seed order), then by name.
  return (pa._order ?? 0) - (pb._order ?? 0) || fullName(pa).localeCompare(fullName(pb));
}

export function fullName(p, { title = true } = {}) {
  if (!p) return '';
  return [title ? p.title : null, p.given_name, p.surname].filter(Boolean).join(' ');
}

export function shortName(p) {
  return [p.given_name, p.surname].filter(Boolean).join(' ');
}

// The tree shows only years for birth and death (never full dates).
// "1952-03-04" -> "1952", "about 1890" -> "c. 1890", "1930s" stays "1930s".
export function birthYear(v) {
  if (!v) return '';
  const m = String(v).match(/(c\.|ca\.?|circa|about|abt\.?|approx\.?|~)?\s*(\d{4}s?)/i);
  if (!m) return '';
  return (m[1] ? 'c. ' : '') + m[2];
}

export function lifeLine(p, d) {
  const b = birthYear(d?.birth_date);
  const dd = birthYear(d?.death_date);
  if (b || dd) return `${b || '?'} – ${dd || (p.is_living === false ? '?' : '')}`.trim();
  if (p.is_living === false) return 'Deceased';
  return '';
}

export const KIND_LABEL = { biological: '', adoptive: 'adopted', step: 'step', foster: 'foster' };
export const STATUS_LABEL = { married: 'married', divorced: 'divorced', widowed: 'widowed', separated: 'separated', partners: 'partners' };

// Spellings of Punjabi names vary (Parkash / Prakash, Avtar / Avatar).
// Compare a consonant "skeleton" as a fallback.
export function skeleton(s) {
  return s.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '').replace(/[aeiouhyw]/g, '').replace(/(.)\1+/g, '$1');
}

export function searchPeople(fam, query, limit = 12) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const sk = words.map(skeleton).filter((w) => w.length >= 2);
  const results = [];
  for (const p of fam.byId.values()) {
    const hay = [p.title, p.given_name, p.surname, p.other_names].filter(Boolean).join(' ').toLowerCase();
    let score = 0;
    if (words.every((w) => hay.includes(w))) {
      score = 10;
      if (hay.startsWith(q) || p.given_name.toLowerCase().startsWith(words[0])) score += 5;
    } else if (sk.length) {
      const hs = hay.split(/\s+/).map(skeleton);
      if (sk.every((w) => hs.some((x) => x.startsWith(w)))) score = 3;
    }
    if (score) results.push([score, p]);
  }
  return results
    .sort((a, b) => b[0] - a[0] || (a[1].generation ?? 99) - (b[1].generation ?? 99) || shortName(a[1]).localeCompare(shortName(b[1])))
    .slice(0, limit)
    .map((r) => r[1]);
}

// "son of X" / "wife of Y": a short phrase to tell people with the same name apart.
export function relationHint(fam, id) {
  const pl = fam.primaryParentLink(id);
  if (pl) {
    const p = fam.byId.get(id);
    const rel = p.gender === 'male' ? 'son' : p.gender === 'female' ? 'daughter' : 'child';
    return `${rel} of ${shortName(fam.byId.get(pl.parent_id))}${pl.confidence === 'uncertain' ? ' (?)' : ''}`;
  }
  const sp = fam.spouses(id)[0];
  if (sp) return `spouse of ${shortName(sp.person)}`;
  return '';
}

// How person `other` is related to `me`, in words ("your first cousin",
// "wife of your nephew"), or '' if no link is found. Follows all parent
// links (birth, adoptive, step), so it is a guide, not a legal record.
export function kinship(fam, me, other) {
  if (!me || !other || !fam.byId.has(me) || !fam.byId.has(other)) return '';
  if (me === other) return 'This is you';
  const g = (id, m, f, n) => { const s = fam.byId.get(id)?.gender; return s === 'male' ? m : s === 'female' ? f : n; };
  const ups = (start) => {
    const dist = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift();
      for (const { person: p } of fam.parents(id)) if (!dist.has(p.id)) { dist.set(p.id, dist.get(id) + 1); queue.push(p.id); }
    }
    return dist;
  };
  const blood = (a, b) => {
    const da = ups(a);
    const db = ups(b);
    let best = null;
    for (const [id, x] of da) if (db.has(id)) { const y = db.get(id); if (!best || x + y < best[0] + best[1]) best = [x, y]; }
    if (!best) return '';
    const [x, y] = best;
    const greats = (n) => 'great-'.repeat(Math.max(0, n));
    if (x === 0) return y === 1 ? g(b, 'son', 'daughter', 'child') : `${greats(y - 2)}grand${g(b, 'son', 'daughter', 'child')}`;
    if (y === 0) return x === 1 ? g(b, 'father', 'mother', 'parent') : `${greats(x - 2)}grand${g(b, 'father', 'mother', 'parent')}`;
    if (x === 1 && y === 1) return g(b, 'brother', 'sister', 'sibling');
    if (x === 1) return `${y > 2 ? `${greats(y - 3)}grand-` : ''}${g(b, 'nephew', 'niece', 'nephew or niece')}`;
    if (y === 1) return `${x > 2 ? `${greats(x - 3)}grand-` : ''}${g(b, 'uncle', 'aunt', 'uncle or aunt')}`;
    const degree = Math.min(x, y) - 1;
    const removed = Math.abs(x - y);
    const ord = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][degree - 1] || `${degree}th`;
    return `${ord} cousin${removed ? ` ${removed === 1 ? 'once' : removed === 2 ? 'twice' : `${removed} times`} removed` : ''}`;
  };
  const direct = blood(me, other);
  if (direct) return `Your ${direct}`;
  for (const { person: s } of fam.spouses(me)) {
    if (s.id === other) return `Your ${g(other, 'husband', 'wife', 'spouse')}`;
  }
  for (const { person: s } of fam.spouses(other)) {
    const r = blood(me, s.id);
    if (r) return `${g(other, 'Husband', 'Wife', 'Spouse')} of your ${r}`;
  }
  for (const { person: s } of fam.spouses(me)) {
    const r = blood(s.id, other);
    if (r) return `Your ${g(s.id, 'husband', 'wife', 'spouse')}'s ${r}`;
  }
  return '';
}
