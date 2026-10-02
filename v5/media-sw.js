const MEDIA_PREFIX = "/v5/media/";
const leases = new Map();
const leaseRequests = new Map();
const upstreamControllers = new Set();
const REFRESH_SKEW_MS = 45 * 1000;
const STARTUP_VIDEO_RANGE_BYTES = 1 * 1024 * 1024;
const STEADY_VIDEO_RANGE_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
let proofIdentityPromise = null;
let sessionContext = "";
let sessionGeneration = 0;

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

function staleSessionError() {
  const error = new Error("media_session_stale");
  error.status = 401;
  return error;
}

function assertSessionState(expectedGeneration, expectedContext) {
  if (
    !expectedContext ||
    expectedGeneration !== sessionGeneration ||
    expectedContext !== sessionContext
  ) {
    throw staleSessionError();
  }
}

function resetSessionState(nextContext = "") {
  sessionGeneration += 1;
  sessionContext = clean(nextContext);
  for (const controller of upstreamControllers) {
    try { controller.abort("media_session_reset"); } catch {}
  }
  upstreamControllers.clear();
  leases.clear();
  leaseRequests.clear();
  proofIdentityPromise = null;
  return sessionGeneration;
}

function cacheKey(course, lessonId, assetId, context = sessionContext) {
  return `${context}:${course}:${lessonId || ''}:${assetId}`;
}

function playbackRange(rawRange, mimeType, method = "GET") {
  const value = clean(rawRange);
  if (clean(method).toUpperCase() === "HEAD") return value;
  const isVideo = clean(mimeType).toLowerCase().startsWith("video/");
  if (value) {
    if (!isVideo) return value;
    const openEnded = value.match(/^bytes=(\d+)-$/i);
    if (openEnded) {
      const start = Number(openEnded[1]);
      const chunkBytes = start === 0 ? STARTUP_VIDEO_RANGE_BYTES : STEADY_VIDEO_RANGE_BYTES;
      const end = start + chunkBytes - 1;
      if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end)) return value;
      return `bytes=${start}-${end}`;
    }
    const explicitBounded = value.match(/^bytes=(\d+)-(\d+)$/i);
    if (explicitBounded) {
      const start = Number(explicitBounded[1]);
      const originalEnd = Number(explicitBounded[2]);
      if (
        !Number.isSafeInteger(start) ||
        start < 0 ||
        !Number.isSafeInteger(originalEnd) ||
        originalEnd < start
      ) {
        return value;
      }
      const limit = start === 0 ? STARTUP_VIDEO_RANGE_BYTES : STEADY_VIDEO_RANGE_BYTES;
      const maxEnd = start + limit - 1;
      if (!Number.isSafeInteger(maxEnd)) return value;
      if (originalEnd <= maxEnd) return value;
      const newEnd = Math.min(originalEnd, maxEnd);
      return `bytes=${start}-${newEnd}`;
    }
    return value;
  }
  return isVideo ? `bytes=0-${STARTUP_VIDEO_RANGE_BYTES - 1}` : "";
}

async function issueLease(course, lessonId, assetId, expectedGeneration, expectedContext) {
  if (!expectedContext || expectedGeneration !== sessionGeneration || expectedContext !== sessionContext) {
    const error = new Error("media_session_stale");
    error.status = 401;
    throw error;
  }

  const params = new URLSearchParams({ endpoint: "v5-play", course, asset: assetId });
  if (lessonId) params.set("lesson", lessonId);
  const proof = await proofIdentity();
  if (expectedGeneration !== sessionGeneration || expectedContext !== sessionContext) {
    const error = new Error("media_session_stale");
    error.status = 401;
    throw error;
  }

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
  if (expectedGeneration !== sessionGeneration || expectedContext !== sessionContext) {
    const error = new Error("media_session_stale");
    error.status = 401;
    throw error;
  }

  return {
    url: String(data.playbackUrl),
    token: String(data.playbackLease),
    mimeType: String(data.mimeType || ""),
    key: proof.privateKey,
    expiresAt: Number(data.expiresAt),
    generation: expectedGeneration,
    context: expectedContext
  };
}

