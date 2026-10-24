# Design note

Started 2026-10-24, on a sick day, for a player who likes Probably Stolen, Batomon and Slay the Spire,
and cares about the game loop more than graphics. This note records the intent, so changes can be
checked against it.

## The pitch

Hire a rabble of dungeon misfits, merge them, and send them against the ghosts of other crews.
Ten trophies before five lives run out. One run takes about 20 minutes.

## Pillars

1. **Every turn is a small, real decision.** Spend or save, reroll or freeze, merge now or wait,
   who stands in front. If a choice is obvious, it isn't a choice.
2. **Rules you can read.** Every ability fits on one line, and it does exactly what it says.
   Shop units show their tier; hovering anything explains it.
3. **Battles are a payoff, not a chore.** They're automatic, short, and skippable (Instant mode).
   The thinking happens in the shop.
4. **Ghosts make it feel alive.** Every team you field haunts future runs. A fresh server is
   seeded with bots so there's always someone to fight.

## Tribes (what each one is about)

- **Beast:** brawlers. They grow when hurt or when friends fall. Easy to play.
- **Undead:** they come back. Summons on faint, and they feed on death. Order matters.
- **Fungus:** patience. Small growth every turn, so they reward keeping units. Currently the
  strongest tribe in bot play; watch it.
- **Goblin:** greed versus tempo (the Probably Stolen itch). Earn gold, and turn unspent gold into
  stats. The tension is buying now versus hoarding for a Hoarder or Warlord.
- **Arcane:** zaps before and during the fight. The Archmage re-triggers everyone's opening moves.
- **Dwarf:** ward, a shield that absorbs damage first. Protects whoever stands behind.

## Relics

Picked on rounds 3, 6, 9 and 12, from three choices (the Slay the Spire beat). They should bend
a build, not just add numbers. Open question: most are plain upgrades today; trade-offs like
"+2 lives, but rerolls cost more" may be more interesting.

## Decisions so far

- The server is the referee. Shop, randomness and battles all run in SpacetimeDB reducers;
  the client only shows things and replays recorded battles.
- One rules engine (`server/src/game/`) is shared by the server, the client and the sim.
- Balance is checked with a headless bot league (`tools/sim.ts`). Bots are dumb, so read the
  numbers as direction, not truth.
- A draw costs nothing for either side, like Super Auto Pets. Revisit if stalling becomes a strategy.

## Known rough edges

- No undo. One misclick on Sell cost a front-line unit in the first playtest.
- Difficulty against a thoughtful human is untested; early rounds are probably easy.
- Bots are simple, so ghost opponents get interesting only as real runs pile up.

## Ideas parked for later

- An in-game feedback button that saves a note, a screenshot and the exact run state.
- Undo for the last shop action.
- Friends' ghosts and live async PvP.
- Smarter bots that play like a person with a few runs behind them.
