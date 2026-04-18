import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, X, RotateCcw, AlertTriangle, GripVertical, Eye, EyeOff } from 'lucide-react';
import { ALL_PRESETS, pointValueFor } from '@/hooks/use-paper-trading';
import type { usePaperTrading } from '@/hooks/use-paper-trading';
import type { QuoteData } from '@/hooks/use-market-data';
import type { SymbolInfo } from '@/components/symbol-selector';

type Trading = ReturnType<typeof usePaperTrading>;

interface Props {
  trading: Trading;
  active: SymbolInfo;
  quote: QuoteData | undefined;
  quotes: Record<string, QuoteData>;
}

const POSITION_KEY = 'fm_trade_panel_pos_v1';
const VISIBLE_KEY  = 'fm_trade_panel_visible_v1';

interface PanelPos { x: number; y: number }

function loadPos(): PanelPos {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (raw) return JSON.parse(raw) as PanelPos;
  } catch { /* ignore */ }
  return { x: window.innerWidth - 760, y: 70 };
}

function clampToViewport(p: PanelPos, w: number, h: number): PanelPos {
  const maxX = Math.max(0, window.innerWidth - w - 4);
  const maxY = Math.max(0, window.innerHeight - 40);
  return { x: Math.max(4, Math.min(p.x, maxX)), y: Math.max(4, Math.min(p.y, maxY)) };
}

const fmtMoney = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPx    = (v: number | null | undefined, dp = 2) => v == null ? '—' : v.toFixed(dp);

