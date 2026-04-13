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
        // ignore
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
  ask: number | null;
  askSize: number | null;
  bid: number | null;
  bidSize: number | null;
}

export interface TvConnectionStatus {
  connected: boolean;
  authenticated: boolean;
  error?: string;
}

export const SYMBOL_DISPLAY: Record<string, string> = {
  "CME_MINI:MES1!":  "MES",
  "CME_MINI:MNQ1!":  "MNQ",
  "CBOT_MINI:MYM1!": "MYM",
  "CME_MINI:M2K1!":  "M2K",
  "CME:ES1!":        "ES",
  "CME:NQ1!":        "NQ",
  "CBOT:YM1!":       "YM",
  "CME:RTY1!":       "RTY",
  "COMEX:MGC1!":     "MGC",
  "NYMEX:MCL1!":     "MCL",
  "CME:MBT1!":       "MBT",
  "CME:MET1!":       "MET",
};

const TV_WS_URL =
  "wss://data.tradingview.com/socket.io/websocket?from=chart%2F&date=2024_03_01-11_55&type=chart";

export class TradingViewFeed extends EventEmitter {
  private ws: WebSocket | null = null;
  private quoteSession: string;
  private symbols: string[];
  private pendingSymbols: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 5000;
  private authToken: string;
  private cookieStr: string;
  private sessionSetup = false;
  private quoteSnapshot: Map<string, QuoteData> = new Map();

  constructor(symbols: string[], authToken = "unauthorized_user_token", cookieStr = "") {
    super();
    this.symbols = [...symbols];
    this.quoteSession = generateSessionId("qs_");
    this.authToken = authToken;
    this.cookieStr = cookieStr;
  }

  setAuth(token: string, cookieStr = "") {
    this.authToken = token;
    this.cookieStr = cookieStr;
    // Cancel any pending reconnect so it doesn't race with the manual connect() call
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Terminate silently (no listeners = no close event = no stray scheduleReconnect)
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
  }

  setAuthToken(token: string) {
    this.setAuth(token);
  }

  /** Dynamically add a symbol to the active session (or queue it for when session starts). */
  addSymbol(tvSymbol: string) {
    if (this.symbols.includes(tvSymbol)) return;
    this.symbols.push(tvSymbol);

    if (this.sessionSetup && this.ws?.readyState === WebSocket.OPEN) {
      this.send(createMessage("quote_add_symbols", [this.quoteSession, tvSymbol]));
      logger.info({ symbol: tvSymbol }, "Dynamically subscribed to symbol");
    } else {
      this.pendingSymbols.push(tvSymbol);
    }
  }

  connect() {
    // Cancel any stale reconnect timer — caller is taking over
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }

    logger.info({ url: TV_WS_URL }, "Connecting to TradingView");

    const wsHeaders: Record<string, string> = {
      Origin: "https://www.tradingview.com",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    };
    if (this.cookieStr) {
      wsHeaders["Cookie"] = this.cookieStr;
    }

    this.ws = new WebSocket(TV_WS_URL, { headers: wsHeaders });

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
      this.sessionSetup = false;
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
        this.send(`~m~${hb.length + 3}~m~~h~${hb}`);
        continue;
      }

      const content = msg.content;
      if (!content) continue;

      const msgType = content["m"] as string | undefined;

      if (content["session_id"] !== undefined && !this.sessionSetup) {
        this.sessionSetup = true;
        this.setupQuoteSession();
        continue;
      }

      if (msgType === "qsd") {
        this.handleQuoteData(content);
      } else if (msgType === "critical_error" || msgType === "protocol_error") {
        logger.error({ msgType, content: JSON.stringify(content).slice(0, 300) }, "TV protocol error");
      }
    }
  }

  private setupQuoteSession() {
    this.quoteSession = generateSessionId("qs_");
    this.send(createMessage("set_auth_token", [this.authToken]));
    this.send(createMessage("quote_create_session", [this.quoteSession]));
    this.send(createMessage("quote_set_fields", [
      this.quoteSession,
      "ch", "chp", "lp", "lp_time", "volume",
      "high_price", "low_price", "open_price", "prev_close_price",
      "current_session", "status", "update_mode",
      "ask", "ask_size", "bid", "bid_size",
    ]));

    const allSymbols = [...new Set([...this.symbols, ...this.pendingSymbols])];
    this.pendingSymbols = [];

    for (const symbol of allSymbols) {
      this.send(createMessage("quote_add_symbols", [this.quoteSession, symbol]));
    }

    this.emit("status", { connected: true, authenticated: true });
    logger.info({ session: this.quoteSession, symbols: allSymbols }, "TradingView quote session ready");
  }

  private handleQuoteData(content: Record<string, unknown>) {
    const params = content["p"] as [
      string,
      { n: string; s: string; v: Record<string, number | string> },
    ];
    if (!params || params.length < 2) return;

    const payload = params[1];
    if (!payload?.n) return;

    const symbolKey = payload.n;
    const v = payload.v ?? {};

    const prev = this.quoteSnapshot.get(symbolKey);
    const merged: QuoteData = {
      symbol: symbolKey,
      displaySymbol: SYMBOL_DISPLAY[symbolKey] ?? symbolKey,
      price:     (v["lp"]             as number | undefined) ?? prev?.price     ?? null,
      change:    (v["ch"]             as number | undefined) ?? prev?.change    ?? null,
      changePct: (v["chp"]            as number | undefined) ?? prev?.changePct ?? null,
      volume:    (v["volume"]         as number | undefined) ?? prev?.volume    ?? null,
      high:      (v["high_price"]     as number | undefined) ?? prev?.high      ?? null,
      low:       (v["low_price"]      as number | undefined) ?? prev?.low       ?? null,
      open:      (v["open_price"]     as number | undefined) ?? prev?.open      ?? null,
      prevClose: (v["prev_close_price"] as number | undefined) ?? prev?.prevClose ?? null,
      timestamp: v["lp_time"] ? (v["lp_time"] as number) * 1000 : prev?.timestamp ?? null,
      session:   (v["current_session"] as string | undefined) ?? prev?.session  ?? null,
      ask:       (v["ask"]            as number | undefined) ?? prev?.ask       ?? null,
      askSize:   (v["ask_size"]       as number | undefined) ?? prev?.askSize   ?? null,
      bid:       (v["bid"]            as number | undefined) ?? prev?.bid       ?? null,
      bidSize:   (v["bid_size"]       as number | undefined) ?? prev?.bidSize   ?? null,
    };

    this.quoteSnapshot.set(symbolKey, merged);

    if (merged.price !== null) {
      this.emit("quote", merged);
    }
  }

  getSnapshot(): Map<string, QuoteData> {
    return this.quoteSnapshot;
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
