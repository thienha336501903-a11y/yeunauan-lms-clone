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

async function publicKey(env) {
  let jwk;
  try { jwk = JSON.parse(clean(env.V5_PLAYBACK_PUBLIC_JWK)); } catch { throw new Error("invalid_public_jwk"); }
  if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || !jwk?.x || !jwk?.y) throw new Error("invalid_public_jwk");
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

async function verifyLease(token, request, env) {
  const parts = clean(token).split(".");
  if (parts.length !== 2) return { ok: false, status: 401, error: "invalid_token" };
  const [encoded, signatureText] = parts;
  let payload;
  try { payload = decodePayload(encoded); } catch { return { ok: false, status: 401, error: "invalid_payload" };
  if (payload?.v !== 1 || !payload?.aid || !payload?.c || !payload?.k || !payload?.exp) return { ok: false, status: 401, error: "invalid_claims" };
  if (Number(payload.exp) <= Date.now()) return { ok: false, status: 403, error: "lease_expired" };
  if (Number(payload.exp) - Number(payload.iat || 0) > 30 * 60 * 1000 + 5000) return { ok: false, status: 403, error: "lease_ttl_invalid" };
  const uaHash = await sha256base64url(request.headers.get("user-agent") || "");
  if (!payload.uah || payload.uah !== uaHash) return { ok: false, status: 403, error: "lease_ua_mismatch" };
  try {
    const key = await publicKey(env);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64urlBytes(signatureText), new TextEncoder().encode(encoded));
    if (!valid) return { ok: false, status: 403, error: "invalid_signature" };
  } catch {
    return { ok: false, status: 500, error: "worker_key_error" };
  }
  return { ok: true, payload };
}

function cors(request, env) {
  const origin = clean(request.headers.get("origin"));
  const allowed = clean(env.V5_ALLOWED_ORIGINS).split(",").map(x => x.trim()).filter(Boolean);
  if (!origin) return {};
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Range,Content-Type",
    "Access-Control-Expose-Headers": "Accept-Ranges,Content-Length,Content-Range,Content-Type,Content-Disposition,ETag",
    "Vary": "Origin"
  };
}

function contentDisposition(filename, inline = true) {
  const safe = clean(filename).replace(/[\r\n"]/g, "") || "media";
  return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safe)}`;
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
  if (source.etag) headers.set("ETag", source.etag);
  return headers;
}

async function media(request, env, corsHeaders) {
  const url = new URL(request.url);
  const access = await verifyLease(url.searchParams.get("t"), request, env);
  if (!access.ok) return json(access.status, { ok: false, error: access.error }, corsHeaders);
  const { payload } = access;
  const requestedRange = parseRangeRequest(request.headers.get("range"));

  if (request.method === "HEAD") {
    const head = await env.V5_MEDIA.head(payload.k);
    if (!head) return json(404, { ok: false, error: "media_not_found" }, corsHeaders);
    const size = Number(head.size || 0);
    const range = resolveRange(requestedRange, size);
    if (range?.invalid) return rangeNotSatisfiable(size, corsHeaders);
    const headers = mediaHeaders(head, payload, corsHeaders);
    headers.set("Content-Length", String(range ? range.length : size));
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    return new Response(null, { status: range ? 206 : 200, headers });
  }

  const object = await env.V5_MEDIA.get(
    payload.k,
    requestedRange && !requestedRange.invalid ? { range: requestedRange.r2 } : undefined
  );
  if (!object?.body) return json(404, { ok: false, error: "media_not_found" }, corsHeaders);
  const size = Number(object.size || 0);
  const range = resolveRange(requestedRange, size);
  if (range?.invalid) return rangeNotSatisfiable(size, corsHeaders);
  const headers = mediaHeaders(object, payload, corsHeaders);
  headers.set("Content-Length", String(range ? range.length : size));
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

export default {
  async fetch(request, env) {
    const corsHeaders = cors(request, env);
    if (corsHeaders === null) return json(403, { ok: false, error: "origin_not_allowed" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (!["GET", "HEAD"].includes(request.method)) return json(405, { ok: false, error: "method_not_allowed" }, corsHeaders);
    const url = new URL(request.url);
    if (url.pathname === "/health") return json(200, { ok: true, service: "v5-r2-media" }, corsHeaders);
    if (url.pathname !== "/v1/media") return json(404, { ok: false, error: "not_found" }, corsHeaders);
    return media(request, env, corsHeaders);
  }
};
