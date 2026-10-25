// A seedable RNG whose state can be saved to disk (mulberry32, same stream as core.ts).
import type { Rng } from '../../server/src/game/core';

export interface SavedRng { a: number }

export function makeRng(seed: number): Rng & SavedRng {
  const f = (() => {
    f.a = (f.a + 0x6d2b79f5) >>> 0;
    let t = f.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng & SavedRng;
  f.a = seed >>> 0;
  return f;
}

// Derive an independent seed from a parent rng.
export const childSeed = (rng: Rng) => Math.floor(rng() * 2 ** 32);
