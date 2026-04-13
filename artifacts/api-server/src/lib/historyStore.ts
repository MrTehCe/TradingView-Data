/**
 * Server-side history store.
 *
 * Keeps up to MAX_HISTORY_MS of tick + order-book data per symbol, in memory,
 * flushed to disk every FLUSH_INTERVAL ms. Survives API-server restarts.
 */

import fs   from 'fs';
import path from 'path';
import { logger } from './logger.js';

export interface TickRecord { ts: number; price: number; vol: number }
export interface OBRecord   { ts: number; ask: number; askSize: number; bid: number; bidSize: number }

const MAX_HISTORY_MS  = 12 * 60 * 60 * 1000;   // 12 hours
const FLUSH_INTERVAL  = 60_000;                  // flush to disk every 60 s
const PRUNE_INTERVAL  = 5  * 60_000;            // prune old in-memory data every 5 min
const DATA_DIR        = path.resolve('./data');

// ── In-memory buffers ──────────────────────────────────────────────────────
const tickHistory: Record<string, TickRecord[]> = {};
const obHistory:   Record<string, OBRecord[]>   = {};

// ── Persistence helpers ────────────────────────────────────────────────────
function filePath(sym: string, kind: 'ticks' | 'ob') {
  const safe = sym.replace(/[^a-zA-Z0-9_]/g, '_');
  return path.join(DATA_DIR, `${safe}_${kind}.json`);
}

function loadSymbol(sym: string) {
  const cutoff = Date.now() - MAX_HISTORY_MS;
  try {
    const t = JSON.parse(fs.readFileSync(filePath(sym, 'ticks'), 'utf8')) as TickRecord[];
    tickHistory[sym] = t.filter(r => r.ts > cutoff);
  } catch { tickHistory[sym] = []; }
  try {
    const o = JSON.parse(fs.readFileSync(filePath(sym, 'ob'), 'utf8')) as OBRecord[];
    obHistory[sym] = o.filter(r => r.ts > cutoff);
  } catch { obHistory[sym] = []; }
}

function flushSymbol(sym: string) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath(sym, 'ticks'), JSON.stringify(tickHistory[sym] ?? []));
    fs.writeFileSync(filePath(sym, 'ob'),    JSON.stringify(obHistory[sym]   ?? []));
  } catch (e) {
    logger.warn({ sym, err: e }, 'historyStore flush failed');
  }
}

function flushAll() {
  for (const sym of Object.keys(tickHistory)) flushSymbol(sym);
}

function pruneAll() {
  const cutoff = Date.now() - MAX_HISTORY_MS;
  for (const sym of Object.keys(tickHistory)) {
    if (tickHistory[sym]) tickHistory[sym] = tickHistory[sym].filter(r => r.ts > cutoff);
    if (obHistory[sym])   obHistory[sym]   = obHistory[sym].filter(r => r.ts > cutoff);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────
export function initHistoryStore(symbols: string[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Load existing data for known symbols
  for (const sym of symbols) loadSymbol(sym);
  logger.info({ symbols }, 'historyStore: loaded from disk');

  setInterval(flushAll,  FLUSH_INTERVAL);
  setInterval(pruneAll,  PRUNE_INTERVAL);

  // Final flush on process exit
  process.on('SIGTERM', () => { flushAll(); });
  process.on('SIGINT',  () => { flushAll(); });
}

// ── Write (called on every incoming quote) ─────────────────────────────────
export function pushTick(sym: string, rec: TickRecord) {
  if (!tickHistory[sym]) { loadSymbol(sym); }
  tickHistory[sym].push(rec);
}

export function pushOB(sym: string, rec: OBRecord) {
  if (!obHistory[sym]) { loadSymbol(sym); }
  obHistory[sym].push(rec);
}

// ── Read (called when a client subscribes to a symbol) ────────────────────
export function getTicks(sym: string): TickRecord[] {
  if (!tickHistory[sym]) loadSymbol(sym);
  return tickHistory[sym] ?? [];
}

export function getOB(sym: string): OBRecord[] {
  if (!obHistory[sym]) loadSymbol(sym);
  return obHistory[sym] ?? [];
}
