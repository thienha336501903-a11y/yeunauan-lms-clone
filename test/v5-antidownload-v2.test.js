import assert from 'node:assert/strict';
import cryptoModule from 'node:crypto';
import test from 'node:test';
import worker from '../cloudflare/v5-media-worker/src/index.js';
import { issueV5PlaybackLease } from '../utils/v5-playback-lease.js';

const encoder = new TextEncoder();
const origin = 'https://preview.example';
const userAgent = 'Mozilla/5.0 V5-proof-test';
const objectSize = 1000;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function sha256base64url(value) {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function leaseFixture(overrides = {}) {
  const issuer = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const proof = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const issuerPublicJwk = await crypto.subtle.exportKey('jwk', issuer.publicKey);
  const proofPublicJwk = await crypto.subtle.exportKey('jwk', proof.publicKey);
  const now = Date.now();
  const payload = {
    v: 2,
    aid: 'asset-v2',
    c: 'course-v2',
    k: 'v5/video.mp4',
    ct: 'video/mp4',
    fn: 'video.mp4',
    sz: objectSize,
    iat: now,
    exp: now + 60_000,
    uah: await sha256base64url(userAgent),
    eh: 'student-v2-hash',
    pk: proofPublicJwk,
    ...overrides
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, issuer.privateKey, encoder.encode(encoded));
  return { token: `${encoded}.${base64url(signature)}`, payload, issuerPublicJwk, proofPrivateKey: proof.privateKey };
}

function fakeR2(contentType = 'video/mp4') {
  const calls = { get: [], head: [] };
  const object = {
    body: 'x', size: objectSize, etag: 'etag-v2', httpEtag: '"etag-v2"',
    httpMetadata: { contentType }
  };
  return {
    calls,
    bucket: {
      async get(key, options) { calls.get.push({ key, options }); return object; },
      async head(key) { calls.head.push({ key }); return object; }
    }
  };
}

function fakeLimiter(success = true) {
  return { async limit() { return { success }; } };
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

async function proofHeaders({ token, proofPrivateKey, method = 'GET', range = 'bytes=0-0', requestOrigin = origin, timestamp = Date.now(), nonce = cryptoModule.randomBytes(16).toString('base64url'), marker = 'sw-v2', signatureRange = range }) {
  const canonical = [method, signatureRange || '', String(timestamp), nonce, token, requestOrigin].join('\n');
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, proofPrivateKey, encoder.encode(canonical));
  const headers = new Headers({
    authorization: `Bearer ${token}`,
    origin: requestOrigin,
    'user-agent': userAgent,
    'x-v5-playback': marker,
    'x-v5-playback-timestamp': String(timestamp),
    'x-v5-playback-nonce': nonce,
    'x-v5-playback-signature': base64url(signature)
  });
  if (range) headers.set('range', range);
  return headers;
}

async function v2Request(options = {}) {
  const lease = options.lease || await leaseFixture(options.payload);
  const r2 = fakeR2(options.contentType || lease.payload.ct);
  const headers = options.headers || await proofHeaders({
    ...lease,
    method: options.method || 'GET',
    range: options.range === undefined ? 'bytes=0-0' : options.range,
    requestOrigin: options.origin || origin,
    timestamp: options.timestamp,
    nonce: options.nonce,
    marker: options.marker,
    signatureRange: options.signatureRange
  });
  const env = {
    V5_PLAYBACK_PUBLIC_JWK: JSON.stringify(lease.issuerPublicJwk),
    V5_ALLOWED_ORIGINS: origin,
    V5_MEDIA_RATE_LIMITER: options.limiter === undefined ? fakeLimiter() : options.limiter,
    V5_PLAYBACK_NONCES: options.nonceGuard === undefined ? fakeNonceGuard() : options.nonceGuard,
    V5_MEDIA: r2.bucket
  };
  const url = options.url || 'https://media.example/v2/media';
  const response = await worker.fetch(new Request(url, { method: options.method || 'GET', headers }), env);
  return { response, calls: r2.calls, lease, env };
}

for (const [label, range, expected] of [
  ['finite', 'bytes=0-0', 'bytes 0-0/1000'],
  ['seek', 'bytes=500-599', 'bytes 500-599/1000'],
  ['suffix', 'bytes=-100', 'bytes 900-999/1000'],
  ['open-ended', 'bytes=900-', 'bytes 900-999/1000']
]) {
  test(`V5 V2 valid ${label} Range returns 206`, async () => {
    const { response, calls } = await v2Request({ range });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), expected);
    assert.equal(calls.get.length, 1);
  });
}

