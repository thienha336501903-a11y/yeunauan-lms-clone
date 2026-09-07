import assert from 'node:assert/strict';
import cryptoModule from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import worker from '../cloudflare/v5-media-worker/src/index.js';
import { issueV5PlaybackLease } from '../utils/v5-playback-lease.js';

const encoder = new TextEncoder();
const userAgent = 'System-B-V5-range-test';
const objectSize = 1000;
const studentEmailHash = 'student-email-hash-1';

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function sha256base64url(value) {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function fixture(overrides = {}, options = {}) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const now = Date.now();
  const payload = {
    v: 1,
    aid: 'asset-1',
    c: 'course-1',
    k: 'v5/test.mp4',
    iat: now,
    exp: now + 60_000,
    uah: await sha256base64url(userAgent),
    eh: studentEmailHash,
    n: 'nonce-1',
    ct: 'video/mp4',
    fn: 'test.mp4',
    ...overrides
  };
  if (!options.omitSize) payload.sz = objectSize;
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, encoder.encode(encoded));
  return { token: `${encoded}.${base64url(signature)}`, publicJwk };
}

function fakeR2({ size = objectSize, throwInvalidRange = false } = {}) {
  const calls = { get: [], head: [] };
  return {
    calls,
    bucket: {
      async get(key, options) {
        calls.get.push({ key, options });
        if (throwInvalidRange) {
          const error = new Error('get: The requested range is not satisfiable. (10039)');
          throw error;
        }
        return {
          body: 'x',
          size,
          etag: 'etag-1',
          httpEtag: '"etag-1"',
          httpMetadata: { contentType: 'video/mp4' }
        };
      },
      async head(key) {
        calls.head.push({ key });
        return {
          size,
          etag: 'etag-1',
          httpEtag: '"etag-1"',
          httpMetadata: { contentType: 'video/mp4' }
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

async function signedRequest(range, method = 'GET', options = {}) {
  const { token, publicJwk } = await fixture(options.payload || {}, { omitSize: options.omitSize });
  const r2 = fakeR2(options.r2 || {});
  const limiter = options.limiter || fakeRateLimiter();
  const headers = new Headers({ 'user-agent': userAgent });
  if (range) headers.set('range', range);
  if (options.origin) headers.set('origin', options.origin);
  const response = await worker.fetch(new Request(`https://media.example/v1/media?t=${encodeURIComponent(token)}`, { method, headers }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(publicJwk),
    V5_ALLOWED_ORIGINS: options.origin || '',
    V5_MEDIA_RATE_LIMITER: limiter.binding,
    V5_MEDIA: r2.bucket
  });
  return { response, calls: r2.calls, limiterCalls: limiter.calls };
}

const rangeCases = [
  ['first bytes', 'bytes=0-99', { offset: 0, length: 100 }, 'bytes 0-99/1000', '100'],
  ['last explicit bytes', 'bytes=900-999', { offset: 900, length: 100 }, 'bytes 900-999/1000', '100'],
  ['suffix bytes', 'bytes=-100', { offset: 900, length: 100 }, 'bytes 900-999/1000', '100'],
  ['open-ended bytes', 'bytes=900-', { offset: 900, length: 100 }, 'bytes 900-999/1000', '100'],
  ['explicit end beyond object', 'bytes=900-1500', { offset: 900, length: 100 }, 'bytes 900-999/1000', '100'],
  ['suffix larger than object', 'bytes=-1500', { offset: 0, length: 1000 }, 'bytes 0-999/1000', '1000']
];

test('V5 playback issuer signs verified media size while preserving identity claims', () => {
  const previousPrivate = process.env.V5_PLAYBACK_PRIVATE_JWK;
  const previousUrl = process.env.V5_MEDIA_PUBLIC_URL;
  const { privateKey } = cryptoModule.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  try {
    process.env.V5_PLAYBACK_PRIVATE_JWK = JSON.stringify(privateKey.export({ format: 'jwk' }));
    process.env.V5_MEDIA_PUBLIC_URL = 'https://media.example';
    const lease = issueV5PlaybackLease({
      assetId: 'asset-1',
      courseSlug: 'course-1',
      objectKey: 'v5/test.mp4',
      mimeType: 'video/mp4',
      filename: 'test.mp4',
      bytes: objectSize,
      userAgent,
      email: 'student@example.com'
    });
    const payload = JSON.parse(Buffer.from(lease.token.split('.')[0], 'base64url').toString('utf8'));
    assert.equal(payload.sz, objectSize);
    assert.equal(payload.aid, 'asset-1');
    assert.equal(payload.c, 'course-1');
    assert.ok(payload.uah);
    assert.ok(payload.eh);
    assert.ok(payload.n);
    const play = fs.readFileSync(new URL('../utils/lms-handlers/v5-play.js', import.meta.url), 'utf8');
    assert.match(play, /original_filename,bytes,status/);
    assert.match(play, /bytes: asset\.bytes/);
  } finally {
    if (previousPrivate === undefined) delete process.env.V5_PLAYBACK_PRIVATE_JWK;
    else process.env.V5_PLAYBACK_PRIVATE_JWK = previousPrivate;
    if (previousUrl === undefined) delete process.env.V5_MEDIA_PUBLIC_URL;
    else process.env.V5_MEDIA_PUBLIC_URL = previousUrl;
  }
});

test('V5 media full GET performs one R2 get and no head', async () => {
  const { response, calls, limiterCalls } = await signedRequest(null);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '1000');
  assert.equal(calls.get.length, 1);
  assert.equal(calls.head.length, 0);
  assert.equal(calls.get[0].options, undefined);
  assert.deepEqual(limiterCalls, [{ key: `${studentEmailHash}:asset-1` }]);
});

for (const [name, rangeHeader, expectedR2Range, expectedContentRange, expectedLength] of rangeCases) {
  test(`V5 media ${name} uses one normalized ranged R2 get`, async () => {
    const { response, calls } = await signedRequest(rangeHeader);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), expectedContentRange);
    assert.equal(response.headers.get('content-length'), expectedLength);
    assert.equal(calls.get.length, 1);
    assert.equal(calls.head.length, 0);
    assert.deepEqual(calls.get[0].options, { range: expectedR2Range });
  });
}

test('V5 media rejects an out-of-bounds signed range before any R2 operation', async () => {
  const { response, calls } = await signedRequest('bytes=1000-');
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */1000');
  assert.equal(calls.get.length, 0);
  assert.equal(calls.head.length, 0);
});

test('V5 media rejects malformed range syntax before any R2 operation', async () => {
  const { response, calls } = await signedRequest('bytes=200-100');
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */1000');
  assert.equal(calls.get.length, 0);
  assert.equal(calls.head.length, 0);
});

test('V5 media converts legacy-lease R2 InvalidRange into 416 without an extra head', async () => {
  const { response, calls } = await signedRequest('bytes=1000-', 'GET', { omitSize: true, r2: { throwInvalidRange: true } });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */*');
  assert.equal(calls.get.length, 1);
  assert.equal(calls.head.length, 0);
});

test('V5 media fails closed if signed size no longer matches the R2 object', async () => {
  const { response, calls } = await signedRequest('bytes=0-99', 'GET', { r2: { size: objectSize + 1 } });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'media_size_mismatch');
  assert.equal(calls.get.length, 1);
  assert.equal(calls.head.length, 0);
});

test('V5 media HEAD keeps metadata-only head and never performs an R2 get', async () => {
  const { response, calls } = await signedRequest('bytes=0-99', 'HEAD');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-99/1000');
  assert.equal(calls.get.length, 0);
  assert.equal(calls.head.length, 1);
});

test('V5 media rejects malformed lease before any R2 operation', async () => {
  const r2 = fakeR2();
  const limiter = fakeRateLimiter();
  const response = await worker.fetch(new Request('https://media.example/v1/media?t=*.sig', {
    headers: { 'user-agent': userAgent }
  }), {
    V5_PLAYBACK_PUBLIC_JWK: '{}',
    V5_ALLOWED_ORIGINS: '',
    V5_MEDIA_RATE_LIMITER: limiter.binding,
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'invalid_payload');
  assert.equal(limiter.calls.length, 0);
  assert.equal(r2.calls.get.length, 0);
  assert.equal(r2.calls.head.length, 0);
});

test('V5 media rejects UA mismatch before any R2 operation', async () => {
  const { token, publicJwk } = await fixture();
  const r2 = fakeR2();
  const response = await worker.fetch(new Request(`https://media.example/v1/media?t=${encodeURIComponent(token)}`, {
    headers: { 'user-agent': `${userAgent}-different` }
  }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(publicJwk),
    V5_ALLOWED_ORIGINS: '',
    V5_MEDIA_RATE_LIMITER: fakeRateLimiter().binding,
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'lease_ua_mismatch');
  assert.equal(r2.calls.get.length, 0);
  assert.equal(r2.calls.head.length, 0);
});

test('V5 media rejects an expired lease before any R2 operation', async () => {
  const now = Date.now();
  const { token, publicJwk } = await fixture({ iat: now - 60_000, exp: now - 1 });
  const r2 = fakeR2();
  const response = await worker.fetch(new Request(`https://media.example/v1/media?t=${encodeURIComponent(token)}`, {
    headers: { 'user-agent': userAgent }
  }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(publicJwk),
    V5_ALLOWED_ORIGINS: '',
    V5_MEDIA_RATE_LIMITER: fakeRateLimiter().binding,
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'lease_expired');
  assert.equal(r2.calls.get.length, 0);
  assert.equal(r2.calls.head.length, 0);
});

test('V5 media rejects a bad ECDSA signature before any R2 operation', async () => {
  const { token, publicJwk } = await fixture();
  const [encoded, signatureText] = token.split('.');
  const signature = Buffer.from(signatureText, 'base64url');
  signature[0] ^= 1;
  const badToken = `${encoded}.${signature.toString('base64url')}`;
  const r2 = fakeR2();
  const response = await worker.fetch(new Request(`https://media.example/v1/media?t=${encodeURIComponent(badToken)}`, {
    headers: { 'user-agent': userAgent }
  }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(publicJwk),
    V5_ALLOWED_ORIGINS: '',
    V5_MEDIA_RATE_LIMITER: fakeRateLimiter().binding,
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'invalid_signature');
  assert.equal(r2.calls.get.length, 0);
  assert.equal(r2.calls.head.length, 0);
});

test('V5 media accepts a Preview rotation key without replacing the legacy live key', async () => {
  const preview = await fixture();
  const legacy = await fixture();
  const r2 = fakeR2();
  const limiter = fakeRateLimiter();
  const response = await worker.fetch(new Request(`https://media.example/v1/media?t=${encodeURIComponent(preview.token)}`, {
    headers: { 'user-agent': userAgent }
  }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(legacy.publicJwk),
    V5_PLAYBACK_PUBLIC_JWK_PREVIEW: JSON.stringify(preview.publicJwk),
    V5_ALLOWED_ORIGINS: '',
    V5_MEDIA_RATE_LIMITER: limiter.binding,
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 200);
  assert.equal(r2.calls.get.length, 1);
  assert.equal(limiter.calls.length, 1);
});

test('V5 media rejects an exceeded authenticated identity before any R2 operation', async () => {
  const limiter = fakeRateLimiter({ success: false });
  const { response, calls, limiterCalls } = await signedRequest('bytes=0-99', 'GET', { limiter, origin: 'https://hoc.yeubep.shop' });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('access-control-expose-headers') || '', /Retry-After/);
  assert.equal((await response.json()).error, 'rate_limit_exceeded');
  assert.deepEqual(limiterCalls, [{ key: `${studentEmailHash}:asset-1` }]);
  assert.equal(calls.get.length, 0);
  assert.equal(calls.head.length, 0);
});

test('V5 media rate limit keys isolate students and assets without using IP', async () => {
  const first = await signedRequest(null, 'GET', { payload: { eh: 'student-hash-a', aid: 'asset-a' } });
  const second = await signedRequest(null, 'GET', { payload: { eh: 'student-hash-b', aid: 'asset-a' } });
  const third = await signedRequest(null, 'GET', { payload: { eh: 'student-hash-a', aid: 'asset-b' } });
  assert.deepEqual(first.limiterCalls, [{ key: 'student-hash-a:asset-a' }]);
  assert.deepEqual(second.limiterCalls, [{ key: 'student-hash-b:asset-a' }]);
  assert.deepEqual(third.limiterCalls, [{ key: 'student-hash-a:asset-b' }]);
});

test('V5 media fails closed when the limiter binding is unavailable', async () => {
  const { token, publicJwk } = await fixture();
  const r2 = fakeR2();
  const response = await worker.fetch(new Request(`https://media.example/v1/media?t=${encodeURIComponent(token)}`, {
    headers: { 'user-agent': userAgent }
  }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(publicJwk),
    V5_ALLOWED_ORIGINS: '',
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'rate_limiter_unavailable');
  assert.equal(r2.calls.get.length, 0);
  assert.equal(r2.calls.head.length, 0);
});

test('V5 health and OPTIONS bypass the media rate limiter', async () => {
  const limiter = fakeRateLimiter({ success: false });
  const env = { V5_ALLOWED_ORIGINS: '', V5_MEDIA_RATE_LIMITER: limiter.binding };
  const health = await worker.fetch(new Request('https://media.example/health'), env);
  const options = await worker.fetch(new Request('https://media.example/v1/media', { method: 'OPTIONS' }), env);
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
