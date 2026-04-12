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

const DEFAULT_ROWS = 50;
const MIN_ROWS = 10;
const MAX_ROWS = 160;
const LABEL_W = 58;
const PROFILE_W = 44;
const TIME_LABEL_H = 20;

// Bookmap-style heat ramp: dark bg → green → cyan → yellow → white
function heatColor(t: number): [number, number, number, number] {
  if (t <= 0) return [0, 0, 0, 0];
  if (t < 0.25) {
    const s = t / 0.25;
    return [0, Math.round(160 * s), Math.round(80 * s), 0.35 + 0.45 * s];
  }
  if (t < 0.55) {
    const s = (t - 0.25) / 0.3;
    return [0, Math.round(160 + 95 * s), Math.round(80 + 175 * s), 0.75 + 0.1 * s];
  }
  if (t < 0.8) {
    const s = (t - 0.55) / 0.25;
    return [Math.round(220 * s), Math.round(255), Math.round(255 - 200 * s), 0.85 + 0.1 * s];
  }
  const s = (t - 0.8) / 0.2;
  return [220 + Math.round(35 * s), 255, Math.round(55 - 55 * s), 0.95 + 0.05 * s];
}

interface Props {
  symbol: string;
  currentPrice: number | null;
  bucketSize: number;
  tickHistoryRef: React.MutableRefObject<Record<string, TickRecord[]>>;
}

