import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { pick, type Rng, type RunState } from './game/core';
import { fight } from './game/battle';
import * as shop from './game/shop';
import { botRun } from './game/bot';
import { pickGhost } from './game/match';

const Unit = t.object('Unit', {
  uid: t.u32(), kind: t.string(), atk: t.i32(), hp: t.i32(), xp: t.u8(), item: t.string(),
});
const ShopSlot = t.object('ShopSlot', {
  kind: t.string(), atk: t.i32(), hp: t.i32(), frozen: t.bool(), isItem: t.bool(),
});

const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    runs: t.u32(),
    victories: t.u32(),
    bestWins: t.u32(),
  }
);

// One active run per player (finished runs are deleted once recorded in the hall).
const run = table(
  { name: 'run', public: true },
  {
    owner: t.identity().primaryKey(),
    round: t.u32(),
    gold: t.i32(),
    lives: t.i32(),
    wins: t.i32(),
    status: t.string(),
    team: t.array(Unit),
    shop: t.array(ShopSlot),
    relics: t.array(t.string()),
    relicChoices: t.array(t.string()),
    nextUid: t.u32(),
    bonusGold: t.i32(),
    rerolls: t.u32(),
    battles: t.u32(),
  }
);

// Battle replays. frames is a JSON blob the client plays back.
const battle = table(
  { name: 'battle', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity().index('btree'),
    seq: t.u32(),
    round: t.u32(),
    oppName: t.string(),
    oppWins: t.i32(),
    oppLives: t.i32(),
    oppRelics: t.array(t.string()),
    result: t.i8(), // 1 win, 0 draw, -1 loss
    frames: t.string(),
  }
);

// Snapshots of every team that entered a battle. Future runs fight these.
const ghost = table(
  { name: 'ghost' },
  {
    id: t.u64().primaryKey().autoInc(),
    round: t.u32().index('btree'),
    name: t.string(),
    ownerHex: t.string(),
    team: t.array(Unit),
    relics: t.array(t.string()),
    gold: t.i32(),
    wins: t.i32(),
    lives: t.i32(),
  }
);

const hall = table(
  { name: 'hall', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    won: t.bool(),
    wins: t.i32(),
    round: t.u32(),
    team: t.array(Unit),
    relics: t.array(t.string()),
    at: t.timestamp(),
  }
);

// Playtest reactions: a few words plus the exact moment they were said in.
// run and battles (the player's last few replays, oldest first) are JSON snapshots taken by the
// server; view is what the client was showing (screen, selection, battle id and frame) and the
// trail of what the player had just done.
// Public on purpose: the replay page reads a moment by id over plain HTTP SQL.
const reaction = table(
  { name: 'reaction', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity(),
    name: t.string(),
    at: t.timestamp(),
    text: t.string(),
    round: t.u32(),
    run: t.string(),
    battles: t.string(),
    view: t.string(),
  }
);

const spacetimedb = schema({ player, run, battle, ghost, hall, reaction });
export default spacetimedb;

// Players only see their own run and replays.
export const ownRunFilter = spacetimedb.clientVisibilityFilter.sql('SELECT * FROM run WHERE owner = :sender');
export const ownBattleFilter = spacetimedb.clientVisibilityFilter.sql('SELECT * FROM battle WHERE owner = :sender');

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const rngOf = (ctx: Ctx): Rng => () => ctx.random();

// ---------- names ----------
const A = ['Grim', 'Mossy', 'Rusty', 'Sly', 'Gloomy', 'Cheery', 'Crooked', 'Velvet', 'Sooty', 'Lucky', 'Hollow', 'Ember', 'Pale', 'Bristle', 'Copper'];
const B = ['Grub', 'Wick', 'Tooth', 'Moth', 'Fang', 'Knuckle', 'Mire', 'Pebble', 'Thistle', 'Lantern', 'Bone', 'Spore', 'Rook', 'Nettle', 'Cinder'];
const C = ['Crew', 'Gang', 'Band', 'Company', 'Rabble', 'Lot', 'Cabal', 'Troupe'];
const crewName = (rng: Rng) => `${pick(rng, A)}${pick(rng, B).toLowerCase()}'s ${pick(rng, C)}`;

// ---------- run state <-> row ----------
type RunRow = NonNullable<ReturnType<Ctx['db']['run']['owner']['find']>>;

