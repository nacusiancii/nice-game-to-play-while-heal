// Shared, dependency-free game types and helpers.
// Used by the SpacetimeDB module (authoritative) and by the client (tooltips, previews).

export type Rng = () => number; // [0, 1)

export const randInt = (rng: Rng, n: number) => Math.floor(rng() * n);
export const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[randInt(rng, arr.length)];
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Seedable RNG for tests and offline simulations.
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Tribe = 'Beast' | 'Undead' | 'Fungus' | 'Goblin' | 'Arcane' | 'Dwarf' | 'Token';

// A unit on a team. kind === '' means an empty slot.
export interface Unit {
  uid: number;
  kind: string;
  atk: number;
  hp: number;
  xp: number;
  item: string;
}

export interface ShopSlot {
  kind: string; // '' = sold out
  atk: number;
  hp: number;
  frozen: boolean;
  isItem: boolean;
}

export type RunStatus = 'shop' | 'won' | 'lost';

export interface RunState {
  round: number;
  gold: number;
  lives: number;
  wins: number;
  status: RunStatus;
  team: Unit[];
  shop: ShopSlot[];
  relics: string[];
  relicChoices: string[];
  nextUid: number;
  bonusGold: number; // gold added at the start of next turn
  rerolls: number; // rerolls used this turn
}

export const START_LIVES = 5;
export const WINS_TO_VICTORY = 10;
export const BASE_GOLD = 10;
export const UNIT_COST = 3;
export const REROLL_COST = 1;
export const BASE_SLOTS = 5;
export const RELIC_ROUNDS = [3, 6, 9, 12];
// The first two rounds are coin flips between three random misfits, so losing them costs no life.
export const lifeCost = (round: number) => (round <= 2 ? 0 : 1);
// Hoarder and Warlord count unspent gold up to this much.
export const HOARD_CAP = 10;

export const emptyUnit = (): Unit => ({ uid: 0, kind: '', atk: 0, hp: 0, xp: 0, item: '' });

export const levelOf = (xp: number) => (xp >= 5 ? 3 : xp >= 2 ? 2 : 1);
// xp needed to reach the next level, and progress inside current level (for UI pips)
export function xpProgress(xp: number): { have: number; need: number } {
  if (xp >= 5) return { have: 0, need: 0 };
  if (xp >= 2) return { have: xp - 2, need: 3 };
  return { have: xp, need: 2 };
}

export const shopTier = (round: number) => Math.min(5, Math.ceil(round / 2));
export const shopUnitSlots = (round: number) => (round < 5 ? 3 : round < 9 ? 4 : 5);
export const shopItemSlots = (round: number) => (round < 5 ? 1 : 2);
export const teamSlots = (relics: readonly string[]) => BASE_SLOTS + (relics.includes('sixth') ? 1 : 0);
export const sellValue = (u: Unit) => levelOf(u.xp);
