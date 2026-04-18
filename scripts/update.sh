#!/usr/bin/env bash
# WSL update script — pull latest from GitHub and restart services.
# The data/ folder (ticks.db) is gitignored, so it is never touched.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Backing up tick DB (defensive)"
mkdir -p /tmp
[ -f artifacts/api-server/data/ticks.db ] && \
  cp artifacts/api-server/data/ticks.db /tmp/ticks.db.bak && \
  echo "    backup: /tmp/ticks.db.bak ($(du -h artifacts/api-server/data/ticks.db | cut -f1))"

echo "==> git pull"
git pull --rebase --autostash

echo "==> pnpm install"
pnpm install --prefer-offline

echo "==> restarting services"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart all || pm2 start ecosystem.config.cjs 2>/dev/null || true
  pm2 status
else
  echo "    pm2 not found — restart your tmux/foreground sessions manually:"
  echo "      pnpm --filter @workspace/api-server run dev"
  echo "      pnpm --filter @workspace/futures-monitor run dev"
fi

echo "==> done. Tick DB rows:"
sqlite3 artifacts/api-server/data/ticks.db \
  "SELECT symbol, COUNT(*), datetime(MIN(ts)/1000,'unixepoch') AS oldest, datetime(MAX(ts)/1000,'unixepoch') AS newest FROM ticks GROUP BY symbol;" \
  2>/dev/null || echo "    (sqlite3 cli not installed — skip)"