function toState(r: RunRow): RunState {
  return {
    round: r.round, gold: r.gold, lives: r.lives, wins: r.wins, status: r.status as RunState['status'],
    team: r.team.map(u => ({ ...u })), shop: r.shop.map(s => ({ ...s })),
    relics: [...r.relics], relicChoices: [...r.relicChoices],
    nextUid: r.nextUid, bonusGold: r.bonusGold, rerolls: r.rerolls,
  };
}

function loadRun(ctx: Ctx) {
  const r = ctx.db.run.owner.find(ctx.sender);
  if (!r) throw new SenderError('No active run');
  return r;
}

function saveRun(ctx: Ctx, r: RunRow, st: RunState) {
  ctx.db.run.owner.update({ ...r, ...st });
}

// Apply a shop action, turning rule errors into SenderErrors for the client.
function act(ctx: Ctx, f: (st: RunState, rng: Rng) => void) {
  const r = loadRun(ctx);
  const st = toState(r);
  try { f(st, rngOf(ctx)); } catch (e) { throw new SenderError((e as Error).message); }
  saveRun(ctx, r, st);
}

function ensurePlayer(ctx: Ctx) {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) return p;
  return ctx.db.player.insert({ identity: ctx.sender, name: crewName(rngOf(ctx)), runs: 0, victories: 0, bestWins: 0 });
}

// ---------- bots ----------
const MAX_ROUND_SEED = 18;

function seedBots(ctx: Ctx, count: number) {
  const rng = rngOf(ctx);
  for (let i = 0; i < count; i++) {
    const name = crewName(rng);
    botRun(rng, st => {
      const opp = pickGhost(rng, st.round, st.wins, r => [...ctx.db.ghost.round.filter(r)]);
      const res = opp
        ? fight(rng, { team: st.team, relics: st.relics, gold: st.gold }, { team: opp.team, relics: opp.relics, gold: opp.gold })
        : { winner: 0 as const };
      ctx.db.ghost.insert({
        id: 0n, round: st.round, name, ownerHex: '', team: st.team.map(u => ({ ...u })),
        relics: [...st.relics], gold: st.gold, wins: st.wins, lives: st.lives,
      });
      return res.winner;
    }, MAX_ROUND_SEED);
  }
}

// Never your own ghost, unless it's the only one there is.
function ghostsAt(ctx: Ctx, meHex: string) {
  return (round: number) => {
    const all = [...ctx.db.ghost.round.filter(round)];
    const others = all.filter(g => g.ownerHex !== meHex);
    return others.length ? others : all;
  };
}

// ---------- lifecycle ----------
export const init = spacetimedb.init(ctx => {
  seedBots(ctx, 48);
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  ensurePlayer(ctx);
});

// ---------- reducers ----------
export const setName = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const clean = name.trim().slice(0, 24);
  if (!clean) throw new SenderError('Name cannot be empty');
  const p = ensurePlayer(ctx);
  ctx.db.player.identity.update({ ...p, name: clean });
});

export const startRun = spacetimedb.reducer(ctx => {
  const p = ensurePlayer(ctx);
  const old = ctx.db.run.owner.find(ctx.sender);
  if (old) ctx.db.run.owner.delete(ctx.sender);
  for (const b of [...ctx.db.battle.owner.filter(ctx.sender)]) ctx.db.battle.id.delete(b.id);
  const st = shop.newRun(rngOf(ctx));
  ctx.db.run.insert({ owner: ctx.sender, ...st, battles: 0 });
  ctx.db.player.identity.update({ ...p, runs: p.runs + 1 });
});

export const buyFromShop = spacetimedb.reducer({ shopIdx: t.u32(), teamIdx: t.u32() }, (ctx, { shopIdx, teamIdx }) =>
  act(ctx, (st, rng) => shop.buy(st, rng, shopIdx, teamIdx)));

export const sellUnit = spacetimedb.reducer({ teamIdx: t.u32() }, (ctx, { teamIdx }) =>
  act(ctx, (st, rng) => shop.sell(st, rng, teamIdx)));

export const moveUnit = spacetimedb.reducer({ from: t.u32(), to: t.u32() }, (ctx, { from, to }) =>
  act(ctx, (st, rng) => shop.move(st, rng, from, to)));

export const reroll = spacetimedb.reducer(ctx => act(ctx, (st, rng) => shop.reroll(st, rng)));

export const toggleFreeze = spacetimedb.reducer({ shopIdx: t.u32() }, (ctx, { shopIdx }) =>
  act(ctx, st => shop.toggleFreeze(st, shopIdx)));

