// Enough of a view layer for one app and not a byte more.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') el.innerHTML = value;
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

// --- overlays ---------------------------------------------------------------

let openSheet = null;

export function sheet(title, body, { actions = [], onClose } = {}) {
  closeSheet();
  const panel = h('div', { class: 'sheet' },
    h('div', { class: 'sheet-grip' }),
    title && h('h2', { class: 'sheet-title' }, title),
    h('div', { class: 'sheet-body' }, body),
    actions.length ? h('div', { class: 'sheet-actions' }, actions) : null,
  );
  const backdrop = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop) closeSheet(); } }, panel);
  document.body.append(backdrop);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => backdrop.classList.add('open'));
  openSheet = { backdrop, onClose };
  return { close: closeSheet, panel };
}

export function closeSheet() {
  if (!openSheet) return;
  const { backdrop, onClose } = openSheet;
  openSheet = null;
  backdrop.classList.remove('open');
  document.body.classList.remove('no-scroll');
  setTimeout(() => backdrop.remove(), 180);
  onClose?.();
}

export function confirmSheet(title, message, { confirmLabel = 'Confirm', danger = false, requireText = null } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const input = requireText
      ? h('input', { class: 'input', placeholder: `Type ${requireText} to confirm`, autocapitalize: 'none', oninput: () => {
          go.disabled = input.value.trim().toUpperCase() !== requireText.toUpperCase();
        } })
      : null;
    const go = h('button', {
      class: danger ? 'btn btn-danger' : 'btn btn-primary',
      disabled: Boolean(requireText),
      onclick: () => { finish(true); closeSheet(); },
    }, confirmLabel);

    sheet(title, frag(h('p', { class: 'muted' }, message), input), {
      actions: [h('button', { class: 'btn', onclick: () => { finish(false); closeSheet(); } }, 'Cancel'), go],
      onClose: () => finish(false),
    });
  });
}

let toastTimer = null;
export function toast(message, { error = false } = {}) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: `toast${error ? ' toast-error' : ''}` }, message);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('open'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('open');
    setTimeout(() => el.remove(), 200);
  }, error ? 5000 : 2600);
}

// --- small shared pieces ----------------------------------------------------

export function icon(name) {
  const paths = {
    dumbbell: 'M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11',
    history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    body: 'M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM7 9h10M12 9v6M9 21l3-6 3 6',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.1a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-3-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.1-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z',
    plus: 'M12 5v14M5 12h14',
    check: 'M20 6 9 17l-5-5',
    back: 'm15 18-6-6 6-6',
    trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
    timer: 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 10v4l2 2M9 2h6',
    up: 'm5 15 7-7 7 7',
    down: 'm19 9-7 7-7-7',
    flat: 'M5 12h14',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
    close: 'M18 6 6 18M6 6l12 12',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
    grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
    cloud: 'M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.5A4 4 0 0 0 6.5 19Z',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of (paths[name] || '').split(' M').map((p, i) => (i ? `M${p}` : p))) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function screen(title, { back = null, action = null, subtitle = null } = {}, ...body) {
  return frag(
    h('header', { class: 'topbar' },
      back ? h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => { location.hash = back; } }, icon('back')) : null,
      h('div', { class: 'topbar-titles' },
        h('h1', {}, title),
        subtitle ? h('p', { class: 'topbar-sub' }, subtitle) : null,
      ),
      action || null,
    ),
    h('main', { class: 'screen' }, ...body),
  );
}

export function empty(message, hint) {
  return h('div', { class: 'empty' }, h('p', {}, message), hint ? h('p', { class: 'muted small' }, hint) : null);
}

export function relativeDay(iso) {
  const then = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) -
    new Date(then.getFullYear(), then.getMonth(), then.getDate())) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: then.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
