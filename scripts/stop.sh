#!/usr/bin/env bash
# Stop the futures monitor tmux sessions.
set -euo pipefail

for s in fm-api fm-web; do
  if tmux has-session -t "$s" 2>/dev/null; then
    tmux kill-session -t "$s"
    echo "stopped: $s"
  else
    echo "not running: $s"
  fi
done
