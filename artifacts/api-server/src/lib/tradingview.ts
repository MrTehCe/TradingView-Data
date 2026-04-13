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
  ask: number | null;
  askSize: number | null;
  bid: number | null;
  bidSize: number | null;
}

export interface HistoryBar {
  time: number;    // unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
  private chartSession = "";
  private readonly symbols: string[];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 5000;
  private authToken: string;
  private cookieStr: string;
  private sessionSetup = false;
  private quoteSnapshot: Map<string, QuoteData> = new Map();

  // chart/history tracking
  private seriesSymMap = new Map<string, string>();  // seriesId -> fullSymbol
  private barStore     = new Map<string, HistoryBar[]>(); // fullSymbol -> sorted bars
  private static readonly HISTORY_BARS = 480; // ~8 hours of 1-min bars

  constructor(symbols: string[], authToken = "unauthorized_user_token", cookieStr = "") {
    super();
    this.symbols = symbols;
    this.quoteSession = generateSessionId("qs_");
    this.authToken = authToken;
    this.cookieStr = cookieStr;
  }

  setAuth(token: string, cookieStr = "") {
    this.authToken = token;
    this.cookieStr = cookieStr;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }

  // keep backward compat
  setAuthToken(token: string) {
    this.setAuth(token);
  }

  getHistorySnapshot(): Record<string, { symbol: string; displaySymbol: string; bars: HistoryBar[] }> {
    const result: Record<string, { symbol: string; displaySymbol: string; bars: HistoryBar[] }> = {};
    for (const [sym, bars] of this.barStore) {
      const display = SYMBOL_DISPLAY[sym] ?? sym;
      result[display] = { symbol: sym, displaySymbol: display, bars };
    }
    return result;
  }

  connect() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
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

    this.ws = new WebSocket(TV_WS_URL, {
      headers: wsHeaders,
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

      const msgType = content["m"] as string | undefined;

      if (content["session_id"] !== undefined && !this.sessionSetup) {
        this.sessionSetup = true;
        this.setupQuoteSession();
        this.setupChartSession();
        continue;
      }

      if (msgType === "qsd") {
        try { this.handleQuoteData(content); }
        catch (err) { logger.error({ err }, "handleQuoteData error"); }
      } else if (msgType === "timescale_update" || msgType === "du") {
        try { this.handleBarData(content); }
        catch (err) { logger.error({ err }, "handleBarData error"); }
      } else if (msgType === "critical_error" || msgType === "protocol_error") {
        logger.error({ msgType, content: JSON.stringify(content).slice(0, 300) }, "TV protocol error");
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
        "ask",
        "ask_size",
        "bid",
        "bid_size",
      ])
    );

    for (const symbol of this.symbols) {
      this.send(createMessage("quote_add_symbols", [this.quoteSession, symbol]));
    }

    this.emit("status", { connected: true, authenticated: true });
    logger.info(
      { session: this.quoteSession, symbols: this.symbols },
      "TradingView quote session ready"
    );
  }

  private setupChartSession() {
    try {
      this.chartSession = generateSessionId("cs_");
      this.seriesSymMap.clear();
      // chart_create_session takes only the session id
      this.send(createMessage("chart_create_session", [this.chartSession]));

      this.symbols.forEach((sym, i) => {
        const symId    = `sds_sym_${i}`;
        const seriesId = `sds_${i}`;
        this.seriesSymMap.set(seriesId, sym);

        // resolve_symbol: [chartSession, localAlias, symbolSpec]
        this.send(createMessage("resolve_symbol", [
          this.chartSession, symId,
          `={"symbol":"${sym}","adjustment":"splits","currency-id":"USD"}`,
        ]));

        // create_series: [chartSession, seriesId, name, symbolRef, resolution, count, range]
        this.send(createMessage("create_series", [
          this.chartSession, seriesId, `s${i}`, symId,
          "1",
          TradingViewFeed.HISTORY_BARS,
          "",
        ]));
      });

      logger.info({ session: this.chartSession }, "TradingView chart session ready");
    } catch (err) {
      logger.error({ err }, "Failed to setup chart session (quote session unaffected)");
    }
  }

  private handleBarData(content: Record<string, unknown>) {
    const params = content["p"] as unknown[];
    if (!Array.isArray(params) || params.length < 2) return;

    const updates = params[1];
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) return;

    for (const [seriesId, seriesData] of Object.entries(updates as Record<string, unknown>)) {
      const sym = this.seriesSymMap.get(seriesId);
      if (!sym) continue;

      if (!seriesData || typeof seriesData !== "object") continue;
      const sd = seriesData as { s?: { i: number; v: number[] }[] };
      if (!sd?.s?.length) continue;

      const existing = this.barStore.get(sym) ?? [];
      const barMap = new Map<number, HistoryBar>(existing.map(b => [b.time, b]));

      for (const bar of sd.s) {
        if (!bar.v || bar.v.length < 6) continue;
        const [time, open, high, low, close, volume] = bar.v;
        if (time && typeof open === "number") {
          barMap.set(time, { time, open, high, low, close, volume: volume ?? 0 });
        }
      }

      const sorted = Array.from(barMap.values()).sort((a, b) => a.time - b.time);
      this.barStore.set(sym, sorted);

      const display = SYMBOL_DISPLAY[sym] ?? sym;
      logger.info({ sym, display, bars: sorted.length }, "History bars updated");
      this.emit("history", { symbol: sym, displaySymbol: display, bars: sorted });
    }
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

    // Merge incoming fields with the last-known snapshot for this symbol
    const prev = this.quoteSnapshot.get(symbolKey);
    const merged: QuoteData = {
      symbol: symbolKey,
      displaySymbol: SYMBOL_DISPLAY[symbolKey] ?? symbolKey,
      price: (v["lp"] as number | undefined) ?? prev?.price ?? null,
      change: (v["ch"] as number | undefined) ?? prev?.change ?? null,
      changePct: (v["chp"] as number | undefined) ?? prev?.changePct ?? null,
      volume: (v["volume"] as number | undefined) ?? prev?.volume ?? null,
      high: (v["high_price"] as number | undefined) ?? prev?.high ?? null,
      low: (v["low_price"] as number | undefined) ?? prev?.low ?? null,
      open: (v["open_price"] as number | undefined) ?? prev?.open ?? null,
      prevClose: (v["prev_close_price"] as number | undefined) ?? prev?.prevClose ?? null,
      timestamp: v["lp_time"] ? (v["lp_time"] as number) * 1000 : prev?.timestamp ?? null,
      session: (v["current_session"] as string | undefined) ?? prev?.session ?? null,
      ask: (v["ask"] as number | undefined) ?? prev?.ask ?? null,
      askSize: (v["ask_size"] as number | undefined) ?? prev?.askSize ?? null,
      bid: (v["bid"] as number | undefined) ?? prev?.bid ?? null,
      bidSize: (v["bid_size"] as number | undefined) ?? prev?.bidSize ?? null,
    };

    this.quoteSnapshot.set(symbolKey, merged);

    // Only emit if we have at least a price
    if (merged.price !== null) {
      logger.info(
        { symbol: symbolKey, status: payload.s, price: merged.price },
        "TV quote update"
      );
      this.emit("quote", merged);
    }
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
