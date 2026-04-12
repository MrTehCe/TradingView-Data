import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const TV_BASE = "https://www.tradingview.com";
const TV_SIGNIN_URL = `${TV_BASE}/accounts/signin/`;
const TV_2FA_URL = `${TV_BASE}/accounts/two-factor/sign-in/totp/`;

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Origin: TV_BASE,
  Referer: `${TV_BASE}/`,
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

const pendingAuth = new Map<
  string,
  { cookies: Map<string, string>; createdAt: number }
>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingAuth.entries()) {
    if (now - v.createdAt > 10 * 60 * 1000) pendingAuth.delete(k);
  }
}, 60_000);

async function getInitialCookies(): Promise<Map<string, string>> {
  const res = await fetch(`${TV_BASE}/`, {
    headers: BASE_HEADERS,
    redirect: "manual",
  });
  const rawCookies = res.headers.getSetCookie?.() ?? [];
  return parseCookies(rawCookies);
}

router.post("/auth/tradingview/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }

  try {
    // Step 1: fetch homepage to get csrftoken
    const initialCookies = await getInitialCookies();
    const csrfToken = initialCookies.get("csrftoken") ?? "";

    logger.info({ csrfToken: csrfToken ? "[present]" : "[missing]" }, "TV CSRF preflight");

    // Step 2: sign in
    const body = new URLSearchParams({ username, password, remember: "on" });

    const tvRes = await fetch(TV_SIGNIN_URL, {
      method: "POST",
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: serializeCookies(initialCookies),
        "X-CSRFToken": csrfToken,
      },
      body: body.toString(),
      redirect: "manual",
    });

    const rawCookies = tvRes.headers.getSetCookie?.() ?? [];
    const sessionCookies = mergeCookies(initialCookies, rawCookies);

    let data: Record<string, unknown> = {};
    const contentType = tvRes.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      data = await tvRes.json() as Record<string, unknown>;
    } else {
      const text = await tvRes.text();
      logger.warn({ status: tvRes.status, text: text.slice(0, 300) }, "TV signin non-JSON response");
    }

    logger.info({ status: tvRes.status, hasUser: !!data.user, error: data.error }, "TV signin response");

    if (data.user) {
      const sessionId = sessionCookies.get("sessionid") ?? null;
      res.json({ success: true, sessionId });
      return;
    }

    const errMsg = String(data.error ?? "").toLowerCase();
    const needs2FA =
      errMsg.includes("2fa") ||
      errMsg.includes("two_factor") ||
      errMsg.includes("two-factor") ||
      errMsg.includes("totp") ||
      errMsg === "2fa required" ||
      tvRes.status === 400 && !!sessionCookies.get("csrftoken");

    if (needs2FA) {
      const tempKey = `tv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pendingAuth.set(tempKey, { cookies: sessionCookies, createdAt: Date.now() });
      logger.info({ tempKey, cookieKeys: [...sessionCookies.keys()] }, "Stored pending 2FA session");
      res.json({ success: false, needs2FA: true, tempKey });
      return;
    }

    res.status(401).json({
      error: String(data.error ?? "Login failed. Check your credentials."),
      needs2FA: false,
    });
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
    const csrfToken = pending.cookies.get("csrftoken") ?? "";
    const cookieStr = serializeCookies(pending.cookies);

    logger.info(
      { cookieKeys: [...pending.cookies.keys()], csrfToken: csrfToken ? "[present]" : "[missing]" },
      "TV 2FA attempt"
    );

    const body = new URLSearchParams({ code: code.trim().replace(/\s/g, "") });

    const tvRes = await fetch(TV_2FA_URL, {
      method: "POST",
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieStr,
        "X-CSRFToken": csrfToken,
      },
      body: body.toString(),
      redirect: "manual",
    });

    const rawCookies = tvRes.headers.getSetCookie?.() ?? [];
    const finalCookies = mergeCookies(pending.cookies, rawCookies);

    let data: Record<string, unknown> = {};
    const contentType = tvRes.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      data = await tvRes.json() as Record<string, unknown>;
    } else {
      const text = await tvRes.text();
      logger.warn({ status: tvRes.status, text: text.slice(0, 300) }, "TV 2FA non-JSON response");
    }

    logger.info({ status: tvRes.status, hasUser: !!data.user, error: data.error }, "TV 2FA response");

    if (data.user || tvRes.status === 200) {
      const sessionId = finalCookies.get("sessionid") ?? null;
      if (!sessionId) {
        logger.warn({ cookieKeys: [...finalCookies.keys()] }, "2FA succeeded but no sessionid found");
        res.status(500).json({ error: "Authenticated but could not extract session. Try pasting the session token manually." });
        return;
      }
      pendingAuth.delete(tempKey);
      res.json({ success: true, sessionId });
      return;
    }

    const errMsg = String(data.error ?? "");
    res.status(401).json({ error: errMsg || "2FA verification failed. Check your code and try again." });
  } catch (err) {
    logger.error({ err }, "TradingView 2FA error");
    res.status(500).json({ error: "Failed to verify 2FA code" });
  }
});

export default router;
