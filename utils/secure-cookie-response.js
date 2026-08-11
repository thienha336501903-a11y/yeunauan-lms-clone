function isHttpsRequest(req) {
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  const vercelEnv = String(process.env.VERCEL_ENV || "").toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  return forwardedProto === "https" || vercelEnv === "production" || nodeEnv === "production";
}

function hardenCookie(cookie, secure) {
  if (typeof cookie !== "string" || !cookie.trim()) return cookie;

  let next = cookie;
  if (!/;\s*httponly(?:;|$)/i.test(next)) {
    next += "; HttpOnly";
  }
  if (secure && !/;\s*secure(?:;|$)/i.test(next)) {
    next += "; Secure";
  }
  if (!/;\s*samesite=/i.test(next)) {
    next += "; SameSite=Lax";
  }
  return next;
}

export function installSecureCookieResponse(req, res) {
  if (!res || res.__secureCookieResponseInstalled) return;
  res.__secureCookieResponseInstalled = true;

  const originalSetHeader = res.setHeader.bind(res);
  const secure = isHttpsRequest(req);

  res.setHeader = (name, value) => {
    if (String(name || "").toLowerCase() === "set-cookie") {
      const hardened = Array.isArray(value)
        ? value.map((cookie) => hardenCookie(cookie, secure))
        : hardenCookie(value, secure);
      return originalSetHeader(name, hardened);
    }
    return originalSetHeader(name, value);
  };
}
