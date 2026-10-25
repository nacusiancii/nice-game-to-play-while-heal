// A simple shop AI. Used to seed ghost opponents so a fresh server has rivals to fight.
import { UNIT_COST, levelOf, pick, type Rng, type RunState, type Unit } from './core';
import { ITEMS, UNITS } from './data';
import { afterBattle, buy, chooseRelic, endTurn, itemCost, newRun, reroll, sell } from './shop';

const power = (u: { atk: number; hp: number }) => u.atk + u.hp;

export interface BotStyle { favourite: string; greed: number; rerollBudget: number }

export function randomStyle(rng: Rng): BotStyle {
  return {
    favourite: pick(rng, ['Beast', 'Undead', 'Fungus', 'Goblin', 'Arcane', 'Dwarf']),
    greed: rng(),
    rerollBudget: Math.floor(rng() * 4),
  };
}

function scoreKind(st: RunState, kind: string, style: BotStyle) {
  const d = UNITS[kind];
  let s = d.tier * 3 + power(d);
  if (st.team.some(u => u.kind === kind && u.xp < 5)) s += 6;
  if (d.tribe === style.favourite) s += 5;
  s += st.team.filter(u => u.kind && UNITS[u.kind].tribe === d.tribe).length * 1.5;
  return s;
}

function weakest(st: RunState): number {
  let best = -1, bv = Infinity;
  st.team.forEach((u, i) => {
    if (!u.kind) return;
    const v = power(u) + UNITS[u.kind].tier * 3 + levelOf(u.xp) * 6;
    if (v < bv) { bv = v; best = i; }
  });
  return best;
}

function tryDo(f: () => void) { try { f(); return true; } catch { return false; } }

export function botTurn(st: RunState, rng: Rng, style: BotStyle) {
  if (st.relicChoices.length) chooseRelic(st, Math.floor(rng() * st.relicChoices.length));
  let rerolls = 0;
  const hoards = st.team.some(u => u.kind === 'hoarder' || u.kind === 'warlord');
  const keep = hoards ? (style.greed > 0.5 ? 4 : 2) : style.greed > 0.8 ? 1 : 0; // save gold for Hoarders
  for (let step = 0; step < 40 && st.gold > keep; step++) {
    // 1) best unit purchase
    const offers = st.shop
      .map((s, i) => ({ s, i }))
      .filter(o => o.s.kind && !o.s.isItem)
      .sort((a, b) => scoreKind(st, b.s.kind, style) - scoreKind(st, a.s.kind, style));
    let acted = false;
    if (st.gold >= UNIT_COST && offers.length) {
      const o = offers[0];
      const mergeIdx = st.team.findIndex(u => u.kind === o.s.kind && u.xp < 5);
      const emptyIdx = st.team.findIndex(u => !u.kind);
      if (mergeIdx >= 0) acted = tryDo(() => buy(st, rng, o.i, mergeIdx));
      else if (emptyIdx >= 0) acted = tryDo(() => buy(st, rng, o.i, emptyIdx));
      else {
        const w = weakest(st);
        const wu = st.team[w];
        if (w >= 0 && scoreKind(st, o.s.kind, style) > power(wu) + UNITS[wu.kind].tier * 3 + levelOf(wu.xp) * 6 + 3) {
          sell(st, rng, w);
          acted = tryDo(() => buy(st, rng, o.i, w));
        }
      }
    }
    if (acted) continue;
    // 2) items
    const item = st.shop.findIndex(s => s.kind && s.isItem);
    const units = st.team.map((u, i) => ({ u, i })).filter(x => x.u.kind);
    if (item >= 0 && st.gold >= itemCost(st) && units.length >= 3) {
      const def = ITEMS[st.shop[item].kind];
      const cands = def.held ? units.filter(x => !x.u.item) : units;
      if (cands.length) {
        const best = cands.sort((a, b) => power(b.u) - power(a.u))[0];
        if (tryDo(() => buy(st, rng, item, best.i))) continue;
      }
    }
    // 3) reroll
    if (rerolls < style.rerollBudget && st.gold >= 1) { rerolls++; reroll(st, rng); continue; }
    break;
  }
  arrange(st, rng);
}

// Put sturdy units in front, summoners and support behind.
function arrange(st: RunState, rng: Rng) {
  const order = st.team
    .map((u, i) => ({ u, i }))
    .filter(x => x.u.kind)
    .sort((a, b) => frontScore(b.u) - frontScore(a.u));
  const desired: Unit[] = order.map(x => x.u);
  for (let target = 0; target < desired.length; target++) {
    const cur = st.team.indexOf(desired[target]);
    if (cur !== target) {
      const a = st.team[cur], b = st.team[target];
      st.team[cur] = b; st.team[target] = a;
    }
  }
  void rng;
}

function frontScore(u: Unit) {
  const d = UNITS[u.kind];
  let s = u.hp * 1.2 + u.atk;
  if (d.faint || d.hurt) s += 4; // likes to be hit
  if (d.friendAheadAttacks || d.friendFaint || d.friendSummoned) s -= 8; // support
  if (u.kind === 'dwarf') s += 6;
  return s;
}


// One whole bot run, round by round. Each turn the bot shops, then `battle` gets the team as it enters the
// fight (and can save it as a ghost) and says who won: 0 the bot, 1 its opponent, -1 a draw.
export function botRun(rng: Rng, battle: (st: RunState) => 0 | 1 | -1, maxRound = 18): RunState {
  const st = newRun(rng);
  const style = randomStyle(rng);
  while (st.status === 'shop' && st.round <= maxRound) {
    botTurn(st, rng, style);
    endTurn(st, rng);
    afterBattle(st, rng, battle(st));
  }
  return st;
}
