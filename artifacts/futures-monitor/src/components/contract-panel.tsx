import React, { useEffect, useState } from 'react';
import { QuoteData } from '@/hooks/use-market-data';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';

export function ContractPanel({
  symbol,
  data,
}: {
  symbol: string;
  data: QuoteData | undefined;
}) {
  const [flashClass, setFlashClass] = useState<string>('');
  const [prevPrice, setPrevPrice] = useState<number | null>(null);

  useEffect(() => {
    if (data?.price && prevPrice && data.price !== prevPrice) {
      if (data.price > prevPrice) {
        setFlashClass('bg-green-500/20');
      } else if (data.price < prevPrice) {
        setFlashClass('bg-red-500/20');
      }
      const t = setTimeout(() => setFlashClass('transition-colors duration-500 bg-transparent'), 100);
      return () => clearTimeout(t);
    }
    setPrevPrice(data?.price ?? null);
  }, [data?.price, prevPrice]);

  if (!data) {
    return (
      <div
        className="flex-1 bg-card rounded-lg border border-border p-6 flex flex-col justify-between animate-pulse"
        data-testid={`panel-${symbol.toLowerCase()}`}
      >
        <div>
          <div className="h-8 bg-muted rounded w-24 mb-6"></div>
          <div className="h-16 bg-muted rounded w-48 mb-4"></div>
          <div className="flex gap-4">
            <div className="h-6 bg-muted rounded w-20"></div>
            <div className="h-6 bg-muted rounded w-20"></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-8 pt-6 border-t border-border/50">
          <div className="space-y-3">
            <div className="h-4 bg-muted rounded w-24"></div>
            <div className="h-4 bg-muted rounded w-24"></div>
          </div>
          <div className="space-y-3">
            <div className="h-4 bg-muted rounded w-24"></div>
            <div className="h-4 bg-muted rounded w-24"></div>
          </div>
        </div>
      </div>
    );
  }

  const isPositive = (data.change ?? 0) >= 0;
  const colorClass = isPositive ? 'text-green-500' : 'text-red-500';

  return (
    <div
      className="flex-1 bg-[#111] rounded-lg border border-[#222] p-6 flex flex-col justify-between relative overflow-hidden"
      data-testid={`panel-${symbol.toLowerCase()}`}
    >
      <div className={cn('absolute inset-0 pointer-events-none -z-10', flashClass)} />
      
      <div className="z-10">
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-3xl font-bold tracking-tight text-white">{symbol}</h2>
          <div className="text-xs text-muted-foreground font-mono">
            {data.timestamp ? formatDistanceToNowStrict(data.timestamp, { addSuffix: true }) : 'Waiting...'}
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
            {isPositive ? '+' : ''}{data.change?.toFixed(2) ?? '-'}
          </div>
          <div className={cn('text-xl opacity-80', colorClass)}>
            ({isPositive ? '+' : ''}{data.changePct?.toFixed(2) ?? '-'}%)
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
