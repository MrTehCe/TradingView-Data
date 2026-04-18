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

echo "==> starting api-server (tmux session: fm-api)"
tmux new-session -d -s fm-api "cd $(pwd) && pnpm --filter @workspace/api-server run dev 2>&1 | tee /tmp/fm-api.log"

echo "==> starting futures-monitor web (tmux session: fm-web)"
tmux new-session -d -s fm-web "cd $(pwd) && pnpm --filter @workspace/futures-monitor run dev 2>&1 | tee /tmp/fm-web.log"

sleep 2
echo ""
echo "==> running sessions:"
tmux ls 2>/dev/null || true
echo ""
echo "Open the app:        http://localhost:3000  (or whatever port the web log shows)"
echo "Tail logs:           ./scripts/logs.sh"
echo "Attach to a session: tmux attach -t fm-api    (Ctrl+B then D to detach)"
echo "Stop everything:     ./scripts/stop.sh"
