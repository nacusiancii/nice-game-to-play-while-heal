// Run and shop rules. All functions mutate the given RunState and throw Error on invalid moves.
import {
  BASE_GOLD, HOARD_CAP, REROLL_COST, lifeCost, RELIC_ROUNDS, START_LIVES, UNIT_COST, WINS_TO_VICTORY,
  emptyUnit, levelOf, pick, sellValue, shopItemSlots, shopTier, shopUnitSlots, shuffle, teamSlots,
  type Rng, type RunState, type ShopSlot, type Unit,
} from './core';
import { ITEMS, ITEM_COST, ITEM_KINDS, RELICS, RELIC_KINDS, UNITS, UNIT_KINDS, type ShopApi } from './data';

const CAP = 99;

export function api(st: RunState, rng: Rng): ShopApi {
  const units = () => st.team.filter(u => u.kind);
  return {
    st, rng, units,
    ahead: u => { const t = units(); return t[t.indexOf(u) - 1]; },
    behind: u => { const t = units(); const i = t.indexOf(u); return i < 0 ? undefined : t[i + 1]; },
    buff: (u, a, h) => { u.atk = Math.min(CAP, u.atk + a); u.hp = Math.min(CAP, u.hp + h); },
    gold: n => { st.gold += n; },
  };
}

export const itemCost = (st: { relics: readonly string[] }) => ITEM_COST - (st.relics.includes('bag') ? 1 : 0);
// Loaded Dice: the first reroll each turn is free and reaches a tier higher. Troll Heart makes rerolls dearer.
const diceRoll = (st: { relics: readonly string[]; rerolls: number }) => st.relics.includes('dice') && st.rerolls === 0;
export const rerollCost = (st: { relics: readonly string[]; rerolls: number }) =>
  diceRoll(st) ? 0 : REROLL_COST + (st.relics.includes('heart') ? 1 : 0);

function rollUnit(rng: Rng, tier: number): ShopSlot {
  const kind = pick(rng, UNIT_KINDS.filter(k => UNITS[k].tier <= tier));
  return { kind, atk: UNITS[kind].atk, hp: UNITS[kind].hp, frozen: false, isItem: false };
}
function rollItem(rng: Rng, tier: number): ShopSlot {
  const kind = pick(rng, ITEM_KINDS.filter(k => ITEMS[k].tier <= tier));
  return { kind, atk: 0, hp: 0, frozen: false, isItem: true };
}

// Refill the shop: frozen slots stay, everything else is re-rolled.
export function rollShop(st: RunState, rng: Rng, tierUp = 0) {
  const tier = Math.min(5, shopTier(st.round) + tierUp);
  const frozenUnits = st.shop.filter(s => s.kind && s.frozen && !s.isItem);
  const frozenItems = st.shop.filter(s => s.kind && s.frozen && s.isItem);
  const units: ShopSlot[] = [...frozenUnits];
  while (units.length < shopUnitSlots(st.round)) units.push(rollUnit(rng, tier));
  const items: ShopSlot[] = [...frozenItems];
  while (items.length < shopItemSlots(st.round)) items.push(rollItem(rng, tier));
  st.shop = [...units, ...items];
}

export function newRun(rng: Rng): RunState {
  const st: RunState = {
    round: 1, gold: BASE_GOLD, lives: START_LIVES, wins: 0, status: 'shop',
    team: Array.from({ length: teamSlots([]) }, emptyUnit), shop: [], relics: [], relicChoices: [],
    nextUid: 1, bonusGold: 0, rerolls: 0,
  };
  rollShop(st, rng);
  return st;
}

function assertShop(st: RunState) {
  if (st.status !== 'shop') throw new Error('Run is over');
  if (st.relicChoices.length) throw new Error('Choose a relic first');
}

function slot(st: RunState, i: number): Unit {
  if (!Number.isInteger(i) || i < 0 || i >= st.team.length) throw new Error('Bad team slot');
  return st.team[i];
}

// Merge `src` into `dst` (same kind). Returns true if dst levelled up.
function merge(st: RunState, rng: Rng, dst: Unit, src: { atk: number; hp: number; xp: number; item: string }) {
  const before = levelOf(dst.xp);
  dst.atk = Math.min(CAP, Math.max(dst.atk, src.atk) + 1);
  dst.hp = Math.min(CAP, Math.max(dst.hp, src.hp) + 1);
  dst.xp = Math.min(5, dst.xp + src.xp + 1);
  if (!dst.item && src.item) dst.item = src.item;
  if (levelOf(dst.xp) > before) levelUpBonus(st, rng);
}

// Levelling up adds a unit from the next tier to the shop.
function levelUpBonus(st: RunState, rng: Rng) {
  const tier = Math.min(5, shopTier(st.round) + 1);
  const pool = UNIT_KINDS.filter(k => UNITS[k].tier === tier);
  const kind = pick(rng, pool);
  const s: ShopSlot = { kind, atk: UNITS[kind].atk, hp: UNITS[kind].hp, frozen: false, isItem: false };
  const free = st.shop.findIndex(x => !x.kind && !x.isItem);
  const firstItem = st.shop.findIndex(x => x.isItem);
  if (free >= 0) st.shop[free] = s;
  else st.shop.splice(firstItem < 0 ? st.shop.length : firstItem, 0, s);
}

// A bought slot stays on the shelf, empty, so the rest of the market doesn't shift under the player's hand.
const sold = (s: ShopSlot): ShopSlot => ({ kind: '', atk: 0, hp: 0, frozen: false, isItem: s.isItem });

