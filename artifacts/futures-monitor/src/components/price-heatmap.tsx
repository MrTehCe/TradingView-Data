import React, { useEffect, useRef, useState } from 'react';
import { TickRecord, OBRecord, HistoryBar } from '@/hooks/use-market-data';
import { cn } from '@/lib/utils';

const WINDOWS = {
  '1m':  { duration:    60_000, useHistory: false },
  '3m':  { duration:   180_000, useHistory: false },
  '5m':  { duration:   300_000, useHistory: false },
  '15m': { duration:   900_000, useHistory: false },
  '30m': { duration: 1_800_000, useHistory: false },
  '1H':  { duration: 3_600_000, useHistory: true  },
  '4H':  { duration:14_400_000, useHistory: true  },
} as const;
type WindowKey = keyof typeof WINDOWS;

const DEFAULT_ROWS = 50;
const MIN_ROWS      = 10;
const MAX_ROWS      = 160;
const COLS          = 40;
const LABEL_W       = 62;
const PROFILE_W     = 40;
const TIME_H        = 18;
const DELTA_H       = 32;
const BUBBLE_R      = 4.5;

function drawSphere(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  isUp: boolean, alpha: number
) {
  const g = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.32, r * 0.06, cx, cy, r);
  if (isUp) {
    g.addColorStop(0,    `rgba(210,255,210,${alpha})`);
    g.addColorStop(0.38, `rgba(40,210,90,${alpha * 0.88})`);
    g.addColorStop(1,    `rgba(0,70,30,${alpha * 0.45})`);
  } else {
    g.addColorStop(0,    `rgba(230,195,255,${alpha})`);
    g.addColorStop(0.38, `rgba(155,45,230,${alpha * 0.88})`);
    g.addColorStop(1,    `rgba(55,5,95,${alpha * 0.45})`);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

interface Props {
  symbol: string;
  currentPrice: number | null;
  bucketSize: number;
  tickHistoryRef: React.MutableRefObject<Record<string, TickRecord[]>>;
  orderBookRef:   React.MutableRefObject<Record<string, OBRecord[]>>;
  historyBarsRef: React.MutableRefObject<Record<string, HistoryBar[]>>;
}

export function PriceHeatmap({ symbol, currentPrice, bucketSize, tickHistoryRef, orderBookRef, historyBarsRef }: Props) {
  const [win, setWin]             = useState<WindowKey>('5m');
  const [visibleRows, setVisible] = useState(DEFAULT_ROWS);

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const winRef   = useRef(win);   winRef.current   = win;
  const priceRef = useRef(currentPrice); priceRef.current = currentPrice;
  const rowsRef  = useRef(visibleRows);  rowsRef.current  = visibleRows;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = Math.max(1, Math.round(rowsRef.current * 0.1));
      setVisible(p => Math.max(MIN_ROWS, Math.min(MAX_ROWS, p + (e.deltaY > 0 ? step : -step))));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', () => setVisible(DEFAULT_ROWS));
    return () => { canvas.removeEventListener('wheel', onWheel); };
  }, []);

  useEffect(() => {
    const draw = () => {
      const canvas    = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const W   = container.clientWidth;
      const H   = container.clientHeight;
      if (W === 0 || H === 0) return;

      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width  = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.scale(dpr, dpr);

      const cfg      = WINDOWS[winRef.current];
      const ROWS     = rowsRef.current;
      const duration = cfg.duration;
      const price    = priceRef.current;
      const allTicks = tickHistoryRef.current[symbol]      ?? [];
      const allOB    = orderBookRef?.current?.[symbol]     ?? [];
      const allBars  = historyBarsRef?.current?.[symbol]   ?? [];

      const gridW   = W - LABEL_W - PROFILE_W;
      const gridH   = H - TIME_H - DELTA_H;
      const cellW   = gridW / COLS;
      const cellH   = gridH / ROWS;
      const bucketMs = duration / COLS;
      const now = Date.now();

      ctx.fillStyle = '#06060e';
      ctx.fillRect(0, 0, W, H);

      const hasData = allTicks.length > 0 || allBars.length > 0;
      if (!price && !hasData) {
        ctx.fillStyle = '#2a2a3a';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for data…', LABEL_W + gridW / 2, H / 2);
        return;
      }

      const center   = price ?? allTicks[allTicks.length - 1]?.price ?? (allBars[allBars.length - 1]?.close ?? 0);
      const priceMin = center - (ROWS / 2) * bucketSize;
      const priceMax = priceMin + ROWS * bucketSize;

      const toX = (ts: number)  => LABEL_W + gridW * (1 - (now - ts) / duration);
      const toY = (p:  number)  => gridH   * (1 - (p - priceMin) / (priceMax - priceMin));
      const toRow = (p: number) => Math.floor((p - priceMin) / bucketSize);
      const toCol = (ts: number) => Math.min(COLS - 1, Math.max(0, Math.floor((duration - (now - ts)) / bucketMs)));

      // ── 1. HISTORY BAR LAYER (for 1H/4H or any window with bars) ─────────
      if (allBars.length > 0) {
        // Accumulate volume per (row, col) from bars
        const barVol  = Array.from({ length: ROWS }, () => new Float64Array(COLS));
        const barUp   = Array.from({ length: ROWS }, () => new Uint8Array(COLS));
        let   totalMaxVol = 1;

        for (const bar of allBars) {
          const tsMs = bar.time * 1000;
          const age  = now - tsMs;
          if (age > duration || age < 0) continue;

          const col     = toCol(tsMs);
          const isUp    = bar.close >= bar.open;
          const lowRow  = Math.max(0, toRow(bar.low));
          const highRow = Math.min(ROWS - 1, toRow(bar.high));
          const volPerRow = bar.volume / Math.max(1, highRow - lowRow + 1);

          for (let row = lowRow; row <= highRow; row++) {
            barVol[row][col] += volPerRow;
            if (isUp) barUp[row][col]++;
            if (barVol[row][col] > totalMaxVol) totalMaxVol = barVol[row][col];
          }
        }

        for (let row = 0; row < ROWS; row++) {
          const dispRow = ROWS - 1 - row;
          const y = dispRow * cellH;
          for (let col = 0; col < COLS; col++) {
            const vol = barVol[row][col];
            if (vol < 0.01) continue;
            const t    = Math.pow(vol / totalMaxVol, 0.5);
            const isUp = barUp[row][col] > 0;
            if (isUp) {
              ctx.fillStyle = `rgba(0,${Math.round(90 + 130 * t)},${Math.round(50 + 60 * t)},${0.15 + 0.65 * t})`;
            } else {
              ctx.fillStyle = `rgba(${Math.round(80 + 80 * t)},0,${Math.round(100 + 110 * t)},${0.15 + 0.65 * t})`;
            }
            ctx.fillRect(LABEL_W + col * cellW, y, cellW, cellH);
          }
        }
      }

      // ── 2. ORDER BOOK LAYER (cyan bid / orange ask) ───────────────────────
      if (!cfg.useHistory && allOB.length > 0) {
        const obBid = Array.from({ length: ROWS }, () => new Float32Array(COLS));
        const obAsk = Array.from({ length: ROWS }, () => new Float32Array(COLS));

        for (const rec of allOB) {
          const age = now - rec.ts;
          if (age > duration) continue;
          const col    = toCol(rec.ts);
          const bidRow = toRow(rec.bid);
          const askRow = toRow(rec.ask);
          if (bidRow >= 0 && bidRow < ROWS) obBid[bidRow][col] = Math.max(obBid[bidRow][col], rec.bidSize);
          if (askRow >= 0 && askRow < ROWS) obAsk[askRow][col] = Math.max(obAsk[askRow][col], rec.askSize);
        }

        const maxBid = Math.max(1, ...obBid.flatMap(r => Array.from(r)));
        const maxAsk = Math.max(1, ...obAsk.flatMap(r => Array.from(r)));

        for (let row = 0; row < ROWS; row++) {
          const dispRow = ROWS - 1 - row;
          const y = dispRow * cellH;
          for (let col = 0; col < COLS; col++) {
            const x  = LABEL_W + col * cellW;
            const bt = obBid[row][col] / maxBid;
            const at = obAsk[row][col] / maxAsk;
            if (bt > 0.03) {
              const a = 0.12 + 0.68 * bt;
              ctx.fillStyle = `rgba(0,${Math.round(160 + 95 * bt)},${Math.round(200 + 55 * bt)},${a})`;
              ctx.fillRect(x, y, cellW, cellH);
            }
            if (at > 0.03) {
              const a = 0.12 + 0.68 * at;
              ctx.fillStyle = `rgba(${Math.round(230 + 25 * at)},${Math.round(100 + 60 * at)},0,${a})`;
              ctx.fillRect(x, y, cellW, cellH);
            }
          }
        }
      }

      // ── 3. TICK DENSITY WASH ──────────────────────────────────────────────
      if (allTicks.length > 0 && !cfg.useHistory) {
        const bgCounts = Array.from({ length: ROWS }, () => new Uint16Array(COLS));
        for (const tick of allTicks) {
          const age = now - tick.ts;
          if (age > duration) continue;
          const col = toCol(tick.ts);
          const row = toRow(tick.price);
          if (row >= 0 && row < ROWS) bgCounts[row][col]++;
        }
        const maxBg = Math.max(1, ...bgCounts.flatMap(r => Array.from(r)));
        for (let row = 0; row < ROWS; row++) {
          const dispRow = ROWS - 1 - row;
          const y = dispRow * cellH;
          for (let col = 0; col < COLS; col++) {
            const t = bgCounts[row][col] / maxBg;
            if (t < 0.05) continue;
            ctx.fillStyle = `rgba(30,60,100,${0.06 + 0.14 * t})`;
            ctx.fillRect(LABEL_W + col * cellW, y, cellW, cellH);
          }
        }
      }

      // ── 4. GRID LINES ─────────────────────────────────────────────────────
      ctx.strokeStyle = '#10101a';
      ctx.lineWidth = 0.5;
      const lineEvery = Math.max(1, Math.round(ROWS / 12));
      for (let row = 0; row <= ROWS; row += lineEvery) {
        const y = row * cellH;
        ctx.beginPath(); ctx.moveTo(LABEL_W, y); ctx.lineTo(LABEL_W + gridW, y); ctx.stroke();
      }
      const colEvery = Math.ceil(COLS / 6);
      for (let col = 0; col <= COLS; col += colEvery) {
        const x = LABEL_W + col * cellW;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gridH); ctx.stroke();
      }

      // ── 5. PRICE PATH + SPHERE BUBBLES (tick mode) ───────────────────────
      if (!cfg.useHistory && allTicks.length > 0) {
        interface PlotTick { x: number; y: number; isUp: boolean; age: number }
        const plotTicks: PlotTick[] = [];
        let prevP: number | null = null;

        for (const tick of allTicks) {
          const age = now - tick.ts;
          if (age > duration) { prevP = tick.price; continue; }
          const x = toX(tick.ts);
          const y = toY(tick.price);
          if (x < LABEL_W || y < 0 || y > gridH) { prevP = tick.price; continue; }
          plotTicks.push({ x, y, isUp: prevP === null || tick.price >= prevP, age });
          prevP = tick.price;
        }

        if (plotTicks.length > 1) {
          ctx.beginPath();
          ctx.moveTo(plotTicks[0].x, plotTicks[0].y);
          for (let i = 1; i < plotTicks.length; i++) ctx.lineTo(plotTicks[i].x, plotTicks[i].y);
          ctx.strokeStyle = 'rgba(180,180,220,0.15)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        for (const t of plotTicks) {
          const fade = Math.pow(1 - t.age / duration, 0.4);
          drawSphere(ctx, t.x, t.y, BUBBLE_R, t.isUp, Math.max(0.12, fade * 0.92));
        }
      }

      // ── 6. BAR CLOSE PATH (history mode) ─────────────────────────────────
      if (cfg.useHistory && allBars.length > 0) {
        const pts: { x: number; y: number }[] = [];
        for (const bar of allBars) {
          const tsMs = bar.time * 1000;
          if (now - tsMs > duration) continue;
          const x = toX(tsMs + 30_000); // midpoint of bar
          const y = toY(bar.close);
          if (x >= LABEL_W && y >= 0 && y <= gridH) pts.push({ x, y });
        }
        if (pts.length > 1) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.strokeStyle = 'rgba(220,220,255,0.35)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      // ── 7. PRICE AXIS LABELS ──────────────────────────────────────────────
      const labelEvery = Math.max(1, Math.round(ROWS / 10));
      ctx.font = `${Math.max(7, Math.min(10, cellH * 0.72))}px monospace`;
      ctx.textAlign = 'right';
      for (let row = 0; row < ROWS; row += labelEvery) {
        const p = priceMin + row * bucketSize;
        ctx.fillStyle = '#2a2a40';
        ctx.fillText(p.toFixed(bucketSize < 1 ? 2 : 0), LABEL_W - 4, toY(p) + 3.5);
      }

      // ── 8. CURRENT PRICE LINE ─────────────────────────────────────────────
      if (price !== null && price >= priceMin && price <= priceMax) {
        const py = toY(price);
        ctx.fillStyle = 'rgba(0,230,118,0.05)';
        ctx.fillRect(LABEL_W, py - cellH / 2, gridW, cellH);
        ctx.strokeStyle = '#00e676';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(LABEL_W, py); ctx.lineTo(LABEL_W + gridW, py); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#00e676';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(price.toFixed(bucketSize < 1 ? 2 : 0), LABEL_W - 4, py + 3.5);
      }

      // ── 9. RIGHT VOLUME PROFILE ───────────────────────────────────────────
      const rowProfile = new Float64Array(ROWS);
      if (cfg.useHistory) {
        for (const bar of allBars) {
          const tsMs = bar.time * 1000;
          if (now - tsMs > duration) continue;
          const lowRow  = Math.max(0, toRow(bar.low));
          const highRow = Math.min(ROWS - 1, toRow(bar.high));
          const volPR   = bar.volume / Math.max(1, highRow - lowRow + 1);
          for (let r = lowRow; r <= highRow; r++) rowProfile[r] += volPR;
        }
      } else {
        for (const tick of allTicks) {
          if (now - tick.ts > duration) continue;
          const r = toRow(tick.price);
          if (r >= 0 && r < ROWS) rowProfile[r]++;
        }
      }
      const maxRT = Math.max(1, ...Array.from(rowProfile));
      const maxPR = PROFILE_W / 2 - 3;
      const profCx = LABEL_W + gridW + PROFILE_W / 2;
      for (let row = 0; row < ROWS; row++) {
        const t = rowProfile[row] / maxRT;
        if (t === 0) continue;
        const r  = Math.max(1, maxPR * Math.sqrt(t));
        const cy = (ROWS - 1 - row) * cellH + cellH / 2;
        ctx.beginPath();
        ctx.arc(profCx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,${Math.round(120 + 110 * t)},${Math.round(70 + 80 * t)},${0.2 + 0.5 * t})`;
        ctx.fill();
      }

      // ── 10. VOLUME DELTA BARS ─────────────────────────────────────────────
      const buyVol  = new Float64Array(COLS);
      const sellVol = new Float64Array(COLS);

      if (cfg.useHistory) {
        for (const bar of allBars) {
          const tsMs = bar.time * 1000;
          if (now - tsMs > duration) continue;
          const col = toCol(tsMs);
          if (bar.close >= bar.open) buyVol[col]  += bar.volume;
          else                       sellVol[col] += bar.volume;
        }
      } else {
        let prevVol: number | null = null;
        let prevPx:  number | null = null;
        for (const tick of allTicks) {
          if (now - tick.ts > duration) { prevVol = tick.vol; prevPx = tick.price; continue; }
          const col  = toCol(tick.ts);
          const dVol = prevVol !== null ? Math.max(0, tick.vol - prevVol) : 0;
          if (prevPx !== null && dVol > 0) {
            if (tick.price >= prevPx) buyVol[col]  += dVol;
            else                      sellVol[col] += dVol;
          }
          prevVol = tick.vol;
          prevPx  = tick.price;
        }
      }

      const maxDelta  = Math.max(1, ...Array.from(buyVol), ...Array.from(sellVol));
      const deltaBase = gridH + DELTA_H / 2;
      ctx.fillStyle = '#0d0d18';
      ctx.fillRect(0, gridH, W, DELTA_H);
      ctx.strokeStyle = '#1a1a28';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(LABEL_W, gridH); ctx.lineTo(LABEL_W + gridW, gridH); ctx.stroke();

      for (let col = 0; col < COLS; col++) {
        const x  = LABEL_W + col * cellW + 1;
        const w  = Math.max(1, cellW - 2);
        const bh = (buyVol[col]  / maxDelta) * (DELTA_H / 2 - 2);
        const sh = (sellVol[col] / maxDelta) * (DELTA_H / 2 - 2);
        if (bh > 0.5) { ctx.fillStyle = 'rgba(0,210,90,0.75)';    ctx.fillRect(x, deltaBase - bh, w, bh); }
        if (sh > 0.5) { ctx.fillStyle = 'rgba(160,50,230,0.75)';   ctx.fillRect(x, deltaBase,      w, sh); }
      }

      // ── 11. TIME AXIS ─────────────────────────────────────────────────────
      ctx.fillStyle = '#0d0d18';
      ctx.fillRect(0, gridH + DELTA_H, W, TIME_H);
      ctx.fillStyle = '#2e2e42';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      for (let col = 0; col <= COLS; col += colEvery) {
        const ageMs = bucketMs * (COLS - col);
        let label: string;
        if (col === COLS) label = 'now';
        else if (ageMs >= 3_600_000) label = `${Math.round(ageMs / 3_600_000)}h`;
        else if (ageMs >= 60_000)    label = `${Math.round(ageMs / 60_000)}m`;
        else                          label = `${Math.round(ageMs / 1_000)}s`;
        ctx.fillText(label, LABEL_W + col * cellW, gridH + DELTA_H + TIME_H * 0.72);
      }

      // ── 12. ZOOM INDICATOR ────────────────────────────────────────────────
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
  }, [symbol, bucketSize, tickHistoryRef, orderBookRef, historyBarsRef]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-1 mb-2 px-0.5">
        <span className="text-xs text-muted-foreground font-mono mr-1">HEATMAP</span>
        {(Object.keys(WINDOWS) as WindowKey[]).map(k => (
          <button key={k} onClick={() => setWin(k)}
            className={cn('px-2 py-0.5 text-xs font-mono rounded transition-colors',
              win === k ? 'bg-white/15 text-white' : 'text-muted-foreground hover:text-white/60')}>
            {k}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground/40 font-mono">
          scroll zoom · dbl reset
        </span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 rounded-lg overflow-hidden border border-[#1a1a28] cursor-crosshair">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
}
