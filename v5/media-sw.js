const MEDIA_PREFIX = "/v5/media/";
const leases = new Map();
const leaseRequests = new Map();
const REFRESH_SKEW_MS = 45 * 1000;
const INITIAL_VIDEO_RANGE_BYTES = 4 * 1024 * 1024;
const DIAGNOSTIC_CHUNK_MIB = new Set([4, 8, 16]);
const encoder = new TextEncoder();
let proofIdentityPromise = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(Promise.all([
  self.clients.claim(),
  proofIdentity().catch(() => null)
])));

function clean(value) {
  return String(value || "").trim();
}

function base64url(bytes) {
  let binary = "";
  for (const value of new Uint8Array(bytes)) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlJson(value) {
  return base64url(encoder.encode(JSON.stringify(value)));
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function proofIdentity() {
  if (!proofIdentityPromise) {
    proofIdentityPromise = (async () => {
      const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      return { privateKey: pair.privateKey, publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey) };
    })();
  }
  return proofIdentityPromise;
}

function cacheKey(course, assetId) {
  return `${course}:${assetId}`;
}

function diagnosticOptions(url) {
  if (!self.location.hostname.endsWith(".vercel.app") || url.searchParams.get("v5diag") !== "1") return null;
  const chunkMiB = Number(url.searchParams.get("chunkMiB") || 4);
  return { chunkMiB: DIAGNOSTIC_CHUNK_MIB.has(chunkMiB) ? chunkMiB : 4 };
}

function playbackRange(rawRange, mimeType, chunkBytes = INITIAL_VIDEO_RANGE_BYTES) {
  const value = clean(rawRange);
  const isVideo = clean(mimeType).toLowerCase().startsWith("video/");
  if (value) {
    if (!isVideo) return value;
    const openEnded = value.match(/^bytes=(\d+)-$/i);
    if (!openEnded) return value;
    const start = Number(openEnded[1]);
    const end = start + chunkBytes - 1;
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end)) return value;
    return `bytes=${start}-${end}`;
  }
  return isVideo ? `bytes=0-${INITIAL_VIDEO_RANGE_BYTES - 1}` : "";
}

async function notifyDiagnostic(clientId, data) {
  if (!clientId) return;
  const client = await self.clients.get(clientId).catch(() => null);
  client?.postMessage({ type: "v5-playback-diagnostic", ...data });
}

async function issueLease(course, assetId) {
  const params = new URLSearchParams({ endpoint: "v5-play", course, asset: assetId });
  const proof = await proofIdentity();
  const response = await fetch(`/api/lms/portal?${params}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { "Accept": "application/json", "X-V5-Playback-Key": base64urlJson(proof.publicJwk) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true || !data.playbackUrl || !data.playbackLease || !data.expiresAt) {
    const error = new Error(data.error || `lease_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return {
    url: String(data.playbackUrl),
    token: String(data.playbackLease),
    mimeType: String(data.mimeType || ""),
    key: proof.privateKey,
    expiresAt: Number(data.expiresAt)
  };
}

async function fetchLease(course, assetId, force = false) {
  const key = cacheKey(course, assetId);
  const current = leases.get(key);
  if (!force && current && Number(current.expiresAt || 0) > Date.now() + REFRESH_SKEW_MS) return current;
  if (!force && leaseRequests.has(key)) return leaseRequests.get(key);

  const request = issueLease(course, assetId).then(lease => {
    leases.set(key, lease);
    return lease;
  });
  if (!force) leaseRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (!force && leaseRequests.get(key) === request) leaseRequests.delete(key);
  }
}

function copyHeaders(upstream) {
  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "content-disposition",
    "etag",
    "retry-after"
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

async function upstreamRequest(request, lease, chunkBytes) {
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const range = chunkBytes === INITIAL_VIDEO_RANGE_BYTES
    ? playbackRange(request.headers.get("range"), lease.mimeType)
    : playbackRange(request.headers.get("range"), lease.mimeType, chunkBytes);
  const timestamp = String(Date.now());
  const nonce = randomNonce();
  const canonical = [method, range, timestamp, nonce, lease.token, self.location.origin].join("\n");
  const signStartedAt = performance.now();
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, lease.key, encoder.encode(canonical));
  const signMs = performance.now() - signStartedAt;
  const headers = new Headers();
  if (range) headers.set("Range", range);
  headers.set("Authorization", `Bearer ${lease.token}`);
  headers.set("X-V5-Playback", "sw-v2");
  headers.set("X-V5-Playback-Timestamp", timestamp);
  headers.set("X-V5-Playback-Nonce", nonce);
  headers.set("X-V5-Playback-Signature", base64url(signature));
  const fetchStartedAt = performance.now();
  const response = await fetch(lease.url, {
    method,
    headers,
    mode: "cors",
    credentials: "omit",
    redirect: "follow",
    cache: "no-store"
  });
  return { response, range, signMs, fetchStartedAt, headersAt: performance.now() };
}

