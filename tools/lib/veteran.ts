// The Veteran: a player who thinks before it buys.
//
// It knows nothing about any particular unit. For every choice it tries each option on a copy of the
// run and fights the result against a bench of likely opponents. Whatever wins most, it does.
// That makes it slow-ish but honest: change a number in data.ts and its judgement changes with it.
import { UNIT_COST, levelOf, shopTier, type Rng, type RunState } from '../../server/src/game/core';
import { ITEMS, UNITS } from '../../server/src/game/data';
import { afterBattle, buy, newRun, chooseRelic, endTurn, itemCost, move, reroll, rerollCost, sell, toggleFreeze } from '../../server/src/game/shop';
import { botTurn, randomStyle } from '../../server/src/game/bot';
import { makeBench, mean, pairedSE, score, scores, type Bench } from './judge';
import { Pool, ghostOf, quickFight, sideOf, type Ghost } from './pool';
import { nm } from './report';
import { childSeed, makeRng } from './rng';
import { cloneRun, compact } from './state';

export interface VeteranOpts {
  k: number; // opponents per quick look
  kFinal: number; // opponents for the close calls
  aheadTurns: number; // also judge the team this many turns later...
  aheadWeight: number; // ...counting that much (0 = only this round's fight matters)
  relicRollouts: number; // simulated futures per relic option
  maxRerolls: number;
}
export const DEFAULT_OPTS: VeteranOpts = { k: 8, kFinal: 24, aheadTurns: 2, aheadWeight: 0.5, relicRollouts: 30, maxRerolls: 6 };

export interface Option { label: string; value: number; key: string } // key: what is chosen, ignoring where it goes
export interface Decision {
  round: number;
  kind: 'shop' | 'relic' | 'reroll' | 'order';
  options: Option[]; // best first
  chosen: string;
  se?: number; // noise: standard error of (best - best alternative), same unit as the values; unknown if absent
  unit: string; // 'win%' for battle odds this round, 'wins' for expected trophies by run end
}

export interface Plan { label: string; tags: string[]; apply: (st: RunState, rng: Rng) => void }

const unitLabel = (st: RunState, i: number) => {
  const u = st.team[i];
  return `${nm(u.kind)} L${levelOf(u.xp)} ${u.atk}/${u.hp}`;
};

// Put the unit at team index `from` at position `to` among living units.
function place(st: RunState, from: number, to: number) {
  const [u] = st.team.splice(from, 1);
  st.team.splice(to, 0, u);
}

// Every sensible single step from here. The state is compacted: units front to back, empties last.
export function plans(st: RunState): Plan[] {
  const out: Plan[] = [];
  const units = st.team.filter(u => u.kind);
  const n = units.length;
  const empty = st.team.findIndex(u => !u.kind);
  st.shop.forEach((s, si) => {
    if (!s.kind) return;
    if (s.isItem) {
      if (st.gold < itemCost(st)) return;
      const def = ITEMS[s.kind];
      units.forEach((u, ti) => {
        if (def.held && u.item === s.kind) return;
        out.push({
          label: `${nm(s.kind)} on ${unitLabel(st, ti)}`, tags: ['item', s.kind],
          apply: (x, rng) => buy(x, rng, si, ti),
        });
      });
      return;
    }
    const merges = units.map((u, ti) => ({ u, ti })).filter(o => o.u.kind === s.kind && o.u.xp < 5);
    if (st.gold >= UNIT_COST) {
      for (const { ti } of merges) out.push({
        label: `${nm(s.kind)}, merged into ${unitLabel(st, ti)}`, tags: ['buy', s.kind, 'merge'],
        apply: (x, rng) => buy(x, rng, si, ti),
      });
      if (empty >= 0 && !merges.length) {
        out.push({ label: `${nm(s.kind)}, in front`, tags: ['buy', s.kind], apply: (x, rng) => { buy(x, rng, si, empty); place(x, empty, 0); } });
        if (n > 0) out.push({ label: `${nm(s.kind)}, at the back`, tags: ['buy', s.kind], apply: (x, rng) => buy(x, rng, si, empty) });
      }
    }
    // Sell someone to make room (or to afford it), then buy into their spot.
    // (If it isn't affordable even after selling, buy throws and the option is dropped.)
    if (!merges.length && !(empty >= 0 && st.gold >= UNIT_COST)) units.forEach((u, ti) => {
      if (u.kind === s.kind) return;
      out.push({
        label: `sell ${unitLabel(st, ti)} for ${nm(s.kind)}`, tags: ['buy', s.kind, 'sell', u.kind],
        apply: (x, rng) => { sell(x, rng, ti); buy(x, rng, si, ti); },
      });
    });
  });
  // Two copies already on the team: merge them.
  units.forEach((u, i) => units.forEach((v, j) => {
    if (i < j && u.kind === v.kind && u.xp < 5 && v.xp < 5) out.push({
      label: `merge both ${nm(u.kind)}`, tags: ['merge', u.kind], apply: (x, rng) => { move(x, rng, j, i); compact(x); },
    });
  }));
  return out;
}

