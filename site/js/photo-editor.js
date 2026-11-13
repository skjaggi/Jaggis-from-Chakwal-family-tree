// A small photo framer: drag the picture (or use the slider) so the face sits
// in the circle, then export a square JPEG. Used for new photos and for
// re-centering an existing one.
import { h } from './ui.js';

const VIEW = 260; // on-screen size of the square frame, CSS px
const OUT = 640;  // saved photo is OUT x OUT

export function photoEditor() {
  const canvas = h('canvas.photo-frame', { width: VIEW, height: VIEW, 'aria-label': 'Drag to move the photo' });
  const zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoom' });
  const el = h('div.photo-editor', { hidden: true },
    canvas,
    h('label.zoom-row', h('span', '−'), zoom, h('span', '+')),
    h('p.form-note', 'Drag the photo to move it, and use the slider to zoom, so the face sits in the circle.'));

  let img = null;
  let x = 0; // image centre, relative to frame centre, in frame px
  let y = 0;

  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = VIEW * dpr;
  canvas.height = VIEW * dpr;
  canvas.style.width = VIEW + 'px';
  canvas.style.height = VIEW + 'px';

  const scale = () => Math.max(VIEW / img.width, VIEW / img.height) * Number(zoom.value);

  function clamp() {
    const s = scale();
    const mx = Math.max(0, (img.width * s - VIEW) / 2);
    const my = Math.max(0, (img.height * s - VIEW) / 2);
    x = Math.max(-mx, Math.min(mx, x));
    y = Math.max(-my, Math.min(my, y));
  }

  function paint(ctx, size, withGuide) {
    const k = size / VIEW;
    const s = scale() * k;
    const w = img.width * s;
    const hgt = img.height * s;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, size / 2 + x * k - w / 2, size / 2 + y * k - hgt / 2, w, hgt);
    if (withGuide) {
      // Dim the corners outside the circle that the tree and panel show.
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function draw() {
    if (!img) return;
    clamp();
    paint(canvas.getContext('2d'), canvas.width, true);
  }

  zoom.addEventListener('input', draw);

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!img) return;
    drag = { px: e.clientX, py: e.clientY, x, y };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    x = drag.x + (e.clientX - drag.px);
    y = drag.y + (e.clientY - drag.py);
    draw();
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    if (!img) return;
    e.preventDefault();
    zoom.value = String(Math.max(1, Math.min(4, Number(zoom.value) * (e.deltaY < 0 ? 1.08 : 1 / 1.08))));
    draw();
  }, { passive: false });

  return {
    el,
    // source: a File/Blob, or a URL of the current photo
    async load(source) {
      const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
      img = await createImageBitmap(blob);
      x = 0;
      y = 0;
      zoom.value = '1';
      el.hidden = false;
      draw();
    },
    get loaded() { return !!img; },
    // for tests: move the picture by (dx, dy) frame px
    nudge(dx, dy) { x += dx; y += dy; draw(); },
    toBlob() {
      const out = document.createElement('canvas');
      out.width = OUT;
      out.height = OUT;
      paint(out.getContext('2d'), OUT, false);
      return new Promise((res) => out.toBlob(res, 'image/jpeg', 0.88));
    },
  };
}
