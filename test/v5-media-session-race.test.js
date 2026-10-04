import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../v5/media-sw.js", import.meta.url), "utf8");

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function makeHarness({ deferSign = false, deferUpstream = false } = {}) {
  const listeners = new Map();
  const signGate = deferred();
  const signStarted = deferred();
  const upstreamGate = deferred();
  const upstreamStarted = deferred();
  let upstreamCalls = 0;

  const self = {
    location: { origin: "https://lms.example.test" },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    addEventListener(type, fn) { listeners.set(type, fn); }
  };

  const cryptoStub = {
    getRandomValues(bytes) {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i + 1) & 255;
      return bytes;
    },
    subtle: {
      async generateKey() { return { privateKey: {}, publicKey: {} }; },
      async exportKey() { return { kty: "EC", crv: "P-256", x: "x", y: "y" }; },
      sign() {
        signStarted.resolve();
        return deferSign ? signGate.promise : Promise.resolve(new Uint8Array(64).buffer);
      }
    }
  };

  const fetchStub = async (input, options = {}) => {
    const url = String(input);
    if (url.startsWith("/api/lms/portal?")) {
      return new Response(JSON.stringify({
        success: true,
        playbackUrl: "https://media.example.test/v2/media",
        playbackLease: "lease-token",
        expiresAt: Date.now() + 60_000,
        mimeType: "video/mp4"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    upstreamCalls += 1;
    upstreamStarted.resolve(options.signal);
    if (deferUpstream) return upstreamGate.promise;
    return new Response("MEDIA", {
      status: 200,
      headers: { "content-type": "video/mp4", "accept-ranges": "bytes" }
    });
  };

  const context = vm.createContext({
    self,
    crypto: cryptoStub,
    fetch: fetchStub,
    TextEncoder,
    Headers,
    Response,
    ReadableStream,
    AbortController,
    URL,
    URLSearchParams,
    btoa: value => Buffer.from(value, "binary").toString("base64"),
    console
  });
  vm.runInContext(source, context, { filename: "media-sw.js" });

  const sendMessage = data => {
    const reply = { value: null, postMessage(value) { this.value = value; } };
    listeners.get("message")({ data, ports: [reply], waitUntil() {} });
    return reply.value;
  };

  const startMedia = () => {
    let responsePromise;
    const request = {
      url: "https://lms.example.test/v5/media/asset-1?course=course-1&lesson=lesson-1",
      method: "GET",
      headers: new Headers({ range: "bytes=0-" })
    };
    listeners.get("fetch")({
      request,
      respondWith(value) { responsePromise = Promise.resolve(value); }
    });
    return responsePromise;
  };

  return {
    setContext(value = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
      return sendMessage({ type: "v5-set-session-context", context: value });
    },
    clear() { return sendMessage({ type: "v5-clear-session" }); },
    startMedia,
    signStarted: signStarted.promise,
    resolveSign() { signGate.resolve(new Uint8Array(64).buffer); },
    upstreamStarted: upstreamStarted.promise,
    resolveUpstream() {
      upstreamGate.resolve(new Response("OLD-MEDIA", {
        status: 200,
        headers: { "content-type": "video/mp4", "accept-ranges": "bytes" }
      }));
    },
    get upstreamCalls() { return upstreamCalls; }
  };
}

test("V5 stale session cannot continue from a pending signature", async () => {
  const h = makeHarness({ deferSign: true });
  assert.equal(h.setContext().ok, true);
  const responsePromise = h.startMedia();
  await h.signStarted;
  h.clear();
  h.resolveSign();
  const response = await responsePromise;
  assert.equal(response.status, 401);
  assert.equal(h.upstreamCalls, 0);
});

test("V5 stale session cannot return an old upstream response", async () => {
  const h = makeHarness({ deferUpstream: true });
  assert.equal(h.setContext().ok, true);
  const responsePromise = h.startMedia();
  const signal = await h.upstreamStarted;
  h.clear();
  assert.equal(signal.aborted, true);
  h.resolveUpstream();
  const response = await responsePromise;
  assert.equal(response.status, 401);
});