interface Tried { plan: Plan; value: number; state: RunState; per?: number[] }

// Try each option on a copy. A glance at all, a quick look at the better half, then a careful look at the
// best version of each of the top few distinct choices, so the numbers we compare (and log) are the precise ones.
function rank(st: RunState, rng: Rng, opts: Plan[], bench: Bench, k: number, careful = true): Tried[] {
  const tried: Tried[] = opts.flatMap(p => {
    const x = cloneRun(st);
    try { p.apply(x, makeRng(childSeed(rng))); } catch { return []; }
    compact(x);
    return [{ plan: p, state: x, value: score(x, bench, Math.ceil(k / 2)) }];
  });
  tried.sort((a, b) => b.value - a.value);
  for (const t of tried.slice(0, 10)) t.value = score(t.state, bench, k);
  tried.sort((a, b) => b.value - a.value);
  if (!careful) return tried;
  const keys = new Set<string>();
  for (const t of tried) {
    const key = keyOf(t.plan);
    if (keys.has(key)) continue;
    if (keys.size >= 4) break;
    keys.add(key);
    t.per = scores(t.state, bench);
    t.value = mean(t.per);
  }
  tried.sort((a, b) => (b.per ? 1 : 0) - (a.per ? 1 : 0) || b.value - a.value);
  return tried;
}

const keyOf = (p: Plan) => p.tags[0] === 'stop' ? 'stop' : p.tags[0] === 'merge' ? 'merge' : p.tags[1];
function seOf(ranked: Tried[]) {
  const best = ranked[0];
  const alt = ranked.find(t => keyOf(t.plan) !== keyOf(best.plan));
  return best.per && alt?.per ? pairedSE(best.per, alt.per) : Infinity;
}

const STOP: Plan = { label: 'done shopping', tags: ['stop'], apply: () => {} };

// Re-order the team by moving one unit at a time, as long as it helps. Each move gets a quick look first;
// only moves that look better get the careful one.
function arrange(st: RunState, full: Bench, k: number, log?: Decision[]) {
  const bench: Bench = { ...full, ahead: undefined }; // order only matters for the coming fight
  compact(st);
  const n = st.team.filter(u => u.kind).length;
  let best = score(st, bench);
  const start = best;
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const x = cloneRun(st);
      place(x, a, b);
      if (score(x, bench, k) <= score(st, bench, k)) continue;
      const v = score(x, bench);
      if (v > best + 1e-9) { best = v; st.team = x.team; improved = true; }
    }
    if (!improved) break;
  }
  if (log && best > start) log.push({
    round: st.round, kind: 'order', unit: 'win%', chosen: 'reordered',
    options: [{ label: 'reordered', value: best, key: 'reordered' }, { label: 'as bought', value: start, key: 'as bought' }],
  });
}

// What would a whole run from here be worth? Play it out with the simple bot, many times.
export function rollout(st: RunState, pool: Pool, seed: number): number {
  const x = cloneRun(st);
  const rng = makeRng(seed);
  const style = randomStyle(rng);
  const tribes = new Map<string, number>();
  for (const u of x.team) if (u.kind) tribes.set(UNITS[u.kind].tribe, (tribes.get(UNITS[u.kind].tribe) ?? 0) + 1);
  const top = [...tribes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) style.favourite = top[0];
  while (x.status === 'shop' && x.round < 30) {
    botTurn(x, rng, style);
    endTurn(x, rng);
    const opp = pool.opponent(rng, x.round, x.wins);
    afterBattle(x, rng, opp ? quickFight(rng, sideOf(x), sideOf(opp)) : 0);
  }
  return x.wins;
}

function pickRelic(st: RunState, rng: Rng, pool: Pool, o: VeteranOpts, log?: Decision[]) {
  const seeds = Array.from({ length: o.relicRollouts }, () => childSeed(rng));
  const options = st.relicChoices.map((r, i) => {
    const x = cloneRun(st);
    chooseRelic(x, i);
    const per = seeds.map(s => rollout(x, pool, s));
    return { r, i, per, value: mean(per) };
  }).sort((a, b) => b.value - a.value);
  log?.push({
    round: st.round, kind: 'relic', unit: 'wins', chosen: nm(options[0].r), se: options[1] ? pairedSE(options[0].per, options[1].per) : Infinity,
    options: options.map(x => ({ label: nm(x.r), value: x.value, key: x.r })),
  });
  chooseRelic(st, options[0].i);
}

