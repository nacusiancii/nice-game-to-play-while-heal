// Play a run of Rabble Below from the terminal, one command at a time. Made for agents and humans alike.
// Same rules and ghost matchmaking as the server; the run is saved to a file between commands.
//
//   ./play new [seed]            start a run
//   ./play show                  everything: team, shop, gold, lives, relics, ability texts
//   ./play buy <shop> <slot>     a unit into a team slot (empty, or the same kind to merge),
//                                or an item onto the unit in that slot. <shop> is a number or part of a name.
//   ./play sell <slot>
//   ./play move <from> <to>      swap two slots (merges if they're the same kind)
//   ./play order <slots...>      line the team up in this order, e.g. `order 3 0 1` (others keep their order behind)
//   ./play reroll | freeze <shop> | relic <n>
//   ./play fight [--full]        end the turn and fight a ghost (--full: blow by blow)
//   ./play hint                  what the Veteran would do this turn, with its numbers (changes nothing)
//   ./play note <text>           a line in your playtest diary
//   ./play diary                 your notes and results so far
//   ./play help                  this list
//   --save <file>                which run (default .runs/current.json). Use one per player.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { UNIT_COST, levelOf, teamSlots, type RunState, type Unit } from '../server/src/game/core';
import { ITEMS, RELICS, UNITS } from '../server/src/game/data';
import { fight, type Frame, type Snap } from '../server/src/game/battle';
import * as shop from '../server/src/game/shop';
import { botPool, sideOf } from './lib/pool';
import { makeRng } from './lib/rng';
import { cloneRun } from './lib/state';
import { DEFAULT_OPTS, veteranTurn, type Decision } from './lib/veteran';
import { distinct, nm, verdict } from './lib/report';

interface Save { seed: number; rng: number; st: RunState; diary: string[] }

// ---------- arguments: flags anywhere, unknown flags rejected ----------
const words: string[] = [];
let file = join(import.meta.dirname, '.runs', 'current.json');
let full = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--save') file = resolve(process.argv[++i] ?? fail('--save needs a file'));
  else if (a.startsWith('--save=') || a.startsWith('--save ')) file = resolve(a.slice(7).trim()); // '--save x' quoted as one word
  else if (a === '--full') full = true;
  else if (a.startsWith('--')) fail(`unknown option ${a}`);
  else words.push(a);
}
const [cmd, ...rest] = words;

