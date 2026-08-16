const leases = new Map();
const MEDIA_PREFIX = "/v4-media/";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type === "V4_MEDIA_LEASE") {
    const leaseId = String(data.leaseId || "").trim();
    const token = String(data.token || "").trim();
    const proof = String(data.proof || "").trim();
    const gateway = String(data.gateway || "").trim();
    const expiresAt = Date.parse(String(data.expiresAt || ""));
    if (!leaseId || !token || !proof || !gateway || !Number.isFinite(expiresAt)) return;
    leases.set(leaseId, { token, proof, gateway, expiresAt });
    return;
  }
  if (data.type === "V4_MEDIA_REVOKE") {
    leases.delete(String(data.leaseId || "").trim());
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

async function proxyMedia(request, leaseId) {
  const lease = leases.get(leaseId);
  if (!lease || lease.expiresAt <= Date.now()) {
    leases.delete(leaseId);
    return new Response("Playback lease expired", {
      status: 410,
      headers: { "Cache-Control": "private, no-store" }
    });
  }

  const headers = new Headers();
  const range = request.headers.get("range");
  if (range) headers.set("Range", range);
  headers.set("Authorization", `Bearer ${lease.token}`);
  headers.set("X-V4-Playback-Proof", lease.proof);
  headers.set("X-V4-Playback", "sw-v1");

  try {
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
