// The Veteran's league: thoughtful players run the market against a pool of bot ghosts.
// Reports how they fare, what they build, and which choices were real dilemmas and which were obvious.
//
//   ./veteran league [runs=56] [seed=1]   win rates + decision report (about a minute on 4 cores)
//   ./veteran trace [seed=1]              one run, turn by turn, with the Veteran's reasoning
//   ./veteran diff before.json after.json what changed between two `league --json` runs, and whether it's noise
//   --json                       league: machine-readable numbers instead of the report
//   --field=bots                 only bot ghosts, like a fresh server (default: bots + veteran ghosts)
//   --new-field                  rebuild the veteran ghosts under the current rules (kept until you ask)
//   --jobs=N                     worker processes (default 4, at low priority)
//   --opts='{"aheadWeight":0}'   change how the Veteran thinks (see VeteranOpts in lib/veteran.ts)
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, setPriority } from 'node:os';
import { join } from 'node:path';
import { levelOf, WINS_TO_VICTORY } from '../server/src/game/core';
import { RELICS, UNITS } from '../server/src/game/data';
import { Pool, botPool, rulesHash, type Ghost } from './lib/pool';
import { makeRng } from './lib/rng';
import { DEFAULT_OPTS, veteranRun, type Decision, type RunLog, type VeteranOpts, type World } from './lib/veteran';
import {
  VERDICTS, VERDICT_HELP, decisionStats, distinct, fmt, nm, patterns, relicStats, unitStats, verdict,
} from './lib/report';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const optArg = process.argv.slice(2).find(a => a.startsWith('--opts='));
const OPTS: VeteranOpts = { ...DEFAULT_OPTS, ...(optArg ? JSON.parse(optArg.slice(7)) : {}) };
const POOL_RUNS = 300; // bot runs in the field
const FIELD_VETERANS = 60; // veteran runs added to the field
const JOBS = Number(process.argv.slice(2).find(a => a.startsWith('--jobs='))?.slice(7) ?? 4);
const DIR = import.meta.dirname;
const fieldArg = process.argv.slice(2).find(a => a.startsWith('--field='))?.slice(8) ?? 'mixed';

type Played = Omit<RunLog, 'final'> & { seed: number; final: { team: RunLog['final']['team']; relics: string[] } };

// Play runs on a few low-priority workers, so the machine stays usable. Workers read the field from files.
async function playAll(seeds: number[], files: Field['files'], opts: VeteranOpts): Promise<Played[]> {
  const n = Math.max(1, Math.min(JOBS, availableParallelism() - 1, seeds.length));
  const chunks = Array.from({ length: n }, (_, w) => seeds.filter((_, i) => i % n === w));
  const parts = await Promise.all(chunks.map(c => new Promise<Played[]>((ok, bad) => {
    const child = fork(process.argv[1], process.argv.slice(2), {
      env: { ...process.env, VETERAN_WORKER: JSON.stringify({ files, seeds: c, opts }) },
      execArgv: process.execArgv,
    });
    try { setPriority(child.pid!, 15); } catch { /* not allowed here: run at normal priority */ }
    child.on('message', m => ok(m as Played[]));
    child.on('error', bad);
    child.on('exit', code => { if (code) bad(new Error(`worker exited ${code}`)); });
  })));
  // Back in seed order, so results don't depend on how many cores did the work.
  const bySeed = new Map(parts.flat().map(r => [r.seed, r]));
  return seeds.map(s => bySeed.get(s)!);
}

const pct = (a: number, b: number) => (b ? `${Math.round(100 * a / b)}%` : '-');
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);

function summary(rs: { wins: number; won: boolean }[]) {
  const n = rs.length;
  const p = rs.filter(r => r.won).length / n;
  const avg = rs.reduce((t, r) => t + r.wins, 0) / n;
  const sd = Math.sqrt(rs.reduce((t, r) => t + (r.wins - avg) ** 2, 0) / Math.max(1, n - 1));
  // ± is two standard errors: differences smaller than that between two leagues are probably noise.
  return { runs: n, victories: p, victoriesPm: 2 * Math.sqrt(p * (1 - p) / n), avgWins: avg, avgWinsPm: 2 * sd / Math.sqrt(n) };
}

