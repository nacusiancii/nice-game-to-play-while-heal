// Matchmaking: which ghost you fight. The server and the tools in tools/ both pick opponents here.
import { pick, shuffle, type Rng } from './core';

export const MATCH_POOL = 6;

// The ghosts of the latest round up to `round` that has any.
export function latestGhosts<G>(round: number, ghostsAt: (round: number) => G[]): G[] {
  for (let r = round; r >= 1; r--) {
    const g = ghostsAt(r);
    if (g.length) return g;
  }
  return [];
}

// The n ghosts with the win record closest to `wins`, ties broken at random.
export function closest<G extends { wins: number }>(rng: Rng, ghosts: readonly G[], wins: number, n: number): G[] {
  return shuffle(rng, [...ghosts]).sort((a, b) => Math.abs(a.wins - wins) - Math.abs(b.wins - wins)).slice(0, n);
}

// Your opponent: one of the MATCH_POOL ghosts with the closest record, from your round, or the latest
// earlier round that has any ghosts at all.
export function pickGhost<G extends { wins: number }>(rng: Rng, round: number, wins: number, ghostsAt: (round: number) => G[]): G | undefined {
  const near = closest(rng, latestGhosts(round, ghostsAt), wins, MATCH_POOL);
  return near.length ? pick(rng, near) : undefined;
}
