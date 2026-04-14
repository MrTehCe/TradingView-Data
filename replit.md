# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

### futures-monitor (frontend)
- Vite + React + TailwindCSS, Bookmap-style order flow visualization
- SharedWorker (`market-data-worker-v3`) manages WS connection to API server
- IndexedDB for browser-side tick/OB persistence (5s flush interval)
- On startup, tries server SQLite history first, falls back to IDB
- History window: 7 days (`MAX_HISTORY_MS`)
- Time windows: 1m / 3m / 5m / 15m / 30m / 1H / 4H; VWAP anchor 23:00 UTC

### api-server (backend)
- Express 5, TradingView WebSocket relay for 12 CME symbols
- Auth: 2FA → `tvAuth.ts` applies token directly via `getFeed().setAuth()`
- Server-side keepalive pings every 25s
- SQLite persistence (`better-sqlite3`): ticks + order book stored in `data/ticks.db`
  - Graceful no-op fallback when native module unavailable (e.g., Replit)
  - 7-day auto-prune (hourly)
- REST endpoints:
  - `GET /api/history/:symbol?since=<epoch_ms>` — returns `{ symbol, ticks, ob }`
  - `POST /api/auth/tradingview/reconnect` — re-applies saved auth credentials

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
