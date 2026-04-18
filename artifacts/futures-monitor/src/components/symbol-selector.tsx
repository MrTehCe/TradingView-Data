import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Search, X } from 'lucide-react';

export interface SymbolInfo {
  display: string;
  tv: string;
  bucket: number;
  pointValue: number;
  tickSize: number;       // minimum price increment
  desc: string;
  group: 'equity' | 'metals' | 'energy' | 'crypto';
}

export const KNOWN_SYMBOLS: SymbolInfo[] = [
  { display: 'MES',  tv: 'CME_MINI:MES1!',  bucket: 0.5,   pointValue: 5,   tickSize: 0.25, desc: 'Micro E-mini S&P 500',  group: 'equity'  },
  { display: 'MNQ',  tv: 'CME_MINI:MNQ1!',  bucket: 2.0,   pointValue: 2,   tickSize: 0.25, desc: 'Micro Nasdaq-100',      group: 'equity'  },
  { display: 'ES',   tv: 'CME:ES1!',         bucket: 0.25,  pointValue: 50,  tickSize: 0.25, desc: 'E-mini S&P 500',        group: 'equity'  },
  { display: 'NQ',   tv: 'CME:NQ1!',         bucket: 0.25,  pointValue: 20,  tickSize: 0.25, desc: 'E-mini Nasdaq-100',     group: 'equity'  },
];

const GROUP_COLOR: Record<string, string> = {
  equity:  'text-cyan-400/70',
  metals:  'text-amber-400/70',
  energy:  'text-orange-400/70',
  crypto:  'text-purple-400/70',
};

interface Props {
  active: SymbolInfo;
  onSelect: (sym: SymbolInfo) => void;
  quotes: Record<string, { price: number | null; changePct: number | null }>;
}

export function SymbolSelector({ active, onSelect, quotes }: Props) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const inputRef          = useRef<HTMLInputElement>(null);
  const containerRef      = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = query.trim()
    ? KNOWN_SYMBOLS.filter(s =>
        s.display.toLowerCase().includes(query.toLowerCase()) ||
        s.desc.toLowerCase().includes(query.toLowerCase()) ||
        s.tv.toLowerCase().includes(query.toLowerCase())
      )
    : KNOWN_SYMBOLS;

  function select(sym: SymbolInfo) {
    onSelect(sym);
    setOpen(false);
    setQuery('');
  }

  const activeQ = quotes[active.display];

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-md border font-mono text-sm transition-all',
          open
            ? 'bg-white/8 border-white/20 text-white'
            : 'bg-[#0c0c14] border-[#1c1c28] text-white/70 hover:text-white hover:border-white/20'
        )}
      >
        <span className="font-bold tracking-widest text-white">{active.display}</span>
        <span className="text-white/30 text-xs hidden sm:block">{active.desc}</span>
        {activeQ?.price != null && (
          <span className={cn(
            'text-xs tabular-nums ml-1',
            (activeQ.changePct ?? 0) >= 0 ? 'text-emerald-400/70' : 'text-purple-400/70'
          )}>
            {(activeQ.changePct ?? 0) >= 0 ? '+' : ''}{activeQ.changePct?.toFixed(2)}%
          </span>
        )}
        <span className="text-white/20 text-[10px] ml-1">▼</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-80 z-50 bg-[#0c0c16] border border-[#222235] rounded-lg shadow-2xl overflow-hidden">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a1a2a]">
            <Search className="w-3.5 h-3.5 text-white/25 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); setQuery(''); }
                if (e.key === 'Enter' && filtered.length > 0) select(filtered[0]);
              }}
              placeholder="Search symbol or name…"
              className="flex-1 bg-transparent text-xs font-mono text-white placeholder:text-white/20 outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-white/20 hover:text-white/50">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Symbol list */}
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map(sym => {
              const q = quotes[sym.display];
              const isActive = sym.display === active.display;
              return (
                <button
                  key={sym.tv}
                  onClick={() => select(sym)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/5 transition-colors font-mono text-xs',
                    isActive ? 'bg-white/8' : ''
                  )}
                >
                  <span className={cn('w-10 font-bold text-sm shrink-0', GROUP_COLOR[sym.group])}>
                    {sym.display}
                  </span>
                  <span className="text-white/30 text-[11px] flex-1 leading-tight">{sym.desc}</span>
                  {q?.price != null ? (
                    <div className="text-right shrink-0">
                      <div className="text-white/70 tabular-nums">{q.price.toFixed(q.price > 100 ? 2 : 4)}</div>
                      {q.changePct != null && (
                        <div className={cn('text-[10px] tabular-nums', q.changePct >= 0 ? 'text-emerald-400/60' : 'text-purple-400/60')}>
                          {q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-white/15 text-[10px]">—</span>
                  )}
                  {isActive && <span className="text-white/30 text-[10px]">●</span>}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-white/20 text-xs font-mono">No symbols match</div>
            )}
          </div>

          <div className="px-3 py-1.5 border-t border-[#1a1a2a] text-[10px] font-mono text-white/15">
            CME Micro &amp; Mini Futures · TradingView feed
          </div>
        </div>
      )}
    </div>
  );
}
