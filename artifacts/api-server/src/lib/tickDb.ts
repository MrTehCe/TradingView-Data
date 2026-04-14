import { logger } from "./logger";
import path from "path";

interface TickRow {
  symbol: string;
  price: number;
  vol: number;
  ts: number;
}

interface OBRow {
  symbol: string;
  ask: number;
  askSize: number;
  bid: number;
  bidSize: number;
  ts: number;
}

interface TickDb {
  insertTick(symbol: string, price: number, vol: number, ts: number): void;
  insertOB(symbol: string, ask: number, askSize: number, bid: number, bidSize: number, ts: number): void;
  getTicks(symbol: string, since: number): TickRow[];
  getOB(symbol: string, since: number): OBRow[];
  prune(olderThan: number): void;
  close(): void;
}

let _db: TickDb | null = null;

function createNoopDb(): TickDb {
  return {
    insertTick() {},
    insertOB() {},
    getTicks() { return []; },
    getOB() { return []; },
    prune() {},
    close() {},
  };
}

export function getTickDb(): TickDb {
  if (_db) return _db;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const dbPath = path.resolve(process.cwd(), "data", "ticks.db");

    const fs = require("fs");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

    db.exec(`
      CREATE TABLE IF NOT EXISTS ticks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        vol REAL NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ticks_sym_ts ON ticks(symbol, ts);

      CREATE TABLE IF NOT EXISTS ob (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        ask REAL NOT NULL,
        ask_size REAL NOT NULL,
        bid REAL NOT NULL,
        bid_size REAL NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ob_sym_ts ON ob(symbol, ts);
    `);

    const insertTickStmt = db.prepare(
      "INSERT INTO ticks (symbol, price, vol, ts) VALUES (?, ?, ?, ?)"
    );
    const insertOBStmt = db.prepare(
      "INSERT INTO ob (symbol, ask, ask_size, bid, bid_size, ts) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const getTicksStmt = db.prepare(
      "SELECT symbol, price, vol, ts FROM ticks WHERE symbol = ? AND ts > ? ORDER BY ts ASC"
    );
    const getOBStmt = db.prepare(
      "SELECT symbol, ask, ask_size AS askSize, bid, bid_size AS bidSize, ts FROM ob WHERE symbol = ? AND ts > ? ORDER BY ts ASC"
    );
    const pruneTicksStmt = db.prepare("DELETE FROM ticks WHERE ts < ?");
    const pruneOBStmt = db.prepare("DELETE FROM ob WHERE ts < ?");

    _db = {
      insertTick(symbol, price, vol, ts) {
        insertTickStmt.run(symbol, price, vol, ts);
      },
      insertOB(symbol, ask, askSize, bid, bidSize, ts) {
        insertOBStmt.run(symbol, ask, askSize, bid, bidSize, ts);
      },
      getTicks(symbol, since) {
        return getTicksStmt.all(symbol, since) as TickRow[];
      },
      getOB(symbol, since) {
        return getOBStmt.all(symbol, since) as OBRow[];
      },
      prune(olderThan) {
        pruneTicksStmt.run(olderThan);
        pruneOBStmt.run(olderThan);
      },
      close() {
        db.close();
      },
    };

    logger.info({ dbPath }, "SQLite tick database ready");

    setInterval(() => {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      _db?.prune(cutoff);
    }, 60 * 60 * 1000);

    return _db;
  } catch (err) {
    logger.warn({ err }, "SQLite not available — running without persistent tick storage (install better-sqlite3 locally)");
    _db = createNoopDb();
    return _db;
  }
}
