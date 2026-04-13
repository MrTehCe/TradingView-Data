import { useEffect } from 'react';
import { useMarketData } from '@/hooks/use-market-data';
import { ContractPanel }  from '@/components/contract-panel';
import { PriceHeatmap }   from '@/components/price-heatmap';
import { SettingsPanel }  from '@/components/settings-panel';
import { PositionsPanel } from '@/components/positions-panel';

const BUCKET = { MES: 0.5, MNQ: 2.0 } as const;

export default function TerminalPage() {
  const { quotes, status, sendToken, tickHistoryRef, orderBookRef } = useMarketData();

  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);

  const mesData = quotes['MES'] ?? quotes['CME_MINI:MES1!'];
  const mnqData = quotes['MNQ'] ?? quotes['CME_MINI:MNQ1!'];

  const currentPrices = {
    MES: mesData?.price ?? null,
    MNQ: mnqData?.price ?? null,
  };

  return (
    <div className="h-screen bg-[#04040a] text-white flex flex-col px-3 pt-2.5 pb-2 font-sans selection:bg-white/20 overflow-hidden">
      <header className="flex justify-between items-center mb-2 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-bold tracking-[0.25em] text-white/30 font-mono uppercase">
            Futures
          </span>
          <span className="h-3 w-px bg-white/10" />
          <span className="text-[11px] font-mono tracking-wider text-white/20">
            CME MES · MNQ
          </span>
        </div>
        <SettingsPanel status={status} sendToken={sendToken} />
      </header>

      <PositionsPanel currentPrices={currentPrices} />

      <div className="flex-1 flex flex-col md:flex-row gap-3 min-h-0 mt-2">
        <div className="flex-1 flex flex-col gap-2 min-h-0">
          <ContractPanel symbol="MES" data={mesData} />
          <PriceHeatmap
            symbol="MES"
            currentPrice={mesData?.price ?? null}
            bucketSize={BUCKET.MES}
            tickHistoryRef={tickHistoryRef}
            orderBookRef={orderBookRef}
          />
        </div>

        <div className="w-px bg-white/5 self-stretch hidden md:block" />

        <div className="flex-1 flex flex-col gap-2 min-h-0">
          <ContractPanel symbol="MNQ" data={mnqData} />
          <PriceHeatmap
            symbol="MNQ"
            currentPrice={mnqData?.price ?? null}
            bucketSize={BUCKET.MNQ}
            tickHistoryRef={tickHistoryRef}
            orderBookRef={orderBookRef}
          />
        </div>
      </div>

      {status.needsLogin && status.wsConnected && (
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground/40 shrink-0 font-mono">
          Click the settings icon to log in and start streaming live data.
        </p>
      )}
    </div>
  );
}
