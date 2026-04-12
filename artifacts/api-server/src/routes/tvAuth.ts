import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const TV_SIGNIN_URL = "https://www.tradingview.com/accounts/signin/";
const TV_2FA_URL = "https://www.tradingview.com/accounts/two-factor/signin/totp/";

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Origin: "https://www.tradingview.com",
  Referer: "https://www.tradingview.com/",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

function parseCookies(rawCookies: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of rawCookies) {
    const [pair] = c.split(";");
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (name) map.set(name, value);
  }
  return map;
}

function serializeCookies(map: Map<string, string>): string {
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function mergeCookies(existing: Map<string, string>, incoming: string[]): Map<string, string> {
  const merged = new Map(existing);
  for (const [k, v] of parseCookies(incoming)) {
    merged.set(k, v);
  }
  return merged;
}

const pendingAuth = new Map<string, { cookies: Map<string, string>; createdAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingAuth.entries()) {
    if (now - v.createdAt > 10 * 60 * 1000) pendingAuth.delete(k);
  }
}, 60_000);

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return res.json() as Promise<Record<string, unknown>>;
  }
  const text = await res.text();
  logger.warn({ status: res.status, preview: text.slice(0, 200) }, "Non-JSON response from TradingView");
  return {};
}

async function getJwtToken(cookies: Map<string, string>): Promise<string | null> {
  const cookieStr = serializeCookies(cookies);

  // Approach: fetch the TV homepage with session cookies — the server renders
  // window.initData with auth_token for authenticated users.
  try {
    const res = await fetch("https://www.tradingview.com/", {
      headers: {
        ...BASE_HEADERS,
        Cookie: cookieStr,
        "Cache-Control": "no-cache",
      },
    });
    const html = await res.text();

    // Several regex patterns TV has used over the years
    const patterns = [
      /"auth_token"\s*:\s*"(eyJ[^"]+)"/,
      /auth_token['":\s]+["']?(eyJ[^"'\s]+)/,
      /"token"\s*:\s*"(eyJ[^"]+)"/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        logger.info({ tokenPrefix: match[1].slice(0, 20) }, "TV auth_token extracted from page");
        return match[1];
      }
    }

    logger.warn({ status: res.status, htmlLen: html.length }, "auth_token not found in TV homepage");
    return null;
  } catch (err) {
    logger.error({ err }, "TV JWT extraction failed");
    return null;
  }
}

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
      headers: { ...BASE_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "manual",
    });

    const rawCookies = tvRes.headers.getSetCookie?.() ?? [];
    const cookies = parseCookies(rawCookies);
    const data = await safeJson(tvRes);

    logger.info({ status: tvRes.status, hasUser: !!data.user, error: data.error, code: data.code }, "TV signin");

    if (data.user) {
      const cookieStr = serializeCookies(cookies);
      const jwtToken = await getJwtToken(cookies);
      // jwtToken may be null if TV page doesn't embed it; cookieStr auth is the fallback
      res.json({ success: true, sessionId: jwtToken ?? "unauthorized_user_token", cookieStr });
      return;
    }

    const code = String(data.code ?? data.error ?? "").toLowerCase();
    const needs2FA = code.includes("2fa") || code.includes("two_factor") || code.includes("two-factor") || code.includes("totp");

    if (needs2FA) {
      const tempKey = `tv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pendingAuth.set(tempKey, { cookies, createdAt: Date.now() });
      logger.info({ tempKey, cookieKeys: [...cookies.keys()] }, "2FA pending");
      res.json({ success: false, needs2FA: true, tempKey });
      return;
    }

    const errMsg = String(data.error ?? data.code ?? "Login failed. Check your credentials.");
    res.status(401).json({ error: errMsg, needs2FA: false });
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
    res.status(400).json({ error: "Session expired. Please log in again." });
    return;
  }

  try {
    const cookieStr = serializeCookies(pending.cookies);
    const body = new URLSearchParams({ code: code.trim().replace(/\s/g, "") });

    logger.info({ cookieKeys: [...pending.cookies.keys()], url: TV_2FA_URL }, "TV 2FA POST");

    const tvRes = await fetch(TV_2FA_URL, {
      method: "POST",
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://www.tradingview.com/accounts/two-factor/signin/totp/",
        Cookie: cookieStr,
      },
      body: body.toString(),
      redirect: "manual",
    });

    const rawCookies = tvRes.headers.getSetCookie?.() ?? [];
    const finalCookies = mergeCookies(pending.cookies, rawCookies);
    const data = await safeJson(tvRes);

    logger.info(
      { status: tvRes.status, hasUser: !!data.user, code: data.code, error: data.error, newCookieKeys: [...parseCookies(rawCookies).keys()] },
      "TV 2FA response"
    );

    if (data.user || tvRes.status === 200) {
      if (!finalCookies.get("sessionid")) {
        res.status(500).json({ error: "2FA succeeded but no session cookie found. Try the manual token option." });
        return;
      }
      const cookieStr = serializeCookies(finalCookies);
      const jwtToken = await getJwtToken(finalCookies);
      // Fall back to cookie-header auth if JWT extraction fails
      pendingAuth.delete(tempKey);
      res.json({ success: true, sessionId: jwtToken ?? "unauthorized_user_token", cookieStr });
      return;
    }

    if (tvRes.status === 403) {
      const detail = String(data.detail ?? data.error ?? "");
      if (detail.toLowerCase().includes("expired")) {
        pendingAuth.delete(tempKey);
        res.status(401).json({ error: "Login session expired — please sign in again." });
        return;
      }
    }

    res.status(401).json({
      error: String(data.detail ?? data.error ?? data.code ?? "2FA verification failed. Check your code."),
    });
  } catch (err) {
    logger.error({ err }, "TradingView 2FA error");
    res.status(500).json({ error: "Failed to verify 2FA code" });
  }
});

export default router;