function diagnosticBody(body, onFirstByte, onComplete) {
  if (!body) return body;
  const reader = body.getReader();
  let bytes = 0;
  let first = true;
  return new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          onComplete(bytes);
          controller.close();
          return;
        }
        if (first) {
          first = false;
          onFirstByte();
        }
        bytes += result.value.byteLength;
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}

async function proxyMedia(request, course, assetId, clientId, diagnostic) {
  const requestId = diagnostic ? `${Date.now().toString(36)}-${randomNonce().slice(0, 8)}` : "";
  const requestStartedAt = performance.now();
  const browserRange = clean(request.headers.get("range"));
  const chunkBytes = diagnostic ? diagnostic.chunkMiB * 1024 * 1024 : INITIAL_VIDEO_RANGE_BYTES;
  try {
    const leaseStartedAt = performance.now();
    let lease = await fetchLease(course, assetId, false);
    let leaseMs = performance.now() - leaseStartedAt;
    let attempt = await upstreamRequest(request, lease, chunkBytes);
    let upstream = attempt.response;
    let retries = 0;

    if ([401, 403, 410].includes(upstream.status)) {
      retries = 1;
      leases.delete(cacheKey(course, assetId));
      const refreshStartedAt = performance.now();
      lease = await fetchLease(course, assetId, true);
      leaseMs += performance.now() - refreshStartedAt;
      attempt = await upstreamRequest(request, lease, chunkBytes);
      upstream = attempt.response;
    }

    const headersAt = performance.now();
    const baseRecord = {
      requestId,
      at: Date.now(),
      method: request.method,
      browserRange,
      workerRange: attempt.range,
      status: upstream.status,
      contentLength: Number(upstream.headers.get("content-length") || 0),
      contentRange: clean(upstream.headers.get("content-range")),
      leaseMs: Number(leaseMs.toFixed(2)),
      signMs: Number(attempt.signMs.toFixed(2)),
      workerTtfbMs: Number((attempt.headersAt - attempt.fetchStartedAt).toFixed(2)),
      totalHeadersMs: Number((headersAt - requestStartedAt).toFixed(2)),
      retries
    };
    await notifyDiagnostic(clientId, { phase: "headers", ...baseRecord });
    const body = diagnostic && request.method !== "HEAD"
      ? diagnosticBody(
        upstream.body,
        () => notifyDiagnostic(clientId, { phase: "first-byte", requestId, afterHeadersMs: Number((performance.now() - headersAt).toFixed(2)) }),
        bytes => notifyDiagnostic(clientId, { phase: "complete", requestId, bytes, downloadMs: Number((performance.now() - headersAt).toFixed(2)) })
      )
      : upstream.body;
    return new Response(request.method === "HEAD" ? null : body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: copyHeaders(upstream)
    });
  } catch (error) {
    const status = Number(error?.status || 0);
    if (diagnostic) await notifyDiagnostic(clientId, {
      phase: "error",
      requestId,
      at: Date.now(),
      browserRange,
      error: clean(error?.message || "media_proxy_failed"),
      elapsedMs: Number((performance.now() - requestStartedAt).toFixed(2))
    });
    return new Response(status === 401 || status === 403 ? "Playback access denied" : "V5 media proxy failed", {
      status: status === 401 || status === 403 ? status : 502,
      headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

self.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type !== "v5-warm-lease") return;
  const course = clean(data.course);
  const assetId = clean(data.assetId);
  if (!course || !assetId) return;
  event.waitUntil(fetchLease(course, assetId, false).catch(() => null));
});

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
  event.respondWith(proxyMedia(event.request, course, assetId, event.clientId, diagnosticOptions(url)));
});
