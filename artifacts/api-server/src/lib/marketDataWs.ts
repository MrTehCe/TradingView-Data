import { IncomingMessage, Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { TradingViewFeed, type QuoteData, type TvConnectionStatus } from "./tradingview";
import { logger } from "./logger";

const SYMBOLS = ["CME_MINI:MNQ1!", "CME_MINI:MES1!"];

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

  const feed = new TradingViewFeed(SYMBOLS);

  feed.on("quote", (quote: QuoteData) => {
    snapshot[quote.symbol] = quote;
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
        const msg = JSON.parse(raw.toString()) as { type: string; token?: string; cookieStr?: string };
        if (msg.type === "set_auth_token" && msg.token) {
          logger.info("TradingView session token received, connecting...");
          feed.setAuth(msg.token, msg.cookieStr ?? "");
          feed.connect();
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WS client error");
      clients.delete(ws);
    });
  });

  logger.info("Market data WebSocket server ready at /api/ws");
  return wss;
}
