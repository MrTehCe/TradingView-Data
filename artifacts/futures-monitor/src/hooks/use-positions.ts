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
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: 'L' | 'S';
  qty: number;
  entry: number;
  exit: number;
  pnl: number;
  closedAt: number;
}

export interface AccountSettings {
  balance: number;
  drawdownPct: number;
  realizedPnl: number;
  closedTrades: ClosedTrade[];
}

const POS_KEY  = 'fm_positions_v3';
const ACCT_KEY = 'fm_account_v2';

function loadPos(): Position[] {
  try {
    // Try current key first; fall back to previous key so we don't lose open trades on upgrade
    const raw = localStorage.getItem(POS_KEY) ?? localStorage.getItem('fm_positions_v2') ?? '[]';
    const parsed = JSON.parse(raw) as Position[];
    const migrated = parsed.map(p => ({ sl: null, tp: null, ...p }));
    // If we read from the old key, migrate it forward immediately
    if (!localStorage.getItem(POS_KEY) && migrated.length > 0) {
      localStorage.setItem(POS_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch { return []; }
}
function savePos(p: Position[]) { localStorage.setItem(POS_KEY, JSON.stringify(p)); }

function loadAcct(): AccountSettings {
  try {
    return JSON.parse(localStorage.getItem(ACCT_KEY) ?? 'null')
      ?? { balance: 50000, drawdownPct: 2.5, realizedPnl: 0, closedTrades: [] };
  } catch { return { balance: 50000, drawdownPct: 2.5, realizedPnl: 0, closedTrades: [] }; }
}
function saveAcct(a: AccountSettings) { localStorage.setItem(ACCT_KEY, JSON.stringify(a)); }

export function pnlDollars(pos: Position, px: number) {
  return (pos.side === 'L' ? px - pos.entry : pos.entry - px) * pos.qty * (POINT_VALUE[pos.symbol] ?? 1);
}
export function pnlPoints(pos: Position, px: number) {
  return (pos.side === 'L' ? px - pos.entry : pos.entry - px) * pos.qty;
}

function defaultLevels(symbol: string, side: 'L' | 'S', entry: number) {
  const bucket = BUCKET_SIZE[symbol] ?? 0.25;
  const offset = bucket * 20;     // 20 ticks default
  const sl = side === 'L' ? entry - offset : entry + offset;
  const tp = side === 'L' ? entry + offset * 2 : entry - offset * 2;
  return { sl, tp };
}

export function usePositions() {
  const [positions, setPositions] = useState<Position[]>(loadPos);
  const [acct, setAcct]           = useState<AccountSettings>(loadAcct);

  const addPosition = useCallback((sym: string, side: 'L' | 'S', qty: number, entry: number) => {
    const { sl, tp } = defaultLevels(sym, side, entry);
    const pos: Position = {
      id: Date.now().toString(), symbol: sym, side, qty, entry, openedAt: Date.now(), sl, tp,
    };
    setPositions(prev => { const next = [...prev, pos]; savePos(next); return next; });
  }, []);

  const closePosition = useCallback((id: string, exitPx: number | null) => {
    setPositions(prev => {
      const pos = prev.find(p => p.id === id);
      if (!pos) return prev;
      const next = prev.filter(p => p.id !== id);
      savePos(next);
      if (exitPx !== null) {
        const tradePnl = pnlDollars(pos, exitPx);
        const trade: ClosedTrade = {
          id: Date.now().toString(), symbol: pos.symbol, side: pos.side,
          qty: pos.qty, entry: pos.entry, exit: exitPx, pnl: tradePnl, closedAt: Date.now(),
        };
        setAcct(a => {
          const updated = { ...a, realizedPnl: a.realizedPnl + tradePnl, closedTrades: [...a.closedTrades, trade] };
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

  const updateAcct = useCallback((patch: Partial<AccountSettings>) => {
    setAcct(prev => { const next = { ...prev, ...patch }; saveAcct(next); return next; });
  }, []);

  return { positions, acct, addPosition, closePosition, updatePosition, updateAcct };
}
