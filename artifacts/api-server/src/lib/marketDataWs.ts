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
  "CBOT:YM1!",        // E-mini Dow Jones
  "CME:RTY1!",        // E-mini Russell 2000
  "COMEX:MGC1!",      // Micro Gold
  "NYMEX:MCL1!",      // Micro Crude Oil
  "CME:MBT1!",        // Micro Bitcoin
  "CME:MET1!",        // Micro Ether
];

type OutgoingMessage =
  | { type: "quote"; data: QuoteData }
  | { type: "status"; connected: boolean; authenticated: boolean; needsLogin: boolean; error?: string }
  | { type: "snapshot"; data: Record<string, QuoteData> };

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
