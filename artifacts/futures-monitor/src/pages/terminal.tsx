import { useEffect, useState, useCallback } from 'react';
import { useMarketData } from '@/hooks/use-market-data';
import { usePaperTrading } from '@/hooks/use-paper-trading';
import { ContractPanel }  from '@/components/contract-panel';
import { PriceHeatmap }   from '@/components/price-heatmap';
import { SettingsPanel }  from '@/components/settings-panel';
import { TradingPanel }   from '@/components/trading-panel';
import { SymbolSelector, KNOWN_SYMBOLS, type SymbolInfo } from '@/components/symbol-selector';
import { cn } from '@/lib/utils';

const DEFAULT_SYMBOL = KNOWN_SYMBOLS.find(s => s.display === 'MES')!;

const GROUP_DOT: Record<string, string> = {
  equity: 'bg-cyan-400/60',
  metals: 'bg-amber-400/60',
  energy: 'bg-orange-400/60',
  crypto: 'bg-purple-400/60',
};

export default function TerminalPage() {
  const { quotes, status, sendToken, clearToken, subscribeSymbol, tickHistoryRef, orderBookRef } = useMarketData();
  const [active, setActive] = useState<SymbolInfo>(DEFAULT_SYMBOL);
  const trading = usePaperTrading(quotes);

  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);

  // Subscribe to ALL known symbols so the strip has live data for all of them
  useEffect(() => {
    for (const sym of KNOWN_SYMBOLS) subscribeSymbol(sym.tv);
  }, [subscribeSymbol]);

  const handleSelect = useCallback((sym: SymbolInfo) => setActive(sym), []);

  const quoteMap: Record<string, { price: number | null; changePct: number | null }> = {};
  for (const [key, q] of Object.entries(quotes)) quoteMap[key] = { price: q.price, changePct: q.changePct };

  const activeData = quotes[active.display];

  return (
    <div className="h-screen bg-[#04040a] text-white flex flex-col px-3 pt-2.5 pb-2 font-sans selection:bg-white/20 overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center mb-2 shrink-0 gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="relative text-[13px] font-black tracking-[0.35em] font-mono uppercase shrink-0 select-none"
            style={{
              color: '#f3eaff',
              textShadow:
                '1.5px 0 0 rgba(168,85,247,0.9), -1.5px 0 0 rgba(52,211,153,0.9), 0 0 8px rgba(52,211,153,0.35)',
              WebkitTextStroke: '0.4px rgba(255,255,255,0.15)',
              filter: 'drop-shadow(0 0 6px rgba(168,85,247,0.3))',
            }}
            data-testid="brand-brokie-maps"
          >
            {/* B — top-right corner chipped off, with a shard floating above */}
            <span style={{ position: 'relative', display: 'inline-block', transform: 'skewX(-6deg) translateY(-1px)' }}>
              <span style={{ display: 'inline-block', clipPath: 'polygon(0 0, 70% 0, 100% 30%, 100% 100%, 0 100%)' }}>B</span>
              <span style={{ position: 'absolute', top: '-6px', right: '-3px', fontSize: '0.45em', opacity: 0.7, transform: 'rotate(28deg)', color: 'rgba(52,211,153,0.9)' }}>◢</span>
            </span>
            <span style={{ display: 'inline-block', transform: 'skewX(-6deg) translateY(-1px)' }}>R</span>

            {/* O — sliced horizontally, lower half nudged down */}
            <span style={{ position: 'relative', display: 'inline-block', transform: 'translateY(1px)', opacity: 0.92 }}>
              <span style={{ display: 'inline-block', clipPath: 'polygon(0 0, 100% 0, 100% 45%, 0 55%)' }}>O</span>
              <span style={{ position: 'absolute', inset: 0, display: 'inline-block', clipPath: 'polygon(0 60%, 100% 50%, 100% 100%, 0 100%)', transform: 'translate(2px, 3px)' }}>O</span>
            </span>

            <span style={{ display: 'inline-block', transform: 'skewX(4deg)' }}>K</span>

            {/* I — bottom snapped off */}
            <span style={{ position: 'relative', display: 'inline-block', transform: 'translateY(-2px) rotate(-3deg)' }}>
              <span style={{ display: 'inline-block', clipPath: 'polygon(0 0, 100% 0, 100% 70%, 0 60%)' }}>I</span>
              <span style={{ position: 'absolute', bottom: '-5px', left: '1px', fontSize: '0.5em', opacity: 0.65, transform: 'rotate(-18deg)', color: 'rgba(168,85,247,0.85)' }}>▍</span>
            </span>

            <span style={{ display: 'inline-block', transform: 'translateY(1px)' }}>E</span>
            <span style={{ display: 'inline-block', width: '0.5em' }} />

            {/* M — left leg broken off */}
            <span style={{ position: 'relative', display: 'inline-block', transform: 'translateY(1px) skewX(3deg)' }}>
              <span style={{ display: 'inline-block', clipPath: 'polygon(15% 0, 100% 0, 100% 100%, 25% 100%, 10% 60%)' }}>M</span>
              <span style={{ position: 'absolute', bottom: '-4px', left: '-4px', fontSize: '0.4em', opacity: 0.7, transform: 'rotate(35deg)', color: 'rgba(52,211,153,0.85)' }}>◣</span>
            </span>

            <span style={{ display: 'inline-block', transform: 'translateY(-1px)' }}>A</span>

            {/* P — top of bowl chipped */}
            <span style={{ position: 'relative', display: 'inline-block', transform: 'rotate(2deg)', opacity: 0.92 }}>
              <span style={{ display: 'inline-block', clipPath: 'polygon(0 0, 60% 0, 85% 15%, 100% 35%, 100% 100%, 0 100%)' }}>P</span>
            </span>

            {/* S — middle bar fractured, slight offset between halves */}
            <span style={{ position: 'relative', display: 'inline-block', transform: 'skewX(-5deg) translateY(1px)' }}>
              <span style={{ display: 'inline-block', clipPath: 'polygon(0 0, 100% 0, 100% 48%, 0 52%)' }}>S</span>
              <span style={{ position: 'absolute', inset: 0, display: 'inline-block', clipPath: 'polygon(0 56%, 100% 52%, 100% 100%, 0 100%)', transform: 'translate(-2px, 2px)' }}>S</span>
            </span>
            <span
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 1px, transparent 1px 3px)',
                mixBlendMode: 'overlay',
              }}
            />
          </span>
          <span className="h-3 w-px bg-white/10 shrink-0" />
          <SymbolSelector active={active} onSelect={handleSelect} quotes={quoteMap} />
        </div>
        <SettingsPanel status={status} sendToken={sendToken} clearToken={clearToken} />
      </header>

      {/* Multi-symbol strip */}
      <div className="flex gap-1 mb-2 shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {KNOWN_SYMBOLS.map(sym => {
          const q = quotes[sym.display];
          const isActive = sym.display === active.display;
          const pct = q?.changePct ?? null;
          const isUp = pct !== null && pct >= 0;
          return (
            <button
              key={sym.display}
              onClick={() => handleSelect(sym)}
              className={cn(
                'flex-none flex flex-col items-start px-2 py-1 rounded transition-all border',
                isActive
                  ? 'bg-white/8 border-white/20'
                  : 'bg-white/[0.025] border-white/[0.06] hover:border-white/15 hover:bg-white/[0.05]'
              )}
            >
              <div className="flex items-center gap-1">
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', GROUP_DOT[sym.group])} />
                <span className="text-[10px] font-bold font-mono text-white/80 tracking-wider">{sym.display}</span>
              </div>
              {q?.price != null ? (
                <span className={cn(
                  'text-[9px] font-mono tabular-nums mt-0.5',
                  pct === null ? 'text-white/30' : isUp ? 'text-emerald-400' : 'text-purple-400'
                )}>
                  {pct !== null ? `${isUp ? '+' : ''}${pct.toFixed(2)}%` : '—'}
                </span>
              ) : (
                <span className="text-[9px] text-white/15 mt-0.5">—</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="flex-1 flex flex-col gap-2 min-h-0">
        <ContractPanel symbol={active.display} data={activeData} />
        <PriceHeatmap
          symbol={active.display}
          currentPrice={activeData?.price ?? null}
          bucketSize={active.bucket}
          tickHistoryRef={tickHistoryRef}
          orderBookRef={orderBookRef}
        />
      </div>

      {status.needsLogin && status.wsConnected && (
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground/40 shrink-0 font-mono">
          Click the settings icon to log in and start streaming live data.
        </p>
      )}

      {/* Floating paper trading window */}
      <TradingPanel trading={trading} active={active} quote={activeData} quotes={quotes} />
    </div>
  );
}
