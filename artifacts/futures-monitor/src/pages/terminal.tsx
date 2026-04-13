import { useEffect, useState, useCallback, useRef } from 'react';
import { useMarketData } from '@/hooks/use-market-data';
import { usePositions }  from '@/hooks/use-positions';
import { ContractPanel }  from '@/components/contract-panel';
import { PriceHeatmap }   from '@/components/price-heatmap';
import { SettingsPanel }  from '@/components/settings-panel';
import { PositionsPanel } from '@/components/positions-panel';
import { SymbolSelector, KNOWN_SYMBOLS, type SymbolInfo } from '@/components/symbol-selector';
import { cn } from '@/lib/utils';

const DEFAULT_SYMBOL = KNOWN_SYMBOLS.find(s => s.display === 'MES')!;

interface SlTpToast { id: number; msg: string; kind: 'sl' | 'tp' }

export default function TerminalPage() {
  const { quotes, status, sendToken, clearToken, subscribeSymbol, tickHistoryRef, orderBookRef } = useMarketData();
  const { positions, acct, addPosition, scaleIn, closePosition, partialClose, updatePosition, updateAcct } = usePositions();
  const [active, setActive] = useState<SymbolInfo>(DEFAULT_SYMBOL);
  const [toasts, setToasts] = useState<SlTpToast[]>([]);

  // Track which position IDs have already been auto-closed this session
  const triggeredRef = useRef<Set<string>>(new Set());

  // High-water / low-water per position ID for trailing stop
  const hwRef = useRef<Record<string, number>>({});

  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);

  useEffect(() => { subscribeSymbol(active.tv); }, [active.tv, subscribeSymbol]);

  const handleSelect = useCallback((sym: SymbolInfo) => setActive(sym), []);

  const quoteMap: Record<string, { price: number | null; changePct: number | null }> = {};
  for (const [key, q] of Object.entries(quotes)) quoteMap[key] = { price: q.price, changePct: q.changePct };

  const currentPrices: Record<string, number | null> = {};
  for (const [key, q] of Object.entries(quotes)) currentPrices[key] = q.price;

  const activeData = quotes[active.display];

  // ── SL / TP auto-close + trailing stop monitor ───────────────────────────
  useEffect(() => {
    for (const pos of positions) {
      const px = currentPrices[pos.symbol];
      if (px == null) continue;

      // ── Trailing stop: advance SL as price moves favourably ──────────────
      if (pos.trailPts != null && pos.trailPts > 0) {
        const hw = hwRef.current[pos.id];
        const newHw = pos.side === 'L' ? Math.max(hw ?? px, px) : Math.min(hw ?? px, px);
        hwRef.current[pos.id] = newHw;

        const newSl = pos.side === 'L' ? newHw - pos.trailPts : newHw + pos.trailPts;
        const slImproved = pos.sl == null
          || (pos.side === 'L' && newSl > pos.sl)
          || (pos.side === 'S' && newSl < pos.sl);

        if (slImproved) {
          updatePosition(pos.id, { sl: Math.round(newSl * 100) / 100 });
        }
      }

      // ── SL / TP auto-close ───────────────────────────────────────────────
      if (triggeredRef.current.has(pos.id)) continue;

      const slHit = pos.sl != null && (pos.side === 'L' ? px <= pos.sl : px >= pos.sl);
      const tpHit = pos.tp != null && (pos.side === 'L' ? px >= pos.tp : px <= pos.tp);
      if (!slHit && !tpHit) continue;

      triggeredRef.current.add(pos.id);

      const kind  = slHit ? 'sl' as const : 'tp' as const;
      const level = (slHit ? pos.sl : pos.tp)!;
      const dir   = pos.side === 'L' ? 'Long' : 'Short';

      closePosition(pos.id, level);

      const msg = `${pos.symbol} ${dir} auto-closed — ${kind.toUpperCase()} hit @ ${level.toFixed(2)}`;
      const toastId = Date.now() + Math.random();
      setToasts(t => [...t, { id: toastId, msg, kind }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== toastId)), 5000);
    }
  });   // runs every render so it reacts to every quote update

  // Clean up triggered IDs + hw entries for closed positions
  useEffect(() => {
    const ids = new Set(positions.map(p => p.id));
    for (const id of triggeredRef.current) {
      if (!ids.has(id)) triggeredRef.current.delete(id);
    }
    for (const id of Object.keys(hwRef.current)) {
      if (!ids.has(id)) delete hwRef.current[id];
    }
  }, [positions]);

  return (
    <div className="h-screen bg-[#04040a] text-white flex flex-col px-3 pt-2.5 pb-2 font-sans selection:bg-white/20 overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center mb-2 shrink-0 gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-bold tracking-[0.25em] text-white/25 font-mono uppercase shrink-0">Futures</span>
          <span className="h-3 w-px bg-white/10 shrink-0" />
          <SymbolSelector active={active} onSelect={handleSelect} quotes={quoteMap} />
        </div>
        <SettingsPanel status={status} sendToken={sendToken} clearToken={clearToken} />
      </header>

      {/* Positions + account */}
      <PositionsPanel
        currentPrices={currentPrices}
        positions={positions}
        acct={acct}
        onAddPosition={addPosition}
        onScaleIn={scaleIn}
        onClosePosition={(id) => closePosition(id, currentPrices[positions.find(p => p.id === id)?.symbol ?? ''] ?? null)}
        onPartialClose={partialClose}
        onUpdatePosition={updatePosition}
        onUpdateAcct={updateAcct}
      />

      {/* Chart */}
      <div className="flex-1 flex flex-col gap-2 min-h-0 mt-2">
        <ContractPanel symbol={active.display} data={activeData} />
        <PriceHeatmap
          symbol={active.display}
          currentPrice={activeData?.price ?? null}
          bucketSize={active.bucket}
          tickHistoryRef={tickHistoryRef}
          orderBookRef={orderBookRef}
          positions={positions}
          onUpdatePosition={updatePosition}
        />
      </div>

      {status.needsLogin && status.wsConnected && (
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground/40 shrink-0 font-mono">
          Click the settings icon to log in and start streaming live data.
        </p>
      )}

      {/* SL / TP toast notifications */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-[100] pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={cn(
            'px-4 py-2.5 rounded-lg border text-sm font-mono font-bold shadow-2xl animate-in slide-in-from-right-4 fade-in duration-200',
            t.kind === 'sl'
              ? 'bg-red-950/90 border-red-500/40 text-red-300'
              : 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300'
          )}>
            {t.kind === 'sl' ? '🔴' : '🟢'} {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
