// Playtest reactions: press H anywhere, say a word or two, Enter. Play never stops.
// The moment is frozen when H is pressed (screen, selection, battle frame, recent trail);
// the server adds its own snapshot of the run when the words arrive.
import { h } from './dom';
import { trail } from './trail';

export interface View {
  screen: string;
  battleId: bigint;
  [k: string]: unknown;
}

const QUICK = ['huh?', 'fun!', 'bug'];

export function initReactions(viewOf: () => View, send: (text: string, battleId: bigint, view: string) => Promise<boolean>) {
  let box: HTMLElement | null = null;
  let input: HTMLInputElement;
  let moment: View | null = null;
  let sent = 0;

  const button = h('button', { class: 'react-btn', title: 'React (H): a word or two about this moment', onclick: () => open() }, '💬');
  document.body.append(button);

  function open() {
    // the moment is always now, even if a forgotten box is still open from earlier
    moment = capture();
    if (box) return input.focus();
    input = h('input', { class: 'react-input', maxLength: 280, placeholder: 'huh? fun! bug… a word or two' }) as HTMLInputElement;
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') submit(input.value);
      else if (ev.key === 'Escape') close();
    });
    box = h('div', { class: 'react-box' }, '💬', input,
      QUICK.map(q => h('button', { class: 'react-chip', onclick: () => submit(input.value.trim() ? `${q} ${input.value}` : q) }, q)));
    // keep game shortcuts (S sells, Space fights, Esc skips) away from the input and the chips
    box.addEventListener('keydown', ev => ev.stopPropagation());
    document.body.append(box);
    input.focus();
  }

  function capture(): View {
    return {
      ...viewOf(),
      build: __BUILD__,
      size: [innerWidth, innerHeight],
      info: (document.querySelector('.info') as HTMLElement | null)?.innerText.trim().replace(/\s*\n\s*/g, ' · ').slice(0, 300) ?? '',
      toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent ?? ''),
      trail: trail.slice(-15),
    };
  }

  function close() {
    box?.remove();
    box = null;
    moment = null;
  }

  function submit(text: string) {
    const m = moment;
    if (!text.trim() || !m) return close();
    close();
    send(text.trim(), m.battleId, JSON.stringify(m, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).then(ok => {
      if (!ok) return; // the error toast already said why
      sent++;
      button.textContent = `💬 ${sent}`;
      button.classList.remove('noted');
      void button.offsetWidth;
      button.classList.add('noted');
    });
  }

  window.addEventListener('keydown', ev => {
    if (ev.key.toLowerCase() !== 'h' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    open();
  }, { capture: true });
}
