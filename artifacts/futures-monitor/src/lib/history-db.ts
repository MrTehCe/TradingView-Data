/**
 * IndexedDB persistence for tick history and order-book snapshots.
 * Much higher storage limits than localStorage (~hundreds of MB vs 5 MB).
 */

const DB_NAME    = 'futures_monitor_v2';
const DB_VERSION = 1;

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('ticks')) {
        const ts = db.createObjectStore('ticks', { keyPath: ['sym', 'ts'] });
        ts.createIndex('sym', 'sym');
        ts.createIndex('ts',  'ts');
      }
      if (!db.objectStoreNames.contains('ob')) {
        const os = db.createObjectStore('ob', { keyPath: ['sym', 'ts'] });
        os.createIndex('sym', 'sym');
        os.createIndex('ts',  'ts');
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror   = () => reject(req.error);
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function appendTicks(sym: string, records: { price: number; ts: number; vol: number }[]): Promise<void> {
  if (records.length === 0) return;
  const db = await openDB();
  const tx = db.transaction('ticks', 'readwrite');
  const st = tx.objectStore('ticks');
  for (const r of records) st.put({ sym, ts: r.ts, price: r.price, vol: r.vol });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function appendOB(sym: string, records: { ts: number; ask: number; askSize: number; bid: number; bidSize: number }[]): Promise<void> {
  if (records.length === 0) return;
  const db = await openDB();
  const tx = db.transaction('ob', 'readwrite');
  const st = tx.objectStore('ob');
  for (const r of records) st.put({ sym, ...r });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function loadTicks(cutoffMs: number): Promise<Record<string, { price: number; ts: number; vol: number }[]>> {
  const db = await openDB();
  const tx = db.transaction('ticks', 'readonly');
  const st = tx.objectStore('ticks');
  const req = st.getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const out: Record<string, { price: number; ts: number; vol: number }[]> = {};
      for (const row of req.result as { sym: string; ts: number; price: number; vol: number }[]) {
        if (row.ts < cutoffMs) continue;
        (out[row.sym] ??= []).push({ price: row.price, ts: row.ts, vol: row.vol });
      }
      for (const arr of Object.values(out)) arr.sort((a, b) => a.ts - b.ts);
      resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function loadOB(cutoffMs: number): Promise<Record<string, { ts: number; ask: number; askSize: number; bid: number; bidSize: number }[]>> {
  const db = await openDB();
  const tx = db.transaction('ob', 'readonly');
  const st = tx.objectStore('ob');
  const req = st.getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const out: Record<string, { ts: number; ask: number; askSize: number; bid: number; bidSize: number }[]> = {};
      for (const row of req.result as ({ sym: string } & { ts: number; ask: number; askSize: number; bid: number; bidSize: number })[]) {
        if (row.ts < cutoffMs) continue;
        const { sym, ...rest } = row;
        (out[sym] ??= []).push(rest);
      }
      for (const arr of Object.values(out)) arr.sort((a, b) => a.ts - b.ts);
      resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

// ── Prune old records ─────────────────────────────────────────────────────────

export async function pruneOlderThan(cutoffMs: number): Promise<void> {
  const db = await openDB();
  for (const storeName of ['ticks', 'ob'] as const) {
    const tx = db.transaction(storeName, 'readwrite');
    const st = tx.objectStore(storeName);
    const idx = st.index('ts');
    const range = IDBKeyRange.upperBound(cutoffMs, true);
    const req = idx.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
  }
}
