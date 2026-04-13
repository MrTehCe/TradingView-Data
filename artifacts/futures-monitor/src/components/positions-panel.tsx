import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { X, Plus, TrendingUp, TrendingDown } from 'lucide-react';

// $ per point — CME micro specs
const POINT_VALUE: Record<string, number> = {
  MES: 5,
  MNQ: 2,
};

export interface Position {
  id: string;
  symbol: 'MES' | 'MNQ';
  side: 'L' | 'S';
  qty: number;
  entry: number;
  openedAt: number;
}

const STORAGE_KEY = 'futures_monitor_positions_v2';

function load(): Position[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
  catch { return []; }
}
function save(p: Position[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }

function pnlDollars(pos: Position, px: number): number {
  const pts = pos.side === 'L' ? px - pos.entry : pos.entry - px;
  return pts * pos.qty * (POINT_VALUE[pos.symbol] ?? 1);
}

function pnlPoints(pos: Position, px: number): number {
  return (pos.side === 'L' ? px - pos.entry : pos.entry - px) * pos.qty;
}

function elapsed(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

interface Props { currentPrices: Record<string, number | null> }

export function PositionsPanel({ currentPrices }: Props) {
  const [positions, setPositions] = useState<Position[]>(load);
  const [adding, setAdding]       = useState(false);

  // Form state
  const [sym,   setSym]   = useState<'MES' | 'MNQ'>('MES');
  const [side,  setSide]  = useState<'L' | 'S'>('L');
  const [qty,   setQty]   = useState('1');
  const [entry, setEntry] = useState('');
  const entryRef = useRef<HTMLInputElement>(null);

  // Timer for elapsed display
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id); }, []);

  // Pre-fill entry with live price when opening form or switching symbol
  useEffect(() => {
    if (!adding) return;
    const px = currentPrices[sym];
    if (px != null) setEntry(px.toFixed(2));
  }, [adding, sym, currentPrices]);

  const openForm = useCallback(() => {
    const px = currentPrices[sym];
    if (px != null) setEntry(px.toFixed(2));
    setAdding(true);
    setTimeout(() => entryRef.current?.select(), 50);
  }, [sym, currentPrices]);

  function submit() {
    const e = parseFloat(entry);
    const q = Math.max(1, parseInt(qty, 10) || 1);
    if (isNaN(e)) return;
    const pos: Position = { id: Date.now().toString(), symbol: sym, side, qty: q, entry: e, openedAt: Date.now() };
    setPositions(prev => { const next = [...prev, pos]; save(next); return next; });
    setAdding(false);
  }

  function remove(id: string) {
    setPositions(prev => { const next = prev.filter(p => p.id !== id); save(next); return next; });
  }

  // Totals
  const totalPnl = positions.reduce((sum, pos) => {
    const px = currentPrices[pos.symbol];
    return px != null ? sum + pnlDollars(pos, px) : sum;
  }, 0);
  const hasPx = positions.some(p => currentPrices[p.symbol] != null);

  return (
    <div className="shrink-0">
      {/* ── Header bar ── */}
      <div className="flex items-center gap-3 mb-1.5">
        <span className="text-[10px] font-mono tracking-[0.2em] text-white/20 uppercase">Positions</span>

        {hasPx && positions.length > 0 && (
          <div className={cn(
            'flex items-center gap-1.5 px-2.5 py-0.5 rounded font-mono font-bold text-sm tabular-nums',
            totalPnl >= 0
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
          )}>
            {totalPnl >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)} unrealized
          </div>
        )}

        <button
          onClick={adding ? () => setAdding(false) : openForm}
          className={cn(
            'ml-auto flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded transition-all',
            adding
              ? 'text-white/30 hover:text-white/50'
              : 'bg-white/8 hover:bg-white/12 text-white/60 hover:text-white border border-white/10 hover:border-white/20'
          )}
        >
          {adding ? '✕ cancel' : <><Plus className="w-3 h-3" /> Track Trade</>}
        </button>
      </div>

      {/* ── Add form ── */}
      {adding && (
        <div className="flex flex-wrap items-center gap-2 mb-2 px-3 py-2 bg-[#0d0d1a] border border-[#222235] rounded-md">
          {/* Symbol toggle */}
          <div className="flex rounded overflow-hidden border border-[#2a2a3e] text-xs font-mono">
            {(['MES', 'MNQ'] as const).map(s => (
              <button key={s} onClick={() => setSym(s)}
                className={cn('px-3 py-1 transition-colors',
                  sym === s ? 'bg-white/10 text-white' : 'text-white/25 hover:text-white/50')}>
                {s}
              </button>
            ))}
          </div>

          {/* Side toggle */}
          <div className="flex rounded overflow-hidden border border-[#2a2a3e] text-xs font-mono">
            <button onClick={() => setSide('L')}
              className={cn('px-3 py-1 transition-colors',
                side === 'L' ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'text-white/25 hover:text-white/50')}>
              Long
            </button>
            <button onClick={() => setSide('S')}
              className={cn('px-3 py-1 transition-colors',
                side === 'S' ? 'bg-purple-500/20 text-purple-300 font-bold' : 'text-white/25 hover:text-white/50')}>
              Short
            </button>
          </div>

          {/* Qty */}
          <label className="flex items-center gap-1.5 text-xs font-mono text-white/30">
            Contracts
            <input type="number" min="1" value={qty}
              onChange={e => setQty(e.target.value)}
              className="w-14 bg-black border border-[#2a2a3e] rounded px-2 py-1 text-white font-mono text-xs text-center outline-none focus:border-white/30"
            />
          </label>

          {/* Entry */}
          <label className="flex items-center gap-1.5 text-xs font-mono text-white/30">
            Entry @
            <input ref={entryRef} type="number" step="0.25" value={entry}
              onChange={e => setEntry(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              className="w-24 bg-black border border-[#2a2a3e] rounded px-2 py-1 text-white font-mono text-xs text-center outline-none focus:border-white/30"
            />
          </label>

          {/* Preview P&L at current price */}
          {(() => {
            const px = currentPrices[sym];
            if (px == null) return null;
            const e2 = parseFloat(entry);
            if (isNaN(e2)) return null;
            const fakePos: Position = { id: '', symbol: sym, side, qty: Math.max(1, parseInt(qty)||1), entry: e2, openedAt: 0 };
            const preview = pnlDollars(fakePos, px);
            return (
              <span className={cn('text-xs font-mono tabular-nums', preview >= 0 ? 'text-emerald-400/60' : 'text-purple-400/60')}>
                now: {preview >= 0 ? '+' : ''}${preview.toFixed(0)}
              </span>
            );
          })()}

          <button onClick={submit}
            className="px-4 py-1 bg-white text-black text-xs font-mono font-bold rounded hover:bg-gray-200 transition-colors ml-1">
            Add
          </button>
        </div>
      )}

      {/* ── Position rows ── */}
      {positions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {positions.map(pos => {
            const px  = currentPrices[pos.symbol];
            const hasPx2 = px != null;
            const pnl = hasPx2 ? pnlDollars(pos, px!) : null;
            const pts = hasPx2 ? pnlPoints(pos, px!) : null;
            const win = pnl !== null && pnl >= 0;

            return (
              <div key={pos.id}
                className={cn(
                  'relative group flex items-center gap-3 rounded-md px-3 py-2 border text-xs font-mono',
                  win
                    ? 'bg-emerald-950/30 border-emerald-500/20'
                    : pnl !== null
                    ? 'bg-purple-950/20 border-purple-500/15'
                    : 'bg-white/3 border-white/8'
                )}>
                {/* Symbol + direction */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-white/60 text-[10px] tracking-widest">{pos.symbol}</span>
                  <span className={cn('font-bold text-sm', pos.side === 'L' ? 'text-emerald-400' : 'text-purple-400')}>
                    {pos.side === 'L' ? '▲ Long' : '▼ Short'}
                  </span>
                </div>

                {/* Qty + entry */}
                <div className="flex flex-col gap-0.5 text-white/40">
                  <span className="text-[10px]">{pos.qty} contract{pos.qty !== 1 ? 's' : ''}</span>
                  <span>@ {pos.entry.toFixed(2)}</span>
                </div>

                {/* Arrow */}
                {hasPx2 && <span className="text-white/20">→</span>}

                {/* Current price */}
                {hasPx2 && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-white/30">now</span>
                    <span className="text-white/70">{px!.toFixed(2)}</span>
                  </div>
                )}

                {/* P&L */}
                {pnl !== null && pts !== null && (
                  <div className={cn('flex flex-col gap-0.5 text-right ml-1', win ? 'text-emerald-400' : 'text-purple-400')}>
                    <span className="text-[10px] opacity-60">{pts >= 0 ? '+' : ''}{pts.toFixed(2)} pts</span>
                    <span className="font-bold text-base tabular-nums">
                      {win ? '+' : ''}${pnl.toFixed(0)}
                    </span>
                  </div>
                )}

                {/* Elapsed */}
                <span className="text-white/15 text-[10px] ml-1">{elapsed(pos.openedAt)}</span>

                {/* Remove */}
                <button
                  onClick={() => remove(pos.id)}
                  title="Close / remove"
                  className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      ) : !adding ? (
        <div
          onClick={openForm}
          className="flex items-center justify-center gap-2 h-9 rounded-md border border-dashed border-white/8 text-white/20 hover:border-white/20 hover:text-white/40 text-xs font-mono cursor-pointer transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Click to track a trade and see live P&amp;L
        </div>
      ) : null}
    </div>
  );
}