export const chooseRelic = spacetimedb.reducer({ idx: t.u32() }, (ctx, { idx }) =>
  act(ctx, st => shop.chooseRelic(st, idx)));

export const fightGhost = spacetimedb.reducer(ctx => {
  const r = loadRun(ctx);
  const st = toState(r);
  if (st.status !== 'shop') throw new SenderError('Run is over');
  if (st.relicChoices.length) throw new SenderError('Choose a relic first');
  if (!st.team.some(u => u.kind)) throw new SenderError('Recruit someone first');
  const rng = rngOf(ctx);
  const p = ensurePlayer(ctx);
  const meHex = ctx.sender.toHexString();

  shop.endTurn(st, rng);
  const opp = pickGhost(rng, st.round, st.wins, ghostsAt(ctx, meHex));
  const oppSide = opp
    ? { team: opp.team.map(u => ({ ...u })), relics: [...opp.relics], gold: opp.gold }
    : { team: [], relics: [], gold: 0 };
  const res = fight(rng, { team: st.team.map(u => ({ ...u })), relics: st.relics, gold: st.gold }, oppSide);

  ctx.db.ghost.insert({
    id: 0n, round: st.round, name: p.name, ownerHex: meHex, team: st.team.map(u => ({ ...u })),
    relics: [...st.relics], gold: st.gold, wins: st.wins, lives: st.lives,
  });
  ctx.db.battle.insert({
    id: 0n, owner: ctx.sender, seq: r.battles + 1, round: st.round,
    oppName: opp?.name ?? 'Empty Halls', oppWins: opp?.wins ?? 0, oppLives: opp?.lives ?? 0,
    oppRelics: opp ? [...opp.relics] : [],
    result: res.winner === 0 ? 1 : res.winner === 1 ? -1 : 0,
    frames: JSON.stringify(res.frames),
  });
  // keep only the latest few replays
  for (const b of [...ctx.db.battle.owner.filter(ctx.sender)]) if (b.seq + 3 <= r.battles + 1) ctx.db.battle.id.delete(b.id);

  shop.afterBattle(st, rng, res.winner);
  ctx.db.run.owner.update({ ...r, ...st, battles: r.battles + 1 });

  if (st.status !== 'shop') {
    ctx.db.hall.insert({
      id: 0n, name: p.name, won: st.status === 'won', wins: st.wins, round: st.round,
      team: st.team.filter(u => u.kind).map(u => ({ ...u })), relics: [...st.relics], at: ctx.timestamp,
    });
    ctx.db.player.identity.update({
      ...p,
      victories: p.victories + (st.status === 'won' ? 1 : 0),
      bestWins: Math.max(p.bestWins, st.wins),
    });
  }
});

export const abandonRun = spacetimedb.reducer(ctx => {
  if (ctx.db.run.owner.find(ctx.sender)) ctx.db.run.owner.delete(ctx.sender);
  for (const b of [...ctx.db.battle.owner.filter(ctx.sender)]) ctx.db.battle.id.delete(b.id);
});

// Save a playtest reaction with a snapshot of the moment. battleId is the replay the player was
// watching (0 = none); the run row alone can't say, since it is already post-battle. The other
// recent battles come along too: "huh? lost again" is usually about a battle no longer on screen.
export const react = spacetimedb.reducer({ text: t.string(), battleId: t.u64(), view: t.string() }, (ctx, { text, battleId, view }) => {
  const clean = text.trim().slice(0, 280);
  if (!clean) throw new SenderError('Say a word or two');
  const p = ensurePlayer(ctx);
  const r = ctx.db.run.owner.find(ctx.sender);
  const battles = [...ctx.db.battle.owner.filter(ctx.sender)].sort((a, b) => a.seq - b.seq);
  const watched = battles.find(b => b.id === battleId);
  const json = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  ctx.db.reaction.insert({
    id: 0n, owner: ctx.sender, name: p.name, at: ctx.timestamp, text: clean, round: watched?.round ?? r?.round ?? 0,
    run: r ? json({ ...r, owner: undefined }) : '',
    battles: json(battles.map(b => ({ ...b, owner: undefined }))),
    view: view.slice(0, 20000),
  });
});

// Top up the ghost pool (the database owner can call this from the CLI).
export const seedMoreBots = spacetimedb.reducer({ count: t.u32() }, (ctx, { count }) => {
  seedBots(ctx, Math.min(count, 50));
});
