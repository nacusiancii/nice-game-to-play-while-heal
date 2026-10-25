// A battle on the stage, no server needed. Teams come from bots at a round, or are spelled out.
//   feel record scenes/battle.ts round=8 seed=3 speed=1
//   feel record scenes/battle.ts a="troll@2+thorns, wolf, rat" b="lich, skeleton, ghoul"
import type { Scene } from '../capture';

export const options = { page: 'stage' };

export default async (s: Scene) => {
  const { round, seed, a, b, relicsA, relicsB, speed } = s.args;
  await s.battle({
    round: round ? Number(round) : undefined, seed: seed ? Number(seed) : undefined,
    a, b, relicsA, relicsB, speed: speed ? Number(speed) : 1,
  });
  s.mark('start');
  await s.until(() => document.querySelector('.result'), { timeout: 120000, label: 'the result banner' });
  s.mark('result');
  await s.wait(1500);
};