export function buy(st: RunState, rng: Rng, shopIdx: number, teamIdx: number) {
  assertShop(st);
  const s = st.shop[shopIdx];
  if (!s || !s.kind) throw new Error('Nothing to buy there');
  const target = slot(st, teamIdx);
  const sa = api(st, rng);
  if (s.isItem) {
    const cost = itemCost(st);
    if (st.gold < cost) throw new Error('Not enough gold');
    const def = ITEMS[s.kind];
    if (!target.kind) throw new Error('Use items on a unit');
    if (s.kind === 'scroll' && target.xp >= 5) throw new Error('Already max level');
    // take it off the shelf first: merging can add a bonus unit to the shop
    st.shop[shopIdx] = sold(s);
    st.gold -= cost;
    if (def.held) target.item = s.kind;
    else if (s.kind === 'scroll') merge(st, rng, target, { atk: target.atk - 1, hp: target.hp - 1, xp: 0, item: '' });
    else def.use!(sa, target);
    return;
  }
  if (st.gold < UNIT_COST) throw new Error('Not enough gold');
  if (target.kind && (target.kind !== s.kind || target.xp >= 5)) throw new Error('That slot is taken');
  st.shop[shopIdx] = sold(s);
  st.gold -= UNIT_COST;
  let bought: Unit;
  if (!target.kind) {
    st.team[teamIdx] = bought = { uid: st.nextUid++, kind: s.kind, atk: s.atk, hp: s.hp, xp: 0, item: '' };
  } else {
    merge(st, rng, target, { atk: s.atk, hp: s.hp, xp: 0, item: '' });
    bought = target;
  }
  for (const f of sa.units()) {
    const d = UNITS[f.kind];
    if (f !== bought && d.friendBought) d.friendBought(sa, f, levelOf(f.xp), bought);
  }
}

export function sell(st: RunState, rng: Rng, teamIdx: number) {
  assertShop(st);
  const u = slot(st, teamIdx);
  if (!u.kind) throw new Error('Nothing to sell');
  st.gold += sellValue(u);
  const d = UNITS[u.kind];
  if (d.sell) d.sell(api(st, rng), u, levelOf(u.xp));
  st.team[teamIdx] = emptyUnit();
}

// Move a unit to another slot: swap, or merge if both are the same kind.
export function move(st: RunState, rng: Rng, from: number, to: number) {
  assertShop(st);
  const a = slot(st, from), b = slot(st, to);
  if (from === to || !a.kind) return;
  if (b.kind && b.kind === a.kind && a.xp < 5 && b.xp < 5) {
    merge(st, rng, b, a);
    st.team[from] = emptyUnit();
    return;
  }
  st.team[from] = b;
  st.team[to] = a;
}

export function reroll(st: RunState, rng: Rng) {
  assertShop(st);
  const cost = rerollCost(st), lucky = diceRoll(st);
  if (st.gold < cost) throw new Error('Not enough gold');
  st.gold -= cost;
  st.rerolls++;
  rollShop(st, rng, lucky ? 1 : 0);
}

export function toggleFreeze(st: RunState, shopIdx: number) {
  assertShop(st);
  const s = st.shop[shopIdx];
  if (!s || !s.kind) throw new Error('Nothing there');
  s.frozen = !s.frozen;
}

export function chooseRelic(st: RunState, idx: number) {
  if (st.status !== 'shop') throw new Error('Run is over');
  const r = st.relicChoices[idx];
  if (!r) throw new Error('No such relic');
  st.relics.push(r);
  st.relicChoices = [];
  if (r === 'heart') st.lives += 2;
  if (r === 'sixth') st.team.push(emptyUnit());
}

// End of shop phase, before the battle.
export function endTurn(st: RunState, rng: Rng) {
  assertShop(st);
  const sa = api(st, rng);
  const spores = st.relics.includes('spores');
  for (const u of sa.units()) {
    const d = UNITS[u.kind];
    if (!d.endTurn) continue;
    const times = spores && d.tribe === 'Fungus' ? 2 : 1;
    for (let i = 0; i < times; i++) d.endTurn(sa, u, levelOf(u.xp));
  }
}

// After a battle: score it, then open the next shop.
export function afterBattle(st: RunState, rng: Rng, winner: 0 | 1 | -1) {
  if (winner === 0) st.wins++;
  else if (winner === 1) st.lives -= lifeCost(st.round);
  if (st.wins >= WINS_TO_VICTORY) { st.status = 'won'; return; }
  if (st.lives <= 0) { st.status = 'lost'; return; }
  startTurn(st, rng);
}

export function startTurn(st: RunState, rng: Rng) {
  const carried = st.relics.includes('piggy') ? Math.min(5, st.gold) : 0;
  st.round++;
  st.gold = BASE_GOLD + carried + st.bonusGold + (st.relics.includes('ledger') ? 2 : 0);
  st.bonusGold = 0;
  st.rerolls = 0;
  const sa = api(st, rng);
  for (const u of sa.units()) {
    const d = UNITS[u.kind];
    if (d.startTurn) d.startTurn(sa, u, levelOf(u.xp));
    if (u.item === 'coin') st.gold += 1;
  }
  rollShop(st, rng);
  if (RELIC_ROUNDS.includes(st.round)) {
    st.relicChoices = shuffle(rng, RELIC_KINDS.filter(r => !st.relics.includes(r) && (RELICS[r].fits?.(st.team) ?? true))).slice(0, 3);
  }
}
