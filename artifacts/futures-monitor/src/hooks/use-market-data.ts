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
}

export interface TickRecord {
  price: number;
  ts: number;
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
  error?: string;
}

const MAX_TICK_AGE_MS = 16 * 60 * 1000;

export function useMarketData() {
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [status, setStatus] = useState<MarketStatus>({
    connected: false,
    authenticated: false,
    needsLogin: true,
    wsConnected: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const tickHistoryRef = useRef<Record<string, TickRecord[]>>({});

  const sendToken = useCallback((token: string, cookieStr = '') => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_auth_token', token, cookieStr }));
    }
  }, []);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setStatus((s) => ({ ...s, wsConnected: true }));
    };

    ws.onclose = () => {
      setStatus((s) => ({ ...s, wsConnected: false, connected: false }));
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      setStatus((s) => ({ ...s, wsConnected: false }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as IncomingMessage;
        if (msg.type === 'quote') {
          setQuotes((prev) => ({ ...prev, [msg.data.displaySymbol]: msg.data }));
          if (msg.data.price !== null) {
            const sym = msg.data.displaySymbol;
            const now = Date.now();
            const buf = tickHistoryRef.current[sym] ?? [];
            buf.push({ price: msg.data.price, ts: now });
            const cutoff = now - MAX_TICK_AGE_MS;
            tickHistoryRef.current[sym] = buf.filter((t) => t.ts > cutoff);
          }
        } else if (msg.type === 'snapshot') {
          const snap: Record<string, QuoteData> = {};
          for (const quote of Object.values(msg.data)) {
            snap[quote.displaySymbol] = quote;
          }
          setQuotes((prev) => ({ ...prev, ...snap }));
        } else if (msg.type === 'status') {
          setStatus((prev) => ({
            ...prev,
            connected: msg.connected,
            authenticated: msg.authenticated,
            needsLogin: msg.needsLogin,
            error: msg.error,
          }));
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

  return { quotes, status, sendToken, tickHistoryRef };
}
