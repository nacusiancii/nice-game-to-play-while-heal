// Plays back a battle recorded by the server.
import type { Fx, Frame, Snap } from '../../server/src/game/battle';
import { RELICS } from '../../server/src/game/data';
import type { Battle } from './module_bindings/types';
import { floatAt, h, img, sleep } from './dom';
import { hearts, unitEl, unitInfo } from './pieces';
import { sfx } from './sfx';

const SPEED_KEY = 'rabble-below/speed';
// 1x, 2x, 4x, or 0 = instant (no replay at all)
const SPEEDS = [1, 2, 4, 0];
export function getSpeed() {
  const v = Number(localStorage.getItem(SPEED_KEY) ?? 1);
  return SPEEDS.includes(v) ? v : 1;
}
export function cycleSpeed() {
  const next = SPEEDS[(SPEEDS.indexOf(getSpeed()) + 1) % SPEEDS.length];
  localStorage.setItem(SPEED_KEY, String(next));
  return next;
}
export const speedLabel = (v: number) => (v === 0 ? 'Instant' : `${v}x`);

export interface BattleMeta { myName: string; myWins: number; myLives: number; myRelics: string[] }

// What is on screen right now, for playtest reactions.
export const battleNow = { id: 0n, frame: -1, frames: 0, over: false, meta: null as BattleMeta | null };

