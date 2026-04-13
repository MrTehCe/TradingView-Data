import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { X, Plus, TrendingUp, TrendingDown, Pencil, Check, AlertTriangle, RotateCcw } from 'lucide-react';
import { KNOWN_SYMBOLS } from '@/components/symbol-selector';
import { type Position, type AccountSettings, pnlDollars, pnlPoints } from '@/hooks/use-positions';

const POINT_VALUE: Record<string, number> = Object.fromEntries(KNOWN_SYMBOLS.map(s => [s.display, s.pointValue]));

function elapsed(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
export function fmtMoney(n: number, forceSign = false) {
  const sign = forceSign && n > 0 ? '+' : '';
  return sign + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

// ── Editable number ───────────────────────────────────────────────────────────
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
  const currentEquity = acct.balance + totalPnl;
  const barColor = breached ? 'bg-red-500' : warning ? 'bg-amber-400' : 'bg-emerald-500/70';

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2 rounded-md border font-mono text-xs mb-2',
      breached ? 'bg-red-950/30 border-red-500/30'
      : warning ? 'bg-amber-950/20 border-amber-500/20'
      : 'bg-[#090910] border-[#181825]'
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
          {fmtMoney(currentEquity)}
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
          <button
            onClick={() => { if (confirm('Reset realized P&L and trade history for a new session?')) onUpdate({ realizedPnl: 0, closedTrades: [] }); }}
            className="flex items-center gap-1 text-[10px] text-white/20 hover:text-amber-400/70 border border-white/8 hover:border-amber-400/30 rounded px-1.5 py-0.5 transition-colors"
          >
            <RotateCcw className="w-2.5 h-2.5" /> Reset
          </button>
        )}
      </div>
    </div>
  );
}

