# Working on Rabble Below

There are two copies of the game on this machine, and they never share anything.

- **Krishna's game** is the main checkout (`~/.t3/projects/nice-game-to-play-while-heal`), started with
  `./play.sh`: SpacetimeDB on :3000, the web client on :5173, data in `.stdb-data/`. Krishna may be playing
  it right now. Don't start, stop, publish to or rebuild it, and don't open his browser.
- **Your sandbox** is your own copy: its own SpacetimeDB process, data, ports, client build and signing key,
  all inside `.sandbox/` in your checkout. Break it, wipe it, restart it as often as you like.

## Your sandbox

```sh
./sandbox up                 # start, or apply your latest code (server + client, ~5 s). Prints the URLs.
./sandbox up --fresh         # same, after wiping the data (for breaking schema changes)
./sandbox save before-tweak  # snapshot the data
./sandbox reset before-tweak # back to that snapshot in under a second
./sandbox reset              # fresh database with seeded bots
./sandbox reset --prod       # a copy of Krishna's current data (his game is only read)
./sandbox sql "SELECT * FROM run"     ./sandbox call start_run     ./sandbox logs
./sandbox env                # SANDBOX_WEB / SANDBOX_STDB for Playwright and scripts
./sandbox ls                 # everything running: Krishna's game, every sandbox, RAM, last activity
./sandbox down               # stop it when you're done; data stays for next time
```

`-n <name>` runs another sandbox from the same checkout, for example to compare two balance ideas side by
side. Each one is a SpacetimeDB process of about 140 MB, and this laptop is short on RAM, so stop the ones
you're not using.

The sandbox survives your shell and tool timeouts; only `./sandbox down` stops it. Use `./sandbox cli …`
instead of a bare `spacetimedb-cli`: inside the sandbox's config, `--server local` means your sandbox.

## Why your sandbox can't hurt Krishna's game

This isn't a convention you have to remember. It's enforced:

- Your sandbox server signs its own tokens. They are rejected by Krishna's server, and his are rejected by
  yours (`401 InvalidSignature`), even though both carry the same owner identity.
- Krishna's database is owned by an identity kept in `~/.config/rabble-below/prod-cli.toml`, which only
  `play.sh` uses. The default `spacetimedb-cli` identity gets `403` if it tries to publish to it or wipe it.
- Krishna's database is locked, so nothing can wipe or delete it until someone deliberately unlocks it.
- `play.sh` refuses to run in a worktree, and refuses to reuse a :3000 server that isn't serving its data.
- Before every publish, `play.sh` backs up his data to `.stdb-backups/` (last 5 kept).

## Shipping to Krishna

Moving your work to Krishna is one deliberate step, and it's his:

1. `./sandbox rehearse` copies his current data into your sandbox and publishes your code on top. If that
   passes, the real publish will too. Play it there if the change touches saved state.
2. Open a PR to `main` (ask Krishna first).
3. After it merges, Krishna runs `./play.sh` in the main checkout. That publishes the new code over his
   data, keeping it, after taking a backup.

## Fast experiments

Balance questions usually don't need a server. `cd tools && npx tsx sim.ts 400 7` plays a headless bot
league against the shared rules in `server/src/game/` in seconds. Use the sandbox when you need the real
server, the real client or real data.
