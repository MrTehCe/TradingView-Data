import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { X, Plus, TrendingUp, TrendingDown, Pencil, Check, AlertTriangle } from 'lucide-react';

const POINT_VALUE: Record<string, number> = { MES: 5, MNQ: 2 };

export interface Position {
  id: string;
  symbol: 'MES' | 'MNQ';
  side: 'L' | 'S';
  qty: number;
  entry: number;
  openedAt: number;
}

interface AccountSettings {
  balance: number;
  drawdownPct: number;
}

const POS_KEY  = 'fm_positions_v2';
const ACCT_KEY = 'fm_account_v1';

function loadPos(): Position[] {
  try { return JSON.parse(localStorage.getItem(POS_KEY) ?? '[]'); } catch { return []; }
}
function savePos(p: Position[]) { localStorage.setItem(POS_KEY, JSON.stringify(p)); }

function loadAcct(): AccountSettings {
  try { return JSON.parse(localStorage.getItem(ACCT_KEY) ?? 'null') ?? { balance: 50000, drawdownPct: 2.5 }; }
  catch { return { balance: 50000, drawdownPct: 2.5 }; }
}
function saveAcct(a: AccountSettings) { localStorage.setItem(ACCT_KEY, JSON.stringify(a)); }

function pnlDollars(pos: Position, px: number) {
  return (pos.side === 'L' ? px - pos.entry : pos.entry - px) * pos.qty * (POINT_VALUE[pos.symbol] ?? 1);
}
function pnlPoints(pos: Position, px: number) {
  return (pos.side === 'L' ? px - pos.entry : pos.entry - px) * pos.qty;
}
function elapsed(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
function fmtMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

// ── Editable number field ─────────────────────────────────────────────────────
function EditableNumber({
  value, onChange, prefix = '', suffix = '', step = 1, min = 0, decimals = 0,
}: {
  value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; step?: number; min?: number; decimals?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw]         = useState('');
  const inputRef              = useRef<HTMLInputElement>(null);

  function start() {
    setRaw(value.toFixed(decimals));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 20);
  }
  function commit() {
    const v = parseFloat(raw);
    if (!isNaN(v) && v >= min) onChange(v);
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        {prefix && <span className="text-white/30">{prefix}</span>}
        <input
          ref={inputRef}
          type="number" step={step} min={min} value={raw}
          onChange={e => setRaw(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          onBlur={commit}
          className="w-24 bg-[#111] border border-white/20 rounded px-1.5 py-0.5 text-white font-mono text-xs text-center outline-none"
        />
        {suffix && <span className="text-white/30">{suffix}</span>}
        <button onClick={commit} className="text-emerald-400/60 hover:text-emerald-400 transition-colors">
          <Check className="w-3 h-3" />
        </button>
      </span>
    );
  }
  return (
    <button
      onClick={start}
      className="inline-flex items-center gap-1 group hover:text-white transition-colors"
      title="Click to edit"
    >
      {prefix && <span>{prefix}</span>}
      <span className="border-b border-dashed border-white/15 group-hover:border-white/40">{value.toFixed(decimals)}</span>
      {suffix && <span>{suffix}</span>}
      <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-40 ml-0.5" />
    </button>
  );
}

// ── Account bar ───────────────────────────────────────────────────────────────
function AccountBar({ totalPnl }: { totalPnl: number }) {
  const [acct, setAcct] = useState<AccountSettings>(loadAcct);

  function update(patch: Partial<AccountSettings>) {
    setAcct(prev => { const next = { ...prev, ...patch }; saveAcct(next); return next; });
  }

  const maxLoss      = acct.balance * (acct.drawdownPct / 100);
  const drawdownUsed = Math.max(0, -totalPnl);           // only counts if losing
  const remaining    = maxLoss - drawdownUsed;
  const pct          = Math.min(1, drawdownUsed / maxLoss);
  const breached     = remaining <= 0;
  const warning      = pct >= 0.75 && !breached;

  const barColor = breached ? 'bg-red-500'
    : warning    ? 'bg-amber-400'
    :              'bg-emerald-500/70';

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-md border font-mono text-xs mb-2',
      breached ? 'bg-red-950/30 border-red-500/30'
      : warning ? 'bg-amber-950/20 border-amber-500/20'
      :           'bg-[#090910] border-[#181825]'
    )}>
      {/* Balance */}
      <div className="flex items-center gap-1.5 text-white/40">
        <span className="text-[10px] tracking-widest uppercase text-white/20">Account</span>
        <span className="text-white/70">
          <EditableNumber
            value={acct.balance}
            onChange={v => update({ balance: v })}
            prefix="$"
            step={1000}
            min={1000}
          />
        </span>
      </div>

      {/* Drawdown % */}
      <div className="flex items-center gap-1.5 text-white/40">
        <span className="text-[10px] uppercase tracking-widest text-white/20">Max DD</span>
        <EditableNumber
          value={acct.drawdownPct}
          onChange={v => update({ drawdownPct: Math.max(0.1, Math.min(50, v)) })}
          suffix="%"
          step={0.5}
          min={0.1}
          decimals={1}
        />
        <span className="text-white/30">= {fmtMoney(-maxLoss)}</span>
      </div>

      {/* Unrealized P&L */}
      {totalPnl !== 0 && (
        <div className={cn('flex items-center gap-1', totalPnl >= 0 ? 'text-emerald-400' : 'text-purple-400')}>
          <span className="text-[10px] uppercase tracking-widest text-white/20">Open P&L</span>
          <span className="font-bold">{totalPnl >= 0 ? '+' : ''}{fmtMoney(totalPnl)}</span>
        </div>
      )}

      {/* Drawdown used / remaining */}
      <div className="flex items-center gap-2 ml-auto">
        {breached ? (
          <span className="flex items-center gap-1 text-red-400 font-bold animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5" /> DRAWDOWN BREACHED
          </span>
        ) : (
          <span className={cn('text-xs', warning ? 'text-amber-400' : 'text-white/30')}>
            {warning && <AlertTriangle className="w-3 h-3 inline mr-1" />}
            Buffer: <span className={cn('font-bold', warning ? 'text-amber-300' : 'text-white/60')}>
              {fmtMoney(remaining)}
            </span>
          </span>
        )}

        {/* Progress bar */}
        <div className="w-32 h-2 bg-white/5 rounded-full overflow-hidden border border-white/8">
          <div
            className={cn('h-full rounded-full transition-all duration-300', barColor)}
            style={{ width: `${pct * 100}%` }}
          />
        </div>
        <span className={cn('text-[10px] tabular-nums', breached ? 'text-red-400' : warning ? 'text-amber-400' : 'text-white/25')}>
          {(pct * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props { currentPrices: Record<string, number | null> }

export function PositionsPanel({ currentPrices }: Props) {
  const [positions, setPositions] = useState<Position[]>(loadPos);
  const [adding, setAdding]       = useState(false);

  const [sym,   setSym]   = useState<'MES' | 'MNQ'>('MES');
  const [side,  setSide]  = useState<'L' | 'S'>('L');
  const [qty,   setQty]   = useState('1');
  const [entry, setEntry] = useState('');
  const entryRef = useRef<HTMLInputElement>(null);

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
    const pos: Position = { id: Date.now().toString(), symbol: sym, side, qty: q, entry: e, openedAt: Date.now() };
    setPositions(prev => { const next = [...prev, pos]; savePos(next); return next; });
    setAdding(false);
  }

  function remove(id: string) {
    setPositions(prev => { const next = prev.filter(p => p.id !== id); savePos(next); return next; });
  }

  const totalPnl = positions.reduce((sum, pos) => {
    const px = currentPrices[pos.symbol];
    return px != null ? sum + pnlDollars(pos, px) : sum;
  }, 0);

  return (
    <div className="shrink-0">
      {/* Account tracker */}
      <AccountBar totalPnl={totalPnl} />

      {/* Positions header */}
      <div className="flex items-center gap-3 mb-1.5">
        <span className="text-[10px] font-mono tracking-[0.2em] text-white/20 uppercase">Positions</span>

        {positions.length > 0 && (
          <div className={cn(
            'flex items-center gap-1.5 px-2 py-0.5 rounded font-mono font-bold text-sm tabular-nums',
            totalPnl >= 0
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
          )}>
            {totalPnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {totalPnl >= 0 ? '+' : ''}{fmtMoney(totalPnl)}
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
          <div className="flex rounded overflow-hidden border border-[#2a2a3e] text-xs font-mono">
            {(['MES', 'MNQ'] as const).map(s => (
              <button key={s} onClick={() => setSym(s)}
                className={cn('px-3 py-1 transition-colors',
                  sym === s ? 'bg-white/10 text-white' : 'text-white/25 hover:text-white/50')}>
                {s}
              </button>
            ))}
          </div>

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

          <label className="flex items-center gap-1.5 text-xs font-mono text-white/30">
            Contracts
            <input type="number" min="1" value={qty}
              onChange={e => setQty(e.target.value)}
              className="w-14 bg-black border border-[#2a2a3e] rounded px-2 py-1 text-white font-mono text-xs text-center outline-none focus:border-white/30"
            />
          </label>

          <label className="flex items-center gap-1.5 text-xs font-mono text-white/30">
            Entry @
            <input ref={entryRef} type="number" step="0.25" value={entry}
              onChange={e => setEntry(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              className="w-24 bg-black border border-[#2a2a3e] rounded px-2 py-1 text-white font-mono text-xs text-center outline-none focus:border-white/30"
            />
          </label>

          {(() => {
            const px = currentPrices[sym];
            if (px == null) return null;
            const e2 = parseFloat(entry);
            if (isNaN(e2)) return null;
            const fake: Position = { id: '', symbol: sym, side, qty: Math.max(1, parseInt(qty)||1), entry: e2, openedAt: 0 };
            const preview = pnlDollars(fake, px);
            return (
              <span className={cn('text-xs font-mono tabular-nums', preview >= 0 ? 'text-emerald-400/60' : 'text-purple-400/60')}>
                now: {preview >= 0 ? '+' : ''}{fmtMoney(preview)}
              </span>
            );
          })()}

          <button onClick={submit}
            className="px-4 py-1 bg-white text-black text-xs font-mono font-bold rounded hover:bg-gray-200 transition-colors ml-1">
            Add
          </button>
        </div>
      )}

      {/* Position rows */}
      {positions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {positions.map(pos => {
            const px  = currentPrices[pos.symbol];
            const has = px != null;
            const pnl = has ? pnlDollars(pos, px!) : null;
            const pts = has ? pnlPoints(pos, px!) : null;
            const win = pnl !== null && pnl >= 0;

            return (
              <div key={pos.id}
                className={cn(
                  'relative group flex items-center gap-3 rounded-md px-3 py-2 border text-xs font-mono',
                  win ? 'bg-emerald-950/30 border-emerald-500/20'
                    : pnl !== null ? 'bg-purple-950/20 border-purple-500/15'
                    : 'bg-white/3 border-white/8'
                )}>
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
                {has && <span className="text-white/15">→</span>}
                {has && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-white/25">now</span>
                    <span className="text-white/70">{px!.toFixed(2)}</span>
                  </div>
                )}
                {pnl !== null && pts !== null && (
                  <div className={cn('flex flex-col gap-0.5 text-right ml-1', win ? 'text-emerald-400' : 'text-purple-400')}>
                    <span className="text-[10px] opacity-50">{pts >= 0 ? '+' : ''}{pts.toFixed(2)} pts</span>
                    <span className="font-bold text-base tabular-nums">{win ? '+' : ''}{fmtMoney(pnl)}</span>
                  </div>
                )}
                <span className="text-white/15 text-[10px] ml-1">{elapsed(pos.openedAt)}</span>
                <button onClick={() => remove(pos.id)} title="Remove"
                  className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all">
                  <X className="w-3 h-3" />
                </button>
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
    </div>
  );
}
