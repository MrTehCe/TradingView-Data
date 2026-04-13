import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { X, Plus, TrendingUp, TrendingDown, Pencil, Check, AlertTriangle, RotateCcw, ChevronDown } from 'lucide-react';
import { KNOWN_SYMBOLS } from '@/components/symbol-selector';
import { type Position, type AccountSettings, pnlDollars, pnlPoints, netPnlDollars, totalFees } from '@/hooks/use-positions';

const POINT_VALUE: Record<string, number> = Object.fromEntries(KNOWN_SYMBOLS.map(s => [s.display, s.pointValue]));

function elapsed(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
function fmtMoney(n: number, forceSign = false) {
  const sign = forceSign && n > 0 ? '+' : '';
  return sign + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

// ── Inline editable number ────────────────────────────────────────────────────
function EditableNumber({ value, onChange, prefix = '', suffix = '', step = 1, min = 0, decimals = 0 }: {
  value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; step?: number; min?: number; decimals?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw]         = useState('');
  const ref                   = useRef<HTMLInputElement>(null);
  function start() { setRaw(value.toFixed(decimals)); setEditing(true); setTimeout(() => ref.current?.select(), 20); }
  function commit() { const v = parseFloat(raw); if (!isNaN(v) && v >= min) onChange(v); setEditing(false); }
  if (editing) return (
    <span className="inline-flex items-center gap-1">
      {prefix && <span className="text-white/30">{prefix}</span>}
      <input ref={ref} type="number" step={step} min={min} value={raw}
        onChange={e => setRaw(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        onBlur={commit}
        className="w-20 bg-[#111] border border-white/20 rounded px-1.5 py-0.5 text-white font-mono text-xs text-center outline-none" />
      {suffix && <span className="text-white/30">{suffix}</span>}
      <button onClick={commit} className="text-emerald-400/60 hover:text-emerald-400"><Check className="w-3 h-3" /></button>
    </span>
  );
  return (
    <button onClick={start} className="inline-flex items-center gap-0.5 group hover:text-white transition-colors" title="Click to edit">
      {prefix && <span>{prefix}</span>}
      <span className="border-b border-dashed border-white/15 group-hover:border-white/40">{value.toFixed(decimals)}</span>
      {suffix && <span>{suffix}</span>}
      <Pencil className="w-2 h-2 opacity-0 group-hover:opacity-40 ml-0.5" />
    </button>
  );
}

// ── SL / TP level badge ───────────────────────────────────────────────────────
function LevelBadge({ label, price, onSet, onClear, color, pnl }: {
  label: string; price: number | null; onSet: (v: number) => void; onClear: () => void;
  color: 'red' | 'green'; pnl?: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw]         = useState('');
  const ref                   = useRef<HTMLInputElement>(null);
  function start(defaultVal: number) { setRaw(defaultVal.toFixed(2)); setEditing(true); setTimeout(() => ref.current?.select(), 20); }
  function commit() { const v = parseFloat(raw); if (!isNaN(v) && v > 0) onSet(v); setEditing(false); }
  const cl = color === 'red'
    ? 'border-red-500/30 text-red-400/80 hover:border-red-500/60 hover:text-red-300'
    : 'border-emerald-500/30 text-emerald-400/80 hover:border-emerald-500/60 hover:text-emerald-300';
  if (editing) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono">
      <span className={cn('text-[9px] uppercase tracking-widest', color === 'red' ? 'text-red-400/60' : 'text-emerald-400/60')}>{label}</span>
      <input ref={ref} type="number" step="0.25" value={raw}
        onChange={e => setRaw(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        onBlur={commit}
        className="w-20 bg-[#111] border border-white/20 rounded px-1.5 py-0.5 text-white font-mono text-[10px] text-center outline-none" />
    </span>
  );
  if (price == null) return (
    <button onClick={() => start(0)}
      className="text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors text-white/20 border-white/10 hover:text-white/50 hover:border-white/20">
      + {label}
    </button>
  );
  return (
    <span className="inline-flex items-center gap-0.5">
      <button onClick={() => start(price)} className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded-l border-y border-l transition-colors', cl)}>
        <span className="text-[9px] opacity-60 mr-0.5">{label}</span>{price.toFixed(2)}
        {pnl != null && <span className={cn('ml-1 text-[9px]', pnl >= 0 ? 'text-emerald-400/60' : 'text-red-400/60')}>{fmtMoney(pnl, true)}</span>}
      </button>
      <button onClick={onClear}
        className={cn('px-1 py-0.5 rounded-r border transition-colors text-white/20 hover:text-white/50', color === 'red' ? 'border-red-500/20 hover:border-red-500/40' : 'border-emerald-500/20 hover:border-emerald-500/40')}>
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

// ── Floating overlay window ───────────────────────────────────────────────────
function FloatingWindow({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[88px] px-3" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[70vh] bg-[#08080f] border border-[#1e1e2e] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#141420] shrink-0">
          <span className="text-[11px] font-mono tracking-[0.2em] text-white/40 uppercase">{title}</span>
          <button onClick={onClose} className="text-white/20 hover:text-white/60 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-3">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Account bar ───────────────────────────────────────────────────────────────
function AccountBar({ unrealizedPnl, acct, onUpdate }: {
  unrealizedPnl: number;
  acct: AccountSettings;
  onUpdate: (patch: Partial<AccountSettings>) => void;
}) {
  const totalPnl     = acct.realizedPnl + unrealizedPnl;
  const maxLoss      = acct.balance * (acct.drawdownPct / 100);
  const drawdownUsed = Math.max(0, -totalPnl);
  const remaining    = maxLoss - drawdownUsed;
  const pct          = Math.min(1, drawdownUsed / maxLoss);
  const breached     = remaining <= 0;
  const warning      = pct >= 0.75 && !breached;
  const barColor     = breached ? 'bg-red-500' : warning ? 'bg-amber-400' : 'bg-emerald-500/70';

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2 rounded-md border font-mono text-xs mb-2',
      breached ? 'bg-red-950/30 border-red-500/30' : warning ? 'bg-amber-950/20 border-amber-500/20' : 'bg-[#090910] border-[#181825]'
    )}>
      <div className="flex items-center gap-1.5 text-white/40">
        <span className="text-[10px] tracking-widest uppercase text-white/20">Account</span>
        <EditableNumber value={acct.balance} onChange={v => onUpdate({ balance: v })} prefix="$" step={1000} min={1000} />
      </div>
      <div className="flex items-center gap-1.5 text-white/40">
        <span className="text-[10px] uppercase tracking-widest text-white/20">Max DD</span>
        <EditableNumber value={acct.drawdownPct} onChange={v => onUpdate({ drawdownPct: Math.max(0.1, Math.min(50, v)) })} suffix="%" step={0.5} min={0.1} decimals={1} />
        <span className="text-white/25">= {fmtMoney(-maxLoss)}</span>
      </div>
      <div className="flex items-center gap-1.5 text-white/40" title="Per-contract per-side commission (exchange + NFA + clearing). $0.37 = typical CME micro rate.">
        <span className="text-[10px] uppercase tracking-widest text-white/20">Fee/side</span>
        <EditableNumber value={acct.feePerSide} onChange={v => onUpdate({ feePerSide: Math.max(0, v) })} prefix="$" step={0.01} min={0} decimals={2} />
      </div>
      {acct.realizedPnl !== 0 && (
        <div className={cn('flex items-center gap-1.5', acct.realizedPnl >= 0 ? 'text-emerald-400' : 'text-purple-400')}>
          <span className="text-[10px] uppercase tracking-widest text-white/20">Realized</span>
          <span className="font-bold">{fmtMoney(acct.realizedPnl, true)}</span>
        </div>
      )}
      {unrealizedPnl !== 0 && (
        <div className={cn('flex items-center gap-1.5', unrealizedPnl >= 0 ? 'text-emerald-400/70' : 'text-purple-400/70')}>
          <span className="text-[10px] uppercase tracking-widest text-white/20">Open</span>
          <span>{fmtMoney(unrealizedPnl, true)}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-white/20">Equity</span>
        <span className={cn('font-bold', totalPnl > 0 ? 'text-emerald-400' : totalPnl < 0 ? 'text-purple-400' : 'text-white/50')}>
          {fmtMoney(acct.balance + totalPnl)}
        </span>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        {breached ? (
          <span className="flex items-center gap-1 text-red-400 font-bold animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5" /> DRAWDOWN BREACHED
          </span>
        ) : (
          <span className={cn('text-xs', warning ? 'text-amber-400' : 'text-white/30')}>
            {warning && <AlertTriangle className="w-3 h-3 inline mr-1" />}
            Buffer: <span className={cn('font-bold', warning ? 'text-amber-300' : 'text-white/60')}>{fmtMoney(remaining)}</span>
          </span>
        )}
        <div className="w-28 h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/8">
          <div className={cn('h-full rounded-full transition-all duration-300', barColor)} style={{ width: `${pct * 100}%` }} />
        </div>
        <span className={cn('text-[10px] tabular-nums w-7 text-right', breached ? 'text-red-400' : warning ? 'text-amber-400' : 'text-white/25')}>
          {(pct * 100).toFixed(0)}%
        </span>
        {(acct.realizedPnl !== 0 || acct.closedTrades.length > 0) && (
          <button onClick={() => { if (confirm('Reset realized P&L and trade history?')) onUpdate({ realizedPnl: 0, closedTrades: [] }); }}
            className="flex items-center gap-1 text-[10px] text-white/20 hover:text-amber-400/70 border border-white/8 hover:border-amber-400/30 rounded px-1.5 py-0.5 transition-colors">
            <RotateCcw className="w-2.5 h-2.5" /> Reset
          </button>
        )}
      </div>
    </div>
  );
}

// ── Position card ─────────────────────────────────────────────────────────────
function PositionCard({ pos, px, feePerSide, onClose, onUpdate, onScaleIn }: {
  pos: Position;
  px: number | null;
  feePerSide: number;
  onClose: () => void;
  onUpdate: (patch: Partial<Pick<Position, 'sl' | 'tp' | 'qty' | 'entry'>>) => void;
  onScaleIn: (addQty: number, addPrice: number) => void;
}) {
  const [, setTick]        = useState(0);
  const [addingMore, setAddingMore] = useState(false);
  const [addQty, setAddQty]         = useState('1');
  const [addPrice, setAddPrice]     = useState('');
  const addPriceRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id); }, []);

  function openAddMore() {
    setAddPrice(px != null ? px.toFixed(2) : pos.entry.toFixed(2));
    setAddQty('1');
    setAddingMore(true);
    setTimeout(() => addPriceRef.current?.select(), 30);
  }
  function commitAddMore() {
    const q = Math.max(1, parseInt(addQty, 10) || 1);
    const p = parseFloat(addPrice);
    if (!isNaN(p) && p > 0) onScaleIn(q, p);
    setAddingMore(false);
  }

  const has        = px != null;
  const grossPnl   = has ? pnlDollars(pos, px!) : null;
  const netPnl     = has ? netPnlDollars(pos, px!, feePerSide) : null;
  const pts        = has ? pnlPoints(pos, px!) : null;
  const roundFees  = totalFees(pos, feePerSide);   // projected total fees at close
  const win        = netPnl !== null && netPnl >= 0;

  // SL/TP badges show net P&L at that level
  const slNet  = pos.sl != null ? pnlDollars(pos, pos.sl)  - roundFees : null;
  const tpNet  = pos.tp != null ? pnlDollars(pos, pos.tp)  - roundFees : null;

  // Weighted-average + new fee preview during add-more form
  const addPreview = (() => {
    const q = Math.max(1, parseInt(addQty, 10) || 1);
    const p = parseFloat(addPrice);
    if (isNaN(p)) return null;
    const avgEntry   = (pos.entry * pos.qty + p * q) / (pos.qty + q);
    const newEntryFees = pos.entryFees + feePerSide * q;
    return { avgEntry, newEntryFees };
  })();

  return (
    <div className={cn(
      'group flex flex-col gap-2 rounded-lg px-4 py-3 border text-xs font-mono',
      win ? 'bg-emerald-950/30 border-emerald-500/20' : netPnl !== null ? 'bg-purple-950/20 border-purple-500/15' : 'bg-white/3 border-white/8'
    )}>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex flex-col gap-0.5 min-w-[56px]">
          <span className="text-white/35 text-[10px] tracking-widest">{pos.symbol}</span>
          <span className={cn('font-bold text-sm', pos.side === 'L' ? 'text-emerald-400' : 'text-purple-400')}>
            {pos.side === 'L' ? '▲ Long' : '▼ Short'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 text-white/40">
          <span className="text-[10px]">{pos.qty}× contracts</span>
          <span>Avg entry @ <span className="text-white/60">{pos.entry.toFixed(2)}</span></span>
        </div>
        {has && (
          <div className="flex flex-col gap-0.5 text-white/40">
            <span className="text-[10px]">now</span>
            <span className="text-white/70">{px!.toFixed(2)}</span>
          </div>
        )}
        {netPnl !== null && pts !== null && grossPnl !== null && (
          <div className={cn('flex flex-col gap-0.5 text-right ml-auto', win ? 'text-emerald-400' : 'text-purple-400')}>
            <span className="text-[10px] opacity-50 tabular-nums">
              {pts >= 0 ? '+' : ''}{pts.toFixed(2)} pts
              <span className="text-white/20 ml-1.5">gross {fmtMoney(grossPnl, true)}</span>
            </span>
            <span className="font-bold text-base tabular-nums">{fmtMoney(netPnl, true)}</span>
            <span className="text-[9px] text-white/20 tabular-nums">−{fmtMoney(roundFees)} fees</span>
          </div>
        )}
        <span className="text-white/15 text-[10px]">{elapsed(pos.openedAt)}</span>
        <button onClick={openAddMore}
          className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono border-white/8 text-white/25 hover:text-cyan-400 hover:border-cyan-500/30 transition-all">
          <Plus className="w-2.5 h-2.5" /> Add
        </button>
        <button onClick={onClose}
          className="flex items-center gap-1 px-2.5 py-1 rounded border text-[10px] font-mono border-white/10 text-white/30 hover:text-red-400 hover:border-red-500/30 transition-all">
          <X className="w-2.5 h-2.5" /> Close & bank
        </button>
      </div>

      {/* Scale-in form */}
      {addingMore && (
        <div className="flex items-center gap-2 px-2 py-2 bg-white/3 rounded border border-white/8">
          <span className="text-white/30 text-[10px] shrink-0">Add contracts:</span>
          <input type="number" min="1" value={addQty} onChange={e => setAddQty(e.target.value)}
            className="w-12 bg-black border border-white/15 rounded px-1.5 py-0.5 text-white font-mono text-[10px] text-center outline-none focus:border-white/30" />
          <span className="text-white/20 text-[10px]">@ price</span>
          <input ref={addPriceRef} type="number" step="0.25" value={addPrice}
            onChange={e => setAddPrice(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitAddMore(); if (e.key === 'Escape') setAddingMore(false); }}
            className="w-24 bg-black border border-white/15 rounded px-1.5 py-0.5 text-white font-mono text-[10px] text-center outline-none focus:border-white/30" />
          {addPreview !== null && (
            <span className="text-white/30 text-[10px]">
              → avg <span className="text-cyan-400">{addPreview.avgEntry.toFixed(2)}</span>
              <span className="text-white/20 ml-1.5">entry fees −{fmtMoney(addPreview.newEntryFees)}</span>
            </span>
          )}
          <button onClick={commitAddMore} className="px-2.5 py-0.5 bg-white/10 hover:bg-white/20 text-white text-[10px] font-mono rounded transition-colors">Confirm</button>
          <button onClick={() => setAddingMore(false)} className="text-white/20 hover:text-white/50 transition-colors"><X className="w-3 h-3" /></button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-white/20 text-[10px] mr-1">Levels:</span>
        <LevelBadge label="SL" price={pos.sl} color="red" pnl={slNet} onSet={v => onUpdate({ sl: v })} onClear={() => onUpdate({ sl: null })} />
        <LevelBadge label="TP" price={pos.tp} color="green" pnl={tpNet} onSet={v => onUpdate({ tp: v })} onClear={() => onUpdate({ tp: null })} />
        <span className="text-white/10 text-[9px] ml-auto">drag lines on chart to adjust</span>
      </div>
    </div>
  );
}

// ── Add trade form ────────────────────────────────────────────────────────────
function AddTradeForm({ currentPrices, onAdd, onClose }: {
  currentPrices: Record<string, number | null>;
  onAdd: (sym: string, side: 'L' | 'S', qty: number, entry: number) => void;
  onClose: () => void;
}) {
  const [sym,   setSym]   = useState<string>('MES');
  const [side,  setSide]  = useState<'L' | 'S'>('L');
  const [qty,   setQty]   = useState('1');
  const [entry, setEntry] = useState(() => (currentPrices['MES'] ?? 0).toFixed(2));
  const entryRef          = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const px = currentPrices[sym];
    if (px != null) setEntry(px.toFixed(2));
  }, [sym, currentPrices]);

  useEffect(() => { setTimeout(() => entryRef.current?.select(), 50); }, []);

  function submit() {
    const e = parseFloat(entry), q = Math.max(1, parseInt(qty, 10) || 1);
    if (isNaN(e)) return;
    onAdd(sym, side, q, e);
    onClose();
  }

  const px = currentPrices[sym];
  const e2 = parseFloat(entry);
  const preview = !isNaN(e2) && px != null
    ? pnlDollars({ id: '', symbol: sym, side, qty: Math.max(1, parseInt(qty) || 1), entry: e2, openedAt: 0, sl: null, tp: null, entryFees: 0 }, px)
    : null;

  return (
    <div className="flex flex-wrap items-end gap-3 p-4 bg-[#0b0b16] border border-[#1e1e2e] rounded-lg">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-mono text-white/25 uppercase tracking-widest">Symbol</label>
        <select value={sym} onChange={e => setSym(e.target.value)}
          className="bg-[#0d0d1a] border border-[#2a2a3e] rounded px-2 py-1.5 text-white font-mono text-xs outline-none cursor-pointer">
          {KNOWN_SYMBOLS.map(s => <option key={s.tv} value={s.display}>{s.display} — {s.desc}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-mono text-white/25 uppercase tracking-widest">Side</label>
        <div className="flex rounded overflow-hidden border border-[#2a2a3e] text-xs font-mono">
          <button onClick={() => setSide('L')} className={cn('px-4 py-1.5 transition-colors', side === 'L' ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'text-white/25 hover:text-white/50')}>Long</button>
          <button onClick={() => setSide('S')} className={cn('px-4 py-1.5 transition-colors', side === 'S' ? 'bg-purple-500/20 text-purple-300 font-bold' : 'text-white/25 hover:text-white/50')}>Short</button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-mono text-white/25 uppercase tracking-widest">Contracts</label>
        <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
          className="w-16 bg-black border border-[#2a2a3e] rounded px-2 py-1.5 text-white font-mono text-xs text-center outline-none focus:border-white/30" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-mono text-white/25 uppercase tracking-widest">Entry Price</label>
        <input ref={entryRef} type="number" step="0.25" value={entry}
          onChange={e => setEntry(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
          className="w-28 bg-black border border-[#2a2a3e] rounded px-2 py-1.5 text-white font-mono text-xs text-center outline-none focus:border-white/30" />
      </div>
      {preview !== null && (
        <div className={cn('flex flex-col gap-0.5', preview >= 0 ? 'text-emerald-400/60' : 'text-purple-400/60')}>
          <label className="text-[10px] font-mono text-white/25 uppercase tracking-widest">Currently</label>
          <span className="text-xs font-mono font-bold">{fmtMoney(preview, true)}</span>
        </div>
      )}
      <button onClick={submit} className="px-5 py-1.5 bg-white text-black text-xs font-mono font-bold rounded hover:bg-gray-200 transition-colors">
        Add Position
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  currentPrices: Record<string, number | null>;
  positions: Position[];
  acct: AccountSettings;
  onAddPosition: (sym: string, side: 'L' | 'S', qty: number, entry: number) => void;
  onScaleIn: (id: string, addQty: number, addPrice: number) => void;
  onClosePosition: (id: string) => void;
  onUpdatePosition: (id: string, patch: Partial<Pick<Position, 'sl' | 'tp' | 'qty' | 'entry'>>) => void;
  onUpdateAcct: (patch: Partial<AccountSettings>) => void;
}

export function PositionsPanel({ currentPrices, positions = [], acct, onAddPosition, onScaleIn, onClosePosition, onUpdatePosition, onUpdateAcct }: Props) {
  const [panel, setPanel] = useState<'positions' | 'history' | 'add' | null>(null);
  const close = useCallback(() => setPanel(null), []);

  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id); }, []);

  const unrealizedPnl = positions.reduce((sum, pos) => {
    const px = currentPrices[pos.symbol];
    return px != null ? sum + pnlDollars(pos, px) : sum;
  }, 0);

  const realizedPnl = acct.realizedPnl;
  const tradeCount  = acct.closedTrades.length;

  return (
    <div className="shrink-0">
      <AccountBar unrealizedPnl={unrealizedPnl} acct={acct} onUpdate={onUpdateAcct} />

      {/* Compact button row */}
      <div className="flex items-center gap-2 mb-2">
        {/* Open positions button */}
        <button
          onClick={() => setPanel(p => p === 'positions' ? null : 'positions')}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-mono transition-all',
            panel === 'positions'
              ? 'bg-white/8 border-white/20 text-white'
              : positions.length > 0
                ? unrealizedPnl >= 0
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15'
                  : 'bg-purple-500/10 border-purple-500/20 text-purple-400 hover:bg-purple-500/15'
                : 'border-white/8 text-white/25 hover:text-white/40 hover:border-white/15'
          )}
        >
          {positions.length > 0
            ? (unrealizedPnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />)
            : null}
          <span>
            {positions.length > 0
              ? `${positions.length} open · ${fmtMoney(unrealizedPnl, true)}`
              : 'Positions'}
          </span>
          <ChevronDown className={cn('w-3 h-3 transition-transform', panel === 'positions' && 'rotate-180')} />
        </button>

        {/* History button */}
        {tradeCount > 0 && (
          <button
            onClick={() => setPanel(p => p === 'history' ? null : 'history')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-mono transition-all',
              panel === 'history'
                ? 'bg-white/8 border-white/20 text-white'
                : realizedPnl >= 0
                  ? 'bg-emerald-500/8 border-emerald-500/15 text-emerald-400/70 hover:text-emerald-400'
                  : 'bg-purple-500/8 border-purple-500/15 text-purple-400/70 hover:text-purple-400'
            )}
          >
            <span>{tradeCount} closed · {fmtMoney(realizedPnl, true)}</span>
            <ChevronDown className={cn('w-3 h-3 transition-transform', panel === 'history' && 'rotate-180')} />
          </button>
        )}

        {/* Add trade button */}
        <button
          onClick={() => setPanel(p => p === 'add' ? null : 'add')}
          className={cn(
            'ml-auto flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded transition-all border',
            panel === 'add'
              ? 'bg-white/10 border-white/25 text-white'
              : 'bg-white/5 hover:bg-white/10 text-white/50 hover:text-white border-white/10 hover:border-white/20'
          )}
        >
          <Plus className="w-3 h-3" /> Open Position
        </button>
      </div>

      {/* ── Floating windows ── */}

      {panel === 'add' && (
        <FloatingWindow title="Open a New Position" onClose={close}>
          <AddTradeForm currentPrices={currentPrices} onAdd={onAddPosition} onClose={close} />
        </FloatingWindow>
      )}

      {panel === 'positions' && (
        <FloatingWindow title={`Open Positions  (${positions.length})`} onClose={close}>
          {positions.length === 0 ? (
            <div className="text-center text-white/20 text-xs font-mono py-8">No open positions</div>
          ) : (
            <div className="space-y-2">
              {positions.map(pos => (
                <PositionCard
                  key={pos.id}
                  pos={pos}
                  px={currentPrices[pos.symbol] ?? null}
                  feePerSide={acct.feePerSide}
                  onClose={() => onClosePosition(pos.id)}
                  onUpdate={patch => onUpdatePosition(pos.id, patch)}
                  onScaleIn={(addQty, addPrice) => onScaleIn(pos.id, addQty, addPrice)}
                />
              ))}
            </div>
          )}
        </FloatingWindow>
      )}

      {panel === 'history' && (
        <FloatingWindow title={`Closed Trades  (${tradeCount})`} onClose={close}>
          {tradeCount === 0 ? (
            <div className="text-center text-white/20 text-xs font-mono py-8">No closed trades yet</div>
          ) : (
            <div className="space-y-1">
              {[...acct.closedTrades].reverse().map(t => {
                const gross = t.grossPnl ?? t.pnl;
                const fees  = t.fees ?? 0;
                const net   = t.pnl;
                const pts   = ((t.exit - t.entry) * (t.side === 'L' ? 1 : -1) * t.qty);
                return (
                  <div key={t.id} className={cn(
                    'flex items-center gap-4 px-4 py-2.5 rounded-md border text-xs font-mono',
                    net >= 0 ? 'bg-emerald-950/20 border-emerald-500/15' : 'bg-purple-950/15 border-purple-500/10'
                  )}>
                    <span className="text-white/40 min-w-[36px]">{t.symbol}</span>
                    <span className={t.side === 'L' ? 'text-emerald-400/70' : 'text-purple-400/70'}>{t.side === 'L' ? '▲ Long' : '▼ Short'} {t.qty}×</span>
                    <span className="text-white/30">{t.entry.toFixed(2)} → {t.exit.toFixed(2)}</span>
                    <span className="text-white/25 text-[10px]">{pts >= 0 ? '+' : ''}{pts.toFixed(2)} pts</span>
                    <div className="flex flex-col items-end ml-auto gap-0">
                      <span className={cn('font-bold tabular-nums text-sm', net >= 0 ? 'text-emerald-400' : 'text-purple-400')}>
                        {fmtMoney(net, true)}
                      </span>
                      {fees > 0 && (
                        <span className="text-[9px] text-white/20 tabular-nums">
                          gross {fmtMoney(gross, true)} − fees {fmtMoney(fees)}
                        </span>
                      )}
                    </div>
                    <span className="text-white/20 text-[10px]">{new Date(t.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                );
              })}
              {/* Summary row */}
              <div className="flex items-center justify-end gap-3 px-4 pt-2 border-t border-white/5 mt-2">
                <span className="text-white/25 text-[10px] font-mono">{tradeCount} trades · net</span>
                <span className={cn('font-bold font-mono', acct.realizedPnl >= 0 ? 'text-emerald-400' : 'text-purple-400')}>
                  {fmtMoney(acct.realizedPnl, true)}
                </span>
              </div>
            </div>
          )}
        </FloatingWindow>
      )}
    </div>
  );
}
