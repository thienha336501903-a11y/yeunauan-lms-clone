import assert from 'node:assert/strict';
import cryptoModule from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import worker from '../cloudflare/v5-media-worker/src/index.js';
import { issueV5PlaybackLease } from '../utils/v5-playback-lease.js';

const encoder = new TextEncoder();
const userAgent = 'System-B-V5-range-test';
const origin = 'https://hoc.yeubep.shop';
const objectSize = 1000;
const studentEmailHash = 'student-email-hash-1';

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function sha256base64url(value) {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function fixture(overrides = {}, options = {}) {
  const issuer = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const proof = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', issuer.publicKey);
  const proofPublicJwk = await crypto.subtle.exportKey('jwk', proof.publicKey);
  const now = Date.now();
  const payload = {
    v: 2,
    aid: 'asset-1',
    c: 'course-1',
    k: 'v5/test.mp4',
    iat: now,
    exp: now + 60_000,
    uah: await sha256base64url(userAgent),
    eh: studentEmailHash,
    ct: 'video/mp4',
    fn: 'test.mp4',
    pk: proofPublicJwk,
    ...overrides
  };
  if (!options.omitSize) payload.sz = objectSize;
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, issuer.privateKey, encoder.encode(encoded));
  return {
    token: `${encoded}.${base64url(signature)}`,
    publicJwk,
    proofPrivateKey: proof.privateKey,
    payload
  };
}

function fakeR2({ size = objectSize, throwInvalidRange = false, contentType = 'video/mp4' } = {}) {
  const calls = { get: [], head: [] };
  return {
    calls,
    bucket: {
      async get(key, options) {
        calls.get.push({ key, options });
        if (throwInvalidRange) throw new Error('get: The requested range is not satisfiable. (10039)');
        return {
          body: 'x',
          size,
          etag: 'etag-1',
          httpEtag: '"etag-1"',
          httpMetadata: { contentType }
        };
      },
      async head(key) {
        calls.head.push({ key });
        return {
          size,
          etag: 'etag-1',
          httpEtag: '"etag-1"',
          httpMetadata: { contentType }
        };
      }
    }
  };
}

function fakeRateLimiter({ success = true, error = null } = {}) {
  const calls = [];
  return {
    calls,
    binding: {
      async limit(options) {
        calls.push(options);
        if (error) throw error;
        return { success };
      }
    }
  };
}

function fakeNonceGuard() {
  const seen = new Set();
  return {
    idFromName(name) { return name; },
    get() {
      return {
        async fetch(_url, init) {
          const { nonce } = JSON.parse(init.body);
          if (seen.has(nonce)) return new Response(null, { status: 409 });
          seen.add(nonce);
          return new Response(null, { status: 204 });
        }
      };
    }
  };
}

async function proofHeaders(lease, range, method = 'GET', requestOrigin = origin) {
  const timestamp = String(Date.now());
  const nonce = cryptoModule.randomBytes(16).toString('base64url');
  const canonical = [method, range || '', timestamp, nonce, lease.token, requestOrigin].join('\n');
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    lease.proofPrivateKey,
    encoder.encode(canonical)
  );
  const headers = new Headers({
    authorization: `Bearer ${lease.token}`,
    origin: requestOrigin,
    'user-agent': userAgent,
    'x-v5-playback': 'sw-v2',
    'x-v5-playback-timestamp': timestamp,
    'x-v5-playback-nonce': nonce,
    'x-v5-playback-signature': base64url(signature)
  });
  if (range) headers.set('range', range);
  return headers;
}

async function signedRequest(range, method = 'GET', options = {}) {
  const lease = options.lease || await fixture(options.payload || {}, { omitSize: options.omitSize });
  const r2 = fakeR2({ contentType: lease.payload.ct, ...(options.r2 || {}) });
  const limiter = options.limiter || fakeRateLimiter();
  const headers = options.headers || await proofHeaders(lease, range, method, options.origin || origin);
  const response = await worker.fetch(new Request('https://media.example/v2/media', { method, headers }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(options.primaryPublicJwk || lease.publicJwk),
    ...(options.previewPublicJwk ? { V5_PLAYBACK_PUBLIC_JWK_PREVIEW: JSON.stringify(options.previewPublicJwk) } : {}),
    V5_ALLOWED_ORIGINS: options.origin || origin,
    V5_MEDIA_RATE_LIMITER: options.omitLimiter ? undefined : limiter.binding,
    V5_PLAYBACK_NONCES: options.nonceGuard || fakeNonceGuard(),
    V5_MEDIA: r2.bucket
  });
  return { response, calls: r2.calls, limiterCalls: limiter.calls, lease };
}

