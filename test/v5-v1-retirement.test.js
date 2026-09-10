import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import worker from '../cloudflare/v5-media-worker/src/index.js';

const origin = 'https://preview.example';

function legacyLeaseToken() {
  const payload = {
    v: 1,
    aid: 'legacy-asset',
    c: 'legacy-course',
    k: 'v5/legacy.mp4',
    exp: Date.now() + 60_000
  };
  return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.AA`;
}

test('Cloudflare V5 Worker no longer exposes /v1/media', async () => {
  const calls = { get: 0, head: 0 };
  const response = await worker.fetch(
    new Request(`https://media.example/v1/media?t=${encodeURIComponent(legacyLeaseToken())}`),
    {
      V5_MEDIA: {
        async get() { calls.get += 1; return null; },
        async head() { calls.head += 1; return null; }
      }
    }
  );

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'not_found');
  assert.deepEqual(calls, { get: 0, head: 0 });
});

test('V2 endpoint rejects legacy V1 lease claims before R2', async () => {
  const calls = { get: 0, head: 0 };
  const response = await worker.fetch(
    new Request('https://media.example/v2/media', {
      headers: {
        authorization: `Bearer ${legacyLeaseToken()}`,
        origin,
        'user-agent': 'Mozilla/5.0'
      }
    }),
    {
      V5_ALLOWED_ORIGINS: origin,
      V5_MEDIA: {
        async get() { calls.get += 1; return null; },
        async head() { calls.head += 1; return null; }
      }
    }
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'invalid_claims');
  assert.deepEqual(calls, { get: 0, head: 0 });
});

test('Worker source contains no legacy V1 media route or handler', () => {
  const source = fs.readFileSync(new URL('../cloudflare/v5-media-worker/src/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\/v1\/media/);
  assert.doesNotMatch(source, /mediaV1/);
  assert.match(source, /payload\?\.v !== 2/);
});