export function PriceHeatmap({ symbol, currentPrice, bucketSize, tickHistoryRef }: Props) {
  const [win, setWin] = useState<WindowKey>('5m');
  const [visibleRows, setVisibleRows] = useState(DEFAULT_ROWS);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const winRef = useRef(win);
  winRef.current = win;
  const priceRef = useRef(currentPrice);
  priceRef.current = currentPrice;
  const rowsRef = useRef(visibleRows);
  rowsRef.current = visibleRows;

  // ── Scroll zoom & double-click reset ───────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = Math.max(1, Math.round(rowsRef.current * 0.1));
      setVisibleRows((prev) =>
        Math.max(MIN_ROWS, Math.min(MAX_ROWS, prev + (e.deltaY > 0 ? step : -step)))
      );
    };

    const onDblClick = () => setVisibleRows(DEFAULT_ROWS);

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDblClick);
    };
  }, []);

  // ── Draw loop ───────────────────────────────────────────────────────────────
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

      const ROWS = rowsRef.current;
      const currentWin = winRef.current;
      const price = priceRef.current;
      const { duration, cols } = WINDOWS[currentWin];
      const ticks = tickHistoryRef.current[symbol] ?? [];

      const gridW = displayW - LABEL_W - PROFILE_W;
      const gridH = displayH - TIME_LABEL_H;
      const cellW = gridW / cols;
      const cellH = gridH / ROWS;

      // ── Canvas background ───────────────────────────────────────────────
      ctx.fillStyle = '#07070f';
      ctx.fillRect(0, 0, displayW, displayH);

      if (!price && ticks.length === 0) {
        ctx.fillStyle = '#333';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for data...', (LABEL_W + displayW - PROFILE_W) / 2, displayH / 2);
        return;
      }

      const center = price ?? ticks[ticks.length - 1]?.price ?? 0;
      const half = (ROWS / 2) * bucketSize;
      const priceMin = center - half;

      // ── Subtle grid lines ───────────────────────────────────────────────
      ctx.strokeStyle = '#111119';
      ctx.lineWidth = 0.5;
      for (let c = 0; c <= cols; c++) {
        const x = LABEL_W + c * cellW;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gridH); ctx.stroke();
      }
      for (let r = 0; r <= ROWS; r++) {
        const y = r * cellH;
        ctx.beginPath(); ctx.moveTo(LABEL_W, y); ctx.lineTo(LABEL_W + gridW, y); ctx.stroke();
      }

      const now = Date.now();
      const bucketDuration = duration / cols;

      const counts: number[][] = Array.from({ length: ROWS }, () => new Array(cols).fill(0));

      for (const tick of ticks) {
        const age = now - tick.ts;
        if (age > duration) continue;
        const col = Math.min(cols - 1, Math.floor((duration - age) / bucketDuration));
        const row = Math.floor((tick.price - priceMin) / bucketSize);
        if (row >= 0 && row < ROWS) counts[row][col]++;
      }

      const maxCount = Math.max(1, ...counts.flat());
      const maxBubbleR = Math.min(cellW, cellH) * 0.48;

      // ── Bubbles (pops) on grid ──────────────────────────────────────────
      for (let row = 0; row < ROWS; row++) {
        const displayRow = ROWS - 1 - row;
        const cy = displayRow * cellH + cellH / 2;

        for (let col = 0; col < cols; col++) {
          const count = counts[row][col];
          if (count === 0) continue;

          const t = count / maxCount;
          const bubbleR = Math.max(1.2, maxBubbleR * Math.sqrt(t));
          const cx = LABEL_W + col * cellW + cellW / 2;

          const [r, g, b, a] = heatColor(t);
          ctx.beginPath();
          ctx.arc(cx, cy, bubbleR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
          ctx.fill();

          // Bright ring on large pops
          if (t > 0.5) {
            ctx.beginPath();
            ctx.arc(cx, cy, bubbleR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${r},${g},${b},${Math.min(1, a + 0.2)})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }

      // ── Price axis labels ───────────────────────────────────────────────
      const labelEvery = Math.max(1, Math.round(ROWS / 10));
      for (let row = 0; row < ROWS; row++) {
        if (row % labelEvery !== 0) continue;
        const displayRow = ROWS - 1 - row;
        const y = displayRow * cellH;
        const rowPrice = priceMin + row * bucketSize;
        const labelPrice = rowPrice.toFixed(bucketSize < 1 ? 2 : 0);
        ctx.fillStyle = '#3a3a4a';
        ctx.font = `${Math.max(7, Math.min(10, cellH * 0.7))}px monospace`;
        ctx.textAlign = 'right';
        ctx.fillText(labelPrice, LABEL_W - 4, y + cellH * 0.72);
      }

      // ── Right-side volume profile (dots) ───────────────────────────────
      const rowTotals = counts.map((rc) => rc.reduce((s, c) => s + c, 0));
      const maxRowTotal = Math.max(1, ...rowTotals);
      const maxProfR = PROFILE_W / 2 - 3;
      const profCx = LABEL_W + gridW + PROFILE_W / 2;

      for (let row = 0; row < ROWS; row++) {
        const total = rowTotals[row];
        if (total === 0) continue;
        const t = total / maxRowTotal;
        const r = Math.max(1, maxProfR * Math.sqrt(t));
        const displayRow = ROWS - 1 - row;
        const cy = displayRow * cellH + cellH / 2;
        const [cr, cg, cb, ca] = heatColor(t * 0.75);
        ctx.beginPath();
        ctx.arc(profCx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${ca * 0.7})`;
        ctx.fill();
      }

      // ── Current price row ───────────────────────────────────────────────
      if (price !== null) {
        const row = Math.floor((price - priceMin) / bucketSize);
        if (row >= 0 && row < ROWS) {
          const displayRow = ROWS - 1 - row;
          const y = displayRow * cellH;

          ctx.fillStyle = 'rgba(0, 230, 118, 0.06)';
          ctx.fillRect(LABEL_W, y, gridW, cellH);

          ctx.strokeStyle = '#00e676';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(LABEL_W + 0.75, y + 0.75, gridW - 1.5, cellH - 1.5);

          const labelPrice = price.toFixed(bucketSize < 1 ? 2 : 0);
          ctx.fillStyle = '#00e676';
          ctx.font = `bold ${Math.max(7, Math.min(10, cellH * 0.7))}px monospace`;
          ctx.textAlign = 'right';
          ctx.fillText(labelPrice, LABEL_W - 4, y + cellH * 0.72);
        }
      }

      // ── Time axis ───────────────────────────────────────────────────────
      ctx.fillStyle = '#0f0f18';
      ctx.fillRect(0, gridH, displayW, TIME_LABEL_H);

      ctx.fillStyle = '#3a3a4a';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';

      const labelStep = Math.ceil(cols / 6);
      for (let col = 0; col <= cols; col += labelStep) {
        const ageMs = (duration / cols) * (cols - col);
        const label =
          col === cols ? 'now'
          : ageMs >= 60_000 ? `${Math.round(ageMs / 60_000)}m`
          : `${Math.round(ageMs / 1_000)}s`;
        ctx.fillText(label, LABEL_W + col * cellW, gridH + TIME_LABEL_H * 0.72);
      }

      // ── Zoom indicator ──────────────────────────────────────────────────
      if (ROWS !== DEFAULT_ROWS) {
        const zoomPct = Math.round((DEFAULT_ROWS / ROWS) * 100);
        ctx.fillStyle = '#444';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${zoomPct}%`, LABEL_W + gridW - 4, gridH - 4);
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
        <span className="ml-auto text-[10px] text-muted-foreground/40 font-mono">
          scroll to zoom · dbl-click reset
        </span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 rounded-lg overflow-hidden border border-[#1c1c1c] cursor-crosshair"
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
}
