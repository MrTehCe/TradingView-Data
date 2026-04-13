import { useState, useEffect, useRef, useCallback } from 'react';
import { appendTicks, appendOB, loadTicks, loadOB, pruneOlderThan } from '@/lib/history-db';

export interface QuoteData {
  symbol: string;
  displaySymbol: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  prevClose: number | null;
  timestamp: number | null;
  session: string | null;
  ask: number | null;
  askSize: number | null;
  bid: number | null;
  bidSize: number | null;
}

export interface TickRecord  { price: number; ts: number; vol: number }
export interface OBRecord    { ts: number; ask: number; askSize: number; bid: number; bidSize: number }

export type IncomingMessage =
  | { type: 'quote'; data: QuoteData }
  | { type: 'status'; connected: boolean; authenticated: boolean; needsLogin: boolean; error?: string }
  | { type: 'snapshot'; data: Record<string, QuoteData> };

export interface MarketStatus {
  connected: boolean;
  authenticated: boolean;
  needsLogin: boolean;
  wsConnected: boolean;
  hasSavedToken: boolean;
  error?: string;
}

const MAX_HISTORY_MS   = 12 * 60 * 60 * 1000;  // 12 hours — supports 1m–12H views
const FLUSH_INTERVAL   = 5_000;                  // write new records to IDB every 5 s
const PRUNE_INTERVAL   = 30 * 60 * 1000;        // prune IDB every 30 min

const TOKEN_KEY = 'fm_tv_auth_v1';

