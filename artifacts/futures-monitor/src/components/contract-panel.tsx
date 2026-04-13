import React, { useEffect, useRef, useState } from 'react';
import { QuoteData } from '@/hooks/use-market-data';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';

type FlashDir = 'up' | 'down' | '';

export function ContractPanel({
  symbol,
  data,
}: {
  symbol: string;
  data: QuoteData | undefined;
}) {
  const [flash, setFlash] = useState<FlashDir>('');
  const prevPriceRef = useRef<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const newPrice = data?.price ?? null;
    const prev = prevPriceRef.current;

    if (newPrice !== null && prev !== null && newPrice !== prev) {
      const dir: FlashDir = newPrice > prev ? 'up' : 'down';
      setFlash(dir);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlash(''), 500);
    }

    prevPriceRef.current = newPrice;
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [data?.price]);

  if (!data || data.price === null) {
    return (
      <div
        className="rounded-md border border-[#1c1c28] px-3 py-2.5 bg-[#0c0c14] animate-pulse"
        data-testid={`panel-${symbol.toLowerCase()}`}
      >
        <div className="flex items-baseline gap-3 mb-1.5">
          <div className="h-4 bg-muted rounded w-10" />
          <div className="h-7 bg-muted rounded w-28" />
          <div className="h-3 bg-muted rounded w-16" />
        </div>
        <div className="flex gap-3">
          <div className="h-2.5 bg-muted rounded w-16" />
          <div className="h-2.5 bg-muted rounded w-12" />
          <div className="h-2.5 bg-muted rounded w-12" />
        </div>
      </div>
    );
  }

  const isPositive = (data.change ?? 0) >= 0;
  const colorClass = isPositive ? 'text-emerald-400' : 'text-purple-400';
  const flashBg =
    flash === 'up'
      ? 'bg-emerald-500/8 border-emerald-500/20'
      : flash === 'down'
      ? 'bg-purple-500/8 border-purple-500/20'
      : 'border-[#1c1c28]';

  const decimals = symbol === 'MES' ? 2 : 2;
  const spread = data.ask !== null && data.bid !== null ? (data.ask - data.bid) : null;

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2.5 relative overflow-hidden transition-colors duration-400',
        flash ? flashBg : 'bg-[#0c0c14] border-[#1c1c28]'
      )}
      data-testid={`panel-${symbol.toLowerCase()}`}
    >
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="text-sm font-bold tracking-widest text-white/50 font-mono">{symbol}</span>
        <span
          className={cn('text-2xl font-mono font-bold tracking-tight', colorClass)}
          data-testid={`price-${symbol.toLowerCase()}`}
        >
          {data.price?.toFixed(decimals) ?? '---'}
        </span>
        <span className={cn('text-xs font-mono', colorClass)} data-testid={`change-${symbol.toLowerCase()}`}>
          {isPositive ? '+' : ''}{data.change?.toFixed(2) ?? '-'}
        </span>
        <span className={cn('text-xs font-mono opacity-75', colorClass)}>
          ({isPositive ? '+' : ''}{data.changePct?.toFixed(2) ?? '-'}%)
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/50 font-mono shrink-0 tabular-nums">
          {data.timestamp
            ? formatDistanceToNowStrict(data.timestamp, { addSuffix: true })
            : '—'}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 font-mono text-[11px]">
        <span className="text-muted-foreground/60">
          VOL <span className="text-white/70" data-testid={`volume-${symbol.toLowerCase()}`}>
            {data.volume ? new Intl.NumberFormat().format(data.volume) : '—'}
          </span>
        </span>
        <span className="text-muted-foreground/60">
          O <span className="text-white/70">{data.open?.toFixed(decimals) ?? '—'}</span>
        </span>
        <span className="text-muted-foreground/60">
          H <span className="text-emerald-400/80">{data.high?.toFixed(decimals) ?? '—'}</span>
        </span>
        <span className="text-muted-foreground/60">
          L <span className="text-purple-400/80">{data.low?.toFixed(decimals) ?? '—'}</span>
        </span>
        <span className="text-muted-foreground/60">
          PC <span className="text-white/50">{data.prevClose?.toFixed(decimals) ?? '—'}</span>
        </span>

        {/* Bid / Ask / Spread */}
        {data.bid !== null && data.ask !== null && (
          <>
            <span className="border-l border-white/10 pl-3 text-muted-foreground/60">
              B <span className="text-cyan-400/90">{data.bid.toFixed(decimals)}</span>
              {data.bidSize !== null && (
                <span className="text-cyan-400/50 ml-0.5">×{data.bidSize}</span>
              )}
            </span>
            <span className="text-muted-foreground/60">
              A <span className="text-orange-400/90">{data.ask.toFixed(decimals)}</span>
              {data.askSize !== null && (
                <span className="text-orange-400/50 ml-0.5">×{data.askSize}</span>
              )}
            </span>
            {spread !== null && (
              <span className="text-muted-foreground/40">
                SPD <span className="text-white/40">{spread.toFixed(decimals)}</span>
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
