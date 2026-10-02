import crypto from "node:crypto";
import { parseCookies, verifyAdminSession } from "./lms.js";
import { getTrustedHost, normalizeHost } from "./tenant-resolver.js";

const ADMIN_COOKIE = "admin_session_token";
const CSRF_COOKIE = "factory_csrf";

function clean(value) {
  return String(value || "").trim();
}

function expectedFactoryHost(env = process.env) {
  try {
    const url = new URL(clean(env.LMS_PUBLIC_URL) || "https://hoc.yeubep.shop");
    return normalizeHost(url.host);
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(clean(a));
  const right = Buffer.from(clean(b));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requestOrigin(req, host) {
  const forwardedProto = clean(req?.headers?.["x-forwarded-proto"]).split(",")[0].trim();
  const protocol = forwardedProto || (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${protocol}://${host}`;
}

export function factoryActorRef(email) {
  return crypto.createHash("sha256").update(String(email || "").trim().toLowerCase()).digest("hex");
}

export function issueFactoryCsrf(req, res) {
  const cookies = parseCookies(req);
  const existing = clean(cookies[CSRF_COOKIE]);
  const token = /^[A-Za-z0-9_-]{32,}$/.test(existing)
    ? existing
    : crypto.randomBytes(32).toString("base64url");

  if (token !== existing) {
    const parts = [
      `${CSRF_COOKIE}=${encodeURIComponent(token)}`,
      "Path=/",
      "SameSite=Strict",
      "Max-Age=3600"
    ];
    if (process.env.NODE_ENV === "production") parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
  }
  return token;
}

export function requireFactoryAdmin(req, res, options = {}) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Origin");

  const host = getTrustedHost(req);
  const allowedHost = normalizeHost(options.allowedHost || expectedFactoryHost(options.env || process.env));
  if (!host || !allowedHost || host !== allowedHost) {
    return { ok: false, status: 404, code: "factory_host_not_allowed", error: "Factory control plane is not available on this host." };
  }

  const cookies = parseCookies(req);
  const token = clean(cookies[ADMIN_COOKIE]);
  const session = verifyAdminSession(token);
  if (!session?.email) {
    return { ok: false, status: 401, code: "factory_admin_required", error: "Platform admin session required." };
  }

  const mutation = !["GET", "HEAD", "OPTIONS"].includes(String(req.method || "").toUpperCase());
  if (mutation) {
    const suppliedOrigin = clean(req.headers?.origin);
    const expectedOrigin = requestOrigin(req, host);
    if (!suppliedOrigin || suppliedOrigin !== expectedOrigin) {
      return { ok: false, status: 403, code: "factory_origin_denied", error: "Same-origin Factory request required." };
    }

    const fetchSite = clean(req.headers?.["sec-fetch-site"]).toLowerCase();
    if (fetchSite && fetchSite !== "same-origin") {
      return { ok: false, status: 403, code: "factory_fetch_site_denied", error: "Cross-site Factory request denied." };
    }

    const csrfCookie = clean(cookies[CSRF_COOKIE]);
    const csrfHeader = clean(req.headers?.["x-factory-csrf"]);
    if (!safeEqual(csrfCookie, csrfHeader)) {
      return { ok: false, status: 403, code: "factory_csrf_denied", error: "Factory CSRF validation failed." };
    }
  }

  return {
    ok: true,
    session,
    actorRef: factoryActorRef(session.email),
    host
  };
}
