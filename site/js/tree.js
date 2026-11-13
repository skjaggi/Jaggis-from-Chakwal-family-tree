// Top-down tree drawn with d3: pan and pinch-zoom, tap a card to open the
// person, tap the round button under a card to show or hide their children.
import { store, canManage } from './data.js';
import { shortName, lifeLine } from './model.js';
import { initials } from './ui.js';
import { branchesOf } from './branches.js';
import { HoverCard } from './hovercard.js';

const D3_ESM = 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
let d3;

const W = 176; // card width
const H = 66; // card height
const GAP_X = 18;
const GAP_Y = 64;
const JOIN = 30; // gap between a person and their spouse's card
// How spouses are drawn: inside the person's card, as an equal card beside
// them, or as a smaller card beside them. For trying them out, add
// ?spouses=side, ?spouses=mini or ?spouses=inside to the address (remembered
// in this browser).
const RING = 22; // gap between a person and a spouse shown below them
const STACK_GAP = 16; // gap between cards stacked in a column
// How wide the tree spreads: 'wide' puts all children side by side; 'stack'
// puts children with nothing showing below them in a column; 'compact' also
// puts spouses below the person. Try with ?layout=wide|stack|compact.
export function layoutMode() {
  let m = new URLSearchParams(location.search).get('layout') || new URLSearchParams(location.hash.split('?')[1] || '').get('layout');
  const ok = ['wide', 'stack', 'compact'];
  try {
    if (ok.includes(m)) localStorage.setItem('layout', m);
    else m = localStorage.getItem('layout');
  } catch { /* storage blocked */ }
  return ok.includes(m) ? m : 'compact';
}
const SPOUSE = { inside: null, side: { w: W, h: H, r: 21 }, mini: { w: 156, h: 56, r: 17 } };
export function spouseMode() {
  let m = new URLSearchParams(location.search).get('spouses') || new URLSearchParams(location.hash.split('?')[1] || '').get('spouses');
  try {
    if (m && m in SPOUSE) localStorage.setItem('spouses', m);
    else m = localStorage.getItem('spouses');
  } catch { /* storage blocked */ }
  return m in SPOUSE ? m : 'mini';
}

export class TreeView {
  constructor(container, { onSelect, onEdit, onBackground }) {
    this.onBackground = onBackground;
    this.container = container;
    this.onSelect = onSelect;
    this.onEdit = onEdit;
    this.expanded = new Set();
    this.rootId = null;
    this.selectedId = null;
  }

