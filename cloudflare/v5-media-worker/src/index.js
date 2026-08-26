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
  try { payload = decodePayload(encoded); } catch { return { ok: false, status: 401, error: "invalid_payload" }; }
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
    "Access-Control-Expose-Headers": "Accept-Ranges,Content-Length,Content-Range,Content-Type,ETag",
    "Vary": "Origin"
  };
}

function contentDisposition(filename, inline = true) {
  const safe = clean(filename).replace(/[\r\n"]/g, "") || "media";
  return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function parseRange(header, size) {
  const text = clean(header);
  if (!text) return null;
  const match = text.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return { invalid: true };
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null && end !== null) {
    const suffix = Math.max(0, end);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = start ?? 0;
    end = end ?? size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return { invalid: true };
  end = Math.min(end, size - 1);
  return { start, end, length: end - start + 1 };
}

async function media(request, env, corsHeaders) {
  const url = new URL(request.url);
  const access = await verifyLease(url.searchParams.get("t"), request, env);
  if (!access.ok) return json(access.status, { ok: false, error: access.error }, corsHeaders);
  const { payload } = access;
  const head = await env.V5_MEDIA.head(payload.k);
  if (!head) return json(404, { ok: false, error: "media_not_found" }, corsHeaders);
  const size = Number(head.size || 0);
  const range = parseRange(request.headers.get("range"), size);
  if (range?.invalid) return new Response(null, { status: 416, headers: { ...corsHeaders, "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", clean(payload.ct) || head.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", contentDisposition(payload.fn, payload.ct?.startsWith("video/") || payload.ct?.startsWith("image/") || payload.ct === "application/pdf"));
  if (head.etag) headers.set("ETag", head.etag);
  if (request.method === "HEAD") {
    headers.set("Content-Length", String(range ? range.length : size));
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    return new Response(null, { status: range ? 206 : 200, headers });
  }
  const object = range
    ? await env.V5_MEDIA.get(payload.k, { range: { offset: range.start, length: range.length } })
    : await env.V5_MEDIA.get(payload.k);
  if (!object?.body) return json(404, { ok: false, error: "media_not_found" }, corsHeaders);
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
