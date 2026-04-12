import WebSocket from "ws";
import { EventEmitter } from "events";
import { logger } from "./logger";

function generateSessionId(prefix: string): string {
  return prefix + Math.random().toString(36).substring(2, 12);
}

function createMessage(funcName: string, paramList: unknown[]): string {
  const msg = JSON.stringify({ m: funcName, p: paramList });
  return `~m~${msg.length}~m~${msg}`;
}

interface ParsedMessage {
  type: "heartbeat" | "data";
  value?: string;
  content?: Record<string, unknown>;
}

function parseMessages(data: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  let str = data;

  while (str.length > 0) {
    const match = str.match(/^~m~(\d+)~m~/);
    if (!match) break;

    const headerLen = match[0].length;
    const msgLen = parseInt(match[1]);
    const content = str.slice(headerLen, headerLen + msgLen);
    str = str.slice(headerLen + msgLen);

    if (content.startsWith("~h~")) {
      messages.push({ type: "heartbeat", value: content.slice(3) });
    } else {
      try {
        messages.push({
          type: "data",
          content: JSON.parse(content) as Record<string, unknown>,
        });
      } catch {
        // ignore parse errors for non-JSON messages
      }
    }
  }

  return messages;
}

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

export interface TvConnectionStatus {
  connected: boolean;
  authenticated: boolean;
  error?: string;
}

const SYMBOL_DISPLAY: Record<string, string> = {
  "CME_MINI:MNQ1!": "MNQ",
  "CME_MINI:MES1!": "MES",
};

const TV_WS_URL =
  "wss://data.tradingview.com/socket.io/websocket?from=chart%2F&date=2024_03_01-11_55&type=chart";

export class TradingViewFeed extends EventEmitter {
  private ws: WebSocket | null = null;
  private quoteSession: string;
  private readonly symbols: string[];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 5000;
  private authToken: string;
  private sessionSetup = false;

  constructor(symbols: string[], authToken = "unauthorized_user_token") {
    super();
    this.symbols = symbols;
    this.quoteSession = generateSessionId("qs_");
    this.authToken = authToken;
  }

  setAuthToken(token: string) {
    this.authToken = token;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }

  connect() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
    }

    logger.info({ url: TV_WS_URL }, "Connecting to TradingView");

    this.ws = new WebSocket(TV_WS_URL, {
      headers: {
        Origin: "https://www.tradingview.com",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    this.ws.on("open", () => {
      logger.info("TradingView WebSocket open");
      this.sessionSetup = false;
      this.emit("status", { connected: true, authenticated: false });
    });

    this.ws.on("message", (raw: Buffer | string) => {
      this.handleRawMessage(raw.toString());
    });

    this.ws.on("close", (code, reason) => {
      logger.warn({ code, reason: reason.toString() }, "TradingView WS closed");
      this.emit("status", { connected: false, authenticated: false });
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      logger.error({ err }, "TradingView WS error");
      this.emit("status", {
        connected: false,
        authenticated: false,
        error: (err as Error).message,
      });
    });
  }

  private handleRawMessage(data: string) {
    const messages = parseMessages(data);

    for (const msg of messages) {
      if (msg.type === "heartbeat") {
        const hb = msg.value!;
        const response = `~m~${hb.length + 3}~m~~h~${hb}`;
        this.send(response);
        continue;
      }

      const content = msg.content;
      if (!content) continue;

      if (content["session_id"] !== undefined && !this.sessionSetup) {
        this.sessionSetup = true;
        this.setupQuoteSession();
        continue;
      }

      const msgType = content["m"];
      if (msgType === "qsd") {
        this.handleQuoteData(content);
      } else if (msgType) {
        logger.debug({ msgType }, "TV message");
      }
    }
  }

  private setupQuoteSession() {
    this.quoteSession = generateSessionId("qs_");
    this.send(createMessage("set_auth_token", [this.authToken]));
    this.send(createMessage("quote_create_session", [this.quoteSession]));
    this.send(
      createMessage("quote_set_fields", [
        this.quoteSession,
        "ch",
        "chp",
        "lp",
        "lp_time",
        "volume",
        "high_price",
        "low_price",
        "open_price",
        "prev_close_price",
        "current_session",
        "status",
        "update_mode",
      ])
    );

    for (const symbol of this.symbols) {
      this.send(
        createMessage("quote_add_symbols", [
          this.quoteSession,
          symbol,
          { flags: ["force_permission"] },
        ])
      );
    }

    this.emit("status", { connected: true, authenticated: true });
    logger.info(
      { session: this.quoteSession, symbols: this.symbols },
      "TradingView quote session ready"
    );
  }

  private handleQuoteData(content: Record<string, unknown>) {
    const params = content["p"] as [
      string,
      { n: string; s: string; v: Record<string, number> },
    ];
    if (!params || params.length < 2) return;

    const payload = params[1];
    logger.info({ symbol: payload?.n, status: payload?.s, hasV: !!payload?.v }, "TV quote update");
    if (!payload || payload.s !== "ok" || !payload.v) return;

    const v = payload.v;
    const symbolKey = payload.n;

    const quote: QuoteData = {
      symbol: symbolKey,
      displaySymbol: SYMBOL_DISPLAY[symbolKey] ?? symbolKey,
      price: v["lp"] ?? null,
      change: v["ch"] ?? null,
      changePct: v["chp"] ?? null,
      volume: v["volume"] ?? null,
      high: v["high_price"] ?? null,
      low: v["low_price"] ?? null,
      open: v["open_price"] ?? null,
      prevClose: v["prev_close_price"] ?? null,
      timestamp: v["lp_time"] ? v["lp_time"] * 1000 : null,
      session: (v["current_session"] as unknown as string) ?? null,
    };

    this.emit("quote", quote);
  }

  private send(msg: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      logger.info("Reconnecting to TradingView...");
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
