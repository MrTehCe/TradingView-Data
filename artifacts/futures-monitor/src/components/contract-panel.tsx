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
        className="rounded-lg border border-[#222] px-4 py-3 bg-[#111] animate-pulse"
        data-testid={`panel-${symbol.toLowerCase()}`}
      >
        <div className="flex items-baseline gap-3 mb-2">
          <div className="h-5 bg-muted rounded w-12" />
          <div className="h-8 bg-muted rounded w-32" />
          <div className="h-4 bg-muted rounded w-20" />
        </div>
        <div className="flex gap-4">
          <div className="h-3 bg-muted rounded w-20" />
          <div className="h-3 bg-muted rounded w-16" />
          <div className="h-3 bg-muted rounded w-16" />
          <div className="h-3 bg-muted rounded w-16" />
        </div>
      </div>
    );
  }

  const isPositive = (data.change ?? 0) >= 0;
  const colorClass = isPositive ? 'text-green-400' : 'text-purple-400';
  const flashBg =
    flash === 'up'
      ? 'bg-green-500/10'
      : flash === 'down'
      ? 'bg-purple-500/10'
      : '';

  return (
    <div
      className={cn(
        'rounded-lg border border-[#222] px-4 py-3 relative overflow-hidden transition-colors duration-500',
        flash ? flashBg : 'bg-[#111]'
      )}
      data-testid={`panel-${symbol.toLowerCase()}`}
    >
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-lg font-bold tracking-tight text-white">{symbol}</span>
        <span
          className={cn('text-3xl font-mono font-bold tracking-tighter', colorClass)}
          data-testid={`price-${symbol.toLowerCase()}`}
        >
          {data.price?.toFixed(2) ?? '---'}
        </span>
        <span
          className={cn('text-sm font-mono font-medium', colorClass)}
          data-testid={`change-${symbol.toLowerCase()}`}
        >
          {isPositive ? '+' : ''}
          {data.change?.toFixed(2) ?? '-'}
        </span>
        <span className={cn('text-sm font-mono opacity-80', colorClass)}>
          ({isPositive ? '+' : ''}
          {data.changePct?.toFixed(2) ?? '-'}%)
        </span>
        <span className="ml-auto text-xs text-muted-foreground font-mono shrink-0">
          {data.timestamp
            ? formatDistanceToNowStrict(data.timestamp, { addSuffix: true })
            : 'Waiting...'}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 font-mono text-xs">
        <span className="text-muted-foreground">
          VOL{' '}
          <span className="text-white/80" data-testid={`volume-${symbol.toLowerCase()}`}>
            {data.volume ? new Intl.NumberFormat().format(data.volume) : '-'}
          </span>
        </span>
        <span className="text-muted-foreground">
          O <span className="text-white/80">{data.open?.toFixed(2) ?? '-'}</span>
        </span>
        <span className="text-muted-foreground">
          H <span className="text-green-400/80">{data.high?.toFixed(2) ?? '-'}</span>
        </span>
        <span className="text-muted-foreground">
          L <span className="text-purple-400/80">{data.low?.toFixed(2) ?? '-'}</span>
        </span>
        <span className="text-muted-foreground">
          PC <span className="text-white/60">{data.prevClose?.toFixed(2) ?? '-'}</span>
        </span>
      </div>
    </div>
  );
}
