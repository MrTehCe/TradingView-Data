// ─────────────────────────────────────────────────────────────────────────────
// Paper trading domain types + presets
// ─────────────────────────────────────────────────────────────────────────────

export type AccountPreset = '25k' | '50k' | '75k' | '100k' | '150k';

export interface AccountConfig {
  preset: AccountPreset;
  startingBalance: number;
  mll: number;            // max loss limit (trailing from peak equity)
}

export const ACCOUNT_PRESETS: Record<AccountPreset, AccountConfig> = {
  '25k':  { preset: '25k',  startingBalance:  25_000, mll: 1_500 },
  '50k':  { preset: '50k',  startingBalance:  50_000, mll: 2_000 },
  '75k':  { preset: '75k',  startingBalance:  75_000, mll: 3_000 },
  '100k': { preset: '100k', startingBalance: 100_000, mll: 4_000 },
  '150k': { preset: '150k', startingBalance: 150_000, mll: 6_000 },
};

export const COMMISSION_PER_CONTRACT = 0.76;

export type Side = 'long' | 'short';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'tp' | 'sl';
export type OrderStatus = 'pending' | 'filled' | 'cancelled';

export interface Position {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  avgPrice: number;
  openedAt: number;
  tpOrderId: string | null;
  slOrderId: string | null;
}

export interface AtmHint {
  tpTicks: number;
  slTicks: number;
}

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  price: number | null;       // null for market
  parentPositionId: string | null;
  reduceOnly: boolean;
  createdAt: number;
  status: OrderStatus;
  filledAt?: number;
  filledPrice?: number;
  atmHint?: AtmHint;          // attach TP/SL on fill (entry orders only)
}

export interface Fill {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  ts: number;
  commission: number;
  realizedPnl: number;        // 0 if opening; non-zero on close
  closedPositionId: string | null;
  reason?: string;            // 'tp' | 'sl' | 'manual' | 'market'
}

export interface PaperState {
  config: AccountConfig;
  cashBalance: number;          // realized P&L sum (relative to starting)
  totalCommission: number;
  peakEquity: number;
  positions: Position[];
  orders: Order[];
  fills: Fill[];
  blownUp: boolean;
  blownUpAt: number | null;
}

export function newAccount(preset: AccountPreset = '50k'): PaperState {
  const config = ACCOUNT_PRESETS[preset];
  return {
    config,
    cashBalance: config.startingBalance,
    totalCommission: 0,
    peakEquity: config.startingBalance,
    positions: [],
    orders: [],
    fills: [],
    blownUp: false,
    blownUpAt: null,
  };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// Compute unrealized P&L for a position at the given mark price
export function unrealizedPnl(pos: Position, mark: number, pointValue: number): number {
  const dir = pos.side === 'long' ? 1 : -1;
  return (mark - pos.avgPrice) * dir * pos.qty * pointValue;
}

// Equity = cash + sum of unrealized for all open positions
export function calcEquity(
  state: PaperState,
  marks: Record<string, number>,
  pointValues: Record<string, number>
): number {
  let unr = 0;
  for (const p of state.positions) {
    const m = marks[p.symbol];
    const pv = pointValues[p.symbol];
    if (m != null && pv != null) unr += unrealizedPnl(p, m, pv);
  }
  return state.cashBalance + unr;
}

export function drawdown(state: PaperState, equity: number): number {
  return Math.max(0, state.peakEquity - equity);
}

export function roundToTick(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}
