// A small balloon with key facts about a person, shown when the pointer rests
// on a box in the tree (or on a long press on a phone). It only uses what the
// viewer is already allowed to see.
import { store } from './data.js';
import { fullName, birthYear, kinship } from './model.js';
import { h, clear, initials } from './ui.js';
import { branchesOf } from './branches.js';

const yearNum = (v) => { const m = String(v || '').match(/\d{4}/); return m ? Number(m[0]) : null; };

export function lifeSummary(p, d) {
  const b = birthYear(d?.birth_date);
  const dd = birthYear(d?.death_date);
  const by = yearNum(d?.birth_date);
  const dy = yearNum(d?.death_date);
  const approx = /c\./.test(b + dd) ? 'about ' : '';
  if (p.is_living === false || dd) {
    const age = by && dy ? ` (aged ${approx}${dy - by})` : '';
    return b || dd ? `${b || '?'} – ${dd || '?'}${age}` : 'Deceased';
  }
  if (b) return `Born ${b}${by ? `, age ${approx}${new Date().getFullYear() - by}` : ''}`;
  return '';
}

export function hoverContent(id) {
  const fam = store.fam;
  const p = fam.byId.get(id);
  const d = fam.details.get(id);
  const photo = store.photoUrls.get(id);
  const spouses = fam.spouses(id).map(({ person: s, union: u }) => `${fullName(s, { title: false })}${u.status && u.status !== 'married' ? ` (${u.status})` : ''}`);
  const kids = fam.children(id).length;
  const br = branchesOf(fam).of.get(id);
  const me = store.claimedId || store.profile?.person_id;
  const rel = store.signedIn && me ? kinship(fam, me, id) : '';
  const facts = [
    ['Born in', d?.birth_place],
    ['Died in', d?.death_place],
    ['Work', d?.profession],
    ['Married to', spouses.join(', ')],
    ['Children', kids ? String(kids) : ''],
  ].filter(([, v]) => v);
  return h('div.hc-inner',
    h('div.hc-photo', photo ? h('img', { src: photo, alt: '' }) : h('span', initials(p.given_name))),
    h('div.hc-text',
      rel ? h('div.hc-rel', rel)
        : store.signedIn && !store.preview && !store.claimedId ? h('div.hc-hint', 'Tap This is me on your own box to see how you are related.') : null,
      h('div.hc-name', fullName(p)),
      p.other_names ? h('div.hc-muted', `Also known as ${p.other_names}`) : null,
      lifeSummary(p, d) ? h('div.hc-life', lifeSummary(p, d)) : null,
      facts.length ? h('dl.hc-facts', facts.map(([k, v]) => [h('dt', k), h('dd', v)])) : null,
      h('div.hc-tags',
        br ? h('span.hc-branch', { 'data-branch': br.slot }, `${fullName(br.person, { title: false })}'s branch`) : null,
        p.generation ? h('span.hc-gen', `Generation ${p.generation}`) : null)));
}

// Attaches hover and long-press behaviour to the tree's boxes.
export class HoverCard {
  constructor(container) {
    this.container = container;
    this.el = h('div.hovercard', { hidden: true, role: 'tooltip' });
    container.appendChild(this.el);
    this.timer = null;
    this.longPressed = false;
  }

  show(id, target) {
    clear(this.el, hoverContent(id));
    this.el.hidden = false;
    const box = target.getBoundingClientRect();
    const host = this.container.getBoundingClientRect();
    const cw = this.el.offsetWidth;
    const ch = this.el.offsetHeight;
    let left = box.left - host.left + box.width / 2 - cw / 2;
    left = Math.max(8, Math.min(left, host.width - cw - 8));
    let top = box.top - host.top - ch - 10;
    if (top < 8) top = box.bottom - host.top + 10; // no room above: show below
    this.el.style.left = `${left}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
  }

  hide() {
    clearTimeout(this.timer);
    this.el.hidden = true;
  }

  // Panning or zooming hides the balloon but leaves a press in progress alone.
  conceal() {
    this.el.hidden = true;
  }

  bind(node, id) {
    node.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.show(id, node), 350);
    });
    node.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.hide();
    });
    // Phones: press and hold to see the balloon; a normal tap still opens the card.
    node.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this.longPressed = false;
      clearTimeout(this.timer);
      const x = e.clientX;
      const y = e.clientY;
      const cancel = (ev) => { if (Math.hypot(ev.clientX - x, ev.clientY - y) > 8) clearTimeout(this.timer); };
      node.addEventListener('pointermove', cancel);
      this.timer = setTimeout(() => {
        this.longPressed = true;
        this.show(id, node);
      }, 500);
      const up = () => {
        clearTimeout(this.timer);
        node.removeEventListener('pointermove', cancel);
      };
      node.addEventListener('pointerup', up, { once: true });
      node.addEventListener('pointercancel', up, { once: true });
    });
    node.addEventListener('contextmenu', (e) => { if (this.longPressed) e.preventDefault(); });
  }
}
