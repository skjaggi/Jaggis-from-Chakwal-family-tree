// Small DOM helpers shared by every screen.

// h('div.card', {onclick}, child, child...) builds an element.
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

let toastTimer;
export function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), kind === 'error' ? 7000 : 3500);
}

// Opens a modal dialog. Returns { close, body }.
export function modal(title, content, { wide = false, onClose } = {}) {
  const dlg = h('dialog.modal' + (wide ? '.wide' : ''));
  const close = () => {
    dlg.close();
    dlg.remove();
    onClose?.();
  };
  const body = h('div.modal-body', content);
  dlg.append(
    h('div.modal-head', h('h2', title), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
    body,
  );
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  document.body.append(dlg);
  dlg.showModal();
  return { close, body, dialog: dlg };
}

export function confirmDialog(message, okLabel = 'OK') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal('Please confirm', [
      h('p', message),
      h('div.form-actions',
        h('button.btn', { type: 'button', onclick: () => finish(false) }, 'Cancel'),
        h('button.btn.primary', { type: 'button', onclick: () => finish(true) }, okLabel)),
    ], { onClose: () => finish(false) });
  });
}

export function field(label, input, hint) {
  return h('label.field', h('span.field-label', label), input, hint ? h('span.field-hint', hint) : null);
}

export function select(name, options, value) {
  return h('select', { name },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
}

export function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}
