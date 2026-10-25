---
name: balance-check
description: Find out how a thoughtful player fares in Rabble Below and whether its decisions are interesting or obvious, without asking Krishna to play. Use when designing or balancing units, tribes, items, relics or economy, when asking "is this fun / too strong / a real choice?", or before and after a rules change in server/src/game/. Covers LLM playtesters with personas (cheap, the default), the Veteran's hint, and the Veteran league (CPU heavy, use sparingly).
---

# Balance check

Two kinds of evidence, used together:

- **Opinions** from LLM playtesters who play a real run in the terminal (`tools/play.ts`). They notice
  confusing rules, boring turns and fake choices. They also misread rules now and then.
- **Numbers** from the Veteran (`tools/lib/veteran.ts`), a search player that tries every option on a copy of
  the run and fights the results. It has no opinions and no unit-specific knowledge, so it is honest about
  any rules you write.

Read the opinions next to the numbers. Neither alone is enough.

The tools install their own deps on first run.

## 1. Default: two or three playtesters (cheap)

Spawn subagents in parallel, each with the brief below, a different persona, its own save name and seed.
Smaller models (Sonnet, Haiku) play fine. Each run takes 10 to 20 minutes and almost no CPU.

Good personas pull in different directions: a greedy economy player, a careful planner who reads every
ability, someone who loves one tall carry, someone who gets bored easily. Point a persona at the thing
you're testing ("you love Fungus").

## 2. Check claims with `hint` (cheap)

When a playtester claims something ("X is useless", "Y combos with Z"), check it before believing it:
start a run at that point and ask `./play hint`. It shows the Veteran's plan and the battle score of each
option in about a second.

## 3. Only to confirm a hunch: the league (CPU heavy)

`./veteran league --json > before.json`, change the rules, `./veteran league --json > after.json`,
then `./veteran diff before.json after.json`. Each league takes a minute or two on 4 low-priority cores.
Changes inside the noise are not flagged; the ± figures say how big a real change must be.
Don't loop on it, don't raise `--jobs` on a laptop, and use `league 224` only for a question that
really needs it. `./veteran trace 5` shows one run with the Veteran's reasoning. The first league
for a seed also builds a field of veteran ghosts (about 30 seconds), kept across rule changes so
before/after face the same opponents. `--new-field` rebuilds it.

How to read the league report:
- **Units / relics:** pick rate when offered. Near 0% is a dead card; near 100% is an auto-pick.
- **Choices:** *dilemma* (top options close and a lot at stake: the good kind), *obvious* (one option far
  ahead), *toss-up* (close, but nothing rides on it).
- The Veteran's blind spots: it shops one step at a time with a two-turn look ahead, its look ahead and
  relic futures are played by a plain shopper, and its freeze rule is a habit, not a plan.

## The playtester brief

Fill in PERSONA, NAME and SEED.

---

You are playtesting **Rabble Below**, a small auto-battler: buy units in a shop, merge three copies to
level up, arrange them, and fight ghosts of other players' teams. Ten trophies wins; losing five lives
ends the run.

**Your persona:** {PERSONA}

Play one full run from `tools/` with `./play <command> --save=.runs/{NAME}.json` (always pass your save).
Start with `./play new {SEED}`, then `./play help` for the commands. Read the rules from what the game prints, not from the
source code. Don't read `server/src/game/*` or the tools' source.

Play like a person:
- Before each `fight`, decide for yourself first, then write one line with `./play note "..."`: what you
  chose, what else you considered, and whether it felt like a **real choice**, an **obvious** one, or
  **no choice at all**.
- `hint` shows what the Veteran (a search bot) would do, with its numbers. Use it at most three times,
  and only *after* you've made up your mind. Say where you disagree and why.

When the run ends, reply with:
1. Result (trophies, lives, round) and your final team.
2. The three most interesting decisions and the three most obvious or boring ones, with round numbers.
3. Anything that felt broken, confusing, unfair or pointless (a unit, a relic, a rule, the tool).
4. Where you disagreed with the Veteran, and who was right in hindsight.
5. One change you'd try first, and why.

Keep it short and concrete. `./play diary --save=...` has your notes.
