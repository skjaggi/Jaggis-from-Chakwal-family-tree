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
let toastEl = null;
export function toast(message, kind = 'info') {
  // Kept by reference: it may have been inside a dialog that has since closed.
  const el = (toastEl ||= document.getElementById('toast'));
  // An open dialog sits above the page, so show the message inside it, or it is hidden behind.
  const top = [...document.querySelectorAll('dialog[open]')].pop();
  const home = top || document.body;
  if (el.parentNode !== home) home.append(el);
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), kind === 'error' ? 7000 : 3500);
}

// Opens a modal dialog. Returns { close, body }.
// With guard: true, if something was typed into the dialog's form, closing with
// ✕ or Escape asks whether to save first, so changes aren't lost by accident.
export function modal(title, content, { wide = false, onClose, guard = false } = {}) {
  const dlg = h('dialog.modal' + (wide ? '.wide' : ''));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dlg.close();
    dlg.remove();
    onClose?.();
  };
  let dirty = false;
  const markDirty = (e) => { if (e.target.closest('form')) dirty = true; };
  dlg.addEventListener('input', markDirty);
  dlg.addEventListener('change', markDirty);
  let asking = false;
  const tryClose = async () => {
    const form = dlg.querySelector('form');
    const submit = form?.querySelector('button[type=submit]');
    if (!guard || !dirty || !submit || asking) return close();
    asking = true;
    const choice = await choiceDialog('Save your changes?', 'You changed something here but haven\'t saved it yet.', [
      ['keep', 'Keep editing'], ['discard', 'Discard changes'], ['save', submit.textContent.trim() || 'Save', true]]);
    asking = false;
    if (choice === 'discard') close();
    else if (choice === 'save') form.requestSubmit(submit);
  };
  const body = h('div.modal-body', content);
  dlg.append(
    h('div.modal-head', h('h2', title), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: tryClose }, '✕')),
    body,
  );
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    tryClose();
  });
  document.body.append(dlg);
  dlg.showModal();
  return { close, body, dialog: dlg };
}

// A small dialog with several buttons. choices: [value, label, primary?]. Resolves to the value picked
// (the first choice if dismissed).
export function choiceDialog(title, message, choices) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal(title, [
      h('p', message),
      h('div.form-actions', choices.map(([v, label, primary]) =>
        h('button.btn' + (primary ? '.primary' : ''), { type: 'button', onclick: () => finish(v) }, label))),
    ], { onClose: () => finish(choices[0][0]) });
  });
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