test('V5 V2 out-of-bounds Range returns 416 without R2', async () => {
  const { response, calls } = await v2Request({ range: 'bytes=1000-' });
  assert.equal(response.status, 416);
  assert.equal(calls.get.length + calls.head.length, 0);
});

test('V5 V2 signed HEAD Range returns metadata-only 206', async () => {
  const { response, calls } = await v2Request({ method: 'HEAD', range: 'bytes=0-0' });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-0/1000');
  assert.equal(calls.get.length, 0);
  assert.equal(calls.head.length, 1);
});

for (const [label, mutate, expectedStatus] of [
  ['missing Authorization', headers => headers.delete('authorization'), 401],
  ['missing Origin', headers => headers.delete('origin'), 403],
  ['wrong Origin', headers => headers.set('origin', 'https://evil.example'), 403],
  ['missing SW marker', headers => headers.delete('x-v5-playback'), 403],
  ['wrong UA', headers => headers.set('user-agent', 'different-agent'), 403],
  ['stale timestamp', headers => headers.set('x-v5-playback-timestamp', String(Date.now() - 120_000)), 403],
  ['bad nonce', headers => headers.set('x-v5-playback-nonce', 'bad nonce'), 403],
  ['bad request signature', headers => headers.set('x-v5-playback-signature', 'AAAA'), 403]
]) {
  test(`V5 V2 rejects ${label} without R2`, async () => {
    const lease = await leaseFixture();
    const headers = await proofHeaders(lease);
    mutate(headers);
    const { response, calls } = await v2Request({ lease, headers });
    assert.equal(response.status, expectedStatus);
    assert.equal(calls.get.length + calls.head.length, 0);
  });
}

test('V5 V2 rejects a query-token transport without R2', async () => {
  const lease = await leaseFixture();
  const headers = await proofHeaders(lease);
  const { response, calls } = await v2Request({ lease, headers, url: `https://media.example/v2/media?t=${encodeURIComponent(lease.token)}` });
  assert.equal(response.status, 400);
  assert.equal(calls.get.length + calls.head.length, 0);
});

test('V5 V2 rejects expired and bad lease signatures without R2', async t => {
  await t.test('expired', async () => {
    const now = Date.now();
    const lease = await leaseFixture({ iat: now - 61_000, exp: now - 1 });
    const { response, calls } = await v2Request({ lease });
    assert.equal(response.status, 403);
    assert.equal(calls.get.length + calls.head.length, 0);
  });
  await t.test('bad signature', async () => {
    const lease = await leaseFixture();
    const [encoded, raw] = lease.token.split('.');
    const signature = Buffer.from(raw, 'base64url'); signature[0] ^= 1;
    lease.token = `${encoded}.${signature.toString('base64url')}`;
    const { response, calls } = await v2Request({ lease });
    assert.equal(response.status, 403);
    assert.equal(calls.get.length + calls.head.length, 0);
  });
});

test('V5 V2 signature copied to another Range is rejected without R2', async () => {
  const lease = await leaseFixture();
  const headers = await proofHeaders({ ...lease, range: 'bytes=100-199', signatureRange: 'bytes=0-0' });
  const { response, calls } = await v2Request({ lease, headers, range: 'bytes=100-199' });
  assert.equal(response.status, 403);
  assert.equal(calls.get.length + calls.head.length, 0);
});

test('V5 V2 rejects replayed nonce without a second R2 call', async () => {
  const lease = await leaseFixture();
  const nonceGuard = fakeNonceGuard();
  const nonce = cryptoModule.randomBytes(16).toString('base64url');
  const headers = await proofHeaders({ ...lease, nonce });
  const first = await v2Request({ lease, headers, nonceGuard });
  const second = await v2Request({ lease, headers, nonceGuard });
  assert.equal(first.response.status, 206);
  assert.equal(second.response.status, 403);
  assert.equal(second.calls.get.length + second.calls.head.length, 0);
});

