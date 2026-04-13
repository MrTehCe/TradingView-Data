/// <reference lib="webworker" />
/// <reference lib="webworker.sharedworkers" />

declare const self: SharedWorkerGlobalScope;

// ── Types (duplicated here so the worker has no external imports) ─────────────
interface TickRecord { price: number; ts: number; vol: number }
interface OBRecord   { ts: number; ask: number; askSize: number; bid: number; bidSize: number }
interface QuoteData  {
  symbol: string; displaySymbol: string;
  price: number | null; change: number | null; changePct: number | null;
  volume: number | null; high: number | null; low: number | null;
  open: number | null; prevClose: number | null; timestamp: number | null;
  session: string | null; ask: number | null; askSize: number | null;
  bid: number | null; bidSize: number | null;
}
type ToTab =
  | { type: 'quote';    data: QuoteData }
  | { type: 'status';   connected: boolean; authenticated: boolean; needsLogin: boolean; error?: string }
  | { type: 'snapshot'; data: Record<string, QuoteData> }
  | { type: 'history';  symbol: string; ticks: TickRecord[]; ob: OBRecord[] };

// ── Shared state ─────────────────────────────────────────────────────────────
const MAX_HISTORY_MS = 12 * 60 * 60 * 1000;
const connectedPorts = new Set<MessagePort>();
const tickHistory: Record<string, TickRecord[]> = {};
const obHistory:   Record<string, OBRecord[]>   = {};
const snapshot:    Record<string, QuoteData>    = {};
const subscribedSymbols = new Set<string>();

let savedToken     = '';
let savedCookieStr = '';
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

let currentStatus: ToTab & { type: 'status' } = {
  type: 'status', connected: false, authenticated: false, needsLogin: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function sendToPort(port: MessagePort, msg: ToTab) {
  try { port.postMessage(JSON.stringify(msg)); } catch { connectedPorts.delete(port); }
}

function broadcastToAll(msg: ToTab) {
  for (const port of connectedPorts) sendToPort(port, msg);
}

// Derive display symbol from TradingView symbol ("CME_MINI:MES1!" → "MES")
function tvToDisplay(tvSym: string): string {
  return tvSym.split(':')[1]?.replace('1!', '') ?? tvSym;
}

// Prune history older than 12h
function pruneHistory() {
  const cutoff = Date.now() - MAX_HISTORY_MS;
  for (const k of Object.keys(tickHistory)) tickHistory[k] = tickHistory[k].filter(t => t.ts > cutoff);
  for (const k of Object.keys(obHistory))   obHistory[k]   = obHistory[k].filter(r => r.ts > cutoff);
}
setInterval(pruneHistory, 30 * 60 * 1000);

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWs() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const proto = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
  try { ws = new WebSocket(`${proto}//${self.location.host}/api/ws`); } catch {
    reconnectTimer = setTimeout(connectWs, 3000);
    return;
  }

  ws.onopen = () => {
    if (savedToken) ws!.send(JSON.stringify({ type: 'set_auth_token', token: savedToken, cookieStr: savedCookieStr }));
    for (const sym of subscribedSymbols) ws!.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
  };

  ws.onclose = () => {
    currentStatus = { ...currentStatus, connected: false };
    broadcastToAll({ type: 'status', connected: false, authenticated: false, needsLogin: false });
    reconnectTimer = setTimeout(connectWs, 3000);
  };

  ws.onerror = () => {};

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      const now    = Date.now();
      const cutoff = now - MAX_HISTORY_MS;

      if (msg.type === 'quote') {
        const q: QuoteData = msg.data;
        snapshot[q.displaySymbol] = q;

        if (q.price !== null) {
          const rec: TickRecord = { price: q.price, ts: now, vol: q.volume ?? 0 };
          const buf = tickHistory[q.displaySymbol] ?? [];
          buf.push(rec);
          tickHistory[q.displaySymbol] = buf.filter(t => t.ts > cutoff);
        }
        if (q.ask !== null && q.bid !== null && q.askSize !== null && q.bidSize !== null) {
          const rec: OBRecord = { ts: now, ask: q.ask, askSize: q.askSize, bid: q.bid, bidSize: q.bidSize };
          const buf = obHistory[q.displaySymbol] ?? [];
          buf.push(rec);
          obHistory[q.displaySymbol] = buf.filter(r => r.ts > cutoff);
        }
        broadcastToAll(msg);

      } else if (msg.type === 'status') {
        currentStatus = msg;
        broadcastToAll(msg);

      } else if (msg.type === 'snapshot') {
        for (const q of Object.values(msg.data) as QuoteData[]) snapshot[q.displaySymbol] = q;
        broadcastToAll(msg);
      }
    } catch { /* ignore malformed */ }
  };
}

// ── Port connection ───────────────────────────────────────────────────────────
self.onconnect = (e: MessageEvent) => {
  const port = e.ports[0];
  connectedPorts.add(port);

  // Immediately send current state to the new tab
  sendToPort(port, currentStatus);
  if (Object.keys(snapshot).length > 0) {
    sendToPort(port, { type: 'snapshot', data: snapshot });
  }

  port.onmessage = (ev: MessageEvent) => {
    try {
      const msg = JSON.parse(ev.data as string);

      if (msg.type === 'set_auth_token' && msg.token) {
        savedToken     = msg.token;
        savedCookieStr = msg.cookieStr ?? '';
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'set_auth_token', token: savedToken, cookieStr: savedCookieStr }));
        } else {
          connectWs();
        }
      }

      if (msg.type === 'subscribe' && msg.symbol) {
        const tvSym   = msg.symbol as string;
        const dispSym = tvToDisplay(tvSym);
        subscribedSymbols.add(tvSym);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'subscribe', symbol: tvSym }));
        }
        // Send any accumulated history to this tab right now
        const ticks = tickHistory[dispSym] ?? [];
        const ob    = obHistory[dispSym]   ?? [];
        if (ticks.length > 0 || ob.length > 0) {
          sendToPort(port, { type: 'history', symbol: dispSym, ticks, ob });
        }
      }
    } catch { /* ignore malformed */ }
  };

  port.start();
  connectWs(); // ensure WS is up
};
