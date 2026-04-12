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
      flashTimerRef.current = setTimeout(() => setFlash(''), 600);
    }

    prevPriceRef.current = newPrice;

    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [data?.price]);

  if (!data || data.price === null) {
    return (
      <div
        className="flex-1 bg-card rounded-lg border border-border p-6 flex flex-col justify-between animate-pulse"
        data-testid={`panel-${symbol.toLowerCase()}`}
      >
        <div>
          <div className="h-8 bg-muted rounded w-24 mb-6" />
          <div className="h-16 bg-muted rounded w-48 mb-4" />
          <div className="flex gap-4">
            <div className="h-6 bg-muted rounded w-20" />
            <div className="h-6 bg-muted rounded w-20" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-8 pt-6 border-t border-border/50">
          <div className="space-y-3">
            <div className="h-4 bg-muted rounded w-24" />
            <div className="h-4 bg-muted rounded w-24" />
          </div>
          <div className="space-y-3">
            <div className="h-4 bg-muted rounded w-24" />
            <div className="h-4 bg-muted rounded w-24" />
          </div>
        </div>
      </div>
    );
  }

  const isPositive = (data.change ?? 0) >= 0;
  const colorClass = isPositive ? 'text-green-500' : 'text-red-500';

  const flashBg =
    flash === 'up'
      ? 'bg-green-500/15'
      : flash === 'down'
      ? 'bg-red-500/15'
      : '';

  return (
    <div
      className={cn(
        'flex-1 rounded-lg border border-[#222] p-6 flex flex-col justify-between relative overflow-hidden transition-colors duration-500',
        flash ? flashBg : 'bg-[#111]'
      )}
      data-testid={`panel-${symbol.toLowerCase()}`}
    >
      <div className="z-10">
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-3xl font-bold tracking-tight text-white">{symbol}</h2>
          <div className="text-xs text-muted-foreground font-mono">
            {data.timestamp
              ? formatDistanceToNowStrict(data.timestamp, { addSuffix: true })
              : 'Waiting...'}
          </div>
        </div>

        <div
          className={cn(
            'text-6xl md:text-7xl font-mono font-bold tracking-tighter mb-4',
            colorClass
          )}
          data-testid={`price-${symbol.toLowerCase()}`}
        >
          {data.price?.toFixed(2) ?? '---'}
        </div>

        <div className="flex items-baseline gap-4 font-mono">
          <div
            className={cn('text-2xl font-medium', colorClass)}
            data-testid={`change-${symbol.toLowerCase()}`}
          >
            {isPositive ? '+' : ''}
            {data.change?.toFixed(2) ?? '-'}
          </div>
          <div className={cn('text-xl opacity-80', colorClass)}>
            ({isPositive ? '+' : ''}
            {data.changePct?.toFixed(2) ?? '-'}%)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-4 mt-12 pt-6 border-t border-[#222] font-mono text-sm z-10">
        <div className="flex justify-between">
          <span className="text-muted-foreground">VOL</span>
          <span className="text-white" data-testid={`volume-${symbol.toLowerCase()}`}>
            {data.volume ? new Intl.NumberFormat().format(data.volume) : '-'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">OPEN</span>
          <span className="text-white">{data.open?.toFixed(2) ?? '-'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">HIGH</span>
          <span className="text-green-500/80">{data.high?.toFixed(2) ?? '-'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">LOW</span>
          <span className="text-red-500/80">{data.low?.toFixed(2) ?? '-'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">PREV</span>
          <span className="text-white opacity-80">{data.prevClose?.toFixed(2) ?? '-'}</span>
        </div>
      </div>
    </div>
  );
}