  async mount() {
    d3 ??= await import(D3_ESM);
    this.svg = d3.select(this.container).append('svg').attr('class', 'tree-svg').attr('role', 'img')
      .attr('aria-label', 'Family tree. Use the outline view for a text version.');
    const defs = this.svg.append('defs');
    for (const r of [17, 21]) defs.append('clipPath').attr('id', `avatar-clip-${r}`).append('circle').attr('r', r);
    this.g = this.svg.append('g');
    this.hover = new HoverCard(this.container);
    this.zoom = d3.zoom().scaleExtent([0.15, 2.5])
      .on('start', () => this.hover.conceal())
      .on('zoom', (e) => this.g.attr('transform', e.transform));
    this.svg.call(this.zoom).on('dblclick.zoom', null);
    // A tap on empty space closes the person's card; a drag to pan does not.
    let down = null;
    this.svg.node().addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; }, true);
    this.svg.on('click.background', (e) => {
      const moved = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6;
      if (moved || e.target.closest('g.node, g.toggle, g.edit-btn')) return;
      this.hover.hide();
      this.onBackground?.();
    });
  }

  // Show the tree from rootId, expanding `depth` generations by default.
  setRoot(rootId, depth = 3) {
    this.rootId = rootId;
    this.expanded = new Set();
    const walk = (id, d) => {
      if (d >= depth) return;
      this.expanded.add(id);
      for (const c of store.fam.treeChildren(id)) walk(c.id, d + 1);
    };
    walk(rootId, 0);
    this.render();
    this.fit();
  }

  expandAll() {
    const walk = (id) => {
      this.expanded.add(id);
      for (const c of store.fam.treeChildren(id)) walk(c.id);
    };
    walk(this.rootId);
    this.render();
    this.fit();
  }

  collapseAll() {
    this.expanded = new Set([this.rootId]);
    this.render();
    this.fit();
  }

  // Make sure id is visible (expanding its ancestors) and centre on it.
  reveal(id) {
    let chain = store.fam.lineage(id);
    let idx = chain.indexOf(this.rootId);
    if (idx === -1 && spouseMode() !== 'inside') {
      // Someone who married in: open their partner's place in the tree.
      for (const { person: s } of store.fam.spouses(id)) {
        const c = store.fam.lineage(s.id);
        if (c.includes(this.rootId)) { chain = c; idx = c.indexOf(this.rootId); break; }
      }
    }
    if (idx === -1) return false;
    for (const a of chain.slice(idx, -1)) this.expanded.add(a);
    this.selectedId = id;
    this.render();
    this.centerOn(id);
    return true;
  }

  select(id) {
    this.selectedId = id;
    this.g?.selectAll('g.node').classed('selected', function () { return this.dataset.id === id; });
  }

  hierarchy() {
    const fam = store.fam;
    const stack = layoutMode() !== 'wide';
    const seen = new Set();
    const kidsOf = (id) => fam.treeChildren(id).filter((c) => !seen.has(c.id));
    const build = (id) => {
      seen.add(id);
      const kids = kidsOf(id);
      const node = { id, hasKids: kids.length > 0, kidCount: kids.length, children: [] };
      if (!this.expanded.has(id)) return node;
      // Children who have no children showing are stacked in a column under
      // their parent instead of side by side, which keeps the tree narrow.
      const leafy = kids.every((c) => !this.expanded.has(c.id) || fam.treeChildren(c.id).length === 0);
      if (stack && kids.length >= 2 && leafy) {
        const items = kids.map((c, i) => Object.assign(build(c.id), { stackOf: id, stackIndex: i }));
        for (let i = 0; i < items.length - 1; i++) items[i].children = [items[i + 1]];
        node.children = [items[0]];
      } else {
        node.children = kids.map((c) => build(c.id));
      }
      return node;
    };
    return d3.hierarchy(build(this.rootId));
  }

  render() {
    if (!this.g || !this.rootId) return;
    const fam = store.fam;
    const mode = spouseMode();
    const below = layoutMode() === 'compact';
    const root = this.hierarchy();
    // Each blood relative is a "unit": their own card plus, unless spouses are
    // shown inside the card, a card for each spouse beside them (or below
    // them in the compact layout).
    const S = SPOUSE[mode];
    for (const n of root.descendants()) {
      n.spouses = S ? fam.spouses(n.data.id) : [];
      const k = n.spouses.length;
      n.w = below ? W : W + k * (S?.w + JOIN || 0);
      n.h = below && k ? H + k * (S.h + RING) : H;
    }
    d3.tree().nodeSize([1, 1])
      .separation((a, b) => ((a.w + b.w) / 2 + GAP_X) * (a.parent === b.parent ? 1 : 1.12))(root);
    this.nodes = root.descendants();
    // Rows: each generation row is as tall as its tallest unit. Rows that only
    // continue a stacked column sit closer together.
    const rowH = [];
    const rowStackOnly = [];
    for (const n of this.nodes) {
      rowH[n.depth] = Math.max(rowH[n.depth] || 0, n.h);
      rowStackOnly[n.depth] = (rowStackOnly[n.depth] ?? true) && (n.data.stackIndex ?? 0) > 0;
    }
    const rowTop = [0];
    for (let dpt = 1; dpt < rowH.length; dpt++) rowTop[dpt] = rowTop[dpt - 1] + rowH[dpt - 1] + (rowStackOnly[dpt] ? STACK_GAP : GAP_Y);
    const byId = new Map();
    for (const n of this.nodes) {
      n.y = rowTop[n.depth] + H / 2;
      n.cx = n.x - n.w / 2 + W / 2;
      n.bottom = n.y - H / 2 + n.h;
      // Spouse cards and the point their shared children hang from.
      n.joins = n.spouses.map((sp, i) => below
        ? { id: sp.person.id, x: n.cx, y: n.y + H / 2 + RING / 2 + i * (S.h + RING), cx: n.cx, cy: n.y + H / 2 + RING + S.h / 2 + i * (S.h + RING) }
        : { id: sp.person.id, x: n.cx + W / 2 + i * (S.w + JOIN) + JOIN / 2, y: n.y, cx: n.cx + W / 2 + i * (S.w + JOIN) + JOIN + S.w / 2, cy: n.y });
      byId.set(n.data.id, n);
    }
    const anchor = (src, childId) => {
      if (below || !src.joins.length) return { x: src.cx, y: src.bottom };
      const other = fam.parents(childId).map((q) => q.person.id).find((pid) => pid !== src.data.id);
      return src.joins.find((j) => j.id === other) || src.joins[0];
    };
    const linkData = this.nodes.filter((n) => n.parent).map((t) => ({ source: t.data.stackOf ? byId.get(t.data.stackOf) : t.parent, target: t }));

    const links = this.g.selectAll('path.link').data(linkData, (d) => d.target.data.id);
    links.exit().remove();
    links.enter().insert('path', ':first-child').attr('class', 'link').merge(links)
      .classed('uncertain', (d) => fam.primaryParentLink(d.target.data.id)?.confidence === 'uncertain')
      .classed('nonbio', (d) => !['biological', undefined].includes(fam.primaryParentLink(d.target.data.id)?.kind))
      .attr('d', (d) => {
        const s = anchor(d.source, d.target.data.id);
        const out = d.source.bottom + 12;
        const t = d.target;
        const ty = t.y - H / 2;
        if (t.data.stackOf) {
          // A rail down the left of the column, with a branch into each card.
          const first = byId.get(t.data.stackOf).children?.[0] || t;
          const colW = Math.max(...linkData.filter((l) => l.target.data.stackOf === t.data.stackOf).map((l) => l.target.w));
          const railX = first.x - colW / 2 - 16;
          const my = out + (first.y - H / 2 - out) / 2;
          return `M${s.x},${s.y}V${my}H${railX}V${t.y}H${t.cx - W / 2}`;
        }
        const my = out + (ty - out) / 2;
        return `M${s.x},${s.y}V${my}H${t.cx}V${ty}`;
      });

    const units = this.g.selectAll('g.unit').data(this.nodes, (d) => d.data.id);
    units.exit().remove();
    const all = units.enter().append('g').attr('class', 'unit').merge(units);
    const br = branchesOf(fam);
    all.attr('transform', (d) => `translate(${d.x},${d.y})`);

    all.each((d, i, els) => {
      const u = d3.select(els[i]);
      u.selectAll('*').remove();
      const p = fam.byId.get(d.data.id);
      const off = d.cx - d.x;
      // Marriage lines between the person and each spouse.
      d.spouses.forEach((sp, k) => {
        const j = d.joins[k];
        const jx = j.x - d.x;
        const jy = j.y - d.y;
        const cls = `marriage${sp.union.status === 'divorced' ? ' divorced' : ''}`;
        if (below) u.append('path').attr('class', cls).attr('d', `M${jx},${jy - RING / 2}V${jy + RING / 2}`);
        else {
          const left = k === 0 ? off + W / 2 : jx - JOIN / 2;
          u.append('path').attr('class', cls)
            .attr('d', k === 0 ? `M${left},0H${jx + JOIN / 2}` : `M${off + W / 2 - 14},${-H / 2 - 6}H${jx}V0H${jx + JOIN / 2}`);
        }
        const ring = u.append('g').attr('class', 'ring').attr('transform', `translate(${jx},${jy})`);
        ring.append('circle').attr('cx', -3).attr('r', 4.5);
        ring.append('circle').attr('cx', 3).attr('r', 4.5);
      });
      const spouses = fam.spouses(p.id);
      const sp0 = spouses[0];
      const spText = mode === 'inside' && sp0 ? `⚭ ${shortName(sp0.person)}${sp0.union.status === 'divorced' ? ' (div.)' : ''}${spouses.length > 1 ? ` +${spouses.length - 1}` : ''}` : '';
      this.card(u, p, off, { w: W, h: H, r: 21, line2: spText, branch: br.of.get(p.id)?.slot });
      d.spouses.forEach((sp, k) => {
        const j = d.joins[k];
        this.card(u, sp.person, j.cx - d.x, { y: j.cy - d.y, w: S.w, h: S.h, r: S.r, spouse: true,
          line2: sp.union.status && sp.union.status !== 'married' ? sp.union.status : '', branch: br.of.get(sp.person.id)?.slot });
      });
      // Show or hide children: under the couple when there is one.
      const side = !below && d.joins.length;
      const tx = side ? d.joins[0].x - d.x : off;
      const tog = u.append('g').attr('class', 'toggle').attr('transform', `translate(${tx},${d.bottom - d.y + 12})`)
        .style('display', d.data.hasKids ? null : 'none')
        .attr('role', 'button')
        .attr('aria-label', this.expanded.has(p.id) ? 'Hide children' : `Show ${d.data.kidCount} children`)
        .on('click', (e) => {
          e.stopPropagation();
          if (this.expanded.has(p.id)) this.expanded.delete(p.id);
          else this.expanded.add(p.id);
          this.render();
        });
      if (side) tog.append('path').attr('class', 'stem').attr('d', `M0,${-H / 2 - 12}V-11`);
      tog.append('circle').attr('r', 11);
      tog.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em').text(this.expanded.has(p.id) ? '−' : String(d.data.kidCount));
    });
  }

  // One person's card, centred at x within its unit.
  card(u, p, x, { y = 0, w, h, r, line2, branch, spouse }) {
    const fam = store.fam;
    const el = u.append('g').attr('class', `node${spouse ? ' spouse-card' : ''}`).attr('transform', `translate(${x},${y})`)
      .attr('data-id', p.id).attr('data-branch', branch ?? null)
      .classed('female', p.gender === 'female').classed('male', p.gender === 'male')
      .classed('selected', p.id === this.selectedId)
      .attr('tabindex', 0)
      .on('click', () => {
        // A long press shows the balloon; don't also open the card.
        if (this.hover.longPressed) { this.hover.longPressed = false; return; }
        this.hover.hide();
        this.onSelect(p.id);
      })
      .on('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.onSelect(p.id);
        }
      });
    this.hover.bind(el.node(), p.id);
    el.append('rect').attr('class', 'card').attr('x', -w / 2).attr('y', -h / 2).attr('width', w).attr('height', h).attr('rx', 10);
    el.append('path').attr('class', 'card-top').attr('d', `M${-w / 2 + 1.5},${-h / 2 + 10} a8.5,8.5 0 0 1 8.5,-8.5 h${w - 20} a8.5,8.5 0 0 1 8.5,8.5`);
    const ax = -w / 2 + r + 7;
    const tx = ax + r + 7;
    const chars = Math.floor((w / 2 - tx - 6) / 7.2);
    drawAvatar(el.append('g').attr('class', 'avatar').attr('transform', `translate(${ax},0)`), p, r);
    const life = lifeLine(p, fam.details.get(p.id)) || (p.generation && !spouse ? `Generation ${p.generation}` : '');
    const name = [p.title === 'Bakhshi' ? 'Bkh.' : p.title, shortName(p)].filter(Boolean).join(' ');
    const lines = [line2, life].filter(Boolean);
    // The name wraps onto a second line when it is too long for the box.
    const avail = w / 2 - tx - 6;
    const pencil = store.signedIn && this.onEdit ? 16 : 0;
    const nameEl = el.append('text').attr('class', 'name').attr('x', tx);
    const nameLines = fitLines(nameEl, name, [avail - pencil, avail]);
    const block = (nameLines.length - 1) * 15 + (lines.length ? 17 + (lines.length - 1) * 15 : 0);
    const top = Math.round(-block / 2 + 4);
    nameEl.text(null);
    nameLines.forEach((t, i) => nameEl.append('tspan').attr('x', tx).attr('y', top + i * 15).text(t));
    const subTop = top + (nameLines.length - 1) * 15 + 17;
    lines.forEach((t, i) => el.append('text').attr('class', 'sub').attr('x', tx).attr('y', subTop + i * 15).text(clip(t, chars + 2)));
    const pl = spouse ? null : fam.primaryParentLink(p.id);
    const canEdit = store.signedIn && this.onEdit;
    el.append('text').attr('class', 'badge').attr('x', w / 2 - (canEdit ? 26 : 8)).attr('y', -h / 2 + 14).attr('text-anchor', 'end')
      .text(pl?.confidence === 'uncertain' ? '?' : pl && pl.kind !== 'biological' ? pl.kind[0].toUpperCase() : '');
    if (canEdit) {
      // A pencil on the top corner of the box opens the edit form.
      const label = `${canManage(p.id, 'person') ? 'Edit' : 'Suggest an edit to'} ${shortName(p)}`;
      const pen = el.append('g').attr('class', 'edit-btn').attr('transform', `translate(${w / 2 - 6},${-h / 2 + 4})`)
        .attr('role', 'button').attr('tabindex', 0).attr('aria-label', label)
        .on('click', (e) => {
          e.stopPropagation();
          this.onEdit(p.id);
        })
        .on('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            this.onEdit(p.id);
          }
        });
      pen.append('circle').attr('r', 13).attr('class', 'edit-hit');
      pen.append('circle').attr('r', 10);
      pen.append('path').attr('d', 'M-4.5,4.5 L-4,1.8 L2.2,-4.4 L4.4,-2.2 L-1.8,4 Z M0.8,-3 L3,-0.8');
      pen.append('title').text(label);
    }
    el.append('title').text([shortName(p), spouse ? 'Married into the family' : '', line2, pl?.confidence === 'uncertain' ? 'Parent not confirmed' : ''].filter(Boolean).join('\n'));
  }

  fit() {
    if (!this.nodes?.length) return;
    const { width, height } = this.container.getBoundingClientRect();
    const minX = Math.min(...this.nodes.map((n) => n.x - n.w / 2)) - 40;
    const maxX = Math.max(...this.nodes.map((n) => n.x + n.w / 2)) + 20;
    const minY = Math.min(...this.nodes.map((n) => n.y)) - H / 2 - 20;
    const maxY = Math.max(...this.nodes.map((n) => n.bottom)) + 40;
    let k = Math.min(width / (maxX - minX), height / (maxY - minY), 1);
    // On a phone a whole wide tree is unreadable; keep cards legible and let people pan.
    k = Math.max(k, Math.min(1, width < 600 ? 0.55 : 0.35));
    const tx = width / 2 - ((minX + maxX) / 2) * k;
    const contentFits = (maxX - minX) * k <= width;
    const x = contentFits ? tx : width / 2 - this.nodes[0].cx * k;
    const t = d3.zoomIdentity.translate(x, 24 - minY * k).scale(k);
    this.svg.transition().duration(300).call(this.zoom.transform, t);
  }

  centerOn(id) {
    const n = this.nodes?.find((d) => d.data.id === id || d.spouses.some((s) => s.person.id === id));
    if (!n) return;
    const j = n.data.id === id ? null : n.joins[n.spouses.findIndex((s) => s.person.id === id)];
    const nx = j ? j.cx : n.cx;
    const ny = j ? j.cy : n.y;
    const { width, height } = this.container.getBoundingClientRect();
    const k = Math.max(d3.zoomTransform(this.svg.node()).k, 0.8);
    // On phones the person card covers the lower half, so aim higher.
    let y = height / 3;
    if (window.matchMedia('(max-width: 760px)').matches) {
      const top = this.container.getBoundingClientRect().top;
      const sheetTop = window.innerHeight * 0.45; // the sheet is at most 55% of the screen
      y = Math.max(H / 2 + 8, Math.min(height / 3, (sheetTop - top) / 2));
    }
    const t = d3.zoomIdentity.translate(width / 2 - nx * k, y - ny * k).scale(k);
    this.svg.transition().duration(400).call(this.zoom.transform, t);
  }

  zoomBy(f) {
    this.svg.transition().duration(200).call(this.zoom.scaleBy, f);
  }
}

