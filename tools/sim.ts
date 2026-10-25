// Quick league: simple bots play full runs against each other's ghosts, matched as on the server.
// Prints balance hints: how often each unit, tribe and relic is on the winning side from round 6.
// Usage: npx tsx sim.ts [runs] [seed]
import { UNITS } from '../server/src/game/data';
import { fight } from '../server/src/game/battle';
import { botRun } from '../server/src/game/bot';
import { Pool, sideOf } from './lib/pool';
import { makeRng } from './lib/rng';

const RUNS = Number(process.argv[2] ?? 400);
const rng = makeRng(Number(process.argv[3] ?? 7));
const pool = new Pool();

type Tally = Map<string, { w: number; n: number }>;
const units: Tally = new Map(), tribes: Tally = new Map(), relics: Tally = new Map();
const count = (t: Tally, k: string, won: number) => { const s = t.get(k) ?? { w: 0, n: 0 }; s.w += won; s.n++; t.set(k, s); };
let battles = 0, beats = 0, maxBeats = 0, draws = 0;
const finals: number[] = [];

for (let r = 0; r < RUNS; r++) {
  const st = botRun(rng, me => {
    const opp = pool.opponent(rng, me.round, me.wins);
    pool.add(me, 'bot');
    if (!opp) return 0;
    const res = fight(rng, structuredClone(sideOf(me)), structuredClone(sideOf(opp)));
    battles++; beats += res.frames.length; maxBeats = Math.max(maxBeats, res.frames.length);
    if (res.winner === -1) { draws++; return -1; }
    if (me.round >= 6) {
      const won = res.winner === 0 ? 1 : 0;
      const team = me.team.filter(u => u.kind);
      for (const k of new Set(team.map(u => u.kind))) count(units, k, won);
      const byTribe = new Map<string, number>();
      for (const u of team) byTribe.set(UNITS[u.kind].tribe, (byTribe.get(UNITS[u.kind].tribe) ?? 0) + 1);
      for (const [t, c] of byTribe) if (c >= 3) count(tribes, t, won);
      for (const k of me.relics) count(relics, k, won);
    }
    return res.winner;
  }, 40);
  finals.push(st.wins);
}

const pct = (s: { w: number; n: number }) => `${(100 * s.w / Math.max(1, s.n)).toFixed(0).padStart(3)}% (n=${s.n})`;
const byRate = (t: Tally) => [...t.entries()].sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n);
console.log(`battles=${battles} avgBeats=${(beats / battles).toFixed(1)} maxBeats=${maxBeats} draws=${(100 * draws / battles).toFixed(1)}%`);
console.log('victories:', finals.filter(w => w >= 10).length, '/', RUNS, ' avg wins', (finals.reduce((a, b) => a + b, 0) / RUNS).toFixed(2));
console.log('\nUnit win rate when fielded (round>=6):');
for (const [k, s] of byRate(units)) console.log(`  T${UNITS[k].tier} ${UNITS[k].tribe.padEnd(7)} ${k.padEnd(12)} ${pct(s)}`);
console.log('\nTribe (3+ of tribe):');
for (const [k, s] of byRate(tribes)) console.log(`  ${k.padEnd(8)} ${pct(s)}`);
console.log('\nRelics:');
for (const [k, s] of byRate(relics)) console.log(`  ${k.padEnd(8)} ${pct(s)}`);
