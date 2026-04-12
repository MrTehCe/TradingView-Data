import { useEffect } from 'react';
import { useMarketData } from '@/hooks/use-market-data';
import { ContractPanel } from '@/components/contract-panel';
import { SettingsPanel } from '@/components/settings-panel';

export default function TerminalPage() {
  const { quotes, status, sendToken } = useMarketData();

  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8 font-sans selection:bg-white/20">
      <div className="max-w-[1600px] mx-auto h-full flex flex-col">
        <header className="flex justify-between items-center mb-8">
          <div className="flex items-baseline gap-4">
            <h1 className="text-xl font-bold tracking-widest text-white/90">
              FUTURES<span className="text-muted-foreground">MONITOR</span>
            </h1>
          </div>
          <SettingsPanel status={status} sendToken={sendToken} />
        </header>

        <div className="flex-1 flex flex-col md:flex-row gap-6 md:gap-8">
          <ContractPanel symbol="MES" data={quotes['MES'] ?? quotes['CME_MINI:MES1!']} />
          <ContractPanel symbol="MNQ" data={quotes['MNQ'] ?? quotes['CME_MINI:MNQ1!']} />
        </div>

        {status.needsLogin && status.wsConnected && (
          <div className="mt-8 text-center">
            <p className="text-xs text-muted-foreground">
              Click the settings icon to log in with your TradingView account and start streaming real-time MES1! and MNQ1! data.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
