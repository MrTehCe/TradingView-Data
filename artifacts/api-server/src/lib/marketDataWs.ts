import { IncomingMessage, Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { TradingViewFeed, type QuoteData, type TvConnectionStatus, SYMBOL_DISPLAY } from "./tradingview.js";
import { initHistoryStore, pushTick, pushOB, getTicks, getOB } from "./historyStore.js";
import { logger } from "./logger.js";

const DEFAULT_SYMBOLS = [
  "CME_MINI:MES1!",
  "CME_MINI:MNQ1!",
  "CBOT_MINI:MYM1!",
  "CME_MINI:M2K1!",
  "CME:ES1!",
  "CME:NQ1!",
  "COMEX:MGC1!",
  "NYMEX:MCL1!",
  "CME:MBT1!",
  "CME:MET1!",
];

type OutgoingMessage =
  | { type: "quote";          data: QuoteData }
  | { type: "status";         connected: boolean; authenticated: boolean; needsLogin: boolean; error?: string }
  | { type: "snapshot";       data: Record<string, QuoteData> }
  | { type: "history_ticks";  sym: string; data: { ts: number; price: number; vol: number }[] }
  | { type: "history_ob";     sym: string; data: { ts: number; ask: number; askSize: number; bid: number; bidSize: number }[] };

function send(ws: WebSocket, msg: OutgoingMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(clients: Set<WebSocket>, msg: OutgoingMessage) {
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

/** Send symbol history to a single client, chunked so large payloads don't stall the socket. */
function sendHistory(ws: WebSocket, tvSymbol: string) {
  const displaySym = SYMBOL_DISPLAY[tvSymbol] ?? tvSymbol.split(":")[1]?.replace("1!", "") ?? tvSymbol;
  const ticks = getTicks(displaySym);
  const ob    = getOB(displaySym);

  // Send in 2000-record chunks to avoid huge single frames
  const CHUNK = 2000;
  for (let i = 0; i < ticks.length; i += CHUNK) {
    send(ws, { type: "history_ticks", sym: displaySym, data: ticks.slice(i, i + CHUNK) });
  }
  for (let i = 0; i < ob.length; i += CHUNK) {
    send(ws, { type: "history_ob", sym: displaySym, data: ob.slice(i, i + CHUNK) });
  }
  logger.debug({ sym: displaySym, ticks: ticks.length, ob: ob.length }, "history sent to client");
}

export function attachMarketDataWs(server: Server) {
  // Initialise history store — loads persisted data from disk
  initHistoryStore(
    DEFAULT_SYMBOLS.map(tv => SYMBOL_DISPLAY[tv] ?? tv.split(":")[1]?.replace("1!", "") ?? tv)
  );

  const wss     = new WebSocketServer({ server, path: "/api/ws" });
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
    broadcast(clients, { type: "quote", data: quote });

    const sym = quote.displaySymbol;
    const ts  = Date.now();

    if (quote.price !== null) {
      pushTick(sym, { ts, price: quote.price, vol: quote.volume ?? 0 });
    }
    if (quote.ask !== null && quote.bid !== null &&
        quote.askSize !== null && quote.bidSize !== null) {
      pushOB(sym, { ts, ask: quote.ask, askSize: quote.askSize, bid: quote.bid, bidSize: quote.bidSize });
    }
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

    // Immediately send history for all default symbols so the client
    // has data even before it explicitly subscribes
    for (const tvSym of DEFAULT_SYMBOLS) {
      sendHistory(ws, tvSym);
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
          // Send history for the newly subscribed symbol
          sendHistory(ws, tvSymbol);
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