function fail(msg: string): never { console.log(`! ${msg}`); process.exit(1); }
const num = (i: number, what: string) => {
  const n = Number(rest[i]);
  if (rest[i] === undefined || !Number.isInteger(n)) fail(`expected ${what} as a number, got "${rest[i] ?? ''}"`);
  return n;
};
function load(): Save {
  if (!existsSync(file)) fail(`no run at ${file}. Start one: ./play new --save ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}
function store(s: Save) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(s)); }

const POOL_RUNS = 300;
const stats = (u: { atk: number; hp: number }) => `${u.atk}/${u.hp}`;

// ---------- views ----------
function describeUnit(u: Unit) {
  const L = levelOf(u.xp);
  const d = UNITS[u.kind];
  const next = L < 3 ? ` (${u.xp >= 2 ? 5 - u.xp : 2 - u.xp} more to L${L + 1})` : '';
  return `${d.name} ${stats(u)} L${L}${next} [${d.tribe}]${u.item ? ` holding ${nm(u.item)}` : ''} — ${d.text(L)}`;
}

const header = (st: RunState) =>
  `Round ${st.round} · ${st.gold} gold · ${st.lives} lives · ${st.wins}/10 trophies` +
  (shop.rerollCost(st) === 0 ? ' · next reroll free' : '');

function show(s: Save) {
  const st = s.st;
  console.log(`${header(st)}   (save: ${file})`);
  if (st.status !== 'shop') { console.log(st.status === 'won' ? 'VICTORY. The run is over.' : 'Out of lives. The run is over.'); return; }
  console.log(`Units cost ${UNIT_COST}, items ${shop.itemCost(st)}, a reroll ${shop.rerollCost(st)}. Unspent gold does not carry over (unless a relic says so); some abilities count it at the start of battle.`);
  if (st.relics.length) console.log(`Relics: ${st.relics.map(r => `${RELICS[r].name} (${RELICS[r].text})`).join('; ')}`);
  if (st.relicChoices.length) {
    console.log(`\nChoose a relic first (relic <n>):`);
    st.relicChoices.forEach((r, i) => console.log(`  ${i}. ${RELICS[r].name} — ${RELICS[r].text}`));
  }
  console.log(`\nTeam (slot 0 fights first; empty slots are skipped in battle; ${teamSlots(st.relics)} slots):`);
  st.team.forEach((u, i) => console.log(`  ${i}. ${u.kind ? describeUnit(u) : '(empty)'}`));
  console.log(`\nShop:`);
  st.shop.forEach((x, i) => {
    if (!x.kind) return;
    const fz = x.frozen ? ' [frozen]' : '';
    if (x.isItem) console.log(`  ${i}. item: ${ITEMS[x.kind].name} — ${ITEMS[x.kind].text}${fz}`);
    else {
      const d = UNITS[x.kind];
      console.log(`  ${i}. T${d.tier} ${d.name} ${stats(x)} [${d.tribe}] — ${d.text(1)}${fz}`);
    }
  });  console.log(`\nCommands: buy <shop> <slot> · sell <slot> · move <from> <to> · order <slots...> · reroll · freeze <shop> · relic <n> · fight · hint · help`);
}

// After an action: what happened, then just enough to plan the next one.
function brief(s: Save, what: string) {
  const st = s.st;
  console.log(`${what}\n${header(st)}`);
  console.log(`  team: ${st.team.map((u, i) => `${i} ${u.kind ? `${nm(u.kind)} ${stats(u)}${levelOf(u.xp) > 1 ? ` L${levelOf(u.xp)}` : ''}${u.item ? ` +${nm(u.item)}` : ''}` : '-'}`).join(' · ')}`);
  console.log(`  shop: ${st.shop.map((x, i) => x.kind ? `${i} ${x.isItem ? 'item ' : ''}${nm(x.kind)}${x.isItem ? '' : ` ${stats(x)}`}${x.frozen ? ' (frozen)' : ''}` : '').filter(Boolean).join(' · ') || '(empty)'}`);
  if (st.relicChoices.length) console.log(`  choose a relic: ${st.relicChoices.map((r, i) => `${i} ${RELICS[r].name}`).join(' · ')}`);
}

// ---------- battle ----------
function narrate(frames: Frame[]) {
  const lines: string[] = [];
  const seen = new Map<number, { s: Snap; mine: boolean }>();
  const label = (uid: number) => { const x = seen.get(uid); return x ? `${x.mine ? 'your' : 'their'} ${nm(x.s.k)}` : `#${uid}`; };
  for (const f of frames) {
    for (const s of f.a) seen.set(s.u, { s, mine: true });
    for (const s of f.b) seen.set(s.u, { s, mine: false });
    const parts: string[] = [];
    for (const x of f.fx) {
      if (x.t === 'note') parts.push(`-- ${x.s} --`);
      else if (x.t === 'atk') parts.push(`${label(x.u)} attacks`);
      else if (x.t === 'dmg') parts.push(`${label(x.u)} takes ${x.n}`);
      else if (x.t === 'buff') parts.push(`${label(x.u)} ${x.a >= 0 ? '+' : ''}${x.a}/${x.h >= 0 ? '+' : ''}${x.h}`);
      else if (x.t === 'ward') parts.push(`${label(x.u)} +${x.n} ward`);
      else if (x.t === 'heal') parts.push(`${label(x.u)} heals ${x.n}`);
      else if (x.t === 'die') parts.push(`${label(x.u)} faints`);
      else if (x.t === 'sum') parts.push(`${label(x.u)} appears`);
      else if (x.t === 'zap') parts.push(`${label(x.f)} zaps ${label(x.u)}`);
    }
    if (!parts.length) continue;
    lines.push(`  ${parts.join('; ')}\n      you: ${line(f.a)}  |  them: ${line(f.b)}`);
  }
  return lines;
}
const line = (ss: Snap[]) => ss.filter(s => s.h > 0).map(s => `${nm(s.k)} ${s.a}/${s.h}${s.w ? `+${s.w}w` : ''}`).join(', ') || '-';

// The short story: both lines once start-of-battle effects are done, and who was left standing.
function summary(frames: Frame[]) {
  const firstHit = frames.findIndex(f => f.fx.some(x => x.t === 'atk'));
  const lineup = frames[Math.max(0, firstHit - 1)] ?? frames[0];
  const end = frames[frames.length - 1];
  const exchanges = frames.filter(f => f.fx.some(x => x.t === 'atk')).length;
  return [
    `  lined up:  you: ${line(lineup.a)}`,
    `             them: ${line(lineup.b)}`,
    `  standing after ${exchanges} exchanges:  you: ${line(end.a)}  |  them: ${line(end.b)}`,
  ];
}

function doFight(s: Save) {
  const st = s.st;
  if (st.status !== 'shop') fail('the run is over');
  if (st.relicChoices.length) fail('choose a relic first');
  if (!st.team.some(u => u.kind)) fail('recruit someone first');
  const rng = makeRng(s.rng);
  const pool = botPool(s.seed, POOL_RUNS);
  shop.endTurn(st, rng);
  const opp = pool.opponent(rng, st.round, st.wins);
  const res = opp ? fight(rng, sideOf(st), sideOf(opp)) : { winner: 0 as const, frames: [] };
  const word = res.winner === 0 ? 'WIN' : res.winner === 1 ? 'LOSS' : 'DRAW';
  const round = st.round;
  if (opp) {
    console.log(`Round ${round} vs a ghost with ${opp.wins} trophies, ${opp.lives} lives, ${opp.gold} unspent gold${opp.relics.length ? `, relics: ${opp.relics.map(nm).join(', ')}` : ''}`);
    console.log((full ? narrate(res.frames) : summary(res.frames)).join('\n'));
  }
  console.log(`=> ${word}${full ? '' : '   (fight --full for blow by blow)'}\n`);
  shop.afterBattle(st, rng, res.winner);
  s.diary.push(`[round ${round}] ${word} → ${st.wins} trophies, ${st.lives} lives`);
  s.rng = rng.a;
  store(s);
  show(s);
}

// ---------- the Veteran's opinion ----------
function hint(s: Save) {
  if (s.st.status !== 'shop') fail('the run is over');
  const pool = botPool(s.seed + 1_000_003, POOL_RUNS); // it knows the meta, not your exact opponent
  const x = cloneRun(s.st);
  const log: Decision[] = [];
  veteranTurn(x, makeRng(s.rng ^ 0x9e3779b9), pool, DEFAULT_OPTS, log);
  const plan = log.map(d => d.kind === 'order' ? 'reorder' : d.kind === 'reroll' && d.chosen !== 'reroll' ? '' : d.chosen).filter(Boolean);
  console.log(`Veteran's plan: ${plan.join(' → ') || 'nothing to do'} → fight`);
  console.log(`  ends with: ${x.team.filter(u => u.kind).map(u => `${nm(u.kind)} ${stats(u)}`).join(', ')}; ${x.gold} gold left`);
  console.log(`  (after a reroll its shop is its own guess; yours will differ)\n`);
  console.log(`Its numbers: battle score this round, 0-100 (half from a look 2 turns ahead); relics: trophies by run end.`);
  for (const d of log) {
    if (d.kind === 'order') { console.log(`  order   ${d.options[1].value.toFixed(2)} → ${d.options[0].value.toFixed(2)} (this fight only)`); continue; }
    const v = (n: number) => (d.unit === 'wins' ? n.toFixed(2) : (100 * n).toFixed(0));
    console.log(`  ${d.kind.padEnd(6)}  ${distinct(d).slice(0, 3).map(o => `${o.label}: ${v(o.value)}`).join('  |  ')}   [${verdict(d)}]`);
  }
}

// ---------- shop actions ----------
function shopIndex(st: RunState, arg: string | undefined): number {
  if (arg === undefined) fail('which shop slot? (a number or part of a name)');
  if (/^\d+$/.test(arg)) return Number(arg);
  const hits = st.shop.map((x, i) => ({ x, i })).filter(({ x }) => x.kind && nm(x.kind).toLowerCase().includes(arg.toLowerCase()));
  if (hits.length !== 1) fail(hits.length ? `"${arg}" matches ${hits.map(h => nm(h.x.kind)).join(' and ')}; be more specific` : `nothing in the shop matches "${arg}"`);
  return hits[0].i;
}

function act(s: Save) {
  const st = s.st;
  const rng = makeRng(s.rng);
  let what = '';
  try {
    if (cmd === 'buy') {
      const si = shopIndex(st, rest[0]);
      const ti = num(1, 'a team slot');
      const offer = st.shop[si];
      const before = st.team[ti] ? { ...st.team[ti] } : undefined;
      shop.buy(st, rng, si, ti);
      const u = st.team[ti];
      if (offer?.isItem) {
        const replaced = ITEMS[offer.kind].held && before?.item && before.item !== offer.kind ? ` (replaced its ${nm(before.item)})` : '';
        what = `${nm(offer.kind)} → ${nm(u.kind)} in slot ${ti}, now ${stats(u)}${replaced}.`;
      } else if (before?.kind) {
        const L0 = levelOf(before.xp), L1 = levelOf(u.xp);
        what = `Merged ${nm(u.kind)} in slot ${ti}: now ${stats(u)} L${L1}` + (L1 > L0 ? `. Level up! Now: "${UNITS[u.kind].text(L1)}" A bonus unit from the next tier joined the shop.` : '.');
      } else what = `Bought ${nm(u.kind)} into slot ${ti}.`;
    } else if (cmd === 'sell') {
      const ti = num(0, 'a team slot');
      const u = st.team[ti];
      const g = st.gold;
      shop.sell(st, rng, ti);
      what = `Sold ${nm(u?.kind ?? '')} for ${st.gold - g} gold.`;
    } else if (cmd === 'move') {
      shop.move(st, rng, num(0, 'from'), num(1, 'to'));
      what = 'Moved.';
    } else if (cmd === 'order') {
      const want = rest.map((_, i) => num(i, 'a team slot'));
      if (new Set(want).size !== want.length || want.some(i => i < 0 || i >= st.team.length)) fail('order takes distinct team slots');
      const others = st.team.map((_, i) => i).filter(i => !want.includes(i));
      st.team = [...want, ...others].map(i => st.team[i]);
      what = 'Reordered.';
    } else if (cmd === 'reroll') { shop.reroll(st, rng); what = 'Rerolled.'; }
    else if (cmd === 'freeze') {
      const si = shopIndex(st, rest[0]);
      shop.toggleFreeze(st, si);
      what = `${st.shop[si].frozen ? 'Froze' : 'Unfroze'} ${nm(st.shop[si].kind)}.`;
    } else if (cmd === 'relic') {
      const r = st.relicChoices[num(0, 'a relic')];
      shop.chooseRelic(st, num(0, 'a relic'));
      what = `Took ${nm(r)}: ${RELICS[r].text}`;
    } else fail(`unknown command "${cmd}". Commands: new show buy sell move order reroll freeze relic fight hint note diary help`);
  } catch (e) { fail((e as Error).message); }
  s.rng = rng.a;
  store(s);
  brief(s, what);
}

// ---------- commands ----------
if (cmd === 'new') {
  const seed = rest[0] ? num(0, 'a seed') : Math.floor(Math.random() * 1e9);
  const rng = makeRng(seed);
  const st = shop.newRun(rng);
  const s: Save = { seed, rng: rng.a, st, diary: [`run started, seed ${seed}`] };
  store(s);
  console.log(`New run, seed ${seed}.\n`);
  show(s);
} else if (cmd === 'help') {
  console.log(readFileSync(import.meta.filename, 'utf8').split('\n').filter(l => l.startsWith('//   ')).map(l => l.slice(5)).join('\n'));
} else if (cmd === 'show' || !cmd) show(load());
else if (cmd === 'fight') doFight(load());
else if (cmd === 'hint') hint(load());
else if (cmd === 'note') {
  if (!rest.length) fail('note what?');
  const s = load();
  s.diary.push(`[round ${s.st.round}] note: ${rest.join(' ')}`);
  store(s);
  console.log(`noted in ${file}`);
} else if (cmd === 'diary') console.log(load().diary.join('\n'));
else act(load());
