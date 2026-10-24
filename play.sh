#!/usr/bin/env bash
# Start Rabble Below: local SpacetimeDB + the built web client. Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")"

DB=rabble-below
PORT=${PORT:-5173}
stdb() { mise exec -- spacetimedb-cli "$@"; }

mise install --quiet >/dev/null 2>&1 || true
[ -d server/node_modules ] || (cd server && npm install --no-fund --no-audit)
[ -d client/node_modules ] || (cd client && npm install --no-fund --no-audit)

# stop everything this script started (SpacetimeDB, the web server) on exit or Ctrl+C
trap 'trap - EXIT INT TERM; kill 0 2>/dev/null' EXIT INT TERM

if ! curl -s -o /dev/null http://127.0.0.1:3000/v1/ping; then
  echo "Starting SpacetimeDB…"
  mkdir -p .stdb-data
  stdb start --listen-addr 127.0.0.1:3000 --data-dir ./.stdb-data \
    --page_pool_max_size 67108864 > .stdb-data/server.log 2>&1 &
  for _ in $(seq 40); do curl -s -o /dev/null http://127.0.0.1:3000/v1/ping && break; sleep 0.25; done
fi

echo "Publishing module…"
stdb publish "$DB" --server local -y >/dev/null
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
