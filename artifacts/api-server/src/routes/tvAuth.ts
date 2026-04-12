import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const TV_SIGNIN_URL = "https://www.tradingview.com/accounts/signin/";
const TV_2FA_URL = "https://www.tradingview.com/accounts/two-factor/sign-in/totp/";

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Origin: "https://www.tradingview.com",
  Referer: "https://www.tradingview.com/",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

function extractSessionId(cookies: string[]): string | null {
  for (const c of cookies) {
    const match = c.match(/sessionid=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

function extractAllCookies(cookies: string[]): string {
  return cookies
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

const pendingAuth = new Map<
  string,
  { cookies: string; createdAt: number }
>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingAuth.entries()) {
    if (now - v.createdAt > 5 * 60 * 1000) pendingAuth.delete(k);
  }
}, 60_000);

router.post("/auth/tradingview/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }

  try {
    const body = new URLSearchParams({ username, password, remember: "on" });

    const tvRes = await fetch(TV_SIGNIN_URL, {
      method: "POST",
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      redirect: "manual",
    });

    const rawCookies = tvRes.headers.getSetCookie?.() ?? [];
    const cookieStr = extractAllCookies(rawCookies);
    const data = await tvRes.json() as Record<string, unknown>;

    logger.info({ status: tvRes.status, hasUser: !!data.user }, "TV signin response");

    if (data.user) {
      const sessionId = extractSessionId(rawCookies);
      res.json({ success: true, sessionId, needs2FA: false });
      return;
    }

    const errMsg = String(data.error ?? "").toLowerCase();
    const needs2FA =
      errMsg.includes("2fa") ||
      errMsg.includes("two-factor") ||
      errMsg.includes("totp") ||
      tvRes.status === 403;

    if (needs2FA) {
      const tempKey = `tv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pendingAuth.set(tempKey, { cookies: cookieStr, createdAt: Date.now() });
      res.json({ success: false, needs2FA: true, tempKey });
      return;
    }

    res.status(401).json({ error: data.error ?? "Login failed", needs2FA: false });
  } catch (err) {
    logger.error({ err }, "TradingView login error");
    res.status(500).json({ error: "Failed to connect to TradingView" });
  }
});

router.post("/auth/tradingview/verify-2fa", async (req, res) => {
  const { code, tempKey } = req.body as { code?: string; tempKey?: string };

  if (!code || !tempKey) {
    res.status(400).json({ error: "code and tempKey are required" });
    return;
  }

  const pending = pendingAuth.get(tempKey);
  if (!pending) {
    res.status(400).json({ error: "Session expired or invalid. Please log in again." });
    return;
  }

  try {
    const body = new URLSearchParams({ code: code.trim().replace(/\s/g, "") });

    const tvRes = await fetch(TV_2FA_URL, {
      method: "POST",
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: pending.cookies,
      },
      body: body.toString(),
      redirect: "manual",
    });

    const rawCookies = tvRes.headers.getSetCookie?.() ?? [];
    const allCookies = [...pending.cookies.split("; "), ...rawCookies.map((c) => c.split(";")[0].trim())];
    const sessionId = extractSessionId(rawCookies) ?? extractSessionId(pending.cookies.split("; ").map(c => `${c};`));

    const data = await tvRes.json() as Record<string, unknown>;
    logger.info({ status: tvRes.status, hasUser: !!data.user }, "TV 2FA response");

    if (data.user || tvRes.status === 200) {
      pendingAuth.delete(tempKey);
      res.json({ success: true, sessionId });
      return;
    }

    res.status(401).json({ error: data.error ?? "2FA verification failed" });
  } catch (err) {
    logger.error({ err }, "TradingView 2FA error");
    res.status(500).json({ error: "Failed to verify 2FA code" });
  }
});

export default router;
