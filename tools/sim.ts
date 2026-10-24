// Headless league: bots play full runs against each other's ghosts. Prints balance stats.
// Usage: npx tsx sim.ts [runs] [seed]
import { mulberry32, levelOf, type RunState, type Unit } from '../server/src/game/core';
import { UNITS } from '../server/src/game/data';
import { fight } from '../server/src/game/battle';
import { newRun, endTurn, afterBattle } from '../server/src/game/shop';
import { botTurn, randomStyle } from '../server/src/game/bot';

const RUNS = Number(process.argv[2] ?? 400);
const rng = mulberry32(Number(process.argv[3] ?? 7));

interface Ghost { round: number; team: Unit[]; relics: string[]; gold: number }
const ghosts = new Map<number, Ghost[]>();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const unitStats = new Map<string, { w: number; n: number }>();
const tribeStats = new Map<string, { w: number; n: number }>();
const relicStats = new Map<string, { w: number; n: number }>();
let frames = 0, battles = 0, draws = 0, maxFrames = 0;
const finals: number[] = [];

for (let r = 0; r < RUNS; r++) {
  const st: RunState = newRun(rng);
  const style = randomStyle(rng);
  while (st.status === 'shop' && st.round < 40) {
    botTurn(st, rng, style);
    endTurn(st, rng);
    const me: Ghost = { round: st.round, team: clone(st.team), relics: [...st.relics], gold: st.gold };
    const pool = ghosts.get(st.round) ?? [];
    let winner: 0 | 1 | -1 = 0;
    if (pool.length) {
      const opp = pool[Math.floor(rng() * pool.length)];
      const res = fight(rng, { team: clone(me.team), relics: me.relics, gold: me.gold }, { team: clone(opp.team), relics: opp.relics, gold: opp.gold });
      winner = res.winner;
      battles++; frames += res.frames.length; maxFrames = Math.max(maxFrames, res.frames.length);
      if (winner === -1) draws++;
      if (st.round >= 6 && winner !== -1) {
        const won = winner === 0 ? 1 : 0;
        const kinds = new Set(me.team.filter(u => u.kind).map(u => u.kind));
        for (const k of kinds) { const s = unitStats.get(k) ?? { w: 0, n: 0 }; s.w += won; s.n++; unitStats.set(k, s); }
        const tribes = new Map<string, number>();
        for (const u of me.team) if (u.kind) tribes.set(UNITS[u.kind].tribe, (tribes.get(UNITS[u.kind].tribe) ?? 0) + 1);
        for (const [t, c] of tribes) if (c >= 3) { const s = tribeStats.get(t) ?? { w: 0, n: 0 }; s.w += won; s.n++; tribeStats.set(t, s); }
        for (const rl of me.relics) { const s = relicStats.get(rl) ?? { w: 0, n: 0 }; s.w += won; s.n++; relicStats.set(rl, s); }
      }
    }
    pool.push(me); ghosts.set(st.round, pool);
    afterBattle(st, rng, winner);
  }
  finals.push(st.wins);
}

const pct = (s: { w: number; n: number }) => (100 * s.w / Math.max(1, s.n)).toFixed(0).padStart(3) + `% (n=${s.n})`;
console.log(`battles=${battles} avgFrames=${(frames / battles).toFixed(1)} maxFrames=${maxFrames} draws=${(100 * draws / battles).toFixed(1)}%`);
console.log('victories:', finals.filter(w => w >= 10).length, '/', RUNS, ' avg wins', (finals.reduce((a, b) => a + b, 0) / RUNS).toFixed(2));
console.log('\nUnit win rate when fielded (round>=6):');
[...unitStats.entries()].sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n)
  .forEach(([k, s]) => console.log(`  T${UNITS[k].tier} ${UNITS[k].tribe.padEnd(7)} ${k.padEnd(12)} ${pct(s)}`));
console.log('\nTribe (3+ of tribe):');
[...tribeStats.entries()].forEach(([k, s]) => console.log(`  ${k.padEnd(8)} ${pct(s)}`));
console.log('\nRelics:');
[...relicStats.entries()].forEach(([k, s]) => console.log(`  ${k.padEnd(8)} ${pct(s)}`));
void levelOf;