const rangeCases = [
  ['first bytes', 'bytes=0-99', { offset: 0, length: 100 }, 'bytes 0-99/1000', '100'],
  ['last explicit bytes', 'bytes=900-999', { offset: 900, length: 100 }, 'bytes 900-999/1000', '100'],
  ['suffix bytes', 'bytes=-100', { offset: 900, length: 100 }, 'bytes 900-999/1000', '100'],
  ['open-ended bytes', 'bytes=900-', { offset: 900, length: 100 }, 'bytes 900-999/1000', '100'],
  ['explicit end beyond object', 'bytes=900-1500', { offset: 900, length: 100 }, 'bytes 900-999/1000', '100'],
  ['suffix larger than object', 'bytes=-1500', { offset: 0, length: 1000 }, 'bytes 0-999/1000', '1000']
];

test('V5 playback issuer signs verified media size while preserving V2 identity claims', () => {
  const previousPrivate = process.env.V5_PLAYBACK_PRIVATE_JWK;
  const previousUrl = process.env.V5_MEDIA_PUBLIC_URL;
  const issuer = cryptoModule.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const proof = cryptoModule.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  try {
    process.env.V5_PLAYBACK_PRIVATE_JWK = JSON.stringify(issuer.privateKey.export({ format: 'jwk' }));
    process.env.V5_MEDIA_PUBLIC_URL = 'https://media.example';
    const lease = issueV5PlaybackLease({
      version: 2,
      assetId: 'asset-1',
      courseSlug: 'course-1',
      objectKey: 'v5/test.mp4',
      mimeType: 'video/mp4',
      filename: 'test.mp4',
      bytes: objectSize,
      userAgent,
      email: 'student@example.com',
      proofPublicJwk: proof.publicKey.export({ format: 'jwk' })
    });
    const payload = JSON.parse(Buffer.from(lease.token.split('.')[0], 'base64url').toString('utf8'));
    assert.equal(payload.v, 2);
    assert.equal(payload.sz, objectSize);
    assert.equal(payload.aid, 'asset-1');
    assert.equal(payload.c, 'course-1');
    assert.ok(payload.uah);
    assert.ok(payload.eh);
    assert.equal(payload.pk.kty, 'EC');
    assert.equal(lease.url, 'https://media.example/v2/media');
    const play = fs.readFileSync(new URL('../utils/lms-handlers/v5-play.js', import.meta.url), 'utf8');
    assert.match(play, /original_filename,bytes,status/);
    assert.match(play, /bytes: asset\.bytes/);
    assert.match(play, /version: 2/);
  } finally {
    if (previousPrivate === undefined) delete process.env.V5_PLAYBACK_PRIVATE_JWK;
    else process.env.V5_PLAYBACK_PRIVATE_JWK = previousPrivate;
    if (previousUrl === undefined) delete process.env.V5_MEDIA_PUBLIC_URL;
    else process.env.V5_MEDIA_PUBLIC_URL = previousUrl;
  }
});

test('V5 V2 image full GET performs one R2 get and no head', async () => {
  const { response, calls, limiterCalls } = await signedRequest(null, 'GET', {
    payload: { ct: 'image/jpeg', fn: 'photo.jpg' },
    r2: { contentType: 'image/jpeg' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '1000');
  assert.equal(calls.get.length, 1);
  assert.equal(calls.head.length, 0);
  assert.equal(calls.get[0].options, undefined);
  assert.deepEqual(limiterCalls, [{ key: `${studentEmailHash}:asset-1` }]);
});

for (const [name, rangeHeader, expectedR2Range, expectedContentRange, expectedLength] of rangeCases) {
  test(`V5 V2 media ${name} uses one normalized ranged R2 get`, async () => {
    const { response, calls } = await signedRequest(rangeHeader);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), expectedContentRange);
    assert.equal(response.headers.get('content-length'), expectedLength);
    assert.equal(calls.get.length, 1);
    assert.equal(calls.head.length, 0);
    assert.deepEqual(calls.get[0].options, { range: expectedR2Range });
  });
}