// The opponents, in two halves of the same kind (see World): the Veteran learns from one and fights the other.
// Bot ghosts like a fresh server; in 'mixed', also the ghosts of veterans who played against those bots,
// as a stand-in for a server full of decent players. Built once per seed and kept across rule changes, like
// ghosts on a live server after a patch: a before/after comparison then faces the very same opponents.
interface Field { world: World; files: { know: string; meet: string }; label: string }
async function field(seed: number, kind: string): Promise<Field> {
  const cache = join(DIR, '.cache');
  mkdirSync(cache, { recursive: true });
  const save = (name: string, ghosts: Ghost[]) => { const f = join(cache, name); writeFileSync(f, JSON.stringify(ghosts)); return f; };
  const bots = { know: botPool(seed + 1_000_003, POOL_RUNS), meet: botPool(seed, POOL_RUNS) };
  const botFiles = { know: save(`bots-know-${seed}.json`, bots.know.all()), meet: save(`bots-meet-${seed}.json`, bots.meet.all()) };
  if (kind === 'bots') return { world: bots, files: botFiles, label: `${bots.meet.size()} bot ghosts` };
  const files = { know: join(cache, `field-${seed}-know.json`), meet: join(cache, `field-${seed}-meet.json`) };
  const stamp = join(cache, `field-${seed}-rules.txt`);
  if (!existsSync(files.meet) || flags.has('--new-field')) {
    process.stderr.write(`Building a field of ${FIELD_VETERANS} veteran runs (once per seed)...\n`);
    writeFileSync(stamp, rulesHash());
    const seeds = Array.from({ length: FIELD_VETERANS }, (_, i) => 7_000_000 + seed * 1000 + i);
    const played = await playAll(seeds, botFiles, DEFAULT_OPTS);
    const half = (h: number) => played.filter((_, i) => i % 2 === h).flatMap(r => r.ghosts);
    writeFileSync(files.know, JSON.stringify([...bots.know.all(), ...half(0)]));
    writeFileSync(files.meet, JSON.stringify([...bots.meet.all(), ...half(1)]));
  }
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') !== rulesHash()) {
    process.stderr.write(`Note: the veteran ghosts were built under older rules. Fine for before/after tests; --new-field to refresh.\n`);
  }
  const load = (f: string): Ghost[] => JSON.parse(readFileSync(f, 'utf8'));
  const meet = load(files.meet);
  const vets = meet.filter(g => g.who === 'veteran').length;
  return { world: { know: Pool.of(load(files.know)), meet: Pool.of(meet) }, files, label: `${meet.length - vets} bot + ${vets} veteran ghosts` };
}

