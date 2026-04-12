import React, { useEffect, useRef, useState } from 'react';
import { TickRecord } from '@/hooks/use-market-data';
import { cn } from '@/lib/utils';

const WINDOWS = {
  '1m':  { duration:  60_000 },
  '3m':  { duration: 180_000 },
  '5m':  { duration: 300_000 },
  '15m': { duration: 900_000 },
} as const;
type WindowKey = keyof typeof WINDOWS;

const DEFAULT_ROWS = 50;
const MIN_ROWS      = 10;
const MAX_ROWS      = 160;
const LABEL_W       = 60;
const PROFILE_W     = 40;
const TIME_H        = 18;
const BUBBLE_R      = 4.5;  // base sphere radius (px)

// 3D sphere radial gradient — direction-colored
function drawSphere(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  isUp: boolean, alpha: number
) {
  const grad = ctx.createRadialGradient(
    cx - r * 0.32, cy - r * 0.32, r * 0.06,
    cx, cy, r
  );
  if (isUp) {
    grad.addColorStop(0,   `rgba(210, 255, 210, ${alpha})`);
    grad.addColorStop(0.38,`rgba(40,  210,  90, ${alpha * 0.88})`);
    grad.addColorStop(1,   `rgba(0,    70,  30, ${alpha * 0.45})`);
  } else {
    grad.addColorStop(0,   `rgba(230, 195, 255, ${alpha})`);
    grad.addColorStop(0.38,`rgba(155,  45, 230, ${alpha * 0.88})`);
    grad.addColorStop(1,   `rgba( 55,   5,  95, ${alpha * 0.45})`);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
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

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const winRef       = useRef(win);   winRef.current = win;
  const priceRef     = useRef(currentPrice); priceRef.current = currentPrice;
  const rowsRef      = useRef(visibleRows);  rowsRef.current  = visibleRows;

  // ── Scroll zoom ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = Math.max(1, Math.round(rowsRef.current * 0.1));
      setVisibleRows(prev => Math.max(MIN_ROWS, Math.min(MAX_ROWS, prev + (e.deltaY > 0 ? step : -step))));
    };
    const onDbl = () => setVisibleRows(DEFAULT_ROWS);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDbl);
    return () => { canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('dblclick', onDbl); };
  }, []);

  // ── Draw loop ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const draw = () => {
      const canvas    = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr      = window.devicePixelRatio || 1;
      const W        = container.clientWidth;
      const H        = container.clientHeight;
      if (W === 0 || H === 0) return;

      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width  = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.scale(dpr, dpr);

      const ROWS     = rowsRef.current;
      const duration = WINDOWS[winRef.current].duration;
      const price    = priceRef.current;
      const allTicks = tickHistoryRef.current[symbol] ?? [];

      const gridW = W - LABEL_W - PROFILE_W;
      const gridH = H - TIME_H;

      // canvas bg
      ctx.fillStyle = '#06060e';
      ctx.fillRect(0, 0, W, H);

      if (!price && allTicks.length === 0) {
        ctx.fillStyle = '#2a2a3a';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for data…', LABEL_W + gridW / 2, H / 2);
        return;
      }

      const center   = price ?? allTicks[allTicks.length - 1]?.price ?? 0;
      const priceMin = center - (ROWS / 2) * bucketSize;
      const priceMax = priceMin + ROWS * bucketSize;
      const now      = Date.now();

      const toX = (ts: number) => LABEL_W + gridW * (1 - (now - ts) / duration);
      const toY = (p: number)  => gridH   * (1 - (p - priceMin) / (priceMax - priceMin));

      // ── Background persistence heatmap ────────────────────────────────────
      // (cell grid, subtle, behind bubbles)
      const COLS      = 40;
      const cellW     = gridW / COLS;
      const cellH     = gridH / ROWS;
      const bucketMs  = duration / COLS;
      const bgCounts: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));

      for (const tick of allTicks) {
        const age = now - tick.ts;
        if (age > duration) continue;
        const col = Math.min(COLS - 1, Math.floor((duration - age) / bucketMs));
        const row = Math.floor((tick.price - priceMin) / bucketSize);
        if (row >= 0 && row < ROWS) bgCounts[row][col]++;
      }
      const maxBg = Math.max(1, ...bgCounts.flat());

      for (let row = 0; row < ROWS; row++) {
        const dispRow = ROWS - 1 - row;
        const y = dispRow * cellH;
        for (let col = 0; col < COLS; col++) {
          const c = bgCounts[row][col];
          if (c === 0) continue;
          const t = c / maxBg;
          // blue → cyan wash (Bookmap background feel)
          const r = Math.round(0   + 30  * t);
          const g = Math.round(30  + 100 * t);
          const b = Math.round(80  + 120 * t);
          ctx.fillStyle = `rgba(${r},${g},${b},${0.08 + 0.22 * t})`;
          ctx.fillRect(LABEL_W + col * cellW, y, cellW, cellH);
        }
      }

      // ── Grid lines (subtle) ───────────────────────────────────────────────
      ctx.strokeStyle = '#10101a';
      ctx.lineWidth   = 0.5;
      const lineEvery = Math.max(1, Math.round(ROWS / 12));
      for (let row = 0; row <= ROWS; row += lineEvery) {
        const y = row * cellH;
        ctx.beginPath(); ctx.moveTo(LABEL_W, y); ctx.lineTo(LABEL_W + gridW, y); ctx.stroke();
      }
      const timeLineEvery = Math.ceil(COLS / 6);
      for (let col = 0; col <= COLS; col += timeLineEvery) {
        const x = LABEL_W + col * cellW;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gridH); ctx.stroke();
      }

      // ── Collect visible ticks with direction ──────────────────────────────
      interface PlotTick { x: number; y: number; isUp: boolean; age: number; price: number }
      const plotTicks: PlotTick[] = [];
      let prevP: number | null = null;

      for (const tick of allTicks) {
        const age = now - tick.ts;
        // carry previous price even for out-of-window ticks
        if (age > duration) { prevP = tick.price; continue; }
        const x = toX(tick.ts);
        const y = toY(tick.price);
        if (x < LABEL_W || y < 0 || y > gridH) { prevP = tick.price; continue; }
        const isUp = prevP === null ? true : tick.price >= prevP;
        plotTicks.push({ x, y, isUp, age, price: tick.price });
        prevP = tick.price;
      }

      // ── Price path line ───────────────────────────────────────────────────
      if (plotTicks.length > 1) {
        ctx.beginPath();
        ctx.moveTo(plotTicks[0].x, plotTicks[0].y);
        for (let i = 1; i < plotTicks.length; i++) {
          ctx.lineTo(plotTicks[i].x, plotTicks[i].y);
        }
        ctx.strokeStyle = 'rgba(180, 180, 220, 0.18)';
        ctx.lineWidth   = 0.8;
        ctx.stroke();
      }

      // ── Spheres ───────────────────────────────────────────────────────────
      for (const t of plotTicks) {
        const fade  = Math.pow(1 - t.age / duration, 0.4); // fade older ticks
        const alpha = Math.max(0.12, fade * 0.92);
        drawSphere(ctx, t.x, t.y, BUBBLE_R, t.isUp, alpha);
      }

      // ── Price axis labels ─────────────────────────────────────────────────
      const labelEvery = Math.max(1, Math.round(ROWS / 10));
      ctx.font = `${Math.max(7, Math.min(10, cellH * 0.75))}px monospace`;
      ctx.textAlign = 'right';
      for (let row = 0; row < ROWS; row += labelEvery) {
        const p = priceMin + row * bucketSize;
        const y = toY(p);
        ctx.fillStyle = '#2e2e42';
        ctx.fillText(p.toFixed(bucketSize < 1 ? 2 : 0), LABEL_W - 4, y + 3.5);
      }

      // ── Current price line + label ────────────────────────────────────────
      if (price !== null && price >= priceMin && price <= priceMax) {
        const py = toY(price);
        ctx.fillStyle = 'rgba(0, 230, 118, 0.055)';
        ctx.fillRect(LABEL_W, py - cellH / 2, gridW, cellH);
        ctx.strokeStyle = '#00e676';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(LABEL_W, py); ctx.lineTo(LABEL_W + gridW, py); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle  = '#00e676';
        ctx.font       = `bold 9px monospace`;
        ctx.textAlign  = 'right';
        ctx.fillText(price.toFixed(bucketSize < 1 ? 2 : 0), LABEL_W - 4, py + 3.5);
      }

      // ── Right volume profile ───────────────────────────────────────────────
      const rowTotals = bgCounts.map(rc => rc.reduce((s, c) => s + c, 0));
      const maxTotal  = Math.max(1, ...rowTotals);
      const maxPR     = PROFILE_W / 2 - 3;
      const profCx    = LABEL_W + gridW + PROFILE_W / 2;

      for (let row = 0; row < ROWS; row++) {
        const t = rowTotals[row] / maxTotal;
        if (t === 0) continue;
        const r  = Math.max(1, maxPR * Math.sqrt(t));
        const dispRow = ROWS - 1 - row;
        const cy = dispRow * cellH + cellH / 2;
        const alpha = 0.2 + 0.5 * t;
        const g = Math.round(100 + 130 * t);
        ctx.beginPath();
        ctx.arc(profCx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, ${g}, ${Math.round(60 + 80*t)}, ${alpha})`;
        ctx.fill();
      }

      // ── Time axis ──────────────────────────────────────────────────────────
      ctx.fillStyle = '#0d0d18';
      ctx.fillRect(0, gridH, W, TIME_H);
      ctx.fillStyle = '#2e2e42';
      ctx.font      = '9px monospace';
      ctx.textAlign = 'center';
      for (let col = 0; col <= COLS; col += timeLineEvery) {
        const ageMs = bucketMs * (COLS - col);
        const label = col === COLS ? 'now'
          : ageMs >= 60_000 ? `${Math.round(ageMs / 60_000)}m`
          : `${Math.round(ageMs / 1_000)}s`;
        ctx.fillText(label, LABEL_W + col * cellW, gridH + TIME_H * 0.72);
      }

      // ── Zoom indicator ─────────────────────────────────────────────────────
      if (ROWS !== DEFAULT_ROWS) {
        ctx.fillStyle = '#444';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round((DEFAULT_ROWS / ROWS) * 100)}%`, LABEL_W + gridW - 4, gridH - 4);
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
              win === k ? 'bg-white/15 text-white' : 'text-muted-foreground hover:text-white/60'
            )}
          >
            {k}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground/40 font-mono">
          scroll zoom · dbl-click reset
        </span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 rounded-lg overflow-hidden border border-[#1a1a28] cursor-crosshair"
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
}
