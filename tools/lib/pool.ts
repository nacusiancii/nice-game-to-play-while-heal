// The ghost pool: teams that fought before, by round. Opponents are picked as on the server (match.ts).
import type { Rng, RunState, Unit } from '../../server/src/game/core';
import { Battle, type Side } from '../../server/src/game/battle';
import { botRun } from '../../server/src/game/bot';
import { closest, latestGhosts, pickGhost } from '../../server/src/game/match';
import { pick } from '../../server/src/game/core';
import { makeRng } from './rng';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DIR = import.meta.dirname;

export interface Ghost { round: number; team: Unit[]; relics: string[]; gold: number; wins: number; lives: number; who: string }

// Battle without replay frames: same rules, a lot faster.
class QuietBattle extends Battle {
  beat() { this.fx.length = 0; }
}
export const quickFight = (rng: Rng, a: Side, b: Side) => new QuietBattle(rng, [a, b]).run().winner;

// Battle score for side a: win 1, draw 0.5, loss up to 0.3 for how much of the enemy it took down.
// The partial credit lets a half-built team tell a good first buy from a bad one.
export function fightScore(rng: Rng, a: Side, b: Side): { winner: 0 | 1 | -1; score: number } {
  const bt = new QuietBattle(rng, [a, b]);
  const { winner } = bt.run();
  if (winner === 0) return { winner, score: 1 };
  if (winner === -1) return { winner, score: 0.5 };
  const left = bt.alive(1).length;
  return { winner, score: 0.3 * Math.max(0, 1 - left / Math.max(1, b.team.length)) };
}

export const sideOf = (x: { team: Unit[]; relics: string[]; gold: number }): Side =>
  ({ team: x.team.filter(u => u.kind), relics: x.relics, gold: x.gold });

// The team as it enters a fight (call after endTurn).
export const ghostOf = (st: RunState, who: string): Ghost => ({
  round: st.round, team: st.team.filter(u => u.kind).map(u => ({ ...u })), relics: [...st.relics],
  gold: st.gold, wins: st.wins, lives: st.lives, who,
});

export class Pool {
  byRound = new Map<number, Ghost[]>();
  at = (round: number) => this.byRound.get(round) ?? [];

  add(st: RunState, who: string) { this.push(ghostOf(st, who)); }
  push(g: Ghost) {
    const l = this.byRound.get(g.round);
    if (l) l.push(g); else this.byRound.set(g.round, [g]);
  }
  all(): Ghost[] { return [...this.byRound.values()].flat(); }
  static of(ghosts: Ghost[]) { const p = new Pool(); for (const g of ghosts) p.push(g); return p; }
  size() { return this.all().length; }

  // The opponent you'd actually meet.
  opponent(rng: Rng, round: number, wins: number): Ghost | undefined {
    return pickGhost(rng, round, wins, this.at);
  }

  // A wider sample of likely opponents for judging a team.
  sample(rng: Rng, round: number, wins: number, k: number): Ghost[] {
    const near = closest(rng, latestGhosts(round, this.at), wins, Math.max(k * 2, 12));
    return near.length ? Array.from({ length: k }, () => pick(rng, near)) : [];
  }

  // One full run by the simple shop bot against this pool. With record, its ghosts join the pool,
  // like the server's seeding.
  botRun(rng: Rng, maxRound = 18, record = true): RunState {
    return botRun(rng, st => {
      const opp = this.opponent(rng, st.round, st.wins);
      const winner = opp ? quickFight(rng, sideOf(st), sideOf(opp)) : 0;
      if (record) this.add(st, 'bot');
      return winner;
    }, maxRound);
  }
}

// Hash of the game rules and the tools' own logic, to tell when something cached was built under other rules.
export function rulesHash() {
  const h = createHash('sha1');
  for (const dir of [join(DIR, '../../server/src/game'), DIR]) {
    for (const f of readdirSync(dir).sort()) if (f.endsWith('.ts')) h.update(readFileSync(join(dir, f)));
  }
  return h.digest('hex').slice(0, 10);
}

// A pool of bot ghosts, as the server seeds. Cached on disk until the rules change.
export function botPool(seed: number, runs = 300): Pool {
  const file = join(DIR, '../.cache', `bots-${rulesHash()}-${seed}-${runs}.json`);
  if (existsSync(file)) return Pool.of(JSON.parse(readFileSync(file, 'utf8')));
  const pool = new Pool();
  const rng = makeRng(seed);
  for (let i = 0; i < runs; i++) pool.botRun(rng);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}`; // several players may build it at once: write, then rename
  writeFileSync(tmp, JSON.stringify(pool.all()));
  renameSync(tmp, file);
  return pool;
}