test('V5 V2 rejects downloader UA before R2', async () => {
  for (const blocked of ['IDM', 'IDMan', 'JDownloader', 'aria2', 'wget', 'curl', 'FDM', 'python-requests', 'Go-http-client']) {
    const lease = await leaseFixture({ uah: await sha256base64url(blocked) });
    const headers = await proofHeaders(lease); headers.set('user-agent', blocked);
    const { response, calls } = await v2Request({ lease, headers });
    assert.equal(response.status, 403, blocked);
    assert.equal(calls.get.length + calls.head.length, 0, blocked);
  }
});

test('V5 V2 rejects video GET without Range but allows image full GET', async () => {
  const video = await v2Request({ range: null });
  assert.equal(video.response.status, 416);
  assert.equal(video.calls.get.length + video.calls.head.length, 0);
  const imageLease = await leaseFixture({ ct: 'image/jpeg', fn: 'photo.jpg' });
  const image = await v2Request({ lease: imageLease, range: null, contentType: 'image/jpeg' });
  assert.equal(image.response.status, 200);
  assert.equal(image.calls.get.length, 1);
});

test('V5 V2 rate-limit failures happen before R2', async t => {
  await t.test('exceeded', async () => {
    const { response, calls } = await v2Request({ limiter: fakeLimiter(false) });
    assert.equal(response.status, 429);
    assert.equal(calls.get.length + calls.head.length, 0);
  });
  await t.test('missing binding', async () => {
    const { response, calls } = await v2Request({ limiter: null });
    assert.equal(response.status, 503);
    assert.equal(calls.get.length + calls.head.length, 0);
  });
  await t.test('missing nonce guard', async () => {
    const { response, calls } = await v2Request({ nonceGuard: null });
    assert.equal(response.status, 503);
    assert.equal(calls.get.length + calls.head.length, 0);
  });
});

test('V5 V2 lease issuer binds a public proof key and never puts lease in URL', () => {
  const oldPrivate = process.env.V5_PLAYBACK_PRIVATE_JWK;
  const oldUrl = process.env.V5_MEDIA_PUBLIC_URL;
  const issuer = cryptoModule.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const proof = cryptoModule.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  try {
    process.env.V5_PLAYBACK_PRIVATE_JWK = JSON.stringify(issuer.privateKey.export({ format: 'jwk' }));
    process.env.V5_MEDIA_PUBLIC_URL = 'https://media.example';
    const lease = issueV5PlaybackLease({
      version: 2, assetId: 'asset-v2', courseSlug: 'course-v2', objectKey: 'v5/video.mp4',
      mimeType: 'video/mp4', filename: 'video.mp4', bytes: objectSize,
      userAgent, email: 'student@example.com', proofPublicJwk: proof.publicKey.export({ format: 'jwk' })
    });
    const payload = JSON.parse(Buffer.from(lease.token.split('.')[0], 'base64url').toString('utf8'));
    assert.equal(payload.v, 2);
    const expectedProof = proof.publicKey.export({ format: 'jwk' });
    assert.equal(payload.pk.kty, expectedProof.kty);
    assert.equal(payload.pk.crv, expectedProof.crv);
    assert.equal(payload.pk.x, expectedProof.x);
    assert.equal(payload.pk.y, expectedProof.y);
    assert.equal(payload.pk.d, undefined);
    assert.equal(lease.url, 'https://media.example/v2/media');
    assert.doesNotMatch(lease.url, /[?&]t=/);
  } finally {
    if (oldPrivate === undefined) delete process.env.V5_PLAYBACK_PRIVATE_JWK; else process.env.V5_PLAYBACK_PRIVATE_JWK = oldPrivate;
    if (oldUrl === undefined) delete process.env.V5_MEDIA_PUBLIC_URL; else process.env.V5_MEDIA_PUBLIC_URL = oldUrl;
  }
});
