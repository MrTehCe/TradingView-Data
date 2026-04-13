import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { X, Plus, ChevronDown, ChevronUp } from 'lucide-react';

// Contract specs: $ per point
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

const STORAGE_KEY = 'futures_monitor_positions';

function loadPositions(): Position[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Position[]) : [];
  } catch {
    return [];
  }
}

function savePositions(positions: Position[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

function calcPnl(pos: Position, currentPrice: number): number {
  const pv = POINT_VALUE[pos.symbol] ?? 1;
  const pts = pos.side === 'L' ? currentPrice - pos.entry : pos.entry - currentPrice;
  return pts * pos.qty * pv;
}

function fmtPts(pos: Position, currentPrice: number): string {
  const pts = pos.side === 'L' ? currentPrice - pos.entry : pos.entry - currentPrice;
  const sign = pts >= 0 ? '+' : '';
  return `${sign}${(pts * pos.qty).toFixed(2)}`;
}

function fmtDollar(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toFixed(0)}`;
}

function elapsed(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

interface AddFormProps {
  onAdd: (p: Omit<Position, 'id' | 'openedAt'>) => void;
  onCancel: () => void;
  currentPrices: Record<string, number | null>;
}

function AddForm({ onAdd, onCancel, currentPrices }: AddFormProps) {
  const [sym, setSym]   = useState<'MES' | 'MNQ'>('MES');
  const [side, setSide] = useState<'L' | 'S'>('L');
  const [qty, setQty]   = useState('1');
  const [entry, setEntry] = useState('');

  useEffect(() => {
    const price = currentPrices[sym];
    if (price !== null && price !== undefined) setEntry(price.toFixed(2));
  }, [sym, currentPrices]);

  function submit() {
    const entryNum = parseFloat(entry);
    const qtyNum   = parseInt(qty, 10);
    if (!isNaN(entryNum) && qtyNum > 0) {
      onAdd({ symbol: sym, side, qty: qtyNum, entry: entryNum });
    }
  }

  return (
    <div className="flex items-center gap-2 bg-[#0e0e1a] border border-[#2a2a40] rounded px-2 py-1.5 flex-wrap">
      {/* Symbol */}
      <div className="flex rounded overflow-hidden border border-[#252535] text-[11px] font-mono">
        {(['MES', 'MNQ'] as const).map(s => (
          <button key={s} onClick={() => setSym(s)}
            className={cn('px-2 py-0.5 transition-colors',
              sym === s ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60')}>
            {s}
          </button>
        ))}
      </div>

      {/* Side */}
      <div className="flex rounded overflow-hidden border border-[#252535] text-[11px] font-mono">
        <button onClick={() => setSide('L')}
          className={cn('px-2.5 py-0.5 transition-colors',
            side === 'L' ? 'bg-emerald-500/20 text-emerald-400' : 'text-white/30 hover:text-white/60')}>
          Long
        </button>
        <button onClick={() => setSide('S')}
          className={cn('px-2.5 py-0.5 transition-colors',
            side === 'S' ? 'bg-purple-500/20 text-purple-400' : 'text-white/30 hover:text-white/60')}>
          Short
        </button>
      </div>

      {/* Qty */}
      <div className="flex items-center gap-1 text-[11px] font-mono">
        <span className="text-white/30">qty</span>
        <input
          type="number" min="1" value={qty}
          onChange={e => setQty(e.target.value)}
          className="w-12 bg-black border border-[#252535] rounded px-1.5 py-0.5 text-white font-mono text-[11px] text-center outline-none focus:border-white/20"
        />
      </div>

      {/* Entry */}
      <div className="flex items-center gap-1 text-[11px] font-mono">
        <span className="text-white/30">@</span>
        <input
          type="number" step="0.25" value={entry}
          onChange={e => setEntry(e.target.value)}
          className="w-20 bg-black border border-[#252535] rounded px-1.5 py-0.5 text-white font-mono text-[11px] text-center outline-none focus:border-white/20"
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
      </div>

      <button onClick={submit}
        className="px-2.5 py-0.5 bg-white/10 hover:bg-white/15 text-white text-[11px] font-mono rounded transition-colors">
        Add
      </button>
      <button onClick={onCancel}
        className="text-white/25 hover:text-white/50 transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface Props {
  currentPrices: Record<string, number | null>;
}

export function PositionsPanel({ currentPrices }: Props) {
  const [positions, setPositions] = useState<Position[]>(loadPositions);
  const [adding, setAdding]       = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [tick, setTick]           = useState(0);

  // Re-render every second for elapsed time
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const addPosition = useCallback((p: Omit<Position, 'id' | 'openedAt'>) => {
    const newPos: Position = { ...p, id: Date.now().toString(), openedAt: Date.now() };
    setPositions(prev => {
      const next = [...prev, newPos];
      savePositions(next);
      return next;
    });
    setAdding(false);
  }, []);

  const removePosition = useCallback((id: string) => {
    setPositions(prev => {
      const next = prev.filter(p => p.id !== id);
      savePositions(next);
      return next;
    });
  }, []);

  // Total P&L
  const totalPnl = positions.reduce((sum, pos) => {
    const price = currentPrices[pos.symbol];
    if (price === null || price === undefined) return sum;
    return sum + calcPnl(pos, price);
  }, 0);

  const hasPositions = positions.length > 0;

  return (
    <div className="shrink-0 border border-[#141420] rounded-md bg-[#07070f] px-2.5 py-1.5">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-1.5 text-[11px] font-mono text-white/30 hover:text-white/60 transition-colors"
        >
          {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          <span>POSITIONS</span>
          {hasPositions && (
            <span className="text-white/20">({positions.length})</span>
          )}
        </button>

        {hasPositions && !collapsed && (
          <div className={cn('ml-2 text-[11px] font-mono font-bold tabular-nums',
            totalPnl >= 0 ? 'text-emerald-400' : 'text-purple-400')}>
            {fmtDollar(totalPnl)}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 text-[10px] font-mono text-white/25 hover:text-white/60 border border-[#1e1e30] hover:border-[#2e2e50] rounded px-1.5 py-0.5 transition-colors"
            >
              <Plus className="w-2.5 h-2.5" /> New
            </button>
          )}
        </div>
      </div>

      {/* Add form */}
      {adding && !collapsed && (
        <div className="mt-1.5">
          <AddForm
            onAdd={addPosition}
            onCancel={() => setAdding(false)}
            currentPrices={currentPrices}
          />
        </div>
      )}

      {/* Position rows */}
      {!collapsed && hasPositions && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {positions.map(pos => {
            const price = currentPrices[pos.symbol];
            const hasPx = price !== null && price !== undefined;
            const pnl   = hasPx ? calcPnl(pos, price!) : null;
            const pts   = hasPx ? fmtPts(pos, price!) : null;
            const isUp  = pnl !== null && pnl >= 0;

            return (
              <div key={pos.id}
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1 border text-[11px] font-mono group',
                  isUp
                    ? 'bg-emerald-500/5 border-emerald-500/15'
                    : 'bg-purple-500/5 border-purple-500/15'
                )}>
                {/* Symbol + side */}
                <span className="text-white/50">{pos.symbol}</span>
                <span className={cn('font-bold', pos.side === 'L' ? 'text-emerald-400' : 'text-purple-400')}>
                  {pos.side === 'L' ? 'Long' : 'Short'}
                </span>
                <span className="text-white/40">{pos.qty}×</span>

                {/* Entry */}
                <span className="text-white/30">@{pos.entry.toFixed(2)}</span>

                {/* Current price */}
                {hasPx && (
                  <span className="text-white/50">{price!.toFixed(2)}</span>
                )}

                {/* P&L */}
                {pnl !== null && (
                  <>
                    <span className={cn('tabular-nums', isUp ? 'text-emerald-400/80' : 'text-purple-400/80')}>
                      {pts} pts
                    </span>
                    <span className={cn('font-bold tabular-nums', isUp ? 'text-emerald-400' : 'text-purple-400')}>
                      {fmtDollar(pnl)}
                    </span>
                  </>
                )}

                {/* Elapsed */}
                <span className="text-white/20">{elapsed(pos.openedAt)}</span>

                {/* Close button */}
                <button
                  onClick={() => removePosition(pos.id)}
                  className="text-white/15 hover:text-red-400/70 transition-colors opacity-0 group-hover:opacity-100 ml-0.5"
                  title="Close position"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!collapsed && !hasPositions && !adding && (
        <div className="mt-1 text-[10px] font-mono text-white/15">
          No open positions — click New to add one.
        </div>
      )}
    </div>
  );
}
