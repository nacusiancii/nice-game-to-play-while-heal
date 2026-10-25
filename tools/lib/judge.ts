// Judge a team the way the market would: fight a fixed set of likely opponents.
// Every candidate is judged against the same opponents with the same dice (common random numbers),
// so small differences between candidates are real differences, not luck.
import { UNIT_COST, type Rng, type RunState } from '../../server/src/game/core';
import type { Side } from '../../server/src/game/battle';
import { ITEMS, UNITS } from '../../server/src/game/data';
import { buy, endTurn, itemCost, reroll, rerollCost, startTurn } from '../../server/src/game/shop';
import { Pool, fightScore, sideOf } from './pool';
import { childSeed, makeRng } from './rng';
import { cloneRun } from './state';

export interface Bench {
  opps: Side[];
  seeds: number[];
  endSeed: number;
  // Looking ahead: the same team a few turns later, grown by a simple shopper, against later opponents.
  ahead?: { turns: number; weight: number; opps: Side[]; seeds: number[]; projSeed: number };
  memo: Map<string, Memo>; // fights already fought, per team, so a closer look only adds new ones
}
interface Memo { me: Side; now: number[]; later?: Side; fut: number[] }

export function makeBench(pool: Pool, rng: Rng, st: RunState, k: number, ahead = { turns: 0, weight: 0 }): Bench {
  const opps = pool.sample(rng, st.round, st.wins, k).map(sideOf);
  const bench: Bench = { opps, seeds: opps.map(() => childSeed(rng)), endSeed: childSeed(rng), memo: new Map() };
  if (ahead.turns > 0 && ahead.weight > 0) {
    const later = pool.sample(rng, st.round + ahead.turns, st.wins + Math.round(ahead.turns / 2), k).map(sideOf);
    bench.ahead = { ...ahead, opps: later, seeds: later.map(() => childSeed(rng)), projSeed: childSeed(rng) };
  }
  return bench;
}

export let battlesFought = 0;

function extend(out: number[], me: Side, opps: Side[], seeds: number[], n: number) {
  battlesFought += Math.max(0, n - out.length);
  for (let i = out.length; i < n; i++) out.push(fightScore(makeRng(seeds[i]), me, opps[i]).score);
}

// Everything that can change a fight or the look ahead.
const keyOf = (st: RunState) => JSON.stringify([
  st.team.filter(u => u.kind).map(u => [u.kind, u.atk, u.hp, u.xp, u.item]), st.gold, st.relics, st.round, st.wins,
  st.shop.filter(s => s.frozen).map(s => s.kind),
]);

// Grow the team for a few turns without us: income, end-of-turn growth, and a plain shopper that spends
// the gold like a sensible player who isn't thinking hard: merges, then empty slots, then items that
// boost a unit (on the strongest one), then a few rerolls looking for more. It never sells or reorders.
function project(st: RunState, turns: number, seed: number): RunState {
  const x = cloneRun(st);
  const rng = makeRng(seed);
  const tryBuy = (si: number, ti: number) => { try { buy(x, rng, si, ti); return true; } catch { return false; } };
  endTurn(x, rng);
  for (let t = 0; t < turns; t++) {
    startTurn(x, rng);
    x.relicChoices = []; // a projection doesn't get to pick relics
    let rerolls = 0;
    for (let guard = 0; guard < 20; guard++) {
      const offers = x.shop.map((s, i) => ({ s, i })).filter(o => o.s.kind && !o.s.isItem)
        .sort((a, b) => UNITS[b.s.kind].tier - UNITS[a.s.kind].tier);
      const merge = offers.map(o => ({ o, j: x.team.findIndex(u => u.kind === o.s.kind && u.xp < 5) })).find(m => m.j >= 0);
      const empty = x.team.findIndex(u => !u.kind);
      if (x.gold >= UNIT_COST && merge && tryBuy(merge.o.i, merge.j)) continue;
      if (x.gold >= UNIT_COST && empty >= 0 && offers.length && tryBuy(offers[0].i, empty)) continue;
      const item = x.shop.findIndex(s => s.kind && s.isItem && !ITEMS[s.kind].held);
      const strongest = x.team.reduce((b, u, i) => (u.kind && (b < 0 || u.atk + u.hp > x.team[b].atk + x.team[b].hp) ? i : b), -1);
      if (item >= 0 && strongest >= 0 && x.gold >= itemCost(x) && tryBuy(item, strongest)) continue;
      if (rerolls < 3 && x.gold >= rerollCost(x) + Math.min(UNIT_COST, itemCost(x))) { reroll(x, rng); rerolls++; continue; }
      break;
    }
    endTurn(x, rng);
  }
  return x;
}

// Per-opponent battle scores (see fightScore) for this round, blended with the look ahead if the bench has one.
export function scores(st: RunState, bench: Bench, n = bench.opps.length): number[] {
  n = Math.min(n, bench.opps.length);
  if (!n) return [0.5];
  const key = keyOf(st);
  let m = bench.memo.get(key);
  if (!m) {
    const s = cloneRun(st);
    endTurn(s, makeRng(bench.endSeed));
    m = { me: sideOf(s), now: [], fut: [] };
    bench.memo.set(key, m);
  }
  extend(m.now, m.me, bench.opps, bench.seeds, n);
  const a = bench.ahead;
  if (!a) return m.now.slice(0, n);
  m.later ??= sideOf(project(st, a.turns, a.projSeed));
  extend(m.fut, m.later, a.opps, a.seeds, Math.min(n, a.opps.length));
  return m.now.slice(0, n).map((v, i) => (1 - a.weight) * v + a.weight * (m.fut[i] ?? v));
}

export const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length);
export const score = (st: RunState, bench: Bench, n?: number) => mean(scores(st, bench, n));

// Standard error of the difference between two options judged on the same bench.
export function pairedSE(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return Infinity;
  const d = Array.from({ length: n }, (_, i) => a[i] - b[i]);
  const m = mean(d);
  const v = d.reduce((t, x) => t + (x - m) ** 2, 0) / (n - 1);
  return Math.sqrt(v / n);
}