// Splits text into lines that fit the given widths (one per line), measuring
// the real text; the last line ends in "…" if it still doesn't fit.
function fitLines(el, text, widths) {
  const fits = (t, wd) => { el.text(t); return el.node().getComputedTextLength() <= wd; };
  if (fits(text, widths[0])) return [text];
  const words = text.split(/\s+/);
  const out = [];
  let i = 0;
  for (let li = 0; li < widths.length && i < words.length; li++) {
    const last = li === widths.length - 1;
    let line = words[i++];
    while (i < words.length && fits(`${line} ${words[i]}`, widths[li])) line += ` ${words[i++]}`;
    if (last && i < words.length) line += ` ${words.slice(i).join(' ')}`, i = words.length;
    if (!fits(line, widths[li])) {
      while (line.length > 1 && !fits(`${line}…`, widths[li])) line = line.slice(0, -1);
      line = `${line.trimEnd()}…`;
    }
    out.push(line);
  }
  return out;
}

function clip(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function drawAvatar(g, p, r = 21) {
  const url = store.photoUrls.get(p.id);
  g.append('circle').attr('r', r).attr('class', 'avatar-bg');
  if (url) {
    g.append('image').attr('href', url).attr('x', -r).attr('y', -r).attr('width', 2 * r).attr('height', 2 * r)
      .attr('clip-path', `url(#avatar-clip-${r})`).attr('preserveAspectRatio', 'xMidYMid slice');
  } else {
    g.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em').attr('class', 'avatar-initials')
      .text(initials(p.given_name));
  }
}
