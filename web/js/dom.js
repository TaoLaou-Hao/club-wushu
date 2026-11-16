// Helpers DOM : aucune donnée n'est jamais injectée via innerHTML.
let counter = 0;
export const uid = (p = 'f') => `${p}-${++counter}`;

const PROPS = ['value', 'checked', 'disabled', 'selected', 'hidden', 'readOnly', 'required', 'multiple'];

// h('div', {class:'x', onclick: fn}, 'texte', autreNoeud, [liste])
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  const isAttrs = attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs);
  if (isAttrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v); // CSSOM : autorisé par la CSP
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROPS.includes(k)) el[k] = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  } else if (attrs !== undefined && attrs !== null) {
    children.unshift(attrs);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Champ de formulaire avec label associé.
export function field(label, input, hint) {
  const id = input.id || uid('in');
  input.id = id;
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    input,
    hint ? h('p', { class: 'hint' }, hint) : null);
}

// Liste déroulante : options = [{value,label}] ou [[value,label]]
export function selectEl(options, value, attrs = {}) {
  const s = h('select', attrs);
  for (const o of options) {
    const [v, l] = Array.isArray(o) ? o : [o.value, o.label];
    s.appendChild(h('option', { value: v }, l));
  }
  if (value !== undefined && value !== null) s.value = value;
  return s;
}

export function button(label, onclick, cls = '', attrs = {}) {
  return h('button', { type: 'button', class: `btn ${cls}`.trim(), onclick, ...attrs }, label);
}

// ---------- Notifications (toasts) ----------
let toastBox = null;
export function toast(message, type = 'info', ms = 5000) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(toastBox);
  }
  const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  toastBox.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- Fenêtres modales (aucun alert/confirm natif) ----------
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function modal({ title, content, actions = [], dismissible = true, wide = false, onClose }) {
  const previous = document.activeElement;
  const titleId = uid('mt');
  const dlg = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('h2', { id: titleId }, title),
    h('div', { class: 'modal-body' }, content),
    actions.length ? h('div', { class: 'modal-actions' }, actions) : null);
  const backdrop = h('div', { class: 'backdrop' }, dlg);
  let closed = false;
  let downOnBackdrop = false;

  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    document.body.classList.toggle('modal-open', document.querySelectorAll('.backdrop').length > 0);
    if (previous && previous.focus && document.contains(previous)) previous.focus();
    if (onClose) onClose(result);
  }
  function isTop() {
    const all = document.querySelectorAll('.backdrop');
    return all[all.length - 1] === backdrop;
  }
  function onKey(e) {
    if (!isTop()) return;
    if (e.key === 'Escape' && dismissible) { e.preventDefault(); close(); }
    else if (e.key === 'Tab') {
      const items = [...dlg.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  backdrop.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === backdrop; });
  backdrop.addEventListener('click', (e) => { if (dismissible && downOnBackdrop && e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');
  const first = dlg.querySelector('input,select,textarea') || dlg.querySelector('.modal-actions button') || dlg;
  first.focus();
  return { close, el: dlg };
}

// Confirmation personnalisée -> Promise<boolean>
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const m = modal({
      title,
      content: h('p', {}, message),
      onClose: () => resolve(answer),
      actions: [
        button('Annuler', () => m.close(), 'btn-ghost'),
        button(confirmLabel, () => { answer = true; m.close(); }, danger ? 'btn-danger' : 'btn-primary'),
      ],
    });
  });
}

// Modale formulaire : onSubmit() peut lever une erreur (affichée dans la modale).
export function formModal({ title, body, submitLabel = 'Enregistrer', danger = false, wide = false, onSubmit }) {
  const errBox = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary') }, submitLabel);
  const form = h('form', { novalidate: false }, body, errBox);
  let m;
  const cancel = button('Annuler', () => m.close(), 'btn-ghost');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    errBox.hidden = true;
    try {
      const r = await onSubmit(form);
      if (r !== false) m.close(true);
    } catch (err) {
      errBox.textContent = errText(err);
      errBox.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  m = modal({ title, content: form, wide, actions: [] });
  form.appendChild(h('div', { class: 'modal-actions' }, cancel, submit));
  return m;
}

// Branché par util.js pour éviter une dépendance circulaire.
let errText = (e) => (e && e.message) || 'Erreur';
export function setErrorFormatter(fn) { errText = fn; }
export function showError(e) { toast(errText(e), 'error'); }

export function badge(text, cls = '') {
  return h('span', { class: `badge ${cls}`.trim() }, text);
}

export function loading(text = 'Chargement…') {
  return h('p', { class: 'loading', role: 'status' }, text);
}

export function emptyState(text) {
  return h('p', { class: 'empty' }, text);
}
