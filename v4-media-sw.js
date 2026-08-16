const leases = new Map();
const MEDIA_PREFIX = "/v4-media/";
const textEncoder = new TextEncoder();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function base64url(bytes) {
  let binary = "";
  for (const value of new Uint8Array(bytes)) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function importSigningKey(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

self.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type === "V4_MEDIA_LEASE") {
    event.waitUntil((async () => {
      const leaseId = String(data.leaseId || "").trim();
      const token = String(data.token || "").trim();
      const gateway = String(data.gateway || "").trim();
      const expiresAt = Date.parse(String(data.expiresAt || ""));
      const candidateKey = data.signingKey || data.proof;
      const signingKey = candidateKey && typeof candidateKey === "object" ? candidateKey : null;
      if (!leaseId || !token || !gateway || !signingKey || !Number.isFinite(expiresAt)) {
        event.ports?.[0]?.postMessage({ ok: false });
        return;
      }
      try {
        const key = await importSigningKey(signingKey);
        leases.set(leaseId, { token, key, gateway, expiresAt });
        event.ports?.[0]?.postMessage({ ok: true });
      } catch {
        event.ports?.[0]?.postMessage({ ok: false });
      }
    })());
    return;
  }
  if (data.type === "V4_MEDIA_REVOKE") {
    leases.delete(String(data.leaseId || "").trim());
    event.ports?.[0]?.postMessage({ ok: true });
  }
});

function filteredHeaders(upstream) {
  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "cache-control",
    "server-timing",
    "x-telegram-media-transport",
    "x-mp4-layout",
    "x-mp4-index-cache"
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

async function signedPlaybackHeaders(request, lease) {
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const range = String(request.headers.get("range") || "");
  const timestamp = String(Date.now());
  const nonce = randomNonce();
  const payload = [method, range, timestamp, nonce, lease.token, self.location.origin].join("\n");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    lease.key,
    textEncoder.encode(payload)
  );

  const headers = new Headers();
  if (range) headers.set("Range", range);
  headers.set("Authorization", `Bearer ${lease.token}`);
  headers.set("X-V4-Playback", "sw-v2");
  headers.set("X-V4-Playback-Timestamp", timestamp);
  headers.set("X-V4-Playback-Nonce", nonce);
  headers.set("X-V4-Playback-Signature", base64url(signature));
  return headers;
}

async function proxyMedia(request, leaseId) {
  const lease = leases.get(leaseId);
  if (!lease || lease.expiresAt <= Date.now()) {
    leases.delete(leaseId);
    return new Response("Playback lease expired", {
      status: 410,
      headers: { "Cache-Control": "private, no-store" }
    });
  }

  try {
    const headers = await signedPlaybackHeaders(request, lease);
    const upstream = await fetch(lease.gateway, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      cache: "no-store"
    });

    if (upstream.status === 401 || upstream.status === 403 || upstream.status === 410) {
      leases.delete(leaseId);
    }

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: filteredHeaders(upstream)
    });
  } catch {
    return new Response("Media proxy failed", {
      status: 502,
      headers: { "Cache-Control": "private, no-store" }
    });
  }
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(MEDIA_PREFIX)) return;
  const leaseId = decodeURIComponent(url.pathname.slice(MEDIA_PREFIX.length)).trim();
  if (!leaseId) {
    event.respondWith(new Response("Missing playback lease", { status: 400 }));
    return;
  }
  event.respondWith(proxyMedia(event.request, leaseId));
});
