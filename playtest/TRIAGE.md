# Triage a playtest session

You were handed a folder in `.playtest/sessions/`. It holds a player's in-game reactions ("huh?",
"fun!", "bug", a word or two), each frozen with the exact moment it was said in. Your job: read
them side by side, find the patterns, fix the small things in your own copy, and tell Krishna what
you found. The player is not a bug reporter. Treat every reaction as honest design data.

## 1. Get your own copy first

- If this thread isn't in a git worktree yet, move it into one with `t3_worktree_handoff`
  (branch `playtest/<session folder name>`, from local `main`, `startFromOrigin: false`) and pass
  the rest of this work as `continuationPrompt`. Don't edit the main checkout: that's the game
  being played.
- **Never touch the player's game.** The SpacetimeDB named under "Data" in `SESSION.md` (port 3000)
  is the game being played: don't publish to, restart or stop it, don't stop `play.sh`, don't open
  the player's browser. Work in your own sandbox (see `AGENTS.md`): `./sandbox rehearse` gives you a
  copy of the player's data, reactions included, running your code. `./sandbox down` when you're done;
  memory on this machine is tight.

## 2. Read

- `SESSION.md` lists every reaction: what was said, the run (team, market, gold), the screen,
  the info panel text, toasts, and the trail of actions just before. `moments/<id>.json` has
  the raw rows.
- **Look at the moments.** `?moment=<id>` on your sandbox's game URL renders the exact screen,
  battle frames included, with your build. If you need the reaction live from the player's game,
  add `&src=http://127.0.0.1:3000` (read only), or point `&src` at a `moments/<id>.json` URL. Players
  press H a beat after what struck them, so step back through the frames (`&frame=<n>`, or ◀ ▶ in
  the banner). Each moment also carries the player's last few battles (`&battle=<id>`): "lost again"
  is usually about one that's no longer on screen. Add `&clean` to hide the banner.
- Read the `REPORT.md` files of earlier sessions in `.playtest/sessions/*/`. A theme that comes
  back after a fix is the most important finding you can make. A "huh?" that stopped coming
  back means a fix worked; say so.

## 3. Sort

- **Bugs first.** A folder ending in `-bug-<id>` is one bug that jumped the queue: fix it quickly
  and keep the scope to that bug.
- Group the rest into **themes** by underlying cause, not by wording ("three of these are about
  selling"). One reaction can be a theme if it's clear enough.
- "fun!" reactions are data too. Name what players enjoy so nobody "fixes" it away.

## 4. Act

- **Small things** (one clear cause, a small diff, no design question): fix them in your
  worktree. Check each fix for real:
  - replay the moment on your build and look at it;
  - reproduce the trail with the rules engine. `server/src/game/` is plain TypeScript; start
    from the moment's `run` JSON (see `tools/sim.ts` for how to drive it).

  Commit each fix on your branch with a message that names the reaction ids.
- **Big themes** (design questions, balance, new mechanics): don't fix them here. If one
  matters, start a focused thread with `t3_thread_launch` (worktree from `main`, branch
  `playtest/<theme>`). Its message quotes the reactions and their moment links and says what
  decision is open. At most two per session; list the rest.
- If a fix changes how the game plays, update `DESIGN.md` the way its last line asks.

## 5. Report

- Write `REPORT.md` into the session folder: themes (with reaction ids), what you fixed
  (branch, commits, how you checked), threads you started, what you left alone and why, and
  what players enjoyed. Keep it short. The next triage reads it.
- End with a short, plain message to Krishna: what they said, the patterns, what you fixed and
  how you checked it, and the one decision you need (usually "merge `playtest/...` into main?").
  Don't merge, push or open PRs yourself: ask.