async function fetchLease(course, lessonId, assetId, force = false) {
  const context = sessionContext;
  const generation = sessionGeneration;
  if (!context) {
    const error = new Error("media_session_not_initialized");
    error.status = 401;
    throw error;
  }

  const key = cacheKey(course, lessonId, assetId, context);
  const current = leases.get(key);
  if (
    !force &&
    current &&
    current.generation === generation &&
    current.context === context &&
    Number(current.expiresAt || 0) > Date.now() + REFRESH_SKEW_MS
  ) {
    return current;
  }
  if (!force && leaseRequests.has(key)) return leaseRequests.get(key);

  const request = issueLease(course, lessonId, assetId, generation, context).then(lease => {
    if (generation !== sessionGeneration || context !== sessionContext) {
      const error = new Error("media_session_stale");
      error.status = 401;
      throw error;
    }
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

async function upstreamRequest(request, lease, expectedGeneration, expectedContext) {
  assertSessionState(expectedGeneration, expectedContext);
  if (
    lease.generation !== expectedGeneration ||
    lease.context !== expectedContext
  ) {
    throw staleSessionError();
  }

  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const range = method === "HEAD" ? clean(request.headers.get("range")) : playbackRange(request.headers.get("range"), lease.mimeType);
  const timestamp = String(Date.now());
  const nonce = randomNonce();
  const canonical = [method, range, timestamp, nonce, lease.token, self.location.origin].join("\n");
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, lease.key, encoder.encode(canonical));
  assertSessionState(expectedGeneration, expectedContext);

  const headers = new Headers();
  if (range) headers.set("Range", range);
  headers.set("Authorization", `Bearer ${lease.token}`);
  headers.set("X-V5-Playback", "sw-v2");
  headers.set("X-V5-Playback-Timestamp", timestamp);
  headers.set("X-V5-Playback-Nonce", nonce);
  headers.set("X-V5-Playback-Signature", base64url(signature));

  const controller = new AbortController();
  upstreamControllers.add(controller);
  try {
    const response = await fetch(lease.url, {
      method,
      headers,
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
    assertSessionState(expectedGeneration, expectedContext);
    // Keep the AbortController registered until the response body is fully
    // consumed so a session reset can abort a stream after headers arrived.
    return { response, controller };
  } catch (error) {
    upstreamControllers.delete(controller);
    if (expectedGeneration !== sessionGeneration || expectedContext !== sessionContext) {
      throw staleSessionError();
    }
    throw error;
  }
}

function releaseUpstream(controller, reason = "") {
  if (!controller) return;
  upstreamControllers.delete(controller);
  if (reason) {
    try { controller.abort(reason); } catch {}
  }
}

function guardedBody(body, expectedGeneration, expectedContext, upstreamController) {
  if (!body || typeof body.getReader !== "function") {
    releaseUpstream(upstreamController);
    return body;
  }
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        assertSessionState(expectedGeneration, expectedContext);
        const { done, value } = await reader.read();
        assertSessionState(expectedGeneration, expectedContext);
        if (done) {
          releaseUpstream(upstreamController);
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        releaseUpstream(upstreamController, "media_session_stream_cancelled");
        try { await reader.cancel(error); } catch {}
        controller.error(error);
      }
    },
    async cancel(reason) {
      releaseUpstream(upstreamController, "media_session_stream_cancelled");
      try { await reader.cancel(reason); } catch {}
    }
  });
}

async function proxyMedia(request, course, lessonId, assetId) {
  const expectedGeneration = sessionGeneration;
  const expectedContext = sessionContext;
  let activeUpstreamController = null;
  try {
    if (!expectedContext) {
      return new Response("Media session not initialized", {
        status: 401,
        headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    assertSessionState(expectedGeneration, expectedContext);
    let lease = await fetchLease(course, lessonId, assetId, false);
    assertSessionState(expectedGeneration, expectedContext);
    let upstreamResult = await upstreamRequest(request, lease, expectedGeneration, expectedContext);
    let upstream = upstreamResult.response;
    activeUpstreamController = upstreamResult.controller;
    assertSessionState(expectedGeneration, expectedContext);

    if ([401, 403, 410].includes(upstream.status)) {
      releaseUpstream(activeUpstreamController, "media_retry");
      activeUpstreamController = null;
      try { await upstream.body?.cancel?.("media_retry"); } catch {}
      leases.delete(cacheKey(course, lessonId, assetId, expectedContext));
      assertSessionState(expectedGeneration, expectedContext);
      lease = await fetchLease(course, lessonId, assetId, true);
      assertSessionState(expectedGeneration, expectedContext);
      upstreamResult = await upstreamRequest(request, lease, expectedGeneration, expectedContext);
      upstream = upstreamResult.response;
      activeUpstreamController = upstreamResult.controller;
      assertSessionState(expectedGeneration, expectedContext);
    }

    let body = null;
    if (request.method === "HEAD") {
      releaseUpstream(activeUpstreamController);
      activeUpstreamController = null;
    } else {
      body = guardedBody(upstream.body, expectedGeneration, expectedContext, activeUpstreamController);
      activeUpstreamController = null;
    }

    assertSessionState(expectedGeneration, expectedContext);
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: copyHeaders(upstream)
    });
  } catch (error) {
    releaseUpstream(activeUpstreamController, "media_session_stale");
    const stale =
      expectedGeneration !== sessionGeneration ||
      expectedContext !== sessionContext ||
      error?.message === "media_session_stale";
    const status = stale ? 401 : Number(error?.status || 0);
    return new Response(status === 401 || status === 403 ? "Playback access denied" : "V5 media proxy failed", {
      status: status === 401 || status === 403 ? status : 502,
      headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

self.addEventListener("message", event => {
  const data = event.data || {};
  const reply = event.ports?.[0] || null;

  if (data.type === "v5-clear-session") {
    resetSessionState("");
    try { reply?.postMessage({ ok: true, generation: sessionGeneration }); } catch {}
    return;
  }

  if (data.type === "v5-set-session-context") {
    const next = clean(data.context);
    if (!/^[A-Za-z0-9_-]{24,160}$/.test(next)) {
      resetSessionState("");
      try { reply?.postMessage({ ok: false, status: 400 }); } catch {}
      return;
    }
    if (next !== sessionContext) resetSessionState(next);
    try { reply?.postMessage({ ok: true, generation: sessionGeneration }); } catch {}
    return;
  }

  if (data.type !== "v5-warm-lease") return;
  const course = clean(data.course);
  const lessonId = clean(data.lessonId);
  const assetId = clean(data.assetId);
  if (!course || !lessonId || !assetId || !sessionContext) {
    try { reply?.postMessage({ ok: false, status: 401 }); } catch {}
    return;
  }
  const task = fetchLease(course, lessonId, assetId, false)
    .then(() => { try { reply?.postMessage({ ok: true }); } catch {} })
    .catch(error => { try { reply?.postMessage({ ok: false, status: Number(error?.status || 0) }); } catch {} });
  event.waitUntil(task);
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
  const lessonId = clean(url.searchParams.get("lesson"));
  // Main/legacy V5 media does not have a canonical Agency lesson id. Keep
  // lesson optional here and let the authoritative v5-play route enforce it
  // only for Agency tenants (handleAgencyV5Play fails closed on missing_lesson).
  if (!assetId || !course) {
    event.respondWith(new Response("Missing V5 media identity", { status: 400 }));
    return;
  }
  event.respondWith(proxyMedia(event.request, course, lessonId, assetId));
});
