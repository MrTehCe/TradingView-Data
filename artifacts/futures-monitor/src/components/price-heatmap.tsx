import React, { useEffect, useRef, useState, useCallback } from 'react';
import { TickRecord, OBRecord } from '@/hooks/use-market-data';
import { type Position, pnlDollars } from '@/hooks/use-positions';
import { cn } from '@/lib/utils';

const WINDOWS = {
  '1m':  { duration:      60_000 },
  '3m':  { duration:     180_000 },
  '5m':  { duration:     300_000 },
  '15m': { duration:     900_000 },
  '30m': { duration:   1_800_000 },
  '1H':  { duration:   3_600_000 },
  '4H':  { duration:  14_400_000 },
} as const;
type WindowKey = keyof typeof WINDOWS;

const DEFAULT_ROWS = 50;
const MIN_ROWS      = 10;
const MAX_ROWS      = 160;
const COLS          = 40;
const LABEL_W       = 68;
const PROFILE_W     = 40;
const TIME_H        = 18;
const DELTA_H       = 32;
const BUBBLE_R      = 4.5;
const LEVEL_HIT_PX  = 8;     // pixels within which a level line is "hit"

function drawSphere(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, isUp: boolean, alpha: number) {
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
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
}

interface Geometry { priceMin: number; priceMax: number; gridH: number; gridW: number }

interface Props {
  symbol: string;
  currentPrice: number | null;
  bucketSize: number;
  tickHistoryRef: React.MutableRefObject<Record<string, TickRecord[]>>;
  orderBookRef:   React.MutableRefObject<Record<string, OBRecord[]>>;
  positions?: Position[];
  onUpdatePosition?: (id: string, patch: { sl?: number | null; tp?: number | null }) => void;
}

