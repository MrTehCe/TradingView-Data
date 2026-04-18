import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCOUNT_PRESETS, COMMISSION_PER_CONTRACT, type AccountPreset, type AtmHint,
  type Order, type OrderSide, type Position, type Fill, type PaperState,
  newAccount, uid, unrealizedPnl, calcEquity, drawdown, roundToTick,
} from '@/lib/paper-trading';
import { KNOWN_SYMBOLS, type SymbolInfo } from '@/components/symbol-selector';
import type { QuoteData } from '@/hooks/use-market-data';

const STORAGE_KEY = 'fm_paper_trading_v1';

const SYM_BY_DISPLAY: Record<string, SymbolInfo> = {};
for (const s of KNOWN_SYMBOLS) SYM_BY_DISPLAY[s.display] = s;

export function pointValueFor(sym: string): number   { return SYM_BY_DISPLAY[sym]?.pointValue ?? 1; }
export function tickSizeFor(sym: string): number     { return SYM_BY_DISPLAY[sym]?.tickSize ?? 0.25; }

function loadState(): PaperState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PaperState;
  } catch { return null; }
}

function saveState(s: PaperState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export interface AtmConfig {
  enabled: boolean;
  tpTicks: number;
  slTicks: number;
}

interface PlaceMarketParams {
  symbol: string;
  side: OrderSide;
  qty: number;
  bid: number;
  ask: number;
  atm?: AtmConfig;
}

interface PlaceLimitParams {
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  atm?: AtmConfig;
}

// ─── Order engine helpers ────────────────────────────────────────────────────

function applyAtmToPosition(state: PaperState, positionId: string, hint: AtmHint): PaperState {
  const pos = state.positions.find(p => p.id === positionId);
  if (!pos) return state;
  if (pos.tpOrderId || pos.slOrderId) return state;
  const ts = Date.now();
  const tickSize = tickSizeFor(pos.symbol);
  const dir = pos.side === 'long' ? 1 : -1;
  const exitSide: OrderSide = pos.side === 'long' ? 'sell' : 'buy';
  const orders: Order[] = [];
  let tpId: string | null = null;
  let slId: string | null = null;
  if (hint.tpTicks > 0) {
    const tp: Order = {
      id: uid(), symbol: pos.symbol, side: exitSide, type: 'tp', qty: pos.qty,
      price: roundToTick(pos.avgPrice + dir * hint.tpTicks * tickSize, tickSize),
      parentPositionId: pos.id, reduceOnly: true, createdAt: ts, status: 'pending',
    };
    orders.push(tp);
    tpId = tp.id;
  }
  if (hint.slTicks > 0) {
    const sl: Order = {
      id: uid(), symbol: pos.symbol, side: exitSide, type: 'sl', qty: pos.qty,
      price: roundToTick(pos.avgPrice - dir * hint.slTicks * tickSize, tickSize),
      parentPositionId: pos.id, reduceOnly: true, createdAt: ts, status: 'pending',
    };
    orders.push(sl);
    slId = sl.id;
  }
  return {
    ...state,
    orders: [...state.orders, ...orders],
    positions: state.positions.map(p =>
      p.id === pos.id ? { ...p, tpOrderId: tpId, slOrderId: slId } : p
    ),
  };
}

function fillOrder(state: PaperState, order: Order, fillPrice: number, reason: string, ts: number): PaperState {
  const pv = pointValueFor(order.symbol);

  // Determine if this opens or closes a position
  const existing = state.positions.find(p => p.symbol === order.symbol);
  let realizedPnl = 0;
  let positions = state.positions;
  let closedPositionId: string | null = null;

  const opposingExisting = existing && (
    (existing.side === 'long'  && order.side === 'sell') ||
    (existing.side === 'short' && order.side === 'buy')
  );

  // For reduce-only orders, cap the executed quantity to the existing position's
  // quantity so a stale bracket can never reverse a position.
  let execQty = order.qty;
  if (order.reduceOnly) {
    if (!opposingExisting || !existing) {
      // No position to reduce — record the order as cancelled rather than fill it
      const orders = state.orders.map(o =>
        o.id === order.id ? { ...o, status: 'cancelled' as const } : o
      );
      return { ...state, orders };
    }
    execQty = Math.min(order.qty, existing.qty);
  }

  const commission = COMMISSION_PER_CONTRACT * execQty;

  if (opposingExisting && existing) {
    // Close (or reduce) existing position
    const closeQty = Math.min(execQty, existing.qty);
    const dir = existing.side === 'long' ? 1 : -1;
    realizedPnl = (fillPrice - existing.avgPrice) * dir * closeQty * pv;

    if (closeQty >= existing.qty) {
      // Full close — also cancel any TP/SL siblings
      positions = state.positions.filter(p => p.id !== existing.id);
      closedPositionId = existing.id;
    } else {
      const newQty = existing.qty - closeQty;
      positions = state.positions.map(p =>
        p.id === existing.id ? { ...p, qty: newQty } : p
      );
    }

    // Remainder reversal only allowed for non-reduce-only entry orders
    const remainder = execQty - closeQty;
    if (remainder > 0 && closeQty >= existing.qty && !order.reduceOnly) {
      const newPos: Position = {
        id: uid(),
        symbol: order.symbol,
        side: order.side === 'buy' ? 'long' : 'short',
        qty: remainder,
        avgPrice: fillPrice,
        openedAt: ts,
        tpOrderId: null,
        slOrderId: null,
      };
      positions = [...positions, newPos];
    }
  } else if (existing) {
    // Add to existing position (same side)
    const newQty = existing.qty + order.qty;
    const newAvg = (existing.avgPrice * existing.qty + fillPrice * order.qty) / newQty;
    positions = state.positions.map(p =>
      p.id === existing.id ? { ...p, qty: newQty, avgPrice: newAvg } : p
    );
  } else {
    // Brand new position
    const newPos: Position = {
      id: uid(),
      symbol: order.symbol,
      side: order.side === 'buy' ? 'long' : 'short',
      qty: order.qty,
      avgPrice: fillPrice,
      openedAt: ts,
      tpOrderId: null,
      slOrderId: null,
    };
    positions = [...positions, newPos];
  }

  // Cancel TP/SL of fully-closed position
  let orders = state.orders.map(o =>
    o.id === order.id
      ? { ...o, status: 'filled' as const, filledAt: ts, filledPrice: fillPrice }
      : o
  );
  if (closedPositionId) {
    orders = orders.map(o =>
      o.parentPositionId === closedPositionId && o.status === 'pending'
        ? { ...o, status: 'cancelled' as const }
        : o
    );
  }

  const fill: Fill = {
    id: uid(),
    orderId: order.id,
    symbol: order.symbol,
    side: order.side,
    qty: order.qty,
    price: fillPrice,
    ts,
    commission,
    realizedPnl,
    closedPositionId,
    reason,
  };

  const cashBalance = state.cashBalance + realizedPnl - commission;
  return {
    ...state,
    cashBalance,
    totalCommission: state.totalCommission + commission,
    positions,
    orders,
    fills: [...state.fills, fill].slice(-500),  // cap
  };
}

// Process pending orders against the latest quote. Uses bid/ask + tracked
// intra-period high/low (so wicks can hit TP/SL).
function processOrders(
  state: PaperState,
  symbol: string,
  bid: number,
  ask: number,
  high: number,
  low: number,
  ts: number,
): PaperState {
  if (state.blownUp) return state;
  let s = state;
  // Snapshot of pending orders for this symbol; we may add new ones (TP/SL on fill) so iterate carefully
  const pending = s.orders.filter(o => o.symbol === symbol && o.status === 'pending');
  for (const o of pending) {
    // Re-check status from latest s (in case prior loop iteration changed it)
    const cur = s.orders.find(x => x.id === o.id);
    if (!cur || cur.status !== 'pending') continue;

    let fillPx: number | null = null;
    let reason = 'limit';

    if (o.type === 'market') {
      fillPx = o.side === 'buy' ? ask : bid;
      reason = 'market';
    } else if (o.type === 'limit' && o.price != null) {
      // Buy limit: triggers when ask (or sweep low) reaches/passes limit price
      // Sell limit: triggers when bid (or sweep high) reaches/passes limit price
      if (o.side === 'buy'  && Math.min(ask, low)  <= o.price) { fillPx = Math.min(o.price, ask); }
      if (o.side === 'sell' && Math.max(bid, high) >= o.price) { fillPx = Math.max(o.price, bid); }
    } else if (o.type === 'tp' && o.price != null) {
      // TP: profitable exit. Long position TP = sell when high >= price
      // Short position TP = buy when low <= price
      if (o.side === 'sell' && high >= o.price) { fillPx = o.price; reason = 'tp'; }
      if (o.side === 'buy'  && low  <= o.price) { fillPx = o.price; reason = 'tp'; }
    } else if (o.type === 'sl' && o.price != null) {
      // SL: stop-loss exit. Long position SL = sell when low <= price
      // Short position SL = buy when high >= price
      if (o.side === 'sell' && low  <= o.price) { fillPx = o.price; reason = 'sl'; }
      if (o.side === 'buy'  && high >= o.price) { fillPx = o.price; reason = 'sl'; }
    }

    if (fillPx != null) {
      s = fillOrder(s, o, fillPx, reason, ts);
      // Attach ATM brackets to the entry-side position if hinted
      if (o.atmHint && !o.reduceOnly) {
        const newPos = [...s.positions].reverse().find(p =>
          p.symbol === o.symbol &&
          ((o.side === 'buy' && p.side === 'long') || (o.side === 'sell' && p.side === 'short'))
        );
        if (newPos) s = applyAtmToPosition(s, newPos.id, o.atmHint);
      }
    }
  }
  return s;
}

// Detect MLL breach. If equity drawdown ≥ MLL → blow up + flatten.
function checkBlowUp(
  state: PaperState,
  marks: Record<string, number>,
  pointValues: Record<string, number>,
  ts: number,
): PaperState {
  if (state.blownUp) return state;
  const equity = calcEquity(state, marks, pointValues);
  const peak = Math.max(state.peakEquity, equity);
  const dd = peak - equity;
  if (dd >= state.config.mll) {
    // Force-close everything at current marks AND cancel all pending orders
    let s: PaperState = { ...state, peakEquity: peak };
    for (const pos of [...s.positions]) {
      const m = marks[pos.symbol];
      if (m == null) continue;
      const pv = pointValues[pos.symbol] ?? 1;
      const dir = pos.side === 'long' ? 1 : -1;
      const realized = (m - pos.avgPrice) * dir * pos.qty * pv;
      const commission = COMMISSION_PER_CONTRACT * pos.qty;
      const fill: Fill = {
        id: uid(),
        orderId: 'blowup',
        symbol: pos.symbol,
        side: pos.side === 'long' ? 'sell' : 'buy',
        qty: pos.qty,
        price: m,
        ts,
        commission,
        realizedPnl: realized,
        closedPositionId: pos.id,
        reason: 'blowup',
      };
      s = {
        ...s,
        cashBalance: s.cashBalance + realized - commission,
        totalCommission: s.totalCommission + commission,
        positions: s.positions.filter(p => p.id !== pos.id),
        fills: [...s.fills, fill].slice(-500),
      };
    }
    // Cancel ALL pending orders (entries, brackets, everything) so the blown-up
    // account cannot reopen positions.
    return {
      ...s,
      orders: s.orders.map(o =>
        o.status === 'pending' ? { ...o, status: 'cancelled' as const } : o
      ),
      blownUp: true,
      blownUpAt: ts,
    };
  }
  // Avoid state churn: only return a new object if peakEquity actually moved.
  if (peak !== state.peakEquity) return { ...state, peakEquity: peak };
  return state;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePaperTrading(quotes: Record<string, QuoteData>) {
  const [state, setState] = useState<PaperState>(() => loadState() ?? newAccount('50k'));
  const stateRef = useRef(state);
  stateRef.current = state;

  // Track intra-period high/low per symbol so wicks can hit stops
  const lastQuoteRef = useRef<Record<string, { bid: number; ask: number; high: number; low: number; ts: number }>>({});

  // Persist on every change
  useEffect(() => { saveState(state); }, [state]);

  // ── Order engine: react to every quote update ──────────────────────────────
  useEffect(() => {
    const ts = Date.now();
    let working = stateRef.current;
    let touched = false;

    const marks: Record<string, number> = {};
    const pointValues: Record<string, number> = {};

    for (const [sym, q] of Object.entries(quotes)) {
      if (q.bid == null || q.ask == null || q.price == null) continue;
      marks[sym] = q.price;
      pointValues[sym] = pointValueFor(sym);

      const prev = lastQuoteRef.current[sym];
      // For wick detection, the sweep range covers from the previous tick's
      // bid/ask through the current tick — so a stop sitting between two ticks
      // can still be hit.
      const sweepHigh = prev ? Math.max(prev.ask, prev.high, q.ask, q.price) : Math.max(q.ask, q.price);
      const sweepLow  = prev ? Math.min(prev.bid, prev.low,  q.bid, q.price) : Math.min(q.bid, q.price);

      const before = working;
      working = processOrders(working, sym, q.bid, q.ask, sweepHigh, sweepLow, ts);
      if (working !== before) touched = true;

      // Reset window after engine pass — high/low collapse to the current tick
      lastQuoteRef.current[sym] = { bid: q.bid, ask: q.ask, high: q.price, low: q.price, ts };
    }

    // Drawdown / blow-up check
    const beforeBU = working;
    working = checkBlowUp(working, marks, pointValues, ts);
    if (working !== beforeBU) touched = true;

    if (touched) setState(working);
  }, [quotes]);

  // ── Order placement ────────────────────────────────────────────────────────
  const placeMarket = useCallback((p: PlaceMarketParams) => {
    setState(prev => {
      if (prev.blownUp) return prev;
      const ts = Date.now();
      const hint = p.atm?.enabled ? { tpTicks: p.atm.tpTicks, slTicks: p.atm.slTicks } : undefined;
      const order: Order = {
        id: uid(), symbol: p.symbol, side: p.side, type: 'market',
        qty: p.qty, price: null, parentPositionId: null, reduceOnly: false,
        createdAt: ts, status: 'pending',
        atmHint: hint,
      };
      let next: PaperState = { ...prev, orders: [...prev.orders, order] };
      const fillPx = p.side === 'buy' ? p.ask : p.bid;
      next = fillOrder(next, order, fillPx, 'market', ts);
      if (hint) {
        const newPos = [...next.positions].reverse().find(po =>
          po.symbol === p.symbol &&
          ((p.side === 'buy' && po.side === 'long') || (p.side === 'sell' && po.side === 'short'))
        );
        if (newPos) next = applyAtmToPosition(next, newPos.id, hint);
      }
      return next;
    });
  }, []);

  const placeLimit = useCallback((p: PlaceLimitParams) => {
    setState(prev => {
      if (prev.blownUp) return prev;
      const ts = Date.now();
      const hint = p.atm?.enabled ? { tpTicks: p.atm.tpTicks, slTicks: p.atm.slTicks } : undefined;
      const order: Order = {
        id: uid(), symbol: p.symbol, side: p.side, type: 'limit',
        qty: p.qty, price: p.price, parentPositionId: null, reduceOnly: false,
        createdAt: ts, status: 'pending',
        atmHint: hint,
      };
      return { ...prev, orders: [...prev.orders, order] };
    });
  }, []);

  const cancelOrder = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      orders: prev.orders.map(o => o.id === id && o.status === 'pending' ? { ...o, status: 'cancelled' } : o),
    }));
  }, []);

  const flattenAll = useCallback((quotesNow: Record<string, QuoteData>) => {
    setState(prev => {
      const ts = Date.now();
      let next = prev;
      for (const pos of [...prev.positions]) {
        const q = quotesNow[pos.symbol];
        if (!q || q.bid == null || q.ask == null) continue;
        const exitSide: OrderSide = pos.side === 'long' ? 'sell' : 'buy';
        const fillPx = exitSide === 'buy' ? q.ask : q.bid;
        const order: Order = {
          id: uid(), symbol: pos.symbol, side: exitSide, type: 'market',
          qty: pos.qty, price: null, parentPositionId: pos.id, reduceOnly: true,
          createdAt: ts, status: 'pending',
        };
        next = { ...next, orders: [...next.orders, order] };
        next = fillOrder(next, order, fillPx, 'manual', ts);
      }
      // Cancel all remaining working orders (e.g. resting limit entries) so
      // a flatten doesn't leave the account exposed to re-entry.
      next = {
        ...next,
        orders: next.orders.map(o =>
          o.status === 'pending' ? { ...o, status: 'cancelled' as const } : o
        ),
      };
      return next;
    });
  }, []);

  const closePosition = useCallback((positionId: string, quotesNow: Record<string, QuoteData>) => {
    setState(prev => {
      const pos = prev.positions.find(p => p.id === positionId);
      if (!pos) return prev;
      const q = quotesNow[pos.symbol];
      if (!q || q.bid == null || q.ask == null) return prev;
      const ts = Date.now();
      const exitSide: OrderSide = pos.side === 'long' ? 'sell' : 'buy';
      const fillPx = exitSide === 'buy' ? q.ask : q.bid;
      const order: Order = {
        id: uid(), symbol: pos.symbol, side: exitSide, type: 'market',
        qty: pos.qty, price: null, parentPositionId: pos.id, reduceOnly: true,
        createdAt: ts, status: 'pending',
      };
      let next = { ...prev, orders: [...prev.orders, order] };
      next = fillOrder(next, order, fillPx, 'manual', ts);
      return next;
    });
  }, []);

  const setPositionTpSl = useCallback((positionId: string, tpTicks: number | null, slTicks: number | null) => {
    setState(prev => {
      const pos = prev.positions.find(p => p.id === positionId);
      if (!pos) return prev;
      const ts = Date.now();
      const tickSize = tickSizeFor(pos.symbol);
      const dir = pos.side === 'long' ? 1 : -1;
      const exitSide: OrderSide = pos.side === 'long' ? 'sell' : 'buy';

      // Cancel existing TP/SL siblings
      let orders = prev.orders.map(o =>
        o.parentPositionId === pos.id && (o.type === 'tp' || o.type === 'sl') && o.status === 'pending'
          ? { ...o, status: 'cancelled' as const }
          : o
      );
      let positions = prev.positions.map(p =>
        p.id === pos.id ? { ...p, tpOrderId: null, slOrderId: null } : p
      );

      let tpId: string | null = null;
      let slId: string | null = null;

      if (tpTicks != null && tpTicks > 0) {
        const tpPrice = roundToTick(pos.avgPrice + dir * tpTicks * tickSize, tickSize);
        const tp: Order = {
          id: uid(), symbol: pos.symbol, side: exitSide, type: 'tp', qty: pos.qty,
          price: tpPrice, parentPositionId: pos.id, reduceOnly: true,
          createdAt: ts, status: 'pending',
        };
        orders = [...orders, tp];
        tpId = tp.id;
      }
      if (slTicks != null && slTicks > 0) {
        const slPrice = roundToTick(pos.avgPrice - dir * slTicks * tickSize, tickSize);
        const sl: Order = {
          id: uid(), symbol: pos.symbol, side: exitSide, type: 'sl', qty: pos.qty,
          price: slPrice, parentPositionId: pos.id, reduceOnly: true,
          createdAt: ts, status: 'pending',
        };
        orders = [...orders, sl];
        slId = sl.id;
      }

      positions = positions.map(p =>
        p.id === pos.id ? { ...p, tpOrderId: tpId, slOrderId: slId } : p
      );
      return { ...prev, orders, positions };
    });
  }, []);

  const resetAccount = useCallback((preset?: AccountPreset) => {
    setState(_prev => newAccount(preset ?? stateRef.current.config.preset));
  }, []);

  const setPreset = useCallback((preset: AccountPreset) => {
    setState(_prev => newAccount(preset));
  }, []);

  // Computed values
  const marks: Record<string, number> = {};
  const pointValues: Record<string, number> = {};
  for (const [sym, q] of Object.entries(quotes)) {
    if (q.price != null) { marks[sym] = q.price; pointValues[sym] = pointValueFor(sym); }
  }
  const equity = calcEquity(state, marks, pointValues);
  const dd = drawdown(state, equity);
  const unrealizedTotal = state.positions.reduce((sum, p) => {
    const m = marks[p.symbol]; const pv = pointValueFor(p.symbol);
    return m != null ? sum + unrealizedPnl(p, m, pv) : sum;
  }, 0);
  const realized = state.cashBalance - state.config.startingBalance;

  return {
    state,
    equity,
    drawdown: dd,
    unrealizedTotal,
    realized,
    placeMarket,
    placeLimit,
    cancelOrder,
    closePosition,
    flattenAll,
    setPositionTpSl,
    resetAccount,
    setPreset,
  };
}

export const ALL_PRESETS = Object.keys(ACCOUNT_PRESETS) as AccountPreset[];