async function league(runs: number, seed: number) {
  const t0 = Date.now();
  const { world, files, label } = await field(seed, fieldArg);
  const brng = makeRng(seed ^ 0x5eed);
  const bots = Array.from({ length: Math.max(runs, 200) }, () => world.meet.botRun(brng, 30, false))
    .map(st => ({ wins: st.wins, won: st.status === 'won' }));
  const vets = await playAll(Array.from({ length: runs }, (_, i) => seed * 100003 + i), files, OPTS);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const vs = summary(vets), bs = summary(bots);
  const all = vets.flatMap(r => r.decisions);

  if (flags.has('--json')) {
    console.log(JSON.stringify({
      seed, field: label, opts: OPTS, veteran: vs, bots: bs, decisions: decisionStats(all), units: unitStats(vets), relics: relicStats(vets),
      dilemmas: patterns(all, 'dilemma').slice(0, 20), obvious: patterns(all, 'obvious').slice(0, 20),
    }, null, 1));
    return;
  }

  console.log(`Veteran league: ${runs} runs vs ${label} (seed ${seed}, ${secs}s)\n`);
  console.log(`              reach ${WINS_TO_VICTORY}        avg trophies`);
  for (const [who, s] of [['veteran', vs], ['simple bot', bs]] as const) {
    console.log(`  ${pad(who, 11)} ${lpad(pct(s.victories, 1), 4)} ±${lpad(Math.round(100 * s.victoriesPm), 2)}%    ${s.avgWins.toFixed(1)} ±${s.avgWinsPm.toFixed(1)}`);
  }

  console.log(`\nHow the Veteran's choices felt:`);
  for (const v of VERDICTS) console.log(`  ${pad(v, 8)} ${VERDICT_HELP[v]}`);
  console.log(`\n  ${pad('choice', 8)} ${lpad('n', 5)} ${VERDICTS.map(v => lpad(v, 8)).join('')}`);
  for (const [k, s] of Object.entries(decisionStats(all))) {
    console.log(`  ${pad(k, 8)} ${lpad(s.n, 5)} ${VERDICTS.map(v => lpad(pct(s[v], s.n), 8)).join('')}`);
  }

  console.log(`\nUnits: how often the Veteran buys one when it's on the shelf, and how often it's in a ${WINS_TO_VICTORY}-trophy team`);
  console.log(`  ${pad('unit', 24)} ${lpad('seen', 5)} ${lpad('bought', 7)} ${lpad('in winners', 11)}`);
  for (const u of unitStats(vets)) {
    console.log(`  ${pad(`T${UNITS[u.kind].tier} ${UNITS[u.kind].name}`, 24)} ${lpad(u.seen, 5)} ${lpad(pct(u.bought, u.seen), 7)} ${lpad(pct(u.inWins, vs.victories * runs), 11)}`);
  }

  console.log(`\nRelics: pick rate when offered, and the Veteran's estimate of what each adds over the average offer (trophies)`);
  for (const r of relicStats(vets)) {
    console.log(`  ${pad(RELICS[r.kind].name, 18)} offered ${lpad(r.offered, 4)}  taken ${lpad(pct(r.taken, r.offered), 4)}  edge ${r.edge >= 0 ? '+' : ''}${r.edge.toFixed(2)}`);
  }

  console.log(`\nRecurring dilemmas (close calls that mattered; avg stakes):`);
  for (const p of patterns(all, 'dilemma').slice(0, 8)) console.log(`  ${lpad(p.n, 4)}x  ${p.what}  (${p.avg.toFixed(2)})`);
  console.log(`\nRecurring obvious calls (avg margin):`);
  for (const p of patterns(all, 'obvious').slice(0, 8)) console.log(`  ${lpad(p.n, 4)}x  ${p.what}  (${p.avg.toFixed(2)})`);
  console.log(`\nShop and reroll numbers are battle scores for this round (0-1, blended with a look ${OPTS.aheadTurns} turns ahead); relic numbers are trophies by run end.`);
}