// One shop phase, ending just before the fight. `pool` is what the Veteran knows about likely opponents.
export function veteranTurn(st: RunState, rng: Rng, pool: Pool, o: VeteranOpts = DEFAULT_OPTS, log?: Decision[], turn?: TurnLog) {
  if (st.relicChoices.length) pickRelic(st, rng, pool, o, log);
  compact(st);
  const see = () => { if (turn) for (const s of st.shop) if (s.kind && !turn.seen.includes(s.kind)) turn.seen.push(s.kind); };
  see();
  const bench = makeBench(pool, rng, st, o.kFinal, { turns: o.aheadTurns, weight: o.aheadWeight });
  let rerolls = 0;
  for (let step = 0; step < 20; step++) {
    const ranked = rank(st, rng, [STOP, ...plans(st)], bench, o.k);
    const best = ranked[0];
    if (best.plan !== STOP) {
      log?.push({ round: st.round, kind: 'shop', unit: 'win%', chosen: best.plan.label, se: seOf(ranked), options: ranked.map(t => ({ label: t.plan.label, value: t.value, key: keyOf(t.plan) })) });
      Object.assign(st, best.state); // the very state it judged, not a fresh roll of the dice
      if (turn && best.plan.tags[0] !== 'merge') turn.bought.push(best.plan.tags[1]);
      see();
      continue;
    }
    // Nothing on the shelf beats keeping the gold. Is a reroll worth a coin?
    if (rerolls >= o.maxRerolls || st.gold < rerollCost(st) + Math.min(UNIT_COST, itemCost(st))) break;
    // Sample a few rerolls and pick the best buy in each on the first k opponents. Then judge "keep" and
    // those picks on the other opponents only: the best of many noisy guesses always looks too good.
    const held = (x: RunState) => mean(scores(x, bench).slice(o.k));
    const keep = held(st);
    let after = 0;
    const SAMPLES = 3;
    for (let t = 0; t < SAMPLES; t++) {
      const x = cloneRun(st);
      reroll(x, makeRng(childSeed(rng)));
      after += held(rank(x, rng, [STOP, ...plans(x)], bench, o.k, false)[0].state) / SAMPLES;
    }
    log?.push({
      round: st.round, kind: 'reroll', unit: 'win%', chosen: after > keep ? 'reroll' : 'keep the gold',
      options: [{ label: 'reroll', value: after, key: 'reroll' }, { label: 'keep the gold', value: keep, key: 'keep' }].sort((a, b) => b.value - a.value),
    });
    if (after <= keep) break;
    reroll(st, rng);
    rerolls++;
    see();
  }
  arrange(st, bench, o.k, log);
  freezeKeepers(st);
}

// Freeze what we'd want next turn: copies of our units, and anything above the current shop tier.
function freezeKeepers(st: RunState) {
  st.shop.forEach((s, i) => {
    if (!s.kind || s.isItem) return;
    const want = st.team.some(u => u.kind === s.kind && u.xp < 5) || UNITS[s.kind].tier > shopTier(st.round);
    if (want !== s.frozen) toggleFreeze(st, i);
  });
}

export interface TurnLog { round: number; seen: string[]; bought: string[] }
export interface RunLog {
  wins: number; lives: number; round: number; won: boolean;
  decisions: Decision[]; turns: TurnLog[]; battles: { round: number; result: number }[]; final: RunState;
  ghosts: Ghost[]; // every team it fielded, for building a field of veteran opponents
}

// Two halves of the same kind of field. The Veteran learns the meta from `know` and meets its real
// opponents in `meet`, so it can't tune its team to the exact ghost it is about to fight.
export interface World { know: Pool; meet: Pool }

// A whole run by the Veteran.
export function veteranRun(world: World, seed: number, o: VeteranOpts = DEFAULT_OPTS): RunLog {
  const rng = makeRng(seed);
  const st = newRun(rng);
  const decisions: Decision[] = [];
  const turns: TurnLog[] = [];
  const battles: RunLog['battles'] = [];
  const ghosts: Ghost[] = [];
  while (st.status === 'shop' && st.round < 30) {
    const turn: TurnLog = { round: st.round, seen: [], bought: [] };
    turns.push(turn);
    veteranTurn(st, rng, world.know, o, decisions, turn);
    endTurn(st, rng);
    const opp = world.meet.opponent(rng, st.round, st.wins);
    const w = opp ? quickFight(rng, sideOf(st), sideOf(opp)) : 0;
    battles.push({ round: st.round, result: w === 0 ? 1 : w === 1 ? -1 : 0 });
    ghosts.push(ghostOf(st, 'veteran'));
    afterBattle(st, rng, w);
  }
  return { wins: st.wins, lives: st.lives, round: st.round, won: st.status === 'won', decisions, turns, battles, final: st, ghosts };
}
