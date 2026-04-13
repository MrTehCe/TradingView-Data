import { useState, useCallback } from 'react';
import { KNOWN_SYMBOLS } from '@/components/symbol-selector';

const POINT_VALUE: Record<string, number> = Object.fromEntries(KNOWN_SYMBOLS.map(s => [s.display, s.pointValue]));
const BUCKET_SIZE: Record<string, number> = Object.fromEntries(KNOWN_SYMBOLS.map(s => [s.display, s.bucket]));

export interface Position {
  id: string;
  symbol: string;
  side: 'L' | 'S';
  qty: number;
  entry: number;
  openedAt: number;
  sl: number | null;
  tp: number | null;
  /** Running total of fees paid on all entry/scale-in fills (feePerSide × qty each fill) */
  entryFees: number;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: 'L' | 'S';
  qty: number;
  entry: number;
  exit: number;
  grossPnl: number;
  fees: number;
  pnl: number;        // net P&L (grossPnl - fees)
  closedAt: number;
}

export interface AccountSettings {
  balance: number;
  drawdownPct: number;
  realizedPnl: number;
  /** Fee per contract per side in dollars (entry side + exit side = 2×). Default $0.37 (CME micro). */
  feePerSide: number;
  closedTrades: ClosedTrade[];
}

const POS_KEY  = 'fm_positions_v4';
const ACCT_KEY = 'fm_account_v3';

function migratePos(raw: unknown[]): Position[] {
  return (raw as Record<string, unknown>[]).map(p => ({
    sl: null, tp: null, entryFees: 0,
    ...p,
  })) as Position[];
}

function loadPos(): Position[] {
  try {
    for (const key of [POS_KEY, 'fm_positions_v3', 'fm_positions_v2']) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const migrated = migratePos(Array.isArray(parsed) ? parsed : []);
      if (key !== POS_KEY && migrated.length > 0) {
        localStorage.setItem(POS_KEY, JSON.stringify(migrated));
      }
      return migrated;
    }
    return [];
  } catch { return []; }
}
function savePos(p: Position[]) { localStorage.setItem(POS_KEY, JSON.stringify(p)); }

function migrateAcct(raw: Record<string, unknown>): AccountSettings {
  const migratedTrades = ((raw.closedTrades as ClosedTrade[] | undefined) ?? []).map(t => ({
    ...t,
    grossPnl: t.grossPnl ?? t.pnl ?? 0,
    fees: t.fees ?? 0,
  }));
  return {
    balance: 50000,
    drawdownPct: 2.5,
    realizedPnl: 0,
    feePerSide: 0.37,
    ...raw,
    closedTrades: migratedTrades,
  };
}

function loadAcct(): AccountSettings {
  try {
    const raw = localStorage.getItem(ACCT_KEY) ?? localStorage.getItem('fm_account_v2') ?? 'null';
    const parsed = JSON.parse(raw);
    return parsed ? migrateAcct(parsed) : migrateAcct({});
  } catch { return migrateAcct({}); }
}
function saveAcct(a: AccountSettings) { localStorage.setItem(ACCT_KEY, JSON.stringify(a)); }

// ── P&L helpers ───────────────────────────────────────────────────────────────

export function pnlDollars(pos: Position, px: number): number {
  return (pos.side === 'L' ? px - pos.entry : pos.entry - px) * pos.qty * (POINT_VALUE[pos.symbol] ?? 1);
}
export function pnlPoints(pos: Position, px: number): number {
  return (pos.side === 'L' ? px - pos.entry : pos.entry - px) * pos.qty;
}

/** Total fees for a round-trip close: entry fees already paid + exit-side fee */
export function totalFees(pos: Position, feePerSide: number): number {
  return pos.entryFees + feePerSide * pos.qty;
}

/** Net P&L after all fees */
export function netPnlDollars(pos: Position, px: number, feePerSide: number): number {
  return pnlDollars(pos, px) - totalFees(pos, feePerSide);
}

// ── Default SL/TP ─────────────────────────────────────────────────────────────

function defaultLevels(symbol: string, side: 'L' | 'S', entry: number) {
  const bucket = BUCKET_SIZE[symbol] ?? 0.25;
  const offset = bucket * 20;
  const sl = side === 'L' ? entry - offset : entry + offset;
  const tp = side === 'L' ? entry + offset * 2 : entry - offset * 2;
  return { sl, tp };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePositions() {
  const [positions, setPositions] = useState<Position[]>(loadPos);
  const [acct, setAcct]           = useState<AccountSettings>(loadAcct);

  const addPosition = useCallback((sym: string, side: 'L' | 'S', qty: number, entry: number) => {
    setAcct(a => {
      const entryFees = a.feePerSide * qty;
      const { sl, tp } = defaultLevels(sym, side, entry);
      const pos: Position = {
        id: Date.now().toString(), symbol: sym, side, qty, entry, openedAt: Date.now(), sl, tp, entryFees,
      };
      setPositions(prev => { const next = [...prev, pos]; savePos(next); return next; });
      return a; // acct unchanged on open
    });
  }, []);

  const closePosition = useCallback((id: string, exitPx: number | null) => {
    setPositions(prev => {
      const pos = prev.find(p => p.id === id);
      if (!pos) return prev;
      const next = prev.filter(p => p.id !== id);
      savePos(next);
      if (exitPx !== null) {
        setAcct(a => {
          const grossPnl = pnlDollars(pos, exitPx);
          const fees     = totalFees(pos, a.feePerSide);
          const netPnl   = grossPnl - fees;
          const trade: ClosedTrade = {
            id: Date.now().toString(), symbol: pos.symbol, side: pos.side,
            qty: pos.qty, entry: pos.entry, exit: exitPx,
            grossPnl, fees, pnl: netPnl, closedAt: Date.now(),
          };
          const updated = { ...a, realizedPnl: a.realizedPnl + netPnl, closedTrades: [...a.closedTrades, trade] };
          saveAcct(updated);
          return updated;
        });
      }
      return next;
    });
  }, []);

  const updatePosition = useCallback((id: string, patch: Partial<Pick<Position, 'sl' | 'tp' | 'qty' | 'entry'>>) => {
    setPositions(prev => {
      const next = prev.map(p => p.id === id ? { ...p, ...patch } : p);
      savePos(next);
      return next;
    });
  }, []);

  /** Add more contracts at a new fill price — weighted-average entry, accumulate entry fees. */
  const scaleIn = useCallback((id: string, addQty: number, addPrice: number) => {
    setAcct(a => {
      setPositions(prev => {
        const next = prev.map(p => {
          if (p.id !== id) return p;
          const totalQty  = p.qty + addQty;
          const avgEntry  = (p.entry * p.qty + addPrice * addQty) / totalQty;
          const newFees   = p.entryFees + a.feePerSide * addQty;
          return { ...p, qty: totalQty, entry: Math.round(avgEntry * 10000) / 10000, entryFees: newFees };
        });
        savePos(next);
        return next;
      });
      return a; // acct unchanged until close
    });
  }, []);

  const updateAcct = useCallback((patch: Partial<AccountSettings>) => {
    setAcct(prev => { const next = { ...prev, ...patch }; saveAcct(next); return next; });
  }, []);

  return { positions, acct, addPosition, scaleIn, closePosition, updatePosition, updateAcct };
}
