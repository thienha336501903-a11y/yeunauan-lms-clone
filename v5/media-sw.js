const MEDIA_PREFIX = "/v5/media/";
const leases = new Map();
const REFRESH_SKEW_MS = 45 * 1000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function clean(value) {
  return String(value || "").trim();
}

function cacheKey(course, assetId) {
  return `${course}:${assetId}`;
}

function playbackRange(rawRange) {
  const value = clean(rawRange);
  return value || "bytes=0-";
}

async function fetchLease(course, assetId, force = false) {
  const key = cacheKey(course, assetId);
  const current = leases.get(key);
  if (!force && current && Number(current.expiresAt || 0) > Date.now() + REFRESH_SKEW_MS) return current;

  const params = new URLSearchParams({ endpoint: "v5-play", course, asset: assetId });
  const response = await fetch(`/api/lms/portal?${params}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { "Accept": "application/json" }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true || !data.playbackUrl || !data.expiresAt) {
    const error = new Error(data.error || `lease_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  const lease = { url: String(data.playbackUrl), expiresAt: Number(data.expiresAt) };
  leases.set(key, lease);
  return lease;
}

function copyHeaders(upstream) {
  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "content-disposition",
    "etag"
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

async function upstreamRequest(request, lease) {
  const headers = new Headers();
  headers.set("Range", playbackRange(request.headers.get("range")));
  return fetch(lease.url, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers,
    mode: "cors",
    credentials: "omit",
    redirect: "follow",
    cache: "no-store"
  });
}

async function proxyMedia(request, course, assetId) {
  try {
    let lease = await fetchLease(course, assetId, false);
    let upstream = await upstreamRequest(request, lease);

    if ([401, 403, 410].includes(upstream.status)) {
      leases.delete(cacheKey(course, assetId));
      lease = await fetchLease(course, assetId, true);
      upstream = await upstreamRequest(request, lease);
    }

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: copyHeaders(upstream)
    });
  } catch (error) {
    const status = Number(error?.status || 0);
    return new Response(status === 401 || status === 403 ? "Playback access denied" : "V5 media proxy failed", {
      status: status === 401 || status === 403 ? status : 502,
      headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(MEDIA_PREFIX)) return;
  if (!["GET", "HEAD"].includes(event.request.method)) {
    event.respondWith(new Response("Method not allowed", { status: 405 }));
    return;
  }
  const assetId = decodeURIComponent(url.pathname.slice(MEDIA_PREFIX.length)).trim();
  const course = clean(url.searchParams.get("course"));
  if (!assetId || !course) {
    event.respondWith(new Response("Missing V5 media identity", { status: 400 }));
    return;
  }
  event.respondWith(proxyMedia(event.request, course, assetId));
});