export function TradingPanel({ trading, active, quote, quotes }: Props) {
  const { state, equity, drawdown, unrealizedTotal, realized,
          placeMarket, placeLimit, cancelOrder, closePosition, flattenAll,
          setPositionTpSl, resetAccount, setPreset } = trading;

  const [collapsed, setCollapsed]   = useState(false);
  const [qty, setQty]               = useState(1);
  const [atmEnabled, setAtmEnabled] = useState(true);
  const [tpTicks, setTpTicks]       = useState(8);
  const [slTicks, setSlTicks]       = useState(6);
  const [showLog, setShowLog]       = useState(false);

  // ── Floating window state ────────────────────────────────────────────────
  const [visible, setVisible] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(VISIBLE_KEY) ?? 'true'); }
    catch { return true; }
  });
  const [pos, setPos] = useState<PanelPos>(() => loadPos());
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef  = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(VISIBLE_KEY, JSON.stringify(visible)); } catch { /* quota or disabled */ }
  }, [visible]);
  useEffect(() => {
    try { localStorage.setItem(POSITION_KEY, JSON.stringify(pos)); } catch { /* quota or disabled */ }
  }, [pos]);

  // Re-clamp when the window resizes so the panel never disappears off-screen
  useEffect(() => {
    const onResize = () => {
      const el = panelRef.current;
      if (!el) return;
      setPos(p => clampToViewport(p, el.offsetWidth, el.offsetHeight));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    // Only start drag when clicking the drag handle area, not buttons/inputs
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      const next = { x: d.origX + (ev.clientX - d.startX), y: d.origY + (ev.clientY - d.startY) };
      const el = panelRef.current;
      setPos(el ? clampToViewport(next, el.offsetWidth, el.offsetHeight) : next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos.x, pos.y]);

  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  const spreadTicks = useMemo(() => {
    if (bid == null || ask == null) return null;
    return Math.round((ask - bid) / active.tickSize);
  }, [bid, ask, active.tickSize]);

  const canTrade = !state.blownUp && bid != null && ask != null && qty > 0;

  const ddPct = state.config.mll > 0 ? Math.min(100, (drawdown / state.config.mll) * 100) : 0;
  const ddColor = ddPct < 50 ? 'bg-emerald-500/60' : ddPct < 80 ? 'bg-amber-500/70' : 'bg-rose-500/80';

  const totalPnl = realized + unrealizedTotal;
  const pnlColor = totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400';

  const myPositions = state.positions;
  const myOpenOrders = state.orders.filter(o => o.status === 'pending');
  const recentFills = [...state.fills].slice(-12).reverse();

  function doMarket(side: 'buy' | 'sell') {
    if (!canTrade || bid == null || ask == null) return;
    placeMarket({ symbol: active.display, side, qty, bid, ask,
      atm: { enabled: atmEnabled, tpTicks, slTicks } });
  }

  function doLimit(side: 'buy' | 'sell') {
    if (!canTrade || bid == null || ask == null) return;
    // Buy at bid (passive), sell at ask (passive)
    const price = side === 'buy' ? bid : ask;
    placeLimit({ symbol: active.display, side, qty, price,
      atm: { enabled: atmEnabled, tpTicks, slTicks } });
  }

  // Hidden — show only the floating restore button
  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="fixed z-40 flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#08081a]/95 backdrop-blur border border-white/15 hover:border-cyan-500/50 hover:bg-[#10101e] text-white/60 hover:text-white text-[10px] font-mono font-bold tracking-wider shadow-lg transition-colors"
        style={{ left: pos.x, top: pos.y }}
        title="Show paper trading panel"
      >
        <Eye className="w-3 h-3" />
        TRADE
        <span className={cn('ml-1', (realized + unrealizedTotal) >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
          {fmtMoney(realized + unrealizedTotal)}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      className="fixed z-40 bg-[#08081a]/95 backdrop-blur border border-white/15 rounded-md text-white shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: collapsed ? 'auto' : 720, maxWidth: 'calc(100vw - 8px)' }}
    >
      {/* Header strip — drag handle */}
      <div
        onMouseDown={onDragStart}
        className="flex items-center gap-3 px-2.5 py-1.5 border-b border-white/5 cursor-move select-none"
      >
        <GripVertical className="w-3 h-3 text-white/25 shrink-0" />
        <span className="text-[10px] font-bold tracking-[0.2em] text-white/40 font-mono uppercase">Paper Trade</span>

        {/* Account preset selector */}
        <select
          value={state.config.preset}
          onChange={e => {
            if (state.positions.length > 0 || state.orders.some(o => o.status === 'pending')) {
              if (!confirm('Switching preset resets the account. Continue?')) return;
            }
            setPreset(e.target.value as typeof state.config.preset);
          }}
          className="bg-[#12122a] border border-white/10 rounded text-[10px] font-mono text-white px-1.5 py-0.5 outline-none hover:border-white/25"
        >
          {ALL_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <div className="flex items-center gap-3 text-[10px] font-mono ml-1">
          <Stat label="Equity" value={fmtMoney(equity)} color={equity >= state.config.startingBalance ? 'text-emerald-400/90' : 'text-rose-400/90'} />
          <Stat label="P&L"    value={fmtMoney(totalPnl)} color={pnlColor} />
          <Stat label="Real"   value={fmtMoney(realized)} color={realized >= 0 ? 'text-emerald-400/70' : 'text-rose-400/70'} />
          <Stat label="Unrl"   value={fmtMoney(unrealizedTotal)} color={unrealizedTotal >= 0 ? 'text-emerald-400/70' : 'text-rose-400/70'} />
          <Stat label="Comm"   value={fmtMoney(state.totalCommission)} color="text-white/50" />
        </div>

        {/* Drawdown meter */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider leading-none">DD / MLL</span>
            <span className="text-[10px] font-mono text-white/80 tabular-nums leading-tight">
              {fmtMoney(drawdown)} / {fmtMoney(state.config.mll)}
            </span>
          </div>
          <div className="w-28 h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
            <div className={cn('h-full transition-all', ddColor)} style={{ width: `${ddPct}%` }} />
          </div>
          {state.blownUp && (
            <span className="flex items-center gap-1 text-[10px] font-bold font-mono text-rose-400 px-1.5 py-0.5 bg-rose-500/10 border border-rose-500/30 rounded">
              <AlertTriangle className="w-3 h-3" /> BLOWN
            </span>
          )}
          <button
            onClick={() => { if (confirm('Reset paper account? All positions, orders, and history will be cleared.')) resetAccount(); }}
            className="text-white/30 hover:text-white/70 p-1"
            title="Reset account"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setCollapsed(c => !c)} className="text-white/30 hover:text-white/70 p-1" title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setVisible(false)} className="text-white/30 hover:text-rose-400 p-1" title="Hide panel (use TRADE button to restore)">
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-2.5 flex gap-3">
          {/* Order entry */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <span className="text-white/30 uppercase tracking-wider">Symbol</span>
              <span className="text-cyan-400/80 font-bold">{active.display}</span>
              <span className="text-white/30 ml-2">Bid</span>
              <span className="text-cyan-300 tabular-nums">{fmtPx(bid)}</span>
              <span className="text-white/30 ml-2">Ask</span>
              <span className="text-orange-300 tabular-nums">{fmtPx(ask)}</span>
              {spreadTicks != null && (
                <span className="text-white/30 ml-1">({spreadTicks}t)</span>
              )}
              <span className="text-white/30 ml-3">Tick value</span>
              <span className="text-white/70 tabular-nums">${(active.tickSize * active.pointValue).toFixed(2)}</span>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Qty</label>
              <div className="flex items-center bg-[#12122a] border border-white/10 rounded">
                <button onClick={() => setQty(q => Math.max(1, q - 1))}
                        className="px-2 py-1 text-white/50 hover:text-white text-xs font-mono">−</button>
                <input
                  type="number" min={1} value={qty}
                  onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-12 bg-transparent text-center text-xs font-mono outline-none tabular-nums"
                />
                <button onClick={() => setQty(q => q + 1)}
                        className="px-2 py-1 text-white/50 hover:text-white text-xs font-mono">+</button>
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                <label className="flex items-center gap-1 text-[10px] font-mono text-white/50 cursor-pointer select-none">
                  <input type="checkbox" checked={atmEnabled} onChange={e => setAtmEnabled(e.target.checked)}
                         className="accent-cyan-500" />
                  ATM
                </label>
                <span className="text-[10px] font-mono text-white/30">TP</span>
                <input type="number" min={0} value={tpTicks}
                       onChange={e => setTpTicks(Math.max(0, parseInt(e.target.value) || 0))}
                       disabled={!atmEnabled}
                       className="w-12 bg-[#12122a] border border-white/10 rounded text-center text-xs font-mono px-1 py-0.5 outline-none tabular-nums disabled:opacity-40" />
                <span className="text-[10px] font-mono text-white/30">SL</span>
                <input type="number" min={0} value={slTicks}
                       onChange={e => setSlTicks(Math.max(0, parseInt(e.target.value) || 0))}
                       disabled={!atmEnabled}
                       className="w-12 bg-[#12122a] border border-white/10 rounded text-center text-xs font-mono px-1 py-0.5 outline-none tabular-nums disabled:opacity-40" />
              </div>
            </div>

            {/* Buy / Sell rows */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => doMarket('buy')}
                disabled={!canTrade}
                className="flex flex-col items-center py-2 rounded bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-300 font-mono text-xs font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span className="tracking-wider">BUY MKT</span>
                <span className="text-[10px] tabular-nums text-emerald-200/80">{fmtPx(ask)}</span>
              </button>
              <button
                onClick={() => doMarket('sell')}
                disabled={!canTrade}
                className="flex flex-col items-center py-2 rounded bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/40 text-rose-300 font-mono text-xs font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span className="tracking-wider">SELL MKT</span>
                <span className="text-[10px] tabular-nums text-rose-200/80">{fmtPx(bid)}</span>
              </button>

              <button
                onClick={() => doLimit('buy')}
                disabled={!canTrade}
                className="flex flex-col items-center py-1.5 rounded bg-cyan-600/15 hover:bg-cyan-600/30 border border-cyan-500/30 text-cyan-200 font-mono text-[11px] font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span className="tracking-wider">BUY @ BID</span>
                <span className="text-[10px] tabular-nums text-cyan-100/70">{fmtPx(bid)}</span>
              </button>
              <button
                onClick={() => doLimit('sell')}
                disabled={!canTrade}
                className="flex flex-col items-center py-1.5 rounded bg-orange-600/15 hover:bg-orange-600/30 border border-orange-500/30 text-orange-200 font-mono text-[11px] font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span className="tracking-wider">SELL @ ASK</span>
                <span className="text-[10px] tabular-nums text-orange-100/70">{fmtPx(ask)}</span>
              </button>
            </div>

            <button
              onClick={() => flattenAll(quotes)}
              disabled={state.positions.length === 0}
              className="w-full py-1.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-mono text-[11px] font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed tracking-wider"
            >
              FLATTEN ALL
            </button>
          </div>

          {/* Positions + Orders */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div>
              <div className="text-[10px] font-mono text-white/30 uppercase tracking-wider mb-1">Positions</div>
              {myPositions.length === 0 ? (
                <div className="text-[11px] font-mono text-white/20 italic px-1">No open positions</div>
              ) : (
                <div className="space-y-1">
                  {myPositions.map(p => {
                    const q = quotes[p.symbol];
                    const mark = q?.price ?? p.avgPrice;
                    const pv = pointValueFor(p.symbol);
                    const dir = p.side === 'long' ? 1 : -1;
                    const upnl = (mark - p.avgPrice) * dir * p.qty * pv;
                    const tpO = state.orders.find(o => o.id === p.tpOrderId && o.status === 'pending');
                    const slO = state.orders.find(o => o.id === p.slOrderId && o.status === 'pending');
                    return (
                      <div key={p.id} className="flex items-center gap-2 px-2 py-1 bg-white/[0.03] border border-white/[0.06] rounded text-[11px] font-mono">
                        <span className={cn('font-bold w-10', p.side === 'long' ? 'text-emerald-400' : 'text-rose-400')}>
                          {p.side === 'long' ? 'LONG' : 'SHRT'}
                        </span>
                        <span className="text-white/80 tabular-nums w-7">{p.qty}</span>
                        <span className="text-cyan-400/80 w-10">{p.symbol}</span>
                        <span className="text-white/50 tabular-nums">@ {fmtPx(p.avgPrice)}</span>
                        <span className="text-white/30 tabular-nums">→ {fmtPx(mark)}</span>
                        <span className={cn('tabular-nums ml-auto', upnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                          {fmtMoney(upnl)}
                        </span>
                        <div className="flex items-center gap-1 text-[10px]">
                          <span className="text-emerald-300/60">TP {tpO?.price != null ? fmtPx(tpO.price) : '—'}</span>
                          <span className="text-rose-300/60">SL {slO?.price != null ? fmtPx(slO.price) : '—'}</span>
                        </div>
                        <button
                          onClick={() => closePosition(p.id, quotes)}
                          className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-white/60 hover:text-white text-[10px] font-bold tracking-wider"
                        >
                          CLOSE
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-mono text-white/30 uppercase tracking-wider mb-1">Working Orders</div>
              {myOpenOrders.length === 0 ? (
                <div className="text-[11px] font-mono text-white/20 italic px-1">No working orders</div>
              ) : (
                <div className="space-y-0.5 max-h-24 overflow-y-auto">
                  {myOpenOrders.map(o => (
                    <div key={o.id} className="flex items-center gap-2 px-2 py-0.5 text-[10px] font-mono">
                      <span className={cn('w-8 font-bold', o.side === 'buy' ? 'text-emerald-400/80' : 'text-rose-400/80')}>
                        {o.side.toUpperCase()}
                      </span>
                      <span className="text-white/50 w-8 uppercase">{o.type}</span>
                      <span className="text-white/70 tabular-nums w-5">{o.qty}</span>
                      <span className="text-cyan-400/70 w-9">{o.symbol}</span>
                      <span className="text-white/60 tabular-nums">@ {o.price != null ? fmtPx(o.price) : 'MKT'}</span>
                      <button onClick={() => cancelOrder(o.id)} className="ml-auto text-white/30 hover:text-rose-400">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <button onClick={() => setShowLog(s => !s)} className="text-[10px] font-mono text-white/30 uppercase tracking-wider hover:text-white/60 flex items-center gap-1">
                Trade Log {showLog ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showLog && (
                <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto bg-black/30 rounded p-1">
                  {recentFills.length === 0 ? (
                    <div className="text-[10px] font-mono text-white/20 italic px-1">No fills yet</div>
                  ) : recentFills.map(f => (
                    <div key={f.id} className="flex items-center gap-2 px-1 text-[10px] font-mono">
                      <span className="text-white/30 tabular-nums">{new Date(f.ts).toLocaleTimeString()}</span>
                      <span className={cn('w-8 font-bold', f.side === 'buy' ? 'text-emerald-400/80' : 'text-rose-400/80')}>
                        {f.side.toUpperCase()}
                      </span>
                      <span className="text-white/70 tabular-nums w-5">{f.qty}</span>
                      <span className="text-cyan-400/70 w-9">{f.symbol}</span>
                      <span className="text-white/60 tabular-nums">@ {fmtPx(f.price)}</span>
                      {f.reason && <span className="text-white/30 uppercase text-[9px]">{f.reason}</span>}
                      {f.realizedPnl !== 0 && (
                        <span className={cn('tabular-nums ml-auto', f.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                          {fmtMoney(f.realizedPnl)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-start leading-tight">
      <span className="text-[8.5px] font-mono text-white/30 uppercase tracking-wider leading-none">{label}</span>
      <span className={cn('tabular-nums leading-tight', color)}>{value}</span>
    </div>
  );
}
