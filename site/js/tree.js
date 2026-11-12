// Top-down tree drawn with d3: pan and pinch-zoom, tap a card to open the
// person, tap the round button under a card to show or hide their children.
import { store } from './data.js';
import { shortName, lifeLine } from './model.js';
import { initials } from './ui.js';

const D3_ESM = 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
let d3;

const W = 176; // card width
const H = 66; // card height
const GAP_X = 18;
const GAP_Y = 64;

export class TreeView {
  constructor(container, { onSelect }) {
    this.container = container;
    this.onSelect = onSelect;
    this.expanded = new Set();
    this.rootId = null;
    this.selectedId = null;
  }

  async mount() {
    d3 ??= await import(D3_ESM);
    this.svg = d3.select(this.container).append('svg').attr('class', 'tree-svg').attr('role', 'img')
      .attr('aria-label', 'Family tree. Use the outline view for a text version.');
    const defs = this.svg.append('defs');
    defs.append('clipPath').attr('id', 'avatar-clip').append('circle').attr('r', 21).attr('cx', 0).attr('cy', 0);
    this.g = this.svg.append('g');
    this.zoom = d3.zoom().scaleExtent([0.15, 2.5]).on('zoom', (e) => this.g.attr('transform', e.transform));
    this.svg.call(this.zoom).on('dblclick.zoom', null);
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
    const chain = store.fam.lineage(id);
    const idx = chain.indexOf(this.rootId);
    if (idx === -1) return false;
    for (const a of chain.slice(idx, -1)) this.expanded.add(a);
    this.selectedId = id;
    this.render();
    this.centerOn(id);
    return true;
  }

  select(id) {
    this.selectedId = id;
    this.g?.selectAll('g.node').classed('selected', (d) => d.data.id === id);
  }

  hierarchy() {
    const fam = store.fam;
    const seen = new Set();
    const build = (id) => {
      seen.add(id);
      const kids = fam.treeChildren(id).filter((c) => !seen.has(c.id));
      return {
        id,
        hasKids: kids.length > 0,
        kidCount: kids.length,
        children: this.expanded.has(id) ? kids.map((c) => build(c.id)) : [],
      };
    };
    return d3.hierarchy(build(this.rootId));
  }

