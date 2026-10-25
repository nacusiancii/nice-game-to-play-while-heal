// Battles for the stage, computed with the same engine the server runs.
import { levelOf, mulberry32, type Rng, type Unit } from '../../server/src/game/core';
import { RELICS, UNITS } from '../../server/src/game/data';
import { fight, type Side } from '../../server/src/game/battle';
import { botRun } from '../../server/src/game/bot';

export interface BattleSpec {
  seed?: number;
  round?: number; // bots shop for this many rounds to build each team
  a?: string; // explicit team, front first: "troll:6/8@2+thorns, wolf, rat"
  b?: string;
  relicsA?: string; // "banner,whet"
  relicsB?: string;
  speed?: number; // 1, 2 or 4
}

// What a bot fields at `round`, drawing on the shared shop and bot code.
function botSide(rng: Rng, round: number): Side {
  let side: Side = { team: [], relics: [], gold: 0 };
  // draws keep every bot alive until the round we want
  botRun(rng, st => { if (st.round === round) side = structuredClone({ team: st.team, relics: st.relics, gold: st.gold }); return -1; }, round);
  return side;
}

// "kind[:atk/hp][@lvl][+item]", comma separated, front unit first.
function parseTeam(spec: string): Unit[] {
  return spec.split(',').map(s => s.trim()).filter(Boolean).map((s, i) => {
    const m = s.match(/^([a-z_]+)(?::(\d+)\/(\d+))?(?:@([123]))?(?:\+([a-z_]+))?$/i);
    if (!m || !UNITS[m[1]]) throw new Error(`bad unit "${s}". Kinds: ${Object.keys(UNITS).join(' ')}`);
    const d = UNITS[m[1]];
    const lvl = Number(m[4] ?? 1);
    return { uid: i + 1, kind: m[1], atk: Number(m[2] ?? d.atk), hp: Number(m[3] ?? d.hp), xp: lvl === 3 ? 5 : lvl === 2 ? 2 : 0, item: m[5] ?? '' };
  });
}

const relicList = (s?: string) => (s ? s.split(',').map(x => x.trim()).filter(x => {
  if (!RELICS[x]) throw new Error(`bad relic "${x}". Relics: ${Object.keys(RELICS).join(' ')}`);
  return true;
}) : []);

export function makeBattle(spec: BattleSpec) {
  const seed = spec.seed ?? 1;
  const round = spec.round ?? 6;
  const rng = mulberry32(seed);
  const side = (team: string | undefined, relics: string | undefined): Side => {
    if (!team) { const s = botSide(rng, round); if (relics) s.relics = relicList(relics); return s; }
    return { team: parseTeam(team), relics: relicList(relics), gold: 0 };
  };
  const a = side(spec.a, spec.relicsA);
  const b = side(spec.b, spec.relicsB);
  const res = fight(rng, structuredClone(a), structuredClone(b));
  const describe = (s: Side) => s.team.filter(u => u.kind)
    .map(u => `${u.kind}:${u.atk}/${u.hp}@${levelOf(u.xp)}${u.item ? '+' + u.item : ''}`).join(', ');
  return {
    battle: {
      id: 0, seq: 1, round, oppName: 'Stage Ghost', oppWins: 0, oppLives: 5, oppRelics: b.relics,
      result: res.winner === 0 ? 1 : res.winner === 1 ? -1 : 0, frames: JSON.stringify(res.frames),
    },
    meta: { myName: 'Stage Crew', myWins: 0, myLives: 5, myRelics: a.relics },
    summary: { a: describe(a), b: describe(b), relicsA: a.relics, relicsB: b.relics, winner: res.winner, frames: res.frames.length },
  };
}
