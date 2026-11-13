// The family's branches: everyone descended from each generation-4 ancestor,
// plus their spouses (the same level the privacy rules use). Each of the eight
// largest branches gets a colour (CSS --branch-1 … --branch-8), used on the
// tree cards and in the dashboard; smaller branches share a neutral colour.
export const BRANCH_GEN = 4;
const COLOURS = 8;

export function branchesOf(fam) {
  if (fam._branches) return fam._branches;
  const people = [...fam.byId.values()];
  const list = [];
  for (const a of people.filter((p) => p.generation === BRANCH_GEN && !fam.isMarriedIn(p.id))) {
    const members = new Set();
    const walk = (id) => {
      if (members.has(id)) return;
      members.add(id);
      for (const s of fam.spouses(id)) members.add(s.person.id);
      for (const c of fam.childLinks(id)) walk(c.child_id);
    };
    walk(a.id);
    list.push({ person: a, members });
  }
  list.sort((x, y) => y.members.size - x.members.size || (x.person.birth_order ?? 0) - (y.person.birth_order ?? 0));
  const of = new Map();
  list.forEach((b, i) => {
    b.slot = i < COLOURS ? i + 1 : 0;
    b.count = b.members.size;
    for (const id of b.members) if (!of.has(id)) of.set(id, b);
  });
  fam._branches = { list, of, earlier: people.filter((p) => !of.has(p.id)).length };
  return fam._branches;
}
