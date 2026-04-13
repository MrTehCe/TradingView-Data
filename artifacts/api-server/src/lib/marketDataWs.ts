import { IncomingMessage, Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { TradingViewFeed, type QuoteData, type TvConnectionStatus, SYMBOL_DISPLAY } from "./tradingview";
import { logger } from "./logger";

// Default symbols to subscribe on startup
const DEFAULT_SYMBOLS = [
  "CME_MINI:MES1!",   // Micro E-mini S&P 500
  "CME_MINI:MNQ1!",   // Micro Nasdaq
  "CBOT_MINI:MYM1!",  // Micro Dow
  "CME_MINI:M2K1!",   // Micro Russell 2000
  "CME:ES1!",         // E-mini S&P 500
  "CME:NQ1!",         // E-mini Nasdaq
  "COMEX:MGC1!",      // Micro Gold
  "NYMEX:MCL1!",      // Micro Crude Oil
  "CME:MBT1!",        // Micro Bitcoin
  "CME:MET1!",        // Micro Ether
];

const HISTORY_MS = 12 * 60 * 60 * 1000; // 12 hours

interface TickRec { price: number; ts: number; vol: number }
interface OBRec   { ts: number; ask: number; askSize: number; bid: number; bidSize: number }

// Server-side tick + OB buffers — survive tab closes/opens
const tickHistory: Record<string, TickRec[]> = {};
const obHistory:   Record<string, OBRec[]>   = {};

// Prune old records every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - HISTORY_MS;
  for (const sym of Object.keys(tickHistory)) {
    tickHistory[sym] = tickHistory[sym].filter(t => t.ts > cutoff);
  }
  for (const sym of Object.keys(obHistory)) {
    obHistory[sym] = obHistory[sym].filter(r => r.ts > cutoff);
  }
}, 30 * 60 * 1000);

type OutgoingMessage =
  | { type: "quote"; data: QuoteData }
  | { type: "status"; connected: boolean; authenticated: boolean; needsLogin: boolean; error?: string }
  | { type: "snapshot"; data: Record<string, QuoteData> }
  | { type: "history"; symbol: string; ticks: TickRec[]; ob: OBRec[] };

function broadcast(clients: Set<WebSocket>, msg: OutgoingMessage) {
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export function attachMarketDataWs(server: Server) {
  const wss = new WebSocketServer({ server, path: "/api/ws" });
  const clients = new Set<WebSocket>();
  const snapshot: Record<string, QuoteData> = {};

  let currentStatus: OutgoingMessage & { type: "status" } = {
    type: "status",
    connected: false,
    authenticated: false,
    needsLogin: true,
  };

  const feed = new TradingViewFeed(DEFAULT_SYMBOLS);

  feed.on("quote", (quote: QuoteData) => {
    snapshot[quote.displaySymbol] = quote;

    // Accumulate server-side history
    const now    = Date.now();
    const cutoff = now - HISTORY_MS;
    const sym    = quote.displaySymbol;

    if (quote.price !== null) {
      const buf = tickHistory[sym] ?? [];
      buf.push({ price: quote.price, ts: now, vol: quote.volume ?? 0 });
      tickHistory[sym] = buf.filter(t => t.ts > cutoff);
    }

    if (quote.ask !== null && quote.bid !== null &&
        quote.askSize !== null && quote.bidSize !== null) {
      const buf = obHistory[sym] ?? [];
      buf.push({ ts: now, ask: quote.ask, askSize: quote.askSize, bid: quote.bid, bidSize: quote.bidSize });
      obHistory[sym] = buf.filter(r => r.ts > cutoff);
    }

    broadcast(clients, { type: "quote", data: quote });
  });

  feed.on("status", (status: TvConnectionStatus) => {
    currentStatus = {
      type: "status",
      connected: status.connected,
      authenticated: status.authenticated,
      needsLogin: false,
      error: status.error,
    };
    broadcast(clients, currentStatus);
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    logger.info({ ip: req.socket.remoteAddress }, "Market data WS client connected");
    clients.add(ws);

    ws.send(JSON.stringify(currentStatus));

    if (Object.keys(snapshot).length > 0) {
      ws.send(JSON.stringify({ type: "snapshot", data: snapshot }));
    }

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          token?: string;
          cookieStr?: string;
          symbol?: string;
        };

        if (msg.type === "set_auth_token" && msg.token) {
          logger.info("TradingView session token received, connecting...");
          feed.setAuth(msg.token, msg.cookieStr ?? "");
          feed.connect();
        }

        if (msg.type === "subscribe" && msg.symbol) {
          const tvSymbol = msg.symbol;
          logger.info({ tvSymbol }, "Client requested symbol subscription");
          if (!SYMBOL_DISPLAY[tvSymbol]) {
            const short = tvSymbol.split(":")[1]?.replace("1!", "") ?? tvSymbol;
            SYMBOL_DISPLAY[tvSymbol] = short;
          }
          feed.addSymbol(tvSymbol);

          // Send accumulated history for this symbol immediately
          const displaySym = SYMBOL_DISPLAY[tvSymbol] ?? tvSymbol;
          const ticks = tickHistory[displaySym] ?? [];
          const ob    = obHistory[displaySym]   ?? [];
          if (ticks.length > 0 || ob.length > 0) {
            logger.info({ displaySym, ticks: ticks.length, ob: ob.length }, "Sending history to new client");
            ws.send(JSON.stringify({ type: "history", symbol: displaySym, ticks, ob }));
          }
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => { clients.delete(ws); });
    ws.on("error", (err) => { logger.error({ err }, "WS client error"); clients.delete(ws); });
  });

  logger.info("Market data WebSocket server ready at /api/ws");
  return wss;
}
