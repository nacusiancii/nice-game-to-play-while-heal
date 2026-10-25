// How a recorded battle is paced on screen. The engine records one frame per trigger; the screen groups
// them into beats so a fight reads as a rhythm of punches, not a queue of small numbers.
// Pure (no DOM), so tools can measure how long fights take without a browser.
import type { Frame } from '../../server/src/game/battle';

export interface Beat { first: number; last: number; ms: number }

// Effects that are small enough to land together: stat buffs, wards, heals, glows, summons.
const SMALL = new Set(['buff', 'heal', 'ward', 'proc', 'sum']);
const small = (f: Frame) => f.fx.length > 0 && f.fx.every(e => SMALL.has(e.t));

export function holdFor(f: Frame, final: boolean) {
  if (!f.fx.length) return 90;                       // someone stepped forward
  if (f.fx.some(e => e.t === 'atk')) return 500;     // the payoff: give it room
  if (f.fx.some(e => e.t === 'note')) return final ? 450 : 600;
  if (f.fx.some(e => e.t === 'die')) return 420;
  if (f.fx.some(e => e.t === 'zap')) return 360;     // zaps stay big and one at a time
  return 320;
}

// A beat is one frame, plus what follows it without needing its own moment: small frames merge with
// each other, and a death takes the step forward and its faint abilities (summons, buffs) with it, so
// cause and effect land together. Held as long as its slowest frame.
const MAX = 6;
export function beats(frames: Frame[]): Beat[] {
  const out: Beat[] = [];
  for (let i = 0; i < frames.length; i++) {
    const dies = frames[i].fx.some(e => e.t === 'die') && !frames[i].fx.some(e => e.t === 'atk');
    const joins = (f: Frame) => small(f) || (dies && !f.fx.length);
    let last = i;
    if (dies || small(frames[i])) while (last + 1 < frames.length && last - i + 1 < MAX && joins(frames[last + 1])) last++;
    let ms = 0;
    for (let k = i; k <= last; k++) ms = Math.max(ms, holdFor(frames[k], k === frames.length - 1));
    out.push({ first: i, last, ms });
    i = last;
  }
  return out;
}

// Total time a fight holds the screen at 1x, before the result box.
export const fightMs = (frames: Frame[]) => beats(frames).reduce((t, b) => t + b.ms, 0);
