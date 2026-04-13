import { useEffect, useState, useCallback } from 'react';
import { useMarketData } from '@/hooks/use-market-data';
import { ContractPanel }    from '@/components/contract-panel';
import { PriceHeatmap }     from '@/components/price-heatmap';
import { SettingsPanel }    from '@/components/settings-panel';
import { PositionsPanel }   from '@/components/positions-panel';
import { SymbolSelector, KNOWN_SYMBOLS, type SymbolInfo } from '@/components/symbol-selector';

const DEFAULT_SYMBOL = KNOWN_SYMBOLS.find(s => s.display === 'MES')!;

export default function TerminalPage() {
  const { quotes, status, sendToken, tickHistoryRef, orderBookRef, subscribeSymbol } = useMarketData();
  const [active, setActive] = useState<SymbolInfo>(DEFAULT_SYMBOL);

  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);

  // Subscribe to the active symbol when it changes
  useEffect(() => {
    subscribeSymbol(active.tv);
  }, [active.tv, subscribeSymbol]);

  const handleSelect = useCallback((sym: SymbolInfo) => {
    setActive(sym);
  }, []);

  // Build a trimmed quotes map for the selector (display → price/changePct)
  const quoteMap: Record<string, { price: number | null; changePct: number | null }> = {};
  for (const [key, q] of Object.entries(quotes)) {
    quoteMap[key] = { price: q.price, changePct: q.changePct };
  }

  const activeData = quotes[active.display];

  const currentPrices: Record<string, number | null> = {};
  for (const [key, q] of Object.entries(quotes)) {
    currentPrices[key] = q.price;
  }

  return (
    <div className="h-screen bg-[#04040a] text-white flex flex-col px-3 pt-2.5 pb-2 font-sans selection:bg-white/20 overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center mb-2 shrink-0 gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-bold tracking-[0.25em] text-white/25 font-mono uppercase shrink-0">
            Futures
          </span>
          <span className="h-3 w-px bg-white/10 shrink-0" />
          <SymbolSelector
            active={active}
            onSelect={handleSelect}
            quotes={quoteMap}
          />
        </div>
        <SettingsPanel status={status} sendToken={sendToken} />
      </header>

      {/* Account + Positions */}
      <PositionsPanel currentPrices={currentPrices} />

      {/* Single chart panel */}
      <div className="flex-1 flex flex-col gap-2 min-h-0 mt-2">
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
    </div>
  );
}
