import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../cloudflare/v5-media-worker/src/index.js';

const encoder = new TextEncoder();
const userAgent = 'System-B-V5-range-test';
const objectSize = 1000;

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function sha256base64url(value) {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function fixture(overrides = {}) {
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
    ct: 'video/mp4',
    fn: 'test.mp4',
    ...overrides
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, encoder.encode(encoded));
  return { token: `${encoded}.${base64url(signature)}`, publicJwk };
}

function fakeR2() {
  const calls = { get: [], head: [] };
  return {
    calls,
    bucket: {
      async get(key, options) {
        calls.get.push({ key, options });
        return {
          body: 'x',
          size: objectSize,
          etag: 'etag-1',
          httpMetadata: { contentType: 'video/mp4' }
        };
      },
      async head(key) {
        calls.head.push({ key });
        return {
          size: objectSize,
          etag: 'etag-1',
          httpMetadata: { contentType: 'video/mp4' }
        };
      }
    }
  };
}

async function request(range, method = 'GET') {
  const { token, publicJwk } = await fixture();
  const r2 = fakeR2();
  const headers = new Headers({ 'user-agent': userAgent });
  if (range) headers.set('range', range);
  const response = await worker.fetch(new Request(`https://media.example/v1/media?t=${encodeURIComponent(token)}`, { method, headers }), {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(publicJwk),
    V5_ALLOWED_ORIGINS: '',
    V5_MEDIA: r2.bucket
  });
  return { response, calls: r2.calls };
}

const rangeCases = [
  ['first bytes', 'bytes=0-99', { offset: 0, length: 100 }, 'bytes 0-99/1000', '100'],
  ['last explicit bytes', 'bytes=900-999', { offset: 900, length: 100 }, 'bytes 900-999/1000', '100'],
  ['suffix bytes', 'bytes=-100', { suffix: 100 }, 'bytes 900-999/1000', '100'],
  ['open-ended bytes', 'bytes=900-', { offset: 900 }, 'bytes 900-999/1000', '100']
];

test('V5 media full GET performs one R2 get and no head', async () => {
  const { response, calls } = await request(null);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '1000');
  assert.equal(calls.get.length, 1);
  assert.equal(calls.head.length, 0);
  assert.equal(calls.get[0].options, undefined);
});

for (const [name, rangeHeader, expectedR2Range, expectedContentRange, expectedLength] of rangeCases) {
  test(`V5 media ${name} uses one ranged R2 get`, async () => {
    const { response, calls } = await request(rangeHeader);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), expectedContentRange);
    assert.equal(response.headers.get('content-length'), expectedLength);
    assert.equal(calls.get.length, 1);
    assert.equal(calls.head.length, 0);
    assert.deepEqual(calls.get[0].options, { range: expectedR2Range });
  });
}

test('V5 media HEAD keeps metadata-only head and never performs an R2 get', async () => {
  const { response, calls } = await request('bytes=0-99', 'HEAD');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-99/1000');
  assert.equal(calls.get.length, 0);
  assert.equal(calls.head.length, 1);
});

test('V5 media rejects malformed lease before any R2 operation', async () => {
  const r2 = fakeR2();
  const response = await worker.fetch(new Request('https://media.example/v1/media?t=*.sig', {
    headers: { 'user-agent': userAgent }
  }), {
    V5_PLAYBACK_PUBLIC_JWK: '{}',
    V5_ALLOWED_ORIGINS: '',
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'invalid_payload');
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
    V5_MEDIA: r2.bucket
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'invalid_signature');
  assert.equal(r2.calls.get.length, 0);
  assert.equal(r2.calls.head.length, 0);
});