export function PriceHeatmap({ symbol, currentPrice, bucketSize, tickHistoryRef, orderBookRef, positions = [], onUpdatePosition }: Props) {
  const [win, setWin]             = useState<WindowKey>('5m');
  const [visibleRows, setVisible] = useState(DEFAULT_ROWS);
  const [isPanning, setIsPanning] = useState(false);
  const [isPanned, setIsPanned]   = useState(false);

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const winRef    = useRef(win);         winRef.current    = win;
  const priceRef  = useRef(currentPrice); priceRef.current = currentPrice;
  const rowsRef   = useRef(visibleRows);  rowsRef.current  = visibleRows;

  const panOffsetRef    = useRef(0);
  const geometryRef     = useRef<Geometry | null>(null);

  // ── Drag state (unified: pan or level) ───────────────────────────────────
  type LevelDrag = { posId: string; type: 'sl' | 'tp'; draft: number };
  const dragModeRef  = useRef<'idle' | 'pan' | 'level'>('idle');
  const levelDragRef = useRef<LevelDrag | null>(null);
  const panStartYRef = useRef(0);
  const panStartPanRef = useRef(0);

  // For cursor hover tracking
  const [cursor, setCursor] = useState<'grab' | 'grabbing' | 'ns-resize'>('grab');

  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  const resetView = useCallback(() => {
    setVisible(DEFAULT_ROWS);
    panOffsetRef.current = 0;
    setIsPanned(false);
  }, []);

  // ── Wheel zoom ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = Math.max(1, Math.round(rowsRef.current * 0.1));
      setVisible(p => Math.max(MIN_ROWS, Math.min(MAX_ROWS, p + (e.deltaY > 0 ? step : -step))));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ── Helpers using geometry ref ───────────────────────────────────────────
  function levelY(price: number, geo: Geometry): number {
    return geo.gridH * (1 - (price - geo.priceMin) / (geo.priceMax - geo.priceMin));
  }
  function priceFromY(y: number, geo: Geometry): number {
    return geo.priceMin + (1 - y / geo.gridH) * (geo.priceMax - geo.priceMin);
  }
  function snapPrice(p: number): number {
    return Math.round(p / bucketSize) * bucketSize;
  }

  // ── Find which level is near a canvas Y ─────────────────────────────────
  function hitTest(offsetY: number): LevelDrag | null {
    const geo = geometryRef.current;
    if (!geo || offsetY > geo.gridH) return null;
    const symPositions = positionsRef.current.filter(p => p.symbol === symbol);
    for (const pos of symPositions) {
      if (pos.sl != null) {
        const ly = levelY(pos.sl, geo);
        if (Math.abs(offsetY - ly) <= LEVEL_HIT_PX) return { posId: pos.id, type: 'sl', draft: pos.sl };
      }
      if (pos.tp != null) {
        const ly = levelY(pos.tp, geo);
        if (Math.abs(offsetY - ly) <= LEVEL_HIT_PX) return { posId: pos.id, type: 'tp', draft: pos.tp };
      }
    }
    return null;
  }

  // ── Unified mouse events ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;
      const hit = hitTest(offsetY);
      if (hit) {
        dragModeRef.current  = 'level';
        levelDragRef.current = hit;
        e.preventDefault();
        return;
      }
      dragModeRef.current   = 'pan';
      panStartYRef.current  = e.clientY;
      panStartPanRef.current = panOffsetRef.current;
      setIsPanning(true);
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;

      if (dragModeRef.current === 'level') {
        const geo = geometryRef.current;
        const drag = levelDragRef.current;
        if (!geo || !drag) return;
        drag.draft = snapPrice(priceFromY(offsetY, geo));
        return;
      }

      if (dragModeRef.current === 'pan') {
        const container = containerRef.current;
        if (!container) return;
        const gridH2 = container.clientHeight - TIME_H - DELTA_H;
        const cellH  = gridH2 / rowsRef.current;
        const dy     = e.clientY - panStartYRef.current;
        panOffsetRef.current = panStartPanRef.current + (dy / cellH) * bucketSize;
        setIsPanned(panOffsetRef.current !== 0);
        return;
      }

      // Hover: update cursor
      const hit = hitTest(offsetY);
      setCursor(hit ? 'ns-resize' : 'grab');
    };

    const onUp = (e: MouseEvent) => {
      if (dragModeRef.current === 'level') {
        const drag = levelDragRef.current;
        if (drag && onUpdatePosition) {
          const rect = canvas.getBoundingClientRect();
          const offsetY = e.clientY - rect.top;
          const geo = geometryRef.current;
          if (geo) drag.draft = snapPrice(priceFromY(offsetY, geo));
          onUpdatePosition(drag.posId, { [drag.type]: drag.draft });
        }
        levelDragRef.current = null;
        dragModeRef.current  = 'idle';
        return;
      }
      if (dragModeRef.current === 'pan') {
        dragModeRef.current = 'idle';
        setIsPanning(false);
      }
    };

    const onDblClick = () => resetView();

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('dblclick', onDblClick);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('dblclick', onDblClick);
    };
  }, [bucketSize, resetView, symbol, onUpdatePosition]);

  // ── Draw loop ────────────────────────────────────────────────────────────
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

      const ROWS     = rowsRef.current;
      const duration = WINDOWS[winRef.current].duration;
      const price    = priceRef.current;
      const allTicks = tickHistoryRef.current[symbol] ?? [];
      const allOB    = orderBookRef?.current?.[symbol] ?? [];

      const gridW   = W - LABEL_W - PROFILE_W;
      const gridH   = H - TIME_H - DELTA_H;
      const cellW   = gridW / COLS;
      const cellH   = gridH / ROWS;
      const bucketMs = duration / COLS;
      const now = Date.now();

      ctx.fillStyle = '#06060e';
      ctx.fillRect(0, 0, W, H);

      if (!price && allTicks.length === 0) {
        ctx.fillStyle = '#2a2a3a'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
        ctx.fillText('Waiting for data…', LABEL_W + gridW / 2, H / 2);
        return;
      }

      const rawCenter = price ?? allTicks[allTicks.length - 1]?.price ?? 0;
      const center    = rawCenter - panOffsetRef.current;
      const priceMin  = center - (ROWS / 2) * bucketSize;
      const priceMax  = priceMin + ROWS * bucketSize;

      // Store geometry for drag hit-testing
      geometryRef.current = { priceMin, priceMax, gridH, gridW };

      const toX   = (ts: number) => LABEL_W + gridW * (1 - (now - ts) / duration);
      const toY   = (p:  number) => gridH   * (1 - (p - priceMin) / (priceMax - priceMin));
      const toRow = (p:  number) => Math.floor((p - priceMin) / bucketSize);
      const toCol = (ts: number) => Math.min(COLS - 1, Math.max(0, Math.floor((duration - (now - ts)) / bucketMs)));

      // ── 1. Order book heatmap ─────────────────────────────────────────────
      if (allOB.length > 0) {
        const obBid = Array.from({ length: ROWS }, () => new Float32Array(COLS));
        const obAsk = Array.from({ length: ROWS }, () => new Float32Array(COLS));
        for (const rec of allOB) {
          if (now - rec.ts > duration) continue;
          const col = toCol(rec.ts), bidRow = toRow(rec.bid), askRow = toRow(rec.ask);
          if (bidRow >= 0 && bidRow < ROWS) obBid[bidRow][col] = Math.max(obBid[bidRow][col], rec.bidSize);
          if (askRow >= 0 && askRow < ROWS) obAsk[askRow][col] = Math.max(obAsk[askRow][col], rec.askSize);
        }
        let maxBid = 1, maxAsk = 1;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          if (obBid[r][c] > maxBid) maxBid = obBid[r][c];
          if (obAsk[r][c] > maxAsk) maxAsk = obAsk[r][c];
        }
        for (let row = 0; row < ROWS; row++) {
          const y = (ROWS - 1 - row) * cellH;
          for (let col = 0; col < COLS; col++) {
            const x = LABEL_W + col * cellW;
            const bt = obBid[row][col] / maxBid, at = obAsk[row][col] / maxAsk;
            if (bt > 0.03) { const a = 0.12 + 0.68 * bt; ctx.fillStyle = `rgba(0,${Math.round(160 + 95 * bt)},${Math.round(200 + 55 * bt)},${a})`; ctx.fillRect(x, y, cellW, cellH); }
            if (at > 0.03) { const a = 0.12 + 0.68 * at; ctx.fillStyle = `rgba(${Math.round(230 + 25 * at)},${Math.round(100 + 60 * at)},0,${a})`; ctx.fillRect(x, y, cellW, cellH); }
          }
        }
      }

      // ── 2. Tick density ───────────────────────────────────────────────────
      const bgCounts = Array.from({ length: ROWS }, () => new Uint16Array(COLS));
      for (const tick of allTicks) {
        if (now - tick.ts > duration) continue;
        const col = toCol(tick.ts), row = toRow(tick.price);
        if (row >= 0 && row < ROWS) bgCounts[row][col]++;
      }
      let maxBg = 1;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (bgCounts[r][c] > maxBg) maxBg = bgCounts[r][c];
      for (let row = 0; row < ROWS; row++) {
        const y = (ROWS - 1 - row) * cellH;
        for (let col = 0; col < COLS; col++) {
          const t = bgCounts[row][col] / maxBg;
          if (t < 0.05) continue;
          ctx.fillStyle = `rgba(30,60,100,${0.06 + 0.14 * t})`;
          ctx.fillRect(LABEL_W + col * cellW, y, cellW, cellH);
        }
      }

      // ── 3. Grid ───────────────────────────────────────────────────────────
      ctx.strokeStyle = '#10101a'; ctx.lineWidth = 0.5;
      const lineEvery = Math.max(1, Math.round(ROWS / 12));
      for (let row = 0; row <= ROWS; row += lineEvery) { const y = row * cellH; ctx.beginPath(); ctx.moveTo(LABEL_W, y); ctx.lineTo(LABEL_W + gridW, y); ctx.stroke(); }
      const colEvery = Math.ceil(COLS / 6);
      for (let col = 0; col <= COLS; col += colEvery) { const x = LABEL_W + col * cellW; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gridH); ctx.stroke(); }

      // ── 4. Price path + bubbles ───────────────────────────────────────────
      interface PlotTick { x: number; y: number; isUp: boolean; age: number }
      const plotTicks: PlotTick[] = [];
      let prevP: number | null = null;
      for (const tick of allTicks) {
        const age = now - tick.ts;
        if (age > duration) { prevP = tick.price; continue; }
        const x = toX(tick.ts), y = toY(tick.price);
        if (x < LABEL_W || y < 0 || y > gridH) { prevP = tick.price; continue; }
        plotTicks.push({ x, y, isUp: prevP === null || tick.price >= prevP, age });
        prevP = tick.price;
      }
      if (plotTicks.length > 1) {
        ctx.beginPath(); ctx.moveTo(plotTicks[0].x, plotTicks[0].y);
        for (let i = 1; i < plotTicks.length; i++) ctx.lineTo(plotTicks[i].x, plotTicks[i].y);
        ctx.strokeStyle = 'rgba(180,180,220,0.15)'; ctx.lineWidth = 0.8; ctx.stroke();
      }
      for (const t of plotTicks) {
        const fade = Math.pow(1 - t.age / duration, 0.4);
        drawSphere(ctx, t.x, t.y, BUBBLE_R, t.isUp, Math.max(0.12, fade * 0.92));
      }

      // ── 4.5. Session VWAP + ±1σ / ±2σ bands ─────────────────────────────
      {
        // CME Globex session anchor: 23:00 UTC (= 6 pm ET)
        const anchor = (() => {
          const d = new Date(); d.setUTCHours(23, 0, 0, 0);
          if (d.getTime() > now) d.setUTCDate(d.getUTCDate() - 1);
          return d.getTime();
        })();

        // Pull ticks from this session, sorted ascending
        const sTicks = allTicks.filter(t => t.ts >= anchor).sort((a, b) => a.ts - b.ts);

        if (sTicks.length >= 3) {
          // Per-tick delta volume (cumulative field → delta)
          const tVolumes: number[] = [];
          for (let i = 0; i < sTicks.length; i++) {
            const dv = i === 0 ? (sTicks[i].vol || 1) : Math.max(0, sTicks[i].vol - sTicks[i - 1].vol);
            tVolumes.push(dv > 0 ? dv : 1);   // never zero-weight
          }

          // Walk columns; for each column boundary accumulate up to that time
          const vwapArr = new Float64Array(COLS + 1).fill(NaN);
          const sdArr   = new Float64Array(COLS + 1).fill(0);
          let cumV = 0, cumPV = 0, cumPV2 = 0, ti2 = 0;

          for (let col = 0; col <= COLS; col++) {
            const colTime = now - (COLS - col) * bucketMs;
            while (ti2 < sTicks.length && sTicks[ti2].ts <= colTime) {
              const w = tVolumes[ti2];
              cumPV  += w * sTicks[ti2].price;
              cumPV2 += w * sTicks[ti2].price * sTicks[ti2].price;
              cumV   += w;
              ti2++;
            }
            if (cumV > 0) {
              const vwap = cumPV / cumV;
              const sd   = Math.sqrt(Math.max(0, cumPV2 / cumV - vwap * vwap));
              vwapArr[col] = vwap;
              sdArr[col]   = sd;
            }
          }

          // Helper: trace a polyline for price offset
          const traceLine = (offset: number) => {
            let started = false;
            for (let col = 0; col <= COLS; col++) {
              if (isNaN(vwapArr[col])) { started = false; continue; }
              const x = LABEL_W + col * cellW;
              const y = toY(vwapArr[col] + offset * sdArr[col]);
              if (y < -2 || y > gridH + 2) { started = false; continue; }
              if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
            }
          };

          ctx.save();

          // ±2σ fill
          ctx.beginPath();
          let fs = false;
          for (let col = 0; col <= COLS; col++) {
            if (isNaN(vwapArr[col])) { fs = false; continue; }
            const x = LABEL_W + col * cellW, y = toY(vwapArr[col] + 2 * sdArr[col]);
            if (!fs) { ctx.moveTo(x, y); fs = true; } else { ctx.lineTo(x, y); }
          }
          for (let col = COLS; col >= 0; col--) {
            if (isNaN(vwapArr[col])) continue;
            ctx.lineTo(LABEL_W + col * cellW, toY(vwapArr[col] - 2 * sdArr[col]));
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(130,80,200,0.05)';
          ctx.fill();

          // ±1σ fill
          ctx.beginPath(); fs = false;
          for (let col = 0; col <= COLS; col++) {
            if (isNaN(vwapArr[col])) { fs = false; continue; }
            const x = LABEL_W + col * cellW, y = toY(vwapArr[col] + 1 * sdArr[col]);
            if (!fs) { ctx.moveTo(x, y); fs = true; } else { ctx.lineTo(x, y); }
          }
          for (let col = COLS; col >= 0; col--) {
            if (isNaN(vwapArr[col])) continue;
            ctx.lineTo(LABEL_W + col * cellW, toY(vwapArr[col] - 1 * sdArr[col]));
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(130,80,200,0.09)';
          ctx.fill();

          // ±2σ dashed lines
          ctx.setLineDash([3, 5]); ctx.lineWidth = 0.8;
          ctx.strokeStyle = 'rgba(160,100,230,0.5)';
          ctx.beginPath(); traceLine(+2); ctx.stroke();
          ctx.beginPath(); traceLine(-2); ctx.stroke();

          // ±1σ dashed lines
          ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(160,100,230,0.7)';
          ctx.beginPath(); traceLine(+1); ctx.stroke();
          ctx.beginPath(); traceLine(-1); ctx.stroke();

          // VWAP centre line (solid)
          ctx.setLineDash([]); ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(200,170,255,0.9)';
          ctx.beginPath(); traceLine(0); ctx.stroke();

          // Right-edge VWAP label
          const lastV = Array.from(vwapArr).reverse().find(v => !isNaN(v));
          if (lastV !== undefined) {
            const vy = Math.max(8, Math.min(gridH - 8, toY(lastV)));
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(LABEL_W + gridW - 56, vy - 6, 56, 12);
            ctx.fillStyle = 'rgba(200,170,255,0.95)';
            ctx.font = 'bold 8px monospace'; ctx.textAlign = 'right';
            ctx.fillText(`VWAP ${lastV.toFixed(2)}`, LABEL_W + gridW - 2, vy + 3);
          }

          ctx.restore();
        }
      }

      // ── 5. Price axis labels ──────────────────────────────────────────────
      const minLabelSpacing = 9; let labelStep = 1;
      while (cellH * labelStep < minLabelSpacing) labelStep++;
      const decimals     = bucketSize < 1 ? 2 : 0;
      const labelFontSize = Math.max(7.5, Math.min(10.5, cellH * 0.75));
      ctx.font = `${labelFontSize}px monospace`;
      ctx.fillStyle = '#06060d'; ctx.fillRect(0, 0, LABEL_W - 1, gridH);
      ctx.strokeStyle = '#141420'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(LABEL_W - 1, 0); ctx.lineTo(LABEL_W - 1, gridH); ctx.stroke();
      for (let row = 0; row < ROWS; row += labelStep) {
        const p = priceMin + row * bucketSize, py = toY(p);
        if (py < 0 || py > gridH) continue;
        ctx.strokeStyle = '#22223a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(LABEL_W - 5, py); ctx.lineTo(LABEL_W - 1, py); ctx.stroke();
        const distFromPrice = price !== null ? Math.abs(p - price) / (ROWS * bucketSize) : 1;
        const labelAlpha = 0.25 + 0.45 * Math.max(0, 1 - distFromPrice * 6);
        ctx.fillStyle = `rgba(160,160,210,${labelAlpha})`; ctx.textAlign = 'right';
        ctx.fillText(p.toFixed(decimals), LABEL_W - 8, py + labelFontSize * 0.38);
      }

      // ── 6. Current price line + badge ─────────────────────────────────────
      if (price !== null) {
        const py = toY(price); const inView = py >= 0 && py <= gridH;
        if (inView) {
          ctx.fillStyle = 'rgba(0,230,118,0.04)'; ctx.fillRect(LABEL_W, py - cellH / 2, gridW, cellH);
          ctx.strokeStyle = '#00e676'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(LABEL_W, py); ctx.lineTo(LABEL_W + gridW, py); ctx.stroke(); ctx.setLineDash([]);
        }
        const clampedPy = Math.max(labelFontSize, Math.min(gridH - 2, inView ? py : (py < 0 ? 2 : gridH - 2)));
        const labelX = LABEL_W - 2, labelH2 = labelFontSize + 4, labelW2 = LABEL_W - 3;
        ctx.fillStyle = inView ? '#00c853' : '#005c25';
        ctx.beginPath(); ctx.roundRect(1, clampedPy - labelH2 / 2, labelW2, labelH2, 3); ctx.fill();
        if (inView) { ctx.fillStyle = '#00c853'; ctx.beginPath(); ctx.moveTo(labelX, clampedPy - 4); ctx.lineTo(labelX + 5, clampedPy); ctx.lineTo(labelX, clampedPy + 4); ctx.fill(); }
        ctx.fillStyle = '#fff'; ctx.font = `bold ${labelFontSize}px monospace`; ctx.textAlign = 'center';
        ctx.fillText(price.toFixed(decimals), labelW2 / 2 + 1, clampedPy + labelFontSize * 0.35);
        if (!inView) { ctx.fillStyle = '#00e676'; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillText(py < 0 ? '▲' : '▼', LABEL_W + 4, py < 0 ? 12 : gridH - 4); }
      }

      // ── 7. Position levels (entry / SL / TP) ─────────────────────────────
      const symPositions = positionsRef.current.filter(p => p.symbol === symbol);
      const drag = levelDragRef.current;
      const lbFont = Math.max(8, Math.min(10, labelFontSize));

      for (const pos of symPositions) {
        // Get live SL/TP (override with draft during drag)
        const slPrice = drag?.posId === pos.id && drag.type === 'sl' ? drag.draft : pos.sl;
        const tpPrice = drag?.posId === pos.id && drag.type === 'tp' ? drag.draft : pos.tp;

        const entryY = toY(pos.entry);
        const slY    = slPrice != null ? toY(slPrice) : null;
        const tpY    = tpPrice != null ? toY(tpPrice) : null;

        // Zone fills
        if (slY !== null && entryY !== null) {
          const top = Math.min(entryY, slY), h = Math.abs(slY - entryY);
          ctx.fillStyle = 'rgba(220,50,50,0.06)'; ctx.fillRect(LABEL_W, top, gridW, h);
        }
        if (tpY !== null && entryY !== null) {
          const top = Math.min(entryY, tpY), h = Math.abs(tpY - entryY);
          ctx.fillStyle = 'rgba(0,200,100,0.06)'; ctx.fillRect(LABEL_W, top, gridW, h);
        }

        // Entry line
        if (entryY >= -2 && entryY <= gridH + 2) {
          ctx.strokeStyle = 'rgba(255,215,50,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
          ctx.beginPath(); ctx.moveTo(LABEL_W, entryY); ctx.lineTo(LABEL_W + gridW, entryY); ctx.stroke();
          ctx.setLineDash([]);
        }

        // SL line
        if (slY !== null && slY >= -2 && slY <= gridH + 2) {
          const isDragging = drag?.posId === pos.id && drag.type === 'sl';
          ctx.strokeStyle = isDragging ? 'rgba(255,100,100,1)' : 'rgba(255,80,80,0.85)';
          ctx.lineWidth = isDragging ? 2 : 1.5; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(LABEL_W, slY); ctx.lineTo(LABEL_W + gridW, slY); ctx.stroke();
          ctx.setLineDash([]);
        }

        // TP line
        if (tpY !== null && tpY >= -2 && tpY <= gridH + 2) {
          const isDragging = drag?.posId === pos.id && drag.type === 'tp';
          ctx.strokeStyle = isDragging ? 'rgba(50,255,150,1)' : 'rgba(50,220,130,0.85)';
          ctx.lineWidth = isDragging ? 2 : 1.5; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(LABEL_W, tpY); ctx.lineTo(LABEL_W + gridW, tpY); ctx.stroke();
          ctx.setLineDash([]);
        }

        // ── Labels on right edge ──────────────────────────────────────────
        const rightX = LABEL_W + gridW;
        const pillW  = PROFILE_W + 2;
        ctx.font = `bold ${lbFont}px monospace`;

        function drawLevelPill(py: number, txt: string, bg: string, fg: string) {
          if (py < 0 || py > gridH) return;
          const ph = lbFont + 5;
          ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(rightX + 1, py - ph / 2, pillW - 2, ph, 3); ctx.fill();
          ctx.fillStyle = fg; ctx.textAlign = 'center';
          ctx.fillText(txt, rightX + 1 + (pillW - 2) / 2, py + lbFont * 0.38);
        }

        // Entry pill
        drawLevelPill(entryY, 'ENTRY', 'rgba(180,140,0,0.55)', '#ffe066');

        // SL pill
        if (slY !== null && slPrice != null) {
          const slDollars = pnlDollars(pos, slPrice);
          const slTxt = slDollars >= 0 ? `+${Math.round(slDollars)}` : `${Math.round(slDollars)}`;
          drawLevelPill(slY, `SL ${slTxt}`, 'rgba(180,30,30,0.55)', '#ff9090');
        }

        // TP pill
        if (tpY !== null && tpPrice != null) {
          const tpDollars = pnlDollars(pos, tpPrice);
          const tpTxt = tpDollars >= 0 ? `+${Math.round(tpDollars)}` : `${Math.round(tpDollars)}`;
          drawLevelPill(tpY, `TP ${tpTxt}`, 'rgba(0,120,60,0.55)', '#60ffb0');
        }
      }

      // ── 8. Volume profile ─────────────────────────────────────────────────
      const rowTotals = bgCounts.map(rc => rc.reduce((s, c) => s + c, 0));
      const maxRT = Math.max(1, ...rowTotals);
      const maxPR = PROFILE_W / 2 - 3, profCx = LABEL_W + gridW + PROFILE_W / 2;
      for (let row = 0; row < ROWS; row++) {
        const t = rowTotals[row] / maxRT; if (t === 0) continue;
        const r = Math.max(1, maxPR * Math.sqrt(t)), cy = (ROWS - 1 - row) * cellH + cellH / 2;
        ctx.beginPath(); ctx.arc(profCx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,${Math.round(120 + 110 * t)},${Math.round(70 + 80 * t)},${0.2 + 0.5 * t})`; ctx.fill();
      }

      // ── 9. Volume delta bars ──────────────────────────────────────────────
      const buyVol = new Float64Array(COLS), sellVol = new Float64Array(COLS);
      let prevVol: number | null = null, prevPx: number | null = null;
      for (const tick of allTicks) {
        if (now - tick.ts > duration) { prevVol = tick.vol; prevPx = tick.price; continue; }
        const col = toCol(tick.ts), dVol = prevVol !== null ? Math.max(0, tick.vol - prevVol) : 0;
        if (prevPx !== null && dVol > 0) { if (tick.price >= prevPx) buyVol[col] += dVol; else sellVol[col] += dVol; }
        prevVol = tick.vol; prevPx = tick.price;
      }
      const maxDelta = Math.max(1, ...Array.from(buyVol), ...Array.from(sellVol));
      const deltaBase = gridH + DELTA_H / 2;
      ctx.fillStyle = '#0d0d18'; ctx.fillRect(0, gridH, W, DELTA_H);
      ctx.strokeStyle = '#1a1a28'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(LABEL_W, gridH); ctx.lineTo(LABEL_W + gridW, gridH); ctx.stroke();
      for (let col = 0; col < COLS; col++) {
        const x = LABEL_W + col * cellW + 1, w = Math.max(1, cellW - 2);
        const bh = (buyVol[col] / maxDelta) * (DELTA_H / 2 - 2), sh = (sellVol[col] / maxDelta) * (DELTA_H / 2 - 2);
        if (bh > 0.5) { ctx.fillStyle = 'rgba(0,210,90,0.75)'; ctx.fillRect(x, deltaBase - bh, w, bh); }
        if (sh > 0.5) { ctx.fillStyle = 'rgba(160,50,230,0.75)'; ctx.fillRect(x, deltaBase, w, sh); }
      }

      // ── 10. Time axis (wall-clock timestamps) ────────────────────────────
      ctx.fillStyle = '#0d0d18'; ctx.fillRect(0, gridH + DELTA_H, W, TIME_H);
      const showSecs = duration <= 300_000;   // show HH:MM:SS for ≤5m, else HH:MM
      const timeFmt: Intl.DateTimeFormatOptions = {
        hour: '2-digit', minute: '2-digit', ...(showSecs ? { second: '2-digit' } : {}),
      };
      for (let col = 0; col <= COLS; col += colEvery) {
        const ageMs  = bucketMs * (COLS - col);
        const ts     = new Date(now - ageMs);
        const label  = ts.toLocaleTimeString([], timeFmt);
        const x      = LABEL_W + col * cellW;
        const isNow  = col === COLS;

        // Slightly brighter for the current-time column
        ctx.fillStyle = isNow ? 'rgba(0,230,118,0.55)' : '#2e2e42';
        ctx.font = isNow ? 'bold 9px monospace' : '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, x, gridH + DELTA_H + TIME_H * 0.72);
      }

      // ── 11. Status hints ──────────────────────────────────────────────────
      ctx.font = '9px monospace'; ctx.textAlign = 'right';
      const hints: string[] = [];
      if (rowsRef.current !== DEFAULT_ROWS) hints.push(`${Math.round((DEFAULT_ROWS / rowsRef.current) * 100)}% zoom`);
      if (panOffsetRef.current !== 0) hints.push('panned · dbl-click to reset');
      if (drag) hints.push('dragging level…');
      if (hints.length > 0) { ctx.fillStyle = 'rgba(100,100,140,0.7)'; ctx.fillText(hints.join('  ·  '), LABEL_W + gridW - 4, gridH - 4); }
    };

    draw();
    const id = setInterval(draw, 100);  // faster refresh when dragging
    return () => clearInterval(id);
  }, [symbol, bucketSize, tickHistoryRef, orderBookRef]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-1 mb-1.5 px-0.5">
        {(Object.keys(WINDOWS) as WindowKey[]).map(k => (
          <button key={k} onClick={() => setWin(k)}
            className={cn(
              'px-2.5 py-0.5 text-[11px] font-mono rounded transition-all',
              win === k
                ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                : 'text-white/25 hover:text-white/50 border border-transparent'
            )}>
            {k}
          </button>
        ))}
        {isPanned && (
          <button onClick={resetView}
            className="ml-1 px-2 py-0.5 text-[10px] font-mono rounded text-amber-400/60 hover:text-amber-300 border border-amber-900/30 transition-colors">
            ⟲
          </button>
        )}
        <span className="ml-auto text-[10px] text-white/10 font-mono">drag · scroll · dbl↩</span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 rounded-md overflow-hidden border border-[#141420]"
        style={{ cursor }}
      >
        <canvas ref={canvasRef} className="w-full h-full block" style={{ userSelect: 'none' }} />
      </div>
    </div>
  );
}
