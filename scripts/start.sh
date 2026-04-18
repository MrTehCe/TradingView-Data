#!/usr/bin/env bash
# Start the futures monitor (api-server + web) in detached tmux sessions.
# After this exits, both keep running in the background.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux not installed. Install it with: sudo apt install -y tmux"
  exit 1
fi

# Kill any old sessions first (idempotent restart)
tmux kill-session -t fm-api 2>/dev/null || true
tmux kill-session -t fm-web 2>/dev/null || true

# Ports (must match vite proxy target in artifacts/futures-monitor/vite.config.ts → 8080)
API_PORT="${API_PORT:-8080}"
WEB_PORT="${WEB_PORT:-3000}"

echo "==> starting api-server on port $API_PORT (tmux session: fm-api)"
tmux new-session -d -s fm-api "cd $(pwd) && PORT=$API_PORT pnpm --filter @workspace/api-server run dev 2>&1 | tee /tmp/fm-api.log"

echo "==> starting futures-monitor web on port $WEB_PORT (tmux session: fm-web)"
tmux new-session -d -s fm-web "cd $(pwd) && PORT=$WEB_PORT pnpm --filter @workspace/futures-monitor run dev 2>&1 | tee /tmp/fm-web.log"

sleep 3
echo ""
echo "==> running sessions:"
tmux ls 2>/dev/null || true

# Quick health probe so we surface obvious failures right away
echo ""
echo "==> health check"
if curl -fsS "http://localhost:$API_PORT/api/history/MES" >/dev/null 2>&1; then
  echo "    api-server: OK (http://localhost:$API_PORT)"
else
  echo "    api-server: NOT RESPONDING — check /tmp/fm-api.log"
fi
if curl -fsS "http://localhost:$WEB_PORT/" >/dev/null 2>&1; then
  echo "    web:        OK (http://localhost:$WEB_PORT)"
else
  echo "    web:        NOT RESPONDING — check /tmp/fm-web.log"
fi

echo ""
echo "Open the app:        http://localhost:$WEB_PORT"
echo "Tail logs:           ./scripts/logs.sh"
echo "Attach to a session: tmux attach -t fm-api    (Ctrl+B then D to detach)"
echo "Stop everything:     ./scripts/stop.sh"
