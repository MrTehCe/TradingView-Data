import React, { useEffect, useRef, useState } from 'react';
import { TickRecord } from '@/hooks/use-market-data';
import { cn } from '@/lib/utils';

const WINDOWS = {
  '1m':  { duration:  60_000, cols: 30 },
  '3m':  { duration: 180_000, cols: 30 },
  '5m':  { duration: 300_000, cols: 30 },
  '15m': { duration: 900_000, cols: 30 },
} as const;

type WindowKey = keyof typeof WINDOWS;

const ROWS = 50;
const LABEL_W = 58;
const BUBBLE_W = 48;
const TIME_LABEL_H = 20;

interface Props {
  symbol: string;
  currentPrice: number | null;
  bucketSize: number;
  tickHistoryRef: React.MutableRefObject<Record<string, TickRecord[]>>;
}

export function PriceHeatmap({ symbol, currentPrice, bucketSize, tickHistoryRef }: Props) {
  const [win, setWin] = useState<WindowKey>('5m');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const winRef = useRef(win);
  winRef.current = win;
  const priceRef = useRef(currentPrice);
  priceRef.current = currentPrice;

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const displayW = container.clientWidth;
      const displayH = container.clientHeight;
      if (displayW === 0 || displayH === 0) return;

      canvas.width = Math.round(displayW * dpr);
      canvas.height = Math.round(displayH * dpr);
      canvas.style.width = `${displayW}px`;
      canvas.style.height = `${displayH}px`;
      ctx.scale(dpr, dpr);

      const currentWin = winRef.current;
      const price = priceRef.current;
      const { duration, cols } = WINDOWS[currentWin];
      const ticks = tickHistoryRef.current[symbol] ?? [];

      const gridW = displayW - LABEL_W - BUBBLE_W;
      const gridH = displayH - TIME_LABEL_H;
      const cellW = gridW / cols;
      const cellH = gridH / ROWS;

      ctx.fillStyle = '#0d0d0d';
      ctx.fillRect(0, 0, displayW, displayH);

      if (!price && ticks.length === 0) {
        ctx.fillStyle = '#333';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for data...', displayW / 2, displayH / 2);
        return;
      }

      const center = price ?? ticks[ticks.length - 1]?.price ?? 0;
      const half = (ROWS / 2) * bucketSize;
      const priceMin = center - half;

      const now = Date.now();
      const bucketDuration = duration / cols;

      const counts: number[][] = Array.from({ length: ROWS }, () => new Array(cols).fill(0));

      for (const tick of ticks) {
        const age = now - tick.ts;
        if (age > duration) continue;
        const col = Math.min(cols - 1, Math.floor((duration - age) / bucketDuration));
        const row = Math.floor((tick.price - priceMin) / bucketSize);
        if (row >= 0 && row < ROWS) {
          counts[row][col]++;
        }
      }

      const maxCount = Math.max(1, ...counts.flat());

      // ── Heatmap cells (green palette) ──────────────────────────────────────
      for (let row = 0; row < ROWS; row++) {
        const displayRow = ROWS - 1 - row;
        const y = displayRow * cellH;
        const rowPrice = priceMin + row * bucketSize;

        for (let col = 0; col < cols; col++) {
          const count = counts[row][col];
          const x = LABEL_W + col * cellW;

          if (count > 0) {
            const t = count / maxCount;
            const r = Math.round(20  + 80  * t);
            const g = Math.round(120 + 135 * t);
            const b = Math.round(50  + 70  * t);
            const a = 0.15 + 0.85 * t;
            ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
          } else {
            ctx.fillStyle = '#141414';
          }
          ctx.fillRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
        }

        // price labels (every 5 rows)
        if (row % 5 === 0) {
          const labelPrice = rowPrice.toFixed(bucketSize < 1 ? 2 : 0);
          ctx.fillStyle = '#444';
          ctx.font = `${Math.max(8, Math.min(10, cellH * 0.75))}px monospace`;
          ctx.textAlign = 'right';
          ctx.fillText(labelPrice, LABEL_W - 4, y + cellH * 0.72);
        }
      }

      // ── Bubble layer (volume profile on right) ─────────────────────────────
      const rowTotals = counts.map((rowCols) => rowCols.reduce((s, c) => s + c, 0));
      const maxRowTotal = Math.max(1, ...rowTotals);
      const maxBubbleR = Math.min(BUBBLE_W / 2 - 2, cellH * 1.4);
      const bubbleCx = LABEL_W + gridW + BUBBLE_W / 2;

      for (let row = 0; row < ROWS; row++) {
        const total = rowTotals[row];
        if (total === 0) continue;
        const t = total / maxRowTotal;
        const r = Math.max(1.5, maxBubbleR * Math.sqrt(t));
        const displayRow = ROWS - 1 - row;
        const cy = displayRow * cellH + cellH / 2;

        const alpha = 0.25 + 0.65 * t;
        const gr = Math.round(40 + 60 * t);
        const gg = Math.round(140 + 115 * t);
        const gb = Math.round(80 + 80 * t);

        ctx.beginPath();
        ctx.arc(bubbleCx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${gr},${gg},${gb},${alpha})`;
        ctx.fill();
      }

      // ── Current price highlight ────────────────────────────────────────────
      if (price !== null) {
        const row = Math.floor((price - priceMin) / bucketSize);
        if (row >= 0 && row < ROWS) {
          const displayRow = ROWS - 1 - row;
          const y = displayRow * cellH;

          ctx.strokeStyle = '#00e676';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(LABEL_W + 0.75, y + 0.75, gridW - 1.5, cellH - 1.5);

          const labelPrice = price.toFixed(bucketSize < 1 ? 2 : 0);
          ctx.fillStyle = '#00e676';
          ctx.font = `bold ${Math.max(8, Math.min(10, cellH * 0.75))}px monospace`;
          ctx.textAlign = 'right';
          ctx.fillText(labelPrice, LABEL_W - 4, y + cellH * 0.72);
        }
      }

      // ── Time axis ──────────────────────────────────────────────────────────
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, gridH, displayW, TIME_LABEL_H);

      ctx.fillStyle = '#444';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';

      const labelStep = Math.ceil(cols / 6);
      for (let col = 0; col <= cols; col += labelStep) {
        const ageMs = (duration / cols) * (cols - col);
        const label =
          col === cols
            ? 'now'
            : ageMs >= 60_000
            ? `${Math.round(ageMs / 60_000)}m`
            : `${Math.round(ageMs / 1_000)}s`;
        const x = LABEL_W + col * cellW;
        ctx.fillText(label, x, gridH + TIME_LABEL_H * 0.7);
      }
    };

    draw();
    const id = setInterval(draw, 500);
    return () => clearInterval(id);
  }, [symbol, bucketSize, tickHistoryRef]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-1 mb-2 px-0.5">
        <span className="text-xs text-muted-foreground font-mono mr-1">HEATMAP</span>
        {(Object.keys(WINDOWS) as WindowKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setWin(k)}
            className={cn(
              'px-2 py-0.5 text-xs font-mono rounded transition-colors',
              win === k
                ? 'bg-white/15 text-white'
                : 'text-muted-foreground hover:text-white/60'
            )}
          >
            {k}
          </button>
        ))}
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 rounded-lg overflow-hidden border border-[#1c1c1c]">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
}
