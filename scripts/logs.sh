#!/usr/bin/env bash
# Tail both service logs side-by-side.
set -euo pipefail

if [ ! -f /tmp/fm-api.log ] && [ ! -f /tmp/fm-web.log ]; then
  echo "No logs yet. Start the services with: ./scripts/start.sh"
  exit 1
fi

# tail -f both files at once with file labels
tail -F /tmp/fm-api.log /tmp/fm-web.log