// freezeAt (replays of a reaction): show that frame and wait for `resume` before playing on.
export function playBattle(root: HTMLElement, b: Battle, meta: BattleMeta, onDone: () => void,
  opts: { freezeAt?: number; resume?: Promise<void> } = {}) {
  const frames: Frame[] = JSON.parse(b.frames);
  Object.assign(battleNow, { id: b.id, frame: -1, frames: frames.length, over: false, meta });
  let speed = getSpeed() || 4;
  let skipping = false;
  let finished = false;

  const stage = h('div', { class: 'stage' });
  const speedBtn = h('button', { class: 'btn', onclick: () => {
    const v = cycleSpeed();
    if (v === 0) { skipping = true; speed = 4; } else speed = v;
    speedBtn.textContent = `Speed ${speedLabel(v)}`;
  } }, `Speed ${speedLabel(speed)}`);
  const skipBtn = h('button', { class: 'btn', onclick: () => { skipping = true; } }, 'Skip ▶▶');
  const relicIcons = (rs: string[]) => h('span', { class: 'relics' }, rs.map(r => h('span', { class: 'relic', title: `${RELICS[r].name}: ${RELICS[r].text}` }, img(RELICS[r].sprite))));
  const info = h('div', { class: 'info' });
  const arena = h('div', { class: 'arena' },
    h('div', { class: 'vs-bar' },
      h('div', { class: 'side' }, h('b', null, meta.myName), hearts(meta.myLives), `🏆 ${meta.myWins}`, relicIcons(meta.myRelics)),
      h('div', { class: 'vs' }, `Round ${b.round}`),
      h('div', { class: 'side' }, relicIcons(b.oppRelics), `🏆 ${b.oppWins}`, h('b', null, b.oppName), h('span', { class: 'label' }, ' (ghost)'))),
    h('div', { class: 'wall' }, h('div', { class: 'torch' }), h('div', { class: 'torch' }), h('div', { class: 'torch' }), h('div', { class: 'torch' })),
    stage,
    info,
    h('div', { class: 'battle-controls' }, speedBtn, skipBtn));
  const snapByUid = new Map<number, Snap>();
  root.replaceChildren(arena);

  const els = new Map<number, HTMLElement>();
  const sides = new Map<number, 0 | 1>();

  function layout(f: Frame) {
    const w = stage.clientWidth;
    const cell = (els.values().next().value?.querySelector('.unit') as HTMLElement | null)?.offsetWidth ?? 96;
    const gap = Math.min(cell + 26, (w - 120) / 12);
    const cx = w / 2;
    const place = (snaps: Snap[], side: 0 | 1) => snaps.forEach((s, i) => {
      let el = els.get(s.u);
      if (!el) {
        el = h('div', { class: `bunit${side === 0 ? ' face-r' : ''}` });
        const uid = s.u;
        el.addEventListener('mouseenter', () => {
          const cur = snapByUid.get(uid);
          if (cur) info.replaceChildren(...unitInfo(cur.k, cur.l === 3 ? 5 : cur.l === 2 ? 2 : 0, side === 0 ? 'yours' : 'enemy'));
        });
        el.addEventListener('mouseleave', () => info.replaceChildren());
        els.set(s.u, el);
        sides.set(s.u, side);
        stage.append(el);
      }
      snapByUid.set(s.u, s);
      el.replaceChildren(unitEl({ kind: s.k, atk: s.a, hp: s.h, lvl: s.l, item: s.i, ward: s.w }, side === 0));
      const x = side === 0 ? cx - 40 - (i + 1) * gap : cx + 40 + i * gap;
      el.style.left = `${x}px`;
      el.style.zIndex = String(20 - i);
    });
    place(f.a, 0);
    place(f.b, 1);
    // drop elements no longer present
    const present = new Set([...f.a, ...f.b].map(s => s.u));
    for (const [uid, el] of els) {
      if (!present.has(uid)) {
        el.classList.add('dying');
        els.delete(uid);
        setTimeout(() => el.remove(), 600);
      }
    }
  }

  function flash(el: HTMLElement | undefined, cls: string) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function applyFx(fx: Fx[]) {
    let hasHit = false, hasZap = false, hasBuff = false;
    for (const e of fx) {
      switch (e.t) {
        case 'atk': {
          const el = els.get(e.u);
          flash(el, sides.get(e.u) === 0 ? 'lunge-r' : 'lunge-l');
          break;
        }
        case 'dmg': {
          const el = els.get(e.u);
          flash(el, 'hurt');
          floatAt(el, `-${e.n}`, 'bad big');
          hasHit = true;
          break;
        }
        case 'buff': {
          const parts = [e.a ? `+${e.a}⚔` : '', e.h ? `+${e.h}♥` : ''].filter(Boolean).join(' ');
          floatAt(els.get(e.u), parts, 'good');
          hasBuff = true;
          break;
        }
        case 'ward': floatAt(els.get(e.u), `+${e.n} ward`, 'ward'); sfx.ward(); break;
        case 'heal': floatAt(els.get(e.u), `+${e.n}♥`, 'good'); hasBuff = true; break;
        case 'die': els.get(e.u)?.classList.add('dying'); sfx.faint(); break;
        case 'sum': els.get(e.u)?.classList.add('summoned'); sfx.summon(); break;
        case 'proc': {
          const el = els.get(e.u);
          flash(el, 'proc');
          sfx.proc();
          break;
        }
        case 'zap': {
          const from = els.get(e.f), to = els.get(e.u);
          if (from && to) {
            const a = from.getBoundingClientRect(), z = to.getBoundingClientRect();
            const p = h('div', { class: 'zap', style: `left:${a.left + a.width / 2}px;top:${a.top + a.height / 3}px` });
            document.body.append(p);
            requestAnimationFrame(() => requestAnimationFrame(() => {
              p.style.left = `${z.left + z.width / 2}px`;
              p.style.top = `${z.top + z.height / 3}px`;
            }));
            setTimeout(() => p.remove(), 320);
          }
          hasZap = true;
          break;
        }
        case 'note': {
          const n = h('div', { class: 'note' }, e.s);
          arena.append(n);
          setTimeout(() => n.remove(), 1500);
          break;
        }
      }
    }
    if (hasHit) sfx.hit();
    else if (hasZap) sfx.zap();
    else if (hasBuff) sfx.buff();
  }

  function frameDelay(f: Frame) {
    if (!f.fx.length) return 100;
    if (f.fx.some(e => e.t === 'atk')) return 560;
    if (f.fx.some(e => e.t === 'note')) return 800;
    if (f.fx.some(e => e.t === 'die')) return 450;
    return 400;
  }

  function showResult() {
    if (finished) return;
    finished = true;
    const res = b.result;
    (res > 0 ? sfx.win : res < 0 ? sfx.lose : sfx.draw)();
    const title = res > 0 ? 'Victory!' : res < 0 ? 'Defeat' : 'Draw';
    const sub = res > 0 ? 'Your rabble earns a trophy.' : res < 0 ? 'You lose a life.' : 'Nobody wins. Nobody loses.';
    const box = h('div', { class: `result ${res > 0 ? 'win' : res < 0 ? 'lose' : 'draw'}` },
      h('h2', null, title), h('p', null, sub),
      h('button', { class: 'btn primary', onclick: () => { cleanup(); onDone(); } }, 'Continue'));
    arena.querySelector('.battle-controls')?.remove();
    arena.append(box);
    battleNow.over = true;
    // don't steal focus from someone typing a reaction
    if (!(document.activeElement instanceof HTMLInputElement)) (box.querySelector('button') as HTMLButtonElement).focus();
    // fast mode: don't make the player click through
    if (getSpeed() === 0 || getSpeed() >= 4) setTimeout(() => { if (box.isConnected) { cleanup(); onDone(); } }, 1100);
  }

  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' || ev.key === 's') skipping = true;
  };
  window.addEventListener('keydown', key);
  const cleanup = () => { window.removeEventListener('keydown', key); battleNow.id = 0n; battleNow.frame = -1; };

  (async () => {
    // Let the stage size itself before the first layout.
    await sleep(30);
    let i0 = 0;
    if (opts.freezeAt !== undefined && frames.length) {
      i0 = Math.max(0, Math.min(opts.freezeAt, frames.length - 1));
      battleNow.frame = i0;
      layout(frames[i0]);
      applyFx(frames[i0].fx);
      await opts.resume;
      i0++;
    }
    for (let i = i0; i < frames.length; i++) {
      if (skipping) { battleNow.frame = frames.length - 1; layout(frames[frames.length - 1]); break; }
      battleNow.frame = i;
      const f = frames[i];
      layout(f);
      applyFx(f.fx);
      await sleep(frameDelay(f) / speed);
    }
    await sleep(skipping ? 50 : 300);
    showResult();
  })();

}
