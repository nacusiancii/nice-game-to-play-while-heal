// Minimal DOM helpers.
type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> | null;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props, ...kids: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(typeof kid === 'object' ? kid : String(kid));
  }
  return el;
}

export const art = (name: string) => `/art/${name}.png`;
export const img = (name: string, cls = '') => h('img', { src: art(name), class: cls, draggable: false, alt: '' });

// Floating text above an element.
export function floatAt(el: Element | null | undefined, text: string, cls = 'good', delay = 0) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const f = h('div', { class: `float ${cls}`, style: `left:${r.left + r.width / 2}px;top:${r.top + 6}px;animation-delay:${delay}ms;opacity:0` }, text);
  document.body.append(f);
  setTimeout(() => f.remove(), 1300 + delay);
}

let toastBox: HTMLElement | null = null;
export function toast(text: string, err = false) {
  if (!toastBox || !toastBox.isConnected) { toastBox = h('div', { class: 'toasts' }); document.body.append(toastBox); }
  const t = h('div', { class: `toast${err ? ' err' : ''}` }, text);
  toastBox.append(t);
  setTimeout(() => t.remove(), 2700);
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
