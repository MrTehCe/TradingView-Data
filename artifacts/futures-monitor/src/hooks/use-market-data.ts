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
  | { type: 'quote';    data: QuoteData }
  | { type: 'status';   connected: boolean; authenticated: boolean; needsLogin: boolean; error?: string }
  | { type: 'snapshot'; data: Record<string, QuoteData> }
  | { type: 'history';  symbol: string; ticks: TickRecord[]; ob: OBRecord[] };

export interface MarketStatus {
  connected: boolean;
  authenticated: boolean;
  needsLogin: boolean;
  wsConnected: boolean;
  hasSavedToken: boolean;
  error?: string;
}

const MAX_HISTORY_MS   = 12 * 60 * 60 * 1000;
const FLUSH_INTERVAL   = 5_000;
const PRUNE_INTERVAL   = 30 * 60 * 1000;

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

// ── SharedWorker singleton ───────────────────────────────────────────────────
// One SharedWorker instance is shared across all tabs on the same origin.
// It holds the WebSocket connection and 12h of tick/OB history in memory.
let sharedWorker: SharedWorker | null = null;
function getWorker(): SharedWorker | null {
  if (typeof SharedWorker === 'undefined') return null;
  if (!sharedWorker) {
    sharedWorker = new SharedWorker(
      new URL('../market-worker.ts', import.meta.url),
      { type: 'module', name: 'market-data-worker-v3' },
    );
  }
  return sharedWorker;
}

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

  const portRef            = useRef<MessagePort | null>(null);
  const tickHistoryRef     = useRef<Record<string, TickRecord[]>>({});
  const orderBookRef       = useRef<Record<string, OBRecord[]>>({});
  const subscribedSymbolsRef = useRef<Set<string>>(new Set());

  const pendingTicksRef    = useRef<Record<string, TickRecord[]>>({});
  const pendingOBRef       = useRef<Record<string, OBRecord[]>>({});
  const lastReconnectRef   = useRef<number>(0);

  // ── Load history from IndexedDB on mount ──────────────────────────────────
  useEffect(() => {
    const cutoff = Date.now() - MAX_HISTORY_MS;
    Promise.all([loadTicks(cutoff), loadOB(cutoff)])
      .then(([ticks, ob]) => {
        for (const [sym, arr] of Object.entries(ticks)) {
          const live   = tickHistoryRef.current[sym] ?? [];
          const merged = [...arr, ...live];
          merged.sort((a, b) => a.ts - b.ts);
          tickHistoryRef.current[sym] = merged;
        }
        for (const [sym, arr] of Object.entries(ob)) {
          const live   = orderBookRef.current[sym] ?? [];
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
    return () => { clearInterval(id); flush(); };
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
    portRef.current?.postMessage(JSON.stringify({ type: 'set_auth_token', token, cookieStr }));
  }, []);

  const clearToken = useCallback(() => {
    clearAuth();
    setStatus(s => ({ ...s, hasSavedToken: false, needsLogin: true, authenticated: false }));
  }, []);

  // ── Symbol subscription ───────────────────────────────────────────────────
  const subscribeSymbol = useCallback((tvSymbol: string) => {
    subscribedSymbolsRef.current.add(tvSymbol);
    portRef.current?.postMessage(JSON.stringify({ type: 'subscribe', symbol: tvSymbol }));
  }, []);

  // ── SharedWorker port setup ───────────────────────────────────────────────
  useEffect(() => {
    const worker = getWorker();
    if (!worker) {
      console.warn('SharedWorker not supported in this browser');
      return;
    }

    const port = worker.port;
    portRef.current = port;
    setStatus(s => ({ ...s, wsConnected: true }));

    // Send saved auth token to the worker immediately
    const auth = loadSavedAuth();
    if (auth) {
      port.postMessage(JSON.stringify({ type: 'set_auth_token', token: auth.token, cookieStr: auth.cookieStr }));
    }

    // Re-send any symbol subscriptions (e.g. after hot-reload)
    for (const sym of subscribedSymbolsRef.current) {
      port.postMessage(JSON.stringify({ type: 'subscribe', symbol: sym }));
    }

    port.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as IncomingMessage;

        if (msg.type === 'quote') {
          setQuotes(prev => ({ ...prev, [msg.data.displaySymbol]: msg.data }));

          const sym    = msg.data.displaySymbol;
          const now    = Date.now();
          const cutoff = now - MAX_HISTORY_MS;

          if (msg.data.price !== null) {
            const rec: TickRecord = { price: msg.data.price, ts: now, vol: msg.data.volume ?? 0 };
            const buf = tickHistoryRef.current[sym] ?? [];
            buf.push(rec);
            tickHistoryRef.current[sym] = buf.filter(t => t.ts > cutoff);
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

        } else if (msg.type === 'history') {
          // Worker is sharing its in-memory accumulation with this new tab
          const sym    = msg.symbol;
          const cutoff = Date.now() - MAX_HISTORY_MS;

          if (msg.ticks.length > 0) {
            const existing   = tickHistoryRef.current[sym] ?? [];
            const existingTs = new Set(existing.map(t => t.ts));
            const novel      = msg.ticks.filter(t => !existingTs.has(t.ts) && t.ts > cutoff);
            if (novel.length > 0) {
              const merged = [...existing, ...novel];
              merged.sort((a, b) => a.ts - b.ts);
              tickHistoryRef.current[sym] = merged;
              // Stage for IDB so the next flush persists them
              (pendingTicksRef.current[sym] ??= []).push(...novel);
            }
          }

          if (msg.ob.length > 0) {
            const existing   = orderBookRef.current[sym] ?? [];
            const existingTs = new Set(existing.map(r => r.ts));
            const novel      = msg.ob.filter(r => !existingTs.has(r.ts) && r.ts > cutoff);
            if (novel.length > 0) {
              const merged = [...existing, ...novel];
              merged.sort((a, b) => a.ts - b.ts);
              orderBookRef.current[sym] = merged;
              (pendingOBRef.current[sym] ??= []).push(...novel);
            }
          }

        } else if (msg.type === 'snapshot') {
          const snap: Record<string, QuoteData> = {};
          for (const q of Object.values(msg.data)) snap[q.displaySymbol] = q;
          setQuotes(prev => ({ ...prev, ...snap }));

        } else if (msg.type === 'status') {
          setStatus(prev => ({
            ...prev,
            connected:     msg.connected,
            authenticated: msg.authenticated,
            needsLogin:    msg.needsLogin && !loadSavedAuth(),
            error:         msg.error,
            wsConnected:   true,
          }));
          if (msg.authenticated) {
            setStatus(prev => ({ ...prev, needsLogin: false }));
            lastReconnectRef.current = 0; // reset so next disconnect/reconnect can retry
          } else {
            // Server is up but not authenticated — re-apply saved token via REST
            // Rate-limited to once per 30 s to avoid hammering the server.
            const auth = loadSavedAuth();
            const now  = Date.now();
            if (auth && (now - lastReconnectRef.current) > 30_000) {
              lastReconnectRef.current = now;
              fetch('/api/auth/tradingview/reconnect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: auth.token, cookieStr: auth.cookieStr }),
              }).catch(() => { /* will retry on next status message */ });
            }
          }
        }
      } catch (e) { console.error('Worker message parse error', e); }
    };

    port.start();

    // No cleanup: the SharedWorker port stays alive for the life of the tab.
    // The worker itself keeps running as long as any tab is connected.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { quotes, status, sendToken, clearToken, subscribeSymbol, tickHistoryRef, orderBookRef };
}
