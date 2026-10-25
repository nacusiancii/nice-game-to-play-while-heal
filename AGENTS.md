# Working on Rabble Below

There are two copies of the game on this machine.

- **Krishna's game** runs from the main checkout with `./play.sh`: SpacetimeDB on :3000, the client on :5173,
  data in `.stdb-data/`. He may be playing right now. Don't start, stop, publish to or rebuild it, don't open
  his browser, and don't run a bare `spacetimedb-cli`: its `local` server is his game.
- **Your sandbox** is your own copy, started with `./sandbox up`: its own SpacetimeDB, data, ports and client
  build in `.sandbox/`. Break it and wipe it as often as you like. `./sandbox help` lists the commands.
  It keeps running after your shell exits, so `./sandbox down` when you're done; the laptop is short on RAM.

Shipping to Krishna: `./sandbox rehearse` (his data, your code), then a PR to `main` (ask him first). After it
merges, he runs `./play.sh`, which backs up his data before publishing.

Balance questions rarely need a server: `cd tools && npx tsx sim.ts 400 7` plays a headless bot league.
