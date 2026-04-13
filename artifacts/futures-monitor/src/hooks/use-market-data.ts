import { useState, useEffect, useRef, useCallback } from 'react';

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

export interface TickRecord {
  price: number;
  ts: number;
  vol: number;
}

export interface OBRecord {
  ts: number;
  ask: number;
  askSize: number;
  bid: number;
  bidSize: number;
}

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

const MAX_HISTORY_MS = 16 * 60 * 1000;
const TOKEN_KEY = 'fm_tv_auth_v1';

interface SavedAuth { token: string; cookieStr: string; savedAt: number }

function loadSavedAuth(): SavedAuth | null {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null'); } catch { return null; }
}
function persistAuth(token: string, cookieStr: string) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, cookieStr, savedAt: Date.now() }));
}
function clearAuth() { localStorage.removeItem(TOKEN_KEY); }

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
  // Track all symbols the user has subscribed to this session so we can replay on reconnect
  const subscribedSymbolsRef = useRef<Set<string>>(new Set());

  /** Send token to the server and persist it for future page loads. */
  const sendToken = useCallback((token: string, cookieStr = '') => {
    persistAuth(token, cookieStr);
    setStatus(s => ({ ...s, hasSavedToken: true, needsLogin: false }));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_auth_token', token, cookieStr }));
    }
  }, []);

  /** Remove the saved token (logout). */
  const clearToken = useCallback(() => {
    clearAuth();
    setStatus(s => ({ ...s, hasSavedToken: false, needsLogin: true, authenticated: false }));
  }, []);

  /** Subscribe to a symbol. Replayed automatically on reconnect. */
  const subscribeSymbol = useCallback((tvSymbol: string) => {
    subscribedSymbolsRef.current.add(tvSymbol);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', symbol: tvSymbol }));
    }
  }, []);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

    ws.onopen = () => {
      setStatus(s => ({ ...s, wsConnected: true }));

      // Auto-replay saved auth token
      const auth = loadSavedAuth();
      if (auth) {
        ws.send(JSON.stringify({ type: 'set_auth_token', token: auth.token, cookieStr: auth.cookieStr }));
      }

      // Replay any symbols the user had subscribed
      for (const sym of subscribedSymbolsRef.current) {
        ws.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
      }
    };

    ws.onclose = () => {
      setStatus(s => ({ ...s, wsConnected: false, connected: false }));
      setTimeout(connect, 3000);
    };

    ws.onerror = () => setStatus(s => ({ ...s, wsConnected: false }));

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as IncomingMessage;

        if (msg.type === 'quote') {
          setQuotes(prev => ({ ...prev, [msg.data.displaySymbol]: msg.data }));

          const sym = msg.data.displaySymbol;
          const now = Date.now();
          const cutoff = now - MAX_HISTORY_MS;

          if (msg.data.price !== null) {
            const buf = tickHistoryRef.current[sym] ?? [];
            buf.push({ price: msg.data.price, ts: now, vol: msg.data.volume ?? 0 });
            tickHistoryRef.current[sym] = buf.filter(t => t.ts > cutoff);
          }

          if (msg.data.ask !== null && msg.data.bid !== null &&
              msg.data.askSize !== null && msg.data.bidSize !== null) {
            const buf = orderBookRef.current[sym] ?? [];
            buf.push({
              ts: now,
              ask: msg.data.ask, askSize: msg.data.askSize,
              bid: msg.data.bid, bidSize: msg.data.bidSize,
            });
            orderBookRef.current[sym] = buf.filter(r => r.ts > cutoff);
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
            // If the server says we need a token but we have one saved, keep needsLogin false
            // (the token was already sent on open; the server will authenticate momentarily)
            needsLogin: msg.needsLogin && !loadSavedAuth(),
            error: msg.error,
          }));

          // If the server authenticated us successfully, update needsLogin to false
          if (msg.authenticated) {
            setStatus(prev => ({ ...prev, needsLogin: false }));
          }
        }
      } catch (e) {
        console.error('WS parse error', e);
      }
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  return { quotes, status, sendToken, clearToken, subscribeSymbol, tickHistoryRef, orderBookRef };
}