// Compare two league reports. A change is flagged when it's bigger than the noise of both runs together.
function diff(a: string, b: string) {
  const A = JSON.parse(readFileSync(a, 'utf8')), B = JSON.parse(readFileSync(b, 'utf8'));
  // pm values are two standard errors. Headline numbers need 2 SE; lists compare ~30 things at once,
  // so they need 3 SE, or one or two would light up by chance alone.
  const sig = (d: number, pmA: number, pmB: number, many = false) => (Math.abs(d) > (many ? 1.5 : 1) * Math.hypot(pmA, pmB) ? '  <- real' : '');
  const sign = (x: number, digits = 0) => `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;
  console.log(`${a} -> ${b}\n`);
  for (const who of ['veteran', 'bots'] as const) {
    const x = A[who], y = B[who];
    console.log(`${pad(who === 'veteran' ? 'veteran' : 'simple bot', 11)} reach 10: ${pct(x.victories, 1)} -> ${pct(y.victories, 1)} (${sign(100 * (y.victories - x.victories))} pts)${sig(y.victories - x.victories, x.victoriesPm, y.victoriesPm)}` +
      `   avg trophies: ${x.avgWins.toFixed(1)} -> ${y.avgWins.toFixed(1)}${sig(y.avgWins - x.avgWins, x.avgWinsPm, y.avgWinsPm)}`);
  }
  // Buy rate is a proportion; its noise is about sqrt(p(1-p)/n).
  const rate = (u: { bought: number; seen: number }) => u.bought / Math.max(1, u.seen);
  const pm = (u: { bought: number; seen: number }) => 2 * Math.sqrt(rate(u) * (1 - rate(u)) / Math.max(1, u.seen));
  const ua = new Map<string, any>(A.units.map((u: any) => [u.kind, u]));
  const moves = B.units.map((u: any) => ({ u, o: ua.get(u.kind) })).filter((x: any) => x.o)
    .map((x: any) => ({ kind: x.u.kind, from: rate(x.o), to: rate(x.u), real: sig(rate(x.u) - rate(x.o), pm(x.o), pm(x.u), true) }))
    .sort((p: any, q: any) => Math.abs(q.to - q.from) - Math.abs(p.to - p.from));
  console.log(`\nBuy rate when seen, biggest moves:`);
  for (const m of moves.slice(0, 10)) console.log(`  ${pad(nm(m.kind), 22)} ${lpad(pct(m.from, 1), 4)} -> ${lpad(pct(m.to, 1), 4)}${m.real}`);
  const ra = new Map<string, any>(A.relics.map((r: any) => [r.kind, r]));
  console.log(`\nRelic pick rate and edge (trophies over the average offer):`);
  for (const r of B.relics) {
    const o = ra.get(r.kind);
    const t = (x: any) => ({ bought: x.taken, seen: x.offered });
    if (o) console.log(`  ${pad(nm(r.kind), 18)} taken ${lpad(pct(o.taken, o.offered), 4)} -> ${lpad(pct(r.taken, r.offered), 4)}   edge ${sign(o.edge, 2)} -> ${sign(r.edge, 2)}${sig(rate(t(r)) - rate(t(o)), pm(t(o)), pm(t(r)), true)}`);
  }
  console.log(`\nChoices (share of shop decisions):`);
  const sa = A.decisions.shop, sb = B.decisions.shop;
  console.log('  ' + VERDICTS.map(v => `${v} ${pct(sa[v], sa.n)} -> ${pct(sb[v], sb.n)}`).join('   '));
  console.log(`\n"real" = beyond the noise of both runs combined (2 standard errors for the headline, 3 for lists).`);
  console.log(`Unflagged moves may still be real: 4x the runs (league 224) halves the noise.`);
}

async function trace(seed: number) {
  const { world } = await field(seed, fieldArg);
  const r = veteranRun(world, seed * 100003, OPTS);
  const byRound = new Map<number, Decision[]>();
  for (const d of r.decisions) byRound.set(d.round, [...(byRound.get(d.round) ?? []), d]);
  console.log(`Numbers: battle score this round (0-100, ${OPTS.aheadWeight ? `half of it from a look ${OPTS.aheadTurns} turns ahead` : 'this fight only'}); relics: expected trophies at run end.`);
  for (const b of r.battles) {
    console.log(`\n== Round ${b.round}`);
    for (const d of byRound.get(b.round) ?? []) {
      if (d.kind === 'order') { console.log(`  order  -> reordered the team (${fmt(d.options[1].value, d.unit)} -> ${fmt(d.options[0].value, d.unit)}, this fight only)`); continue; }
      const top = distinct(d).slice(0, 3).map(o => `${o.label} ${fmt(o.value, d.unit)}`).join(' | ');
      console.log(`  ${pad(d.kind, 6)} -> ${d.chosen} [${verdict(d)}]\n           ${top}`);
    }
    console.log(`  battle: ${b.result === 1 ? 'WIN' : b.result === -1 ? 'loss' : 'draw'}`);
  }
  console.log(`\nFinal: ${r.wins} trophies, ${r.lives} lives, round ${r.round}${r.won ? ' — VICTORY' : ''}`);
  console.log(`Team: ${r.final.team.filter(u => u.kind).map(u => `${nm(u.kind)} L${levelOf(u.xp)} ${u.atk}/${u.hp}${u.item ? ` +${nm(u.item)}` : ''}`).join(', ')}`);
  console.log(`Relics: ${r.final.relics.map(nm).join(', ') || 'none'}`);
}

if (process.env.VETERAN_WORKER) {
  // Worker: play a slice of the league's runs and send them back.
  const { files, seeds, opts } = JSON.parse(process.env.VETERAN_WORKER) as { files: Field['files']; seeds: number[]; opts: VeteranOpts };
  const load = (f: string) => Pool.of(JSON.parse(readFileSync(f, 'utf8')));
  const world = { know: load(files.know), meet: load(files.meet) };
  const out = seeds.map(s => {
    const r = veteranRun(world, s, opts);
    return { ...r, seed: s, final: { team: r.final.team.filter(u => u.kind), relics: r.final.relics } };
  });
  process.send!(out, () => process.exit(0));
} else {
  const cmd = args[0] ?? 'league';
  if (cmd === 'league') await league(Number(args[1] ?? 56), Number(args[2] ?? 1));
  else if (cmd === 'trace') await trace(Number(args[1] ?? 1));
  else if (cmd === 'diff' && args[2]) diff(args[1], args[2]);
  else { console.error('usage: veteran league [runs] [seed] | trace [seed] | diff before.json after.json'); process.exit(1); }
}