// ── Editable price level badge (SL / TP on position card) ────────────────────
function LevelBadge({
  label, price, onSet, onClear, color,
  pnl,
}: {
  label: string; price: number | null; onSet: (v: number) => void; onClear: () => void;
  color: 'red' | 'green'; pnl?: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw]         = useState('');
  const ref                   = useRef<HTMLInputElement>(null);

  function start(defaultVal: number) {
    setRaw(defaultVal.toFixed(2));
    setEditing(true);
    setTimeout(() => ref.current?.select(), 20);
  }
  function commit() {
    const v = parseFloat(raw);
    if (!isNaN(v) && v > 0) onSet(v);
    setEditing(false);
  }

  const cl = color === 'red'
    ? 'border-red-500/30 text-red-400/80 hover:border-red-500/60 hover:text-red-300'
    : 'border-emerald-500/30 text-emerald-400/80 hover:border-emerald-500/60 hover:text-emerald-300';

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono">
        <span className={cn('text-[9px] uppercase tracking-widest', color === 'red' ? 'text-red-400/60' : 'text-emerald-400/60')}>{label}</span>
        <input ref={ref} type="number" step="0.25" value={raw}
          onChange={e => setRaw(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          onBlur={commit}
          className="w-20 bg-[#111] border border-white/20 rounded px-1.5 py-0.5 text-white font-mono text-[10px] text-center outline-none" />
      </span>
    );
  }

  if (price == null) {
    return (
      <button
        onClick={() => start(0)}
        className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors text-white/20 border-white/10 hover:text-white/50 hover:border-white/20')}
      >
        + {label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        onClick={() => start(price)}
        className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded-l border-y border-l transition-colors', cl)}
      >
        <span className="text-[9px] opacity-60 mr-0.5">{label}</span>
        {price.toFixed(2)}
        {pnl != null && (
          <span className={cn('ml-1 text-[9px]', pnl >= 0 ? 'text-emerald-400/60' : 'text-red-400/60')}>
            {fmtMoney(pnl, true)}
          </span>
        )}
      </button>
      <button onClick={onClear}
        className={cn('px-1 py-0.5 rounded-r border transition-colors text-white/20 hover:text-white/50', color === 'red' ? 'border-red-500/20 hover:border-red-500/40' : 'border-emerald-500/20 hover:border-emerald-500/40')}>
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
interface Props {
  currentPrices: Record<string, number | null>;
  positions: Position[];
  acct: AccountSettings;
  onAddPosition: (sym: string, side: 'L' | 'S', qty: number, entry: number) => void;
  onClosePosition: (id: string) => void;
  onUpdatePosition: (id: string, patch: Partial<Pick<Position, 'sl' | 'tp' | 'qty' | 'entry'>>) => void;
  onUpdateAcct: (patch: Partial<AccountSettings>) => void;
}

export function PositionsPanel({ currentPrices, positions = [], acct, onAddPosition, onClosePosition, onUpdatePosition, onUpdateAcct }: Props) {
  const [adding, setAdding] = useState(false);
  const [sym,   setSym]     = useState<string>('MES');
  const [side,  setSide]    = useState<'L' | 'S'>('L');
  const [qty,   setQty]     = useState('1');
  const [entry, setEntry]   = useState('');
  const entryRef            = useRef<HTMLInputElement>(null);

  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id); }, []);

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
    onAddPosition(sym, side, q, e);
    setAdding(false);
  }

  const unrealizedPnl = positions.reduce((sum, pos) => {
    const px = currentPrices[pos.symbol];
    return px != null ? sum + pnlDollars(pos, px) : sum;
  }, 0);

  return (
    <div className="shrink-0">
      <AccountBar unrealizedPnl={unrealizedPnl} acct={acct} onUpdate={onUpdateAcct} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-1.5">
        <span className="text-[10px] font-mono tracking-[0.2em] text-white/20 uppercase">Positions</span>
        {positions.length > 0 && (
          <div className={cn(
            'flex items-center gap-1.5 px-2 py-0.5 rounded font-mono font-bold text-sm tabular-nums',
            unrealizedPnl >= 0
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
          )}>
            {unrealizedPnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {fmtMoney(unrealizedPnl, true)} open
          </div>
        )}
        {acct.closedTrades.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] font-mono text-white/25">
            {acct.closedTrades.length} closed ·
            <span className={acct.realizedPnl >= 0 ? 'text-emerald-400/70' : 'text-purple-400/70'}>
              {fmtMoney(acct.realizedPnl, true)} realized
            </span>
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

      {/* Add form */}
      {adding && (
        <div className="flex flex-wrap items-center gap-2 mb-2 px-3 py-2 bg-[#0d0d1a] border border-[#222235] rounded-md">
          <select value={sym} onChange={e => setSym(e.target.value)}
            className="bg-[#0d0d1a] border border-[#2a2a3e] rounded px-2 py-1 text-white font-mono text-xs outline-none cursor-pointer">
            {KNOWN_SYMBOLS.map(s => <option key={s.tv} value={s.display}>{s.display} — {s.desc}</option>)}
          </select>
          <div className="flex rounded overflow-hidden border border-[#2a2a3e] text-xs font-mono">
            <button onClick={() => setSide('L')} className={cn('px-3 py-1 transition-colors', side === 'L' ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'text-white/25 hover:text-white/50')}>Long</button>
            <button onClick={() => setSide('S')} className={cn('px-3 py-1 transition-colors', side === 'S' ? 'bg-purple-500/20 text-purple-300 font-bold' : 'text-white/25 hover:text-white/50')}>Short</button>
          </div>
          <label className="flex items-center gap-1.5 text-xs font-mono text-white/30">
            Contracts
            <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
              className="w-14 bg-black border border-[#2a2a3e] rounded px-2 py-1 text-white font-mono text-xs text-center outline-none focus:border-white/30" />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-mono text-white/30">
            Entry @
            <input ref={entryRef} type="number" step="0.25" value={entry}
              onChange={e => setEntry(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              className="w-24 bg-black border border-[#2a2a3e] rounded px-2 py-1 text-white font-mono text-xs text-center outline-none focus:border-white/30" />
          </label>
          {(() => {
            const px = currentPrices[sym];
            if (px == null) return null;
            const e2 = parseFloat(entry);
            if (isNaN(e2)) return null;
            const fakePos: Position = { id: '', symbol: sym, side, qty: Math.max(1, parseInt(qty)||1), entry: e2, openedAt: 0, sl: null, tp: null };
            const preview = pnlDollars(fakePos, px);
            return <span className={cn('text-xs font-mono tabular-nums', preview >= 0 ? 'text-emerald-400/60' : 'text-purple-400/60')}>now: {fmtMoney(preview, true)}</span>;
          })()}
          <button onClick={submit}
            className="px-4 py-1 bg-white text-black text-xs font-mono font-bold rounded hover:bg-gray-200 transition-colors ml-1">
            Add
          </button>
        </div>
      )}

      {/* Position cards */}
      {positions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {positions.map(pos => {
            const px  = currentPrices[pos.symbol];
            const has = px != null;
            const pnl = has ? pnlDollars(pos, px!) : null;
            const pts = has ? pnlPoints(pos, px!) : null;
            const win = pnl !== null && pnl >= 0;
            const pv  = POINT_VALUE[pos.symbol] ?? 1;
            const slPnl = pos.sl != null && pv ? pnlDollars(pos, pos.sl) : null;
            const tpPnl = pos.tp != null && pv ? pnlDollars(pos, pos.tp) : null;

            return (
              <div key={pos.id} className={cn(
                'relative group flex flex-col gap-1 rounded-md px-3 py-2 border text-xs font-mono',
                win ? 'bg-emerald-950/30 border-emerald-500/20'
                  : pnl !== null ? 'bg-purple-950/20 border-purple-500/15'
                  : 'bg-white/3 border-white/8'
              )}>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-white/40 text-[10px] tracking-widest">{pos.symbol}</span>
                    <span className={cn('font-bold text-sm', pos.side === 'L' ? 'text-emerald-400' : 'text-purple-400')}>
                      {pos.side === 'L' ? '▲ Long' : '▼ Short'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 text-white/40">
                    <span className="text-[10px]">{pos.qty}×</span>
                    <span>@ {pos.entry.toFixed(2)}</span>
                  </div>
                  {has && <><span className="text-white/15">→</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-white/25">now</span>
                    <span className="text-white/70">{px!.toFixed(2)}</span>
                  </div></>}
                  {pnl !== null && pts !== null && (
                    <div className={cn('flex flex-col gap-0.5 text-right ml-1', win ? 'text-emerald-400' : 'text-purple-400')}>
                      <span className="text-[10px] opacity-50">{pts >= 0 ? '+' : ''}{pts.toFixed(2)} pts</span>
                      <span className="font-bold text-base tabular-nums">{fmtMoney(pnl, true)}</span>
                    </div>
                  )}
                  <span className="text-white/15 text-[10px] ml-1">{elapsed(pos.openedAt)}</span>
                  <button onClick={() => onClosePosition(pos.id)} title="Close trade & bank P&L"
                    className="ml-2 flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-all border-white/10 text-white/30 hover:text-white hover:border-white/30">
                    <X className="w-2.5 h-2.5" /> Close
                  </button>
                </div>

                {/* SL / TP badges */}
                <div className="flex items-center gap-2 mt-0.5">
                  <LevelBadge
                    label="SL" price={pos.sl} color="red"
                    pnl={slPnl}
                    onSet={v => onUpdatePosition(pos.id, { sl: v })}
                    onClear={() => onUpdatePosition(pos.id, { sl: null })}
                  />
                  <LevelBadge
                    label="TP" price={pos.tp} color="green"
                    pnl={tpPnl}
                    onSet={v => onUpdatePosition(pos.id, { tp: v })}
                    onClear={() => onUpdatePosition(pos.id, { tp: null })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : !adding ? (
        <div onClick={openForm}
          className="flex items-center justify-center gap-2 h-8 rounded-md border border-dashed border-white/8 text-white/15 hover:border-white/20 hover:text-white/35 text-xs font-mono cursor-pointer transition-colors">
          <Plus className="w-3 h-3" /> Click to track a trade and see live P&L
        </div>
      ) : null}

      {/* Closed trades */}
      {acct.closedTrades.length > 0 && (
        <div className="mt-2 space-y-0.5">
          <div className="text-[10px] font-mono tracking-widest text-white/15 uppercase mb-1">Closed Trades</div>
          {[...acct.closedTrades].reverse().map(t => (
            <div key={t.id} className={cn(
              'flex items-center gap-3 px-2.5 py-1 rounded text-[11px] font-mono border',
              t.pnl >= 0 ? 'bg-emerald-950/15 border-emerald-500/10' : 'bg-purple-950/10 border-purple-500/8'
            )}>
              <span className="text-white/30">{t.symbol}</span>
              <span className={t.side === 'L' ? 'text-emerald-400/60' : 'text-purple-400/60'}>{t.side === 'L' ? '▲' : '▼'} {t.qty}×</span>
              <span className="text-white/25">{t.entry.toFixed(2)} → {t.exit.toFixed(2)}</span>
              <span className={cn('font-bold ml-auto tabular-nums', t.pnl >= 0 ? 'text-emerald-400' : 'text-purple-400')}>
                {fmtMoney(t.pnl, true)}
              </span>
              <span className="text-white/15 text-[10px]">{new Date(t.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
