<img src="client/public/art/goblin_new.png" width="64" height="64" alt="">

# Rabble Below

A small async auto-battler. Hire a rabble of dungeon misfits, merge them to level up, pick relics, and send
them against the ghosts of other crews. Ten trophies before five lives run out.

## Play

```sh
./play.sh
```

Then open http://127.0.0.1:5173. Ctrl+C stops everything.

`play.sh` uses mise to get the SpacetimeDB CLI (pinned in `mise.toml`), starts a local SpacetimeDB on port 3000
with its data in `.stdb-data/`, publishes the module, builds the client and serves it with Python's static server.
Total footprint is around 100 MB of RAM.

## How it works

- `server/src/game/` holds the whole rules engine as plain TypeScript: units, items, relics, shop, battle, bot AI.
  The client imports the same files for tooltips.
- `server/src/index.ts` is the SpacetimeDB module. Every shop action and every battle runs in a reducer, with
  `ctx.random` as the only randomness. Each team you field is saved as a ghost; future runs fight those ghosts.
  On first publish the module seeds ~50 bot runs so there is always someone to fight.
- `client/` is a small Vite + vanilla TypeScript app. It subscribes to its own run, replays battles from the
  recorded frames, and calls reducers for every action.
- `tools/sim.ts` runs a headless bot league and prints win rates per unit, tribe and relic:
  `cd tools && npm install && npx tsx sim.ts 400 7`.

## Dev loop

`./play.sh` is the copy you play. To change the game, work in your own sandbox: a private SpacetimeDB, database,
client build and port pair, so nothing you do can reach the game you're playing.

```sh
./sandbox up            # start it, or apply your latest code; prints the URL to open
./sandbox save x        # snapshot; ./sandbox reset x goes back to it
./sandbox reset --prod  # copy your real data into the sandbox
./sandbox rehearse      # check that this branch's code publishes cleanly over your real data
./sandbox ls            # what's running on this machine, and whose it is
./sandbox down
```

See [AGENTS.md](AGENTS.md) for the rest, and for why a sandbox can't touch the real game.

Add bot ghosts to the real game: `mise exec -- spacetimedb-cli --config-path ~/.config/rabble-below/prod-cli.toml call rabble-below seed_more_bots 20`.
Each `./play.sh` backs up the data to `.stdb-backups/` first (the last 5 are kept). The database is locked, so wiping it
takes a deliberate `spacetimedb-cli --config-path ~/.config/rabble-below/prod-cli.toml unlock rabble-below` first.

## Credits

- Art: [Dungeon Crawl Stone Soup tiles](https://opengameart.org/content/dungeon-crawl-32x32-tiles), CC0.
- Font: [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans), SIL Open Font License.
- Sounds are synthesized in the browser.
