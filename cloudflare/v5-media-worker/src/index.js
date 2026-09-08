let cachedPublicJwksRaw = "";
let cachedPublicKeysPromise = null;
let cachedAllowedOriginsRaw = "";
let cachedAllowedOrigins = new Set();

function json(status, data, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

function base64urlBytes(value) {
  const input = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = input + "=".repeat((4 - (input.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodePayload(value) {
  return JSON.parse(new TextDecoder().decode(base64urlBytes(value)));
}

function clean(value) {
  return String(value || "").trim();
}

async function sha256base64url(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function publicKeys(env) {
  const raws = [env.V5_PLAYBACK_PUBLIC_JWK, env.V5_PLAYBACK_PUBLIC_JWK_PREVIEW].map(clean).filter(Boolean);
  const cacheKey = raws.join("\n");
  if (cachedPublicKeysPromise && cachedPublicJwksRaw === cacheKey) return cachedPublicKeysPromise;
  if (!raws.length) throw new Error("invalid_public_jwk");

  const promise = Promise.all(raws.map(async raw => {
    let jwk;
    try { jwk = JSON.parse(raw); } catch { throw new Error("invalid_public_jwk"); }
    if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || !jwk?.x || !jwk?.y) throw new Error("invalid_public_jwk");
    return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }));
  cachedPublicJwksRaw = cacheKey;
  cachedPublicKeysPromise = promise;
  try {
    return await promise;
  } catch (error) {
    if (cachedPublicKeysPromise === promise) {
      cachedPublicJwksRaw = "";
      cachedPublicKeysPromise = null;
    }
    throw error;
  }
}

async function verifyLease(token, request, env, expectedVersion = 1) {
  const parts = clean(token).split(".");
  if (parts.length !== 2) return { ok: false, status: 401, error: "invalid_token" };
  const [encoded, signatureText] = parts;
  let payload;
  try { payload = decodePayload(encoded); } catch { return { ok: false, status: 401, error: "invalid_payload" }; }
  if (payload?.v !== expectedVersion || !payload?.aid || !payload?.c || !payload?.k || !payload?.exp) return { ok: false, status: 401, error: "invalid_claims" };
  if (Number(payload.exp) <= Date.now()) return { ok: false, status: 403, error: "lease_expired" };
  if (Number(payload.exp) - Number(payload.iat || 0) > 30 * 60 * 1000 + 5000) return { ok: false, status: 403, error: "lease_ttl_invalid" };
  const uaHash = await sha256base64url(request.headers.get("user-agent") || "");
  if (!payload.uah || payload.uah !== uaHash) return { ok: false, status: 403, error: "lease_ua_mismatch" };
  try {
    const keys = await publicKeys(env);
    let valid = false;
    for (const key of keys) {
      if (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64urlBytes(signatureText), new TextEncoder().encode(encoded))) {
        valid = true;
        break;
      }
    }
    if (!valid) return { ok: false, status: 403, error: "invalid_signature" };
  } catch {
    return { ok: false, status: 500, error: "worker_key_error" };
  }
  return { ok: true, payload };
}

function bearerToken(request) {
  const match = clean(request.headers.get("authorization")).match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : "";
}

function downloaderUserAgent(request) {
  return /\b(?:IDM|IDMan|JDownloader|aria2|wget|curl|FDM|python-requests|Go-http-client)\b/i.test(clean(request.headers.get("user-agent")));
}

function validProofJwk(jwk) {
  return Boolean(jwk && jwk.kty === "EC" && jwk.crv === "P-256" && jwk.x && jwk.y && !jwk.d);
}

async function verifyRequestProof(request, token, payload, origin) {
  if (clean(request.headers.get("x-v5-playback")) !== "sw-v2") return { ok: false, error: "sw_marker_required" };
  if (downloaderUserAgent(request)) return { ok: false, error: "downloader_user_agent" };
  const timestampText = clean(request.headers.get("x-v5-playback-timestamp"));
  if (!/^\d{13}$/.test(timestampText) || Math.abs(Date.now() - Number(timestampText)) > 45_000) return { ok: false, error: "request_timestamp_invalid" };
  const nonce = clean(request.headers.get("x-v5-playback-nonce"));
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(nonce)) return { ok: false, error: "request_nonce_invalid" };
  const signatureText = clean(request.headers.get("x-v5-playback-signature"));
  if (!signatureText || !validProofJwk(payload.pk)) return { ok: false, error: "request_proof_invalid" };
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const range = clean(request.headers.get("range"));
  const canonical = [method, range, timestampText, nonce, token, origin].join("\n");
  try {
    const key = await crypto.subtle.importKey("jwk", payload.pk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64urlBytes(signatureText), new TextEncoder().encode(canonical));
    return valid ? { ok: true, nonce } : { ok: false, error: "request_signature_invalid" };
  } catch {
    return { ok: false, error: "request_signature_invalid" };
  }
}

async function consumeNonce(payload, nonce, env) {
  const namespace = env.V5_PLAYBACK_NONCES;
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") return { ok: false, status: 503, error: "nonce_guard_unavailable" };
  try {
    const id = namespace.idFromName(clean(payload.eh));
    const response = await namespace.get(id).fetch("https://nonce.internal/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce, expiresAt: Math.min(Number(payload.exp), Date.now() + 60_000) })
    });
    if (response.status === 204) return { ok: true };
    if (response.status === 409) return { ok: false, status: 403, error: "request_nonce_replayed" };
  } catch {}
  return { ok: false, status: 503, error: "nonce_guard_unavailable" };
}

function rateLimitRetryAfter(env) {
  const seconds = Number(env.V5_MEDIA_RATE_LIMIT_RETRY_AFTER_SECONDS || 60);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 3600 ? seconds : 60;
}

async function enforceMediaRateLimit(payload, env, corsHeaders) {
  const emailHash = clean(payload?.eh);
  const assetId = clean(payload?.aid);
  if (!emailHash || !assetId) {
    return json(403, { ok: false, error: "rate_limit_identity_invalid" }, {
      ...corsHeaders,
      "Cache-Control": "private, no-store"
    });
  }
  if (!env.V5_MEDIA_RATE_LIMITER || typeof env.V5_MEDIA_RATE_LIMITER.limit !== "function") {
    return json(503, { ok: false, error: "rate_limiter_unavailable" }, {
      ...corsHeaders,
      "Cache-Control": "private, no-store"
    });
  }
  let result;
  try {
    result = await env.V5_MEDIA_RATE_LIMITER.limit({ key: `${emailHash}:${assetId}` });
  } catch {
    return json(503, { ok: false, error: "rate_limiter_unavailable" }, {
      ...corsHeaders,
      "Cache-Control": "private, no-store"
    });
  }
  if (result?.success) return null;
  const retryAfter = rateLimitRetryAfter(env);
  return json(429, { ok: false, error: "rate_limit_exceeded" }, {
    ...corsHeaders,
    "Cache-Control": "private, no-store",
    "Retry-After": String(retryAfter)
  });
}

function allowedOrigins(env) {
  const raw = clean(env.V5_ALLOWED_ORIGINS);
  if (raw !== cachedAllowedOriginsRaw) {
    cachedAllowedOriginsRaw = raw;
    cachedAllowedOrigins = new Set(raw.split(",").map(x => x.trim()).filter(Boolean));
  }
  return cachedAllowedOrigins;
}

function cors(request, env) {
  const origin = clean(request.headers.get("origin"));
  if (!origin) return {};
  if (!allowedOrigins(env).has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Range,Content-Type,Authorization,X-V5-Playback,X-V5-Playback-Timestamp,X-V5-Playback-Nonce,X-V5-Playback-Signature",
    "Access-Control-Expose-Headers": "Accept-Ranges,Content-Length,Content-Range,Content-Type,Content-Disposition,ETag,Retry-After",
    "Vary": "Origin"
  };
}

function contentDisposition(filename, inline = true) {
  const safe = clean(filename).replace(/[\r\n"]/g, "") || "media";
  return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function trustedObjectSize(payload) {
  if (payload?.sz === undefined || payload?.sz === null || payload?.sz === "") return null;
  const size = Number(payload.sz);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function parseRangeRequest(header) {
  const text = clean(header);
  if (!text) return null;
  const match = text.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  if (match[1]) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : null;
    if (!Number.isSafeInteger(start) || start < 0 || (end !== null && (!Number.isSafeInteger(end) || end < start))) return { invalid: true };
    return {
      start,
      end,
      r2: end === null ? { offset: start } : { offset: start, length: end - start + 1 }
    };
  }
  const suffix = Number(match[2]);
  if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
  return { suffix, r2: { suffix } };
}

function resolveRange(requested, size) {
  if (!requested) return null;
  if (requested.invalid || !Number.isSafeInteger(size) || size < 0) return { invalid: true };
  if (requested.suffix !== undefined) {
    const length = Math.min(requested.suffix, size);
    if (length <= 0) return { invalid: true };
    const start = size - length;
    return { start, end: size - 1, length };
  }
  if (requested.start >= size) return { invalid: true };
  const end = requested.end === null ? size - 1 : Math.min(requested.end, size - 1);
  return { start: requested.start, end, length: end - requested.start + 1 };
}

function rangeNotSatisfiable(size, corsHeaders) {
  return new Response(null, {
    status: 416,
    headers: {
      ...corsHeaders,
      "Content-Range": Number.isSafeInteger(size) && size >= 0 ? `bytes */${size}` : "bytes */*",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store"
    }
  });
}

function mediaHeaders(source, payload, corsHeaders) {
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", clean(payload.ct) || source.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", contentDisposition(payload.fn, payload.ct?.startsWith("video/") || payload.ct?.startsWith("image/") || payload.ct === "application/pdf"));
  if (source.httpEtag) headers.set("ETag", source.httpEtag);
  else if (source.etag) headers.set("ETag", source.etag);
  return headers;
}

function isInvalidRangeError(error) {
  const message = String(error?.message || error || "");
  return Number(error?.code) === 10039 || /(?:InvalidRange|\(10039\))/.test(message);
}

function r2RangeFor(requested, resolved, trustedSize) {
  if (!requested || requested.invalid) return undefined;
  if (trustedSize !== null && resolved && !resolved.invalid) {
    return { offset: resolved.start, length: resolved.length };
  }
  return requested.r2;
}

async function serveMedia(request, env, corsHeaders, payload, requireVideoRange = false) {
  const requestedRange = parseRangeRequest(request.headers.get("range"));
  const trustedSize = trustedObjectSize(payload);
  const isVideo = clean(payload.mt).toLowerCase() === "video" || clean(payload.ct).toLowerCase().startsWith("video/");
  if (requireVideoRange && request.method === "GET" && isVideo && !requestedRange) {
    return rangeNotSatisfiable(trustedSize, corsHeaders);
  }
  const rateLimited = await enforceMediaRateLimit(payload, env, corsHeaders);
  if (rateLimited) return rateLimited;

  if (request.method === "HEAD") {
    if (requestedRange?.invalid) return rangeNotSatisfiable(trustedSize, corsHeaders);
    const head = await env.V5_MEDIA.head(payload.k);
    if (!head) return json(404, { ok: false, error: "media_not_found" }, corsHeaders);
    const size = Number(head.size || 0);
    if (trustedSize !== null && size !== trustedSize) return json(502, { ok: false, error: "media_size_mismatch" }, { ...corsHeaders, "Cache-Control": "private, no-store" });
    const range = resolveRange(requestedRange, size);
    if (range?.invalid) return rangeNotSatisfiable(size, corsHeaders);
    const headers = mediaHeaders(head, payload, corsHeaders);
    headers.set("Content-Length", String(range ? range.length : size));
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    return new Response(null, { status: range ? 206 : 200, headers });
  }

  if (requestedRange?.invalid) return rangeNotSatisfiable(trustedSize, corsHeaders);
  const trustedRange = trustedSize !== null ? resolveRange(requestedRange, trustedSize) : null;
  if (trustedRange?.invalid) return rangeNotSatisfiable(trustedSize, corsHeaders);

  let object;
  try {
    const r2Range = r2RangeFor(requestedRange, trustedRange, trustedSize);
    object = await env.V5_MEDIA.get(payload.k, r2Range ? { range: r2Range } : undefined);
  } catch (error) {
    if (isInvalidRangeError(error)) return rangeNotSatisfiable(trustedSize, corsHeaders);
    throw error;
  }
  if (!object?.body) return json(404, { ok: false, error: "media_not_found" }, corsHeaders);
  const size = Number(object.size || 0);
  if (trustedSize !== null && size !== trustedSize) return json(502, { ok: false, error: "media_size_mismatch" }, { ...corsHeaders, "Cache-Control": "private, no-store" });
  const range = trustedRange || resolveRange(requestedRange, size);
  if (range?.invalid) return rangeNotSatisfiable(size, corsHeaders);
  const headers = mediaHeaders(object, payload, corsHeaders);
  headers.set("Content-Length", String(range ? range.length : size));
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

async function mediaV1(request, env, corsHeaders) {
  const url = new URL(request.url);
  const access = await verifyLease(url.searchParams.get("t"), request, env, 1);
  if (!access.ok) return json(access.status, { ok: false, error: access.error }, corsHeaders);
  return serveMedia(request, env, corsHeaders, access.payload, false);
}

async function mediaV2(request, env, corsHeaders, origin) {
  const url = new URL(request.url);
  const token = bearerToken(request);
  if (!token) return json(401, { ok: false, error: "authorization_required" }, corsHeaders);
  if (url.searchParams.has("t")) return json(400, { ok: false, error: "query_token_forbidden" }, corsHeaders);
  const access = await verifyLease(token, request, env, 2);
  if (!access.ok) return json(access.status, { ok: false, error: access.error }, corsHeaders);
  if (!clean(access.payload.eh) || !validProofJwk(access.payload.pk)) return json(403, { ok: false, error: "invalid_v2_claims" }, corsHeaders);
  const proof = await verifyRequestProof(request, token, access.payload, origin);
  if (!proof.ok) return json(403, { ok: false, error: proof.error }, corsHeaders);
  const nonce = await consumeNonce(access.payload, proof.nonce, env);
  if (!nonce.ok) return json(nonce.status, { ok: false, error: nonce.error }, corsHeaders);
  return serveMedia(request, env, corsHeaders, access.payload, true);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isV2 = url.pathname === "/v2/media";
    const origin = clean(request.headers.get("origin"));
    if (isV2 && (!origin || !allowedOrigins(env).has(origin))) return json(403, { ok: false, error: "origin_not_allowed" });
    const corsHeaders = cors(request, env);
    if (corsHeaders === null) return json(403, { ok: false, error: "origin_not_allowed" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (!["GET", "HEAD"].includes(request.method)) return json(405, { ok: false, error: "method_not_allowed" }, corsHeaders);
    if (url.pathname === "/health") return json(200, { ok: true, service: "v5-r2-media" }, corsHeaders);
    if (url.pathname === "/v1/media") return mediaV1(request, env, corsHeaders);
    if (isV2) return mediaV2(request, env, corsHeaders, origin);
    return json(404, { ok: false, error: "not_found" }, corsHeaders);
  }
};

export class V5PlaybackNonceGuard {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const data = await request.json().catch(() => ({}));
    const nonce = clean(data.nonce);
    const expiresAt = Number(data.expiresAt);
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(nonce) || !Number.isFinite(expiresAt)) return new Response(null, { status: 400 });
    const key = `n:${nonce}`;
    if (await this.storage.get(key)) return new Response(null, { status: 409 });
    await this.storage.put(key, expiresAt);
    const alarm = await this.storage.getAlarm();
    if (!alarm || alarm > expiresAt) await this.storage.setAlarm(expiresAt);
    return new Response(null, { status: 204 });
  }

  async alarm() {
    const now = Date.now();
    const entries = await this.storage.list({ prefix: "n:" });
    let next = null;
    for (const [key, expiresAt] of entries) {
      if (Number(expiresAt) <= now) await this.storage.delete(key);
      else next = next === null ? Number(expiresAt) : Math.min(next, Number(expiresAt));
    }
    if (next !== null) await this.storage.setAlarm(next);
  }
}