test('V5 V2 rejects an out-of-bounds signed range before any R2 operation', async () => {
  const { response, calls } = await signedRequest('bytes=1000-');
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */1000');
  assert.equal(calls.get.length + calls.head.length, 0);
});

test('V5 V2 rejects malformed range syntax before any R2 operation', async () => {
  const { response, calls } = await signedRequest('bytes=200-100');
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */1000');
  assert.equal(calls.get.length + calls.head.length, 0);
});

test('V5 V2 converts R2 InvalidRange into 416 without an extra head when signed size is absent', async () => {
  const { response, calls } = await signedRequest('bytes=1000-', 'GET', { omitSize: true, r2: { throwInvalidRange: true } });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */*');
  assert.equal(calls.get.length, 1);
  assert.equal(calls.head.length, 0);
});

test('V5 V2 fails closed if signed size no longer matches the R2 object', async () => {
  const { response, calls } = await signedRequest('bytes=0-99', 'GET', { r2: { size: objectSize + 1 } });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'media_size_mismatch');
  assert.equal(calls.get.length, 1);
  assert.equal(calls.head.length, 0);
});

test('V5 V2 HEAD keeps metadata-only head and never performs an R2 get', async () => {
  const { response, calls } = await signedRequest('bytes=0-99', 'HEAD');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-99/1000');
  assert.equal(calls.get.length, 0);
  assert.equal(calls.head.length, 1);
});

test('V5 V2 rejects malformed lease before any R2 operation', async () => {
  const r2 = fakeR2();
  const limiter = fakeRateLimiter();
  const response = await worker.fetch(new Request('https://media.example/v2/media', {
    headers: { authorization: 'Bearer *.sig', origin, 'user-agent': userAgent }
  }), {
    V5_PLAYBACK_PUBLIC_JWK: '{}',
    V5_ALLOWED_ORIGINS: origin,
    V5_MEDIA_RATE_LIMITER: limiter.binding,
    V5_PLAYBACK_NONCES: fakeNonceGuard(),
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'invalid_payload');
  assert.equal(limiter.calls.length, 0);
  assert.equal(r2.calls.get.length + r2.calls.head.length, 0);
});

test('V5 V2 rejects UA mismatch before any R2 operation', async () => {
  const lease = await fixture();
  const headers = await proofHeaders(lease, 'bytes=0-99');
  headers.set('user-agent', `${userAgent}-different`);
  const r2 = fakeR2();
  const response = await worker.fetch(new Request('https://media.example/v2/media', { headers }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(lease.publicJwk),
    V5_ALLOWED_ORIGINS: origin,
    V5_MEDIA_RATE_LIMITER: fakeRateLimiter().binding,
    V5_PLAYBACK_NONCES: fakeNonceGuard(),
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'lease_ua_mismatch');
  assert.equal(r2.calls.get.length + r2.calls.head.length, 0);
});

test('V5 V2 rejects an expired lease before any R2 operation', async () => {
  const now = Date.now();
  const lease = await fixture({ iat: now - 60_000, exp: now - 1 });
  const headers = await proofHeaders(lease, 'bytes=0-99');
  const r2 = fakeR2();
  const response = await worker.fetch(new Request('https://media.example/v2/media', { headers }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(lease.publicJwk),
    V5_ALLOWED_ORIGINS: origin,
    V5_MEDIA_RATE_LIMITER: fakeRateLimiter().binding,
    V5_PLAYBACK_NONCES: fakeNonceGuard(),
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'lease_expired');
  assert.equal(r2.calls.get.length + r2.calls.head.length, 0);
});

test('V5 V2 rejects a bad ECDSA lease signature before any R2 operation', async () => {
  const lease = await fixture();
  const [encoded, signatureText] = lease.token.split('.');
  const signature = Buffer.from(signatureText, 'base64url');
  signature[0] ^= 1;
  lease.token = `${encoded}.${signature.toString('base64url')}`;
  const headers = await proofHeaders(lease, 'bytes=0-99');
  const r2 = fakeR2();
  const response = await worker.fetch(new Request('https://media.example/v2/media', { headers }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(lease.publicJwk),
    V5_ALLOWED_ORIGINS: origin,
    V5_MEDIA_RATE_LIMITER: fakeRateLimiter().binding,
    V5_PLAYBACK_NONCES: fakeNonceGuard(),
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'invalid_signature');
  assert.equal(r2.calls.get.length + r2.calls.head.length, 0);
});

test('V5 V2 accepts a Preview rotation key without replacing the live key', async () => {
  const preview = await fixture({ ct: 'image/jpeg', fn: 'photo.jpg' });
  const live = await fixture();
  const headers = await proofHeaders(preview, null);
  const r2 = fakeR2({ contentType: 'image/jpeg' });
  const limiter = fakeRateLimiter();
  const response = await worker.fetch(new Request('https://media.example/v2/media', { headers }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(live.publicJwk),
    V5_PLAYBACK_PUBLIC_JWK_PREVIEW: JSON.stringify(preview.publicJwk),
    V5_ALLOWED_ORIGINS: origin,
    V5_MEDIA_RATE_LIMITER: limiter.binding,
    V5_PLAYBACK_NONCES: fakeNonceGuard(),
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 200);
  assert.equal(r2.calls.get.length, 1);
  assert.equal(limiter.calls.length, 1);
});

test('V5 V2 rejects an exceeded authenticated identity before any R2 operation', async () => {
  const limiter = fakeRateLimiter({ success: false });
  const { response, calls, limiterCalls } = await signedRequest('bytes=0-99', 'GET', { limiter });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('access-control-expose-headers') || '', /Retry-After/);
  assert.equal((await response.json()).error, 'rate_limit_exceeded');
  assert.deepEqual(limiterCalls, [{ key: `${studentEmailHash}:asset-1` }]);
  assert.equal(calls.get.length + calls.head.length, 0);
});

test('V5 V2 rate limit keys isolate students and assets without using IP', async () => {
  const first = await signedRequest('bytes=0-99', 'GET', { payload: { eh: 'student-hash-a', aid: 'asset-a' } });
  const second = await signedRequest('bytes=0-99', 'GET', { payload: { eh: 'student-hash-b', aid: 'asset-a' } });
  const third = await signedRequest('bytes=0-99', 'GET', { payload: { eh: 'student-hash-a', aid: 'asset-b' } });
  assert.deepEqual(first.limiterCalls, [{ key: 'student-hash-a:asset-a' }]);
  assert.deepEqual(second.limiterCalls, [{ key: 'student-hash-b:asset-a' }]);
  assert.deepEqual(third.limiterCalls, [{ key: 'student-hash-a:asset-b' }]);
});

test('V5 V2 fails closed when the limiter binding is unavailable', async () => {
  const { response, calls } = await signedRequest('bytes=0-99', 'GET', { omitLimiter: true });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'rate_limiter_unavailable');
  assert.equal(calls.get.length + calls.head.length, 0);
});

test('V5 health and V2 OPTIONS bypass the media rate limiter', async () => {
  const limiter = fakeRateLimiter({ success: false });
  const env = { V5_ALLOWED_ORIGINS: origin, V5_MEDIA_RATE_LIMITER: limiter.binding };
  const health = await worker.fetch(new Request('https://media.example/health'), env);
  const options = await worker.fetch(new Request('https://media.example/v2/media', {
    method: 'OPTIONS',
    headers: { origin }
  }), env);
  assert.equal(health.status, 200);
  assert.equal(options.status, 204);
  assert.equal(limiter.calls.length, 0);
});

test('V5 Worker rate limit threshold remains deployment-configurable at 600 requests/minute', () => {
  const config = fs.readFileSync(new URL('../cloudflare/v5-media-worker/wrangler.toml.example', import.meta.url), 'utf8');
  assert.match(config, /name = "V5_MEDIA_RATE_LIMITER"/);
  assert.match(config, /limit = 600/);
  assert.match(config, /period = 60/);
});