  render() {
    if (!this.g || !this.rootId) return;
    const fam = store.fam;
    const root = this.hierarchy();
    d3.tree().nodeSize([W + GAP_X, H + GAP_Y]).separation((a, b) => (a.parent === b.parent ? 1 : 1.15))(root);
    this.nodes = root.descendants();

    const links = this.g.selectAll('path.link').data(root.links(), (d) => d.target.data.id);
    links.exit().remove();
    links.enter().append('path').attr('class', 'link').merge(links)
      .classed('uncertain', (d) => fam.primaryParentLink(d.target.data.id)?.confidence === 'uncertain')
      .classed('nonbio', (d) => !['biological', undefined].includes(fam.primaryParentLink(d.target.data.id)?.kind))
      .attr('d', (d) => {
        const sx = d.source.x;
        const sy = d.source.y + H / 2 + 12;
        const tx = d.target.x;
        const ty = d.target.y - H / 2;
        const my = (sy + ty) / 2;
        return `M${sx},${sy}V${my}H${tx}V${ty}`;
      });

    const nodes = this.g.selectAll('g.node').data(this.nodes, (d) => d.data.id);
    nodes.exit().remove();
    const enter = nodes.enter().append('g').attr('class', 'node');
    enter.append('rect').attr('class', 'card').attr('x', -W / 2).attr('y', -H / 2).attr('width', W).attr('height', H).attr('rx', 10);
    enter.append('g').attr('class', 'avatar').attr('transform', `translate(${-W / 2 + 28},0)`);
    enter.append('text').attr('class', 'name').attr('x', -W / 2 + 56).attr('y', -12);
    enter.append('text').attr('class', 'sub spouse').attr('x', -W / 2 + 56).attr('y', 6);
    enter.append('text').attr('class', 'sub life').attr('x', -W / 2 + 56).attr('y', 22);
    enter.append('text').attr('class', 'badge').attr('x', W / 2 - 8).attr('y', -H / 2 + 14).attr('text-anchor', 'end');
    const tog = enter.append('g').attr('class', 'toggle').attr('transform', `translate(0,${H / 2 + 12})`);
    tog.append('circle').attr('r', 11);
    tog.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em');
    enter.append('title');

    const all = enter.merge(nodes);
    all.attr('transform', (d) => `translate(${d.x},${d.y})`)
      .classed('selected', (d) => d.data.id === this.selectedId)
      .attr('tabindex', 0)
      .on('click', (e, d) => {
        if (e.target.closest('.toggle')) return;
        this.onSelect(d.data.id);
      })
      .on('keydown', (e, d) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.onSelect(d.data.id);
        }
      });

    all.each((d, i, els) => {
      const p = fam.byId.get(d.data.id);
      const el = d3.select(els[i]);
      el.classed('female', p.gender === 'female').classed('male', p.gender === 'male');
      const spouses = fam.spouses(p.id);
      const sp = spouses[0];
      const spText = sp ? `⚭ ${shortName(sp.person)}${sp.union.status === 'divorced' ? ' (div.)' : ''}${spouses.length > 1 ? ` +${spouses.length - 1}` : ''}` : '';
      el.select('text.name').text(clip([p.title === 'Bakhshi' ? 'Bkh.' : p.title, shortName(p)].filter(Boolean).join(' '), 17));
      el.select('text.spouse').text(clip(spText, 19));
      const life = lifeLine(p, fam.details.get(p.id));
      el.select('text.life').text(clip(life || (p.generation ? `Generation ${p.generation}` : ''), 20));
      const pl = fam.primaryParentLink(p.id);
      el.select('text.badge').text(pl?.confidence === 'uncertain' ? '?' : pl && pl.kind !== 'biological' ? pl.kind[0].toUpperCase() : '');
      el.select('title').text([shortName(p), spText, pl?.confidence === 'uncertain' ? 'Parent not confirmed' : ''].filter(Boolean).join('\n'));
      drawAvatar(el.select('g.avatar'), p);
      el.select('g.toggle')
        .style('display', d.data.hasKids ? null : 'none')
        .attr('role', 'button')
        .attr('aria-label', this.expanded.has(p.id) ? 'Hide children' : `Show ${d.data.kidCount} children`)
        .on('click', (e) => {
          e.stopPropagation();
          if (this.expanded.has(p.id)) this.expanded.delete(p.id);
          else this.expanded.add(p.id);
          this.render();
        });
      el.select('g.toggle text').text(this.expanded.has(p.id) ? '−' : String(d.data.kidCount));
    });
  }

  fit() {
    if (!this.nodes?.length) return;
    const { width, height } = this.container.getBoundingClientRect();
    const xs = this.nodes.map((n) => n.x);
    const ys = this.nodes.map((n) => n.y);
    const minX = Math.min(...xs) - W / 2 - 20;
    const maxX = Math.max(...xs) + W / 2 + 20;
    const minY = Math.min(...ys) - H / 2 - 20;
    const maxY = Math.max(...ys) + H / 2 + 40;
    let k = Math.min(width / (maxX - minX), height / (maxY - minY), 1);
    // On a phone a whole wide tree is unreadable; keep cards legible and let people pan.
    k = Math.max(k, Math.min(1, width < 600 ? 0.55 : 0.35));
    const tx = width / 2 - ((minX + maxX) / 2) * k;
    const contentFits = (maxX - minX) * k <= width;
    const x = contentFits ? tx : width / 2 - this.nodes[0].x * k;
    const t = d3.zoomIdentity.translate(x, 24 - minY * k).scale(k);
    this.svg.transition().duration(300).call(this.zoom.transform, t);
  }

  centerOn(id) {
    const n = this.nodes?.find((d) => d.data.id === id);
    if (!n) return;
    const { width, height } = this.container.getBoundingClientRect();
    const k = Math.max(d3.zoomTransform(this.svg.node()).k, 0.8);
    // On phones the person card covers the lower half, so aim higher.
    let y = height / 3;
    if (window.matchMedia('(max-width: 760px)').matches) {
      const top = this.container.getBoundingClientRect().top;
      const sheetTop = window.innerHeight * 0.45; // the sheet is at most 55% of the screen
      y = Math.max(H / 2 + 8, Math.min(height / 3, (sheetTop - top) / 2));
    }
    const t = d3.zoomIdentity.translate(width / 2 - n.x * k, y - n.y * k).scale(k);
    this.svg.transition().duration(400).call(this.zoom.transform, t);
  }

  zoomBy(f) {
    this.svg.transition().duration(200).call(this.zoom.scaleBy, f);
  }
}

function clip(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function drawAvatar(g, p) {
  g.selectAll('*').remove();
  const url = store.photoUrls.get(p.id);
  g.append('circle').attr('r', 21).attr('class', 'avatar-bg');
  if (url) {
    g.append('image').attr('href', url).attr('x', -21).attr('y', -21).attr('width', 42).attr('height', 42)
      .attr('clip-path', 'url(#avatar-clip)').attr('preserveAspectRatio', 'xMidYMid slice');
  } else {
    g.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em').attr('class', 'avatar-initials')
      .text(initials(p.given_name));
  }
}
