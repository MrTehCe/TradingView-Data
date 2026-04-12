import { useEffect } from 'react';
import { useMarketData } from '@/hooks/use-market-data';
import { ContractPanel } from '@/components/contract-panel';
import { PriceHeatmap } from '@/components/price-heatmap';
import { SettingsPanel } from '@/components/settings-panel';

const BUCKET = { MES: 0.5, MNQ: 2.0 } as const;

export default function TerminalPage() {
  const { quotes, status, sendToken, tickHistoryRef } = useMarketData();

  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);

  const mesData = quotes['MES'] ?? quotes['CME_MINI:MES1!'];
  const mnqData = quotes['MNQ'] ?? quotes['CME_MINI:MNQ1!'];

  return (
    <div className="h-screen bg-black text-white flex flex-col p-3 md:p-5 font-sans selection:bg-white/20 overflow-hidden">
      <header className="flex justify-between items-center mb-3 shrink-0">
        <h1 className="text-lg font-bold tracking-widest text-white/90">
          FUTURES<span className="text-muted-foreground">MONITOR</span>
        </h1>
        <SettingsPanel status={status} sendToken={sendToken} />
      </header>

      <div className="flex-1 flex flex-col md:flex-row gap-4 md:gap-6 min-h-0">
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <ContractPanel symbol="MES" data={mesData} />
          <PriceHeatmap
            symbol="MES"
            currentPrice={mesData?.price ?? null}
            bucketSize={BUCKET.MES}
            tickHistoryRef={tickHistoryRef}
          />
        </div>

        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <ContractPanel symbol="MNQ" data={mnqData} />
          <PriceHeatmap
            symbol="MNQ"
            currentPrice={mnqData?.price ?? null}
            bucketSize={BUCKET.MNQ}
            tickHistoryRef={tickHistoryRef}
          />
        </div>
      </div>

      {status.needsLogin && status.wsConnected && (
        <p className="mt-2 text-center text-xs text-muted-foreground shrink-0">
          Click the settings icon to log in and start streaming live MES1! and MNQ1! data.
        </p>
      )}
    </div>
  );
}
