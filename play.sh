#!/usr/bin/env bash
# Start Rabble Below: local SpacetimeDB + the built web client. Ctrl+C stops both.
# This is Krishna's copy of the game. Agents work in their own copy: ./sandbox (see AGENTS.md).
set -euo pipefail
cd "$(dirname "$0")"

DB=rabble-below
PORT=${PORT:-5173}
# The identity that owns this game lives in its own config, so the default CLI identity (the one agents
# use) cannot publish over it or wipe it. Without that file, fall back to the default config.
PROD_CFG="$HOME/.config/rabble-below/prod-cli.toml"
stdb() {
  if [ -f "$PROD_CFG" ]; then mise exec -- spacetimedb-cli --config-path "$PROD_CFG" "$@"
  else mise exec -- spacetimedb-cli "$@"; fi
}

if [ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]; then
  echo "This checkout is a worktree. play.sh runs Krishna's game from the main checkout only."
  echo "To play this branch, use your own copy: ./sandbox up"
  exit 1
fi

mise install --quiet >/dev/null 2>&1 || true
[ -d server/node_modules ] || (cd server && npm install --no-fund --no-audit)
[ -d client/node_modules ] || (cd client && npm install --no-fund --no-audit)

# Something already serves :3000? Reuse it only if it is this game's own server.
running=$(curl -s -o /dev/null http://127.0.0.1:3000/v1/ping && echo yes || true)
holder=$(ss -Hltnp '( sport = :3000 )' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)
if [ -n "$running" ] && [ "$holder" != "$(cat .stdb-data/spacetime.pid 2>/dev/null)" ]; then
  echo "Port 3000 is held by another SpacetimeDB (pid ${holder:-?}), not this game's data."
  echo "See who owns it with ./sandbox ls, stop it, then run ./play.sh again."
  exit 1
fi

# stop everything this script started (SpacetimeDB, the web server) on exit or Ctrl+C
trap 'trap - EXIT INT TERM; kill 0 2>/dev/null' EXIT INT TERM

if [ -z "$running" ]; then
  echo "Starting SpacetimeDB…"
  mkdir -p .stdb-data
  stdb start --listen-addr 127.0.0.1:3000 --data-dir ./.stdb-data \
    --page_pool_max_size 67108864 > .stdb-data/server.log 2>&1 &
  for _ in $(seq 40); do curl -s -o /dev/null http://127.0.0.1:3000/v1/ping && break; sleep 0.25; done
fi

# Keep the last 5 copies of the data from before each publish. To roll back: stop play.sh, then
# rm -rf .stdb-data && cp -a .stdb-backups/<time> .stdb-data
if [ -d .stdb-data/replicas ]; then
  backup=".stdb-backups/$(date +%Y-%m-%d_%H-%M-%S)"
  mkdir -p .stdb-backups && cp -a .stdb-data "$backup" && rm -f "$backup/spacetime.pid"
  ls -1d .stdb-backups/*/ | head -n -5 | xargs -r rm -rf
fi

echo "Publishing module…"
if ! stdb publish "$DB" --server local -y >/dev/null; then
  echo "Publishing failed and nothing was changed. Your data is as it was."
  echo "(A breaking schema change? Ask the agent to run ./sandbox rehearse.)"
  exit 1
fi
stdb lock "$DB" --server local >/dev/null 2>&1 || true # nothing can wipe or delete it until unlocked
stdb generate --lang typescript --out-dir client/src/module_bindings --module-path server >/dev/null

echo "Building client…"
(cd client && npx vite build --logLevel warn)

echo
echo "  Rabble Below is ready:  http://127.0.0.1:$PORT"
echo "  (Ctrl+C to stop)"
echo
[ -z "${NO_OPEN:-}" ] && command -v xdg-open >/dev/null && (sleep 1; xdg-open "http://127.0.0.1:$PORT" >/dev/null 2>&1) &
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory client/dist >/dev/null 2>&1 &
wait