// ── Auth helpers ──────────────────────────────────────────────────────────────
interface SavedAuth { token: string; cookieStr: string; savedAt: number }
function loadSavedAuth(): SavedAuth | null {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null'); } catch { return null; }
}
function persistAuth(token: string, cookieStr: string) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, cookieStr, savedAt: Date.now() }));
}
function clearAuth() { localStorage.removeItem(TOKEN_KEY); }

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useMarketData() {
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});

  const savedAuth = loadSavedAuth();
  const [status, setStatus] = useState<MarketStatus>({
    connected: false,
    authenticated: false,
    needsLogin: !savedAuth,
    wsConnected: false,
    hasSavedToken: !!savedAuth,
  });

  const wsRef          = useRef<WebSocket | null>(null);
  const tickHistoryRef = useRef<Record<string, TickRecord[]>>({});
  const orderBookRef   = useRef<Record<string, OBRecord[]>>({});
  const subscribedSymbolsRef = useRef<Set<string>>(new Set());

  // Pending buffers — only records added since last IDB flush
  const pendingTicksRef = useRef<Record<string, TickRecord[]>>({});
  const pendingOBRef    = useRef<Record<string, OBRecord[]>>({});

  // ── Load history from IndexedDB on mount ──────────────────────────────────
  useEffect(() => {
    const cutoff = Date.now() - MAX_HISTORY_MS;
    Promise.all([loadTicks(cutoff), loadOB(cutoff)])
      .then(([ticks, ob]) => {
        // Merge loaded data with any already-arrived live ticks (keep both)
        for (const [sym, arr] of Object.entries(ticks)) {
          const live = tickHistoryRef.current[sym] ?? [];
          const merged = [...arr, ...live];
          merged.sort((a, b) => a.ts - b.ts);
          tickHistoryRef.current[sym] = merged;
        }
        for (const [sym, arr] of Object.entries(ob)) {
          const live = orderBookRef.current[sym] ?? [];
          const merged = [...arr, ...live];
          merged.sort((a, b) => a.ts - b.ts);
          orderBookRef.current[sym] = merged;
        }
      })
      .catch(err => console.warn('IDB load failed:', err));
  }, []);

  // ── Flush pending records to IndexedDB every 5 s ──────────────────────────
  useEffect(() => {
    const flush = () => {
      for (const [sym, arr] of Object.entries(pendingTicksRef.current)) {
        if (arr.length > 0) appendTicks(sym, arr).catch(() => {});
      }
      for (const [sym, arr] of Object.entries(pendingOBRef.current)) {
        if (arr.length > 0) appendOB(sym, arr).catch(() => {});
      }
      pendingTicksRef.current = {};
      pendingOBRef.current    = {};
    };

    const id = setInterval(flush, FLUSH_INTERVAL);
    return () => { clearInterval(id); flush(); };  // final flush on unmount
  }, []);

  // ── Prune old IDB records every 30 min ────────────────────────────────────
  useEffect(() => {
    const prune = () => pruneOlderThan(Date.now() - MAX_HISTORY_MS).catch(() => {});
    const id = setInterval(prune, PRUNE_INTERVAL);
    return () => clearInterval(id);
  }, []);

  // ── Token helpers ─────────────────────────────────────────────────────────
  const sendToken = useCallback((token: string, cookieStr = '') => {
    persistAuth(token, cookieStr);
    setStatus(s => ({ ...s, hasSavedToken: true, needsLogin: false }));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_auth_token', token, cookieStr }));
    }
  }, []);

  const clearToken = useCallback(() => {
    clearAuth();
    setStatus(s => ({ ...s, hasSavedToken: false, needsLogin: true, authenticated: false }));
  }, []);

  // ── Symbol subscription ───────────────────────────────────────────────────
  const subscribeSymbol = useCallback((tvSymbol: string) => {
    subscribedSymbolsRef.current.add(tvSymbol);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', symbol: tvSymbol }));
    }
  }, []);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

    ws.onopen = () => {
      setStatus(s => ({ ...s, wsConnected: true }));
      const auth = loadSavedAuth();
      if (auth) ws.send(JSON.stringify({ type: 'set_auth_token', token: auth.token, cookieStr: auth.cookieStr }));
      for (const sym of subscribedSymbolsRef.current) {
        ws.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
      }
    };

    ws.onclose = () => { setStatus(s => ({ ...s, wsConnected: false, connected: false })); setTimeout(connect, 3000); };
    ws.onerror = () => setStatus(s => ({ ...s, wsConnected: false }));

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as IncomingMessage;

        if (msg.type === 'quote') {
          setQuotes(prev => ({ ...prev, [msg.data.displaySymbol]: msg.data }));

          const sym    = msg.data.displaySymbol;
          const now    = Date.now();
          const cutoff = now - MAX_HISTORY_MS;

          if (msg.data.price !== null) {
            const rec: TickRecord = { price: msg.data.price, ts: now, vol: msg.data.volume ?? 0 };
            // In-memory ring buffer
            const buf = tickHistoryRef.current[sym] ?? [];
            buf.push(rec);
            tickHistoryRef.current[sym] = buf.filter(t => t.ts > cutoff);
            // Stage for IDB flush
            (pendingTicksRef.current[sym] ??= []).push(rec);
          }

          if (msg.data.ask !== null && msg.data.bid !== null &&
              msg.data.askSize !== null && msg.data.bidSize !== null) {
            const rec: OBRecord = { ts: now, ask: msg.data.ask, askSize: msg.data.askSize, bid: msg.data.bid, bidSize: msg.data.bidSize };
            const buf = orderBookRef.current[sym] ?? [];
            buf.push(rec);
            orderBookRef.current[sym] = buf.filter(r => r.ts > cutoff);
            (pendingOBRef.current[sym] ??= []).push(rec);
          }

        } else if (msg.type === 'snapshot') {
          const snap: Record<string, QuoteData> = {};
          for (const q of Object.values(msg.data)) snap[q.displaySymbol] = q;
          setQuotes(prev => ({ ...prev, ...snap }));

        } else if (msg.type === 'status') {
          setStatus(prev => ({
            ...prev,
            connected: msg.connected,
            authenticated: msg.authenticated,
            needsLogin: msg.needsLogin && !loadSavedAuth(),
            error: msg.error,
          }));
          if (msg.authenticated) {
            setStatus(prev => ({ ...prev, needsLogin: false }));
          }
        }
      } catch (e) { console.error('WS parse error', e); }
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  return { quotes, status, sendToken, clearToken, subscribeSymbol, tickHistoryRef, orderBookRef };
}
