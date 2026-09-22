import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const swSource = fs.readFileSync(new URL('../v5/media-sw.js', import.meta.url), 'utf8');

const sandbox = {
  self: {
    addEventListener() {},
    skipWaiting() {},
    clients: { claim() {} },
    location: { origin: 'https://hoc.yeubep.shop' }
  },
  console,
  TextEncoder,
  crypto,
  Uint8Array,
  btoa,
  String,
  Number,
  Math,
  URL,
  URLSearchParams,
  Map,
  Headers,
  fetch: () => {},
  Response: class {}
};
vm.createContext(sandbox);
vm.runInContext(
  `${swSource}\n;globalThis.exported = { playbackRange, STARTUP_VIDEO_RANGE_BYTES, STEADY_VIDEO_RANGE_BYTES };`,
  sandbox
);
const { playbackRange, STARTUP_VIDEO_RANGE_BYTES, STEADY_VIDEO_RANGE_BYTES } = sandbox.exported;

test('V5 explicit video range clamp - constants and invariants', () => {
  assert.equal(STARTUP_VIDEO_RANGE_BYTES, 1 * 1024 * 1024, 'startup must be 1 MiB');
  assert.equal(STEADY_VIDEO_RANGE_BYTES, 4 * 1024 * 1024, 'steady must be 4 MiB');
  assert.match(swSource, /const STARTUP_VIDEO_RANGE_BYTES = 1 \* 1024 \* 1024/);
  assert.match(swSource, /const STEADY_VIDEO_RANGE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(swSource, /playbackRange\(request\.headers\.get\("range"\), lease\.mimeType\)/);
});

test('V5 explicit video range clamp - no Range', () => {
  assert.equal(playbackRange('', 'video/mp4'), `bytes=0-${STARTUP_VIDEO_RANGE_BYTES - 1}`);
  assert.equal(playbackRange(null, 'video/mp4'), `bytes=0-${STARTUP_VIDEO_RANGE_BYTES - 1}`);
  assert.equal(playbackRange(undefined, 'video/mp4'), `bytes=0-${STARTUP_VIDEO_RANGE_BYTES - 1}`);
  assert.equal(playbackRange('', 'application/pdf'), '');
  assert.equal(playbackRange(null, 'image/png'), '');
});

test('V5 explicit video range clamp - open-ended byte 0', () => {
  assert.equal(playbackRange('bytes=0-', 'video/mp4'), 'bytes=0-1048575');
});

test('V5 explicit video range clamp - open-ended midstream', () => {
  assert.equal(playbackRange('bytes=1048576-', 'video/mp4'), `bytes=1048576-${1048576 + STEADY_VIDEO_RANGE_BYTES - 1}`);
  assert.equal(playbackRange('bytes=201168-', 'video/mp4'), `bytes=201168-${201168 + STEADY_VIDEO_RANGE_BYTES - 1}`);
});

test('V5 explicit video range clamp - bytes=0-1', () => {
  assert.equal(playbackRange('bytes=0-1', 'video/mp4'), 'bytes=0-1');
});

test('V5 explicit video range clamp - explicit nhỏ', () => {
  assert.equal(playbackRange('bytes=0-500', 'video/mp4'), 'bytes=0-500');
  assert.equal(playbackRange('bytes=2000-3000', 'video/mp4'), 'bytes=2000-3000');
  assert.equal(playbackRange('bytes=10000-10050', 'video/mp4'), 'bytes=10000-10050');
});

test('V5 explicit video range clamp - exact boundary', () => {
  assert.equal(playbackRange(`bytes=0-${STARTUP_VIDEO_RANGE_BYTES - 1}`, 'video/mp4'), `bytes=0-${STARTUP_VIDEO_RANGE_BYTES - 1}`);
  const midStart = 2000000;
  const midEnd = midStart + STEADY_VIDEO_RANGE_BYTES - 1;
  assert.equal(playbackRange(`bytes=${midStart}-${midEnd}`, 'video/mp4'), `bytes=${midStart}-${midEnd}`);
});

test('V5 explicit video range clamp - explicit lớn start=0', () => {
  assert.equal(playbackRange('bytes=0-40547687', 'video/mp4'), 'bytes=0-1048575');
  assert.equal(playbackRange('bytes=0-2000000', 'video/mp4'), 'bytes=0-1048575');
  assert.equal(playbackRange(`bytes=0-${STARTUP_VIDEO_RANGE_BYTES}`, 'video/mp4'), `bytes=0-${STARTUP_VIDEO_RANGE_BYTES - 1}`);
});

test('V5 explicit video range clamp - explicit lớn midstream', () => {
  assert.equal(playbackRange('bytes=201168-40547687', 'video/mp4'), `bytes=201168-${201168 + STEADY_VIDEO_RANGE_BYTES - 1}`);
  assert.equal(playbackRange('bytes=10000000-20000000', 'video/mp4'), `bytes=10000000-${10000000 + STEADY_VIDEO_RANGE_BYTES - 1}`);
});

test('V5 explicit video range clamp - suffix', () => {
  assert.equal(playbackRange('bytes=-500', 'video/mp4'), 'bytes=-500');
  assert.equal(playbackRange('bytes=-1048576', 'video/mp4'), 'bytes=-1048576');
});

test('V5 explicit video range clamp - malformed/end-before-start', () => {
  assert.equal(playbackRange('bytes=500-100', 'video/mp4'), 'bytes=500-100');
  assert.equal(playbackRange('bytes=10-0', 'video/mp4'), 'bytes=10-0');
  assert.equal(playbackRange('invalid-range', 'video/mp4'), 'invalid-range');
});

test('V5 explicit video range clamp - multi-range', () => {
  assert.equal(playbackRange('bytes=0-10,20-30', 'video/mp4'), 'bytes=0-10,20-30');
  assert.equal(playbackRange('bytes=0-50, 100-200', 'video/mp4'), 'bytes=0-50, 100-200');
});

test('V5 explicit video range clamp - overflow', () => {
  assert.equal(playbackRange('bytes=9007199254740992-9007199254740993', 'video/mp4'), 'bytes=9007199254740992-9007199254740993');
  const safeNearMax = Number.MAX_SAFE_INTEGER - 100;
  assert.equal(playbackRange(`bytes=${safeNearMax}-${Number.MAX_SAFE_INTEGER}`, 'video/mp4'), `bytes=${safeNearMax}-${Number.MAX_SAFE_INTEGER}`);
});

test('V5 explicit video range clamp - HEAD', () => {
  assert.equal(playbackRange('bytes=0-40547687', 'video/mp4', 'HEAD'), 'bytes=0-40547687');
  assert.equal(playbackRange('bytes=0-1', 'video/mp4', 'HEAD'), 'bytes=0-1');
  assert.equal(playbackRange('', 'video/mp4', 'HEAD'), '');
  assert.match(swSource, /const method = request\.method === "HEAD" \? "HEAD" : "GET";/);
  assert.match(swSource, /clean\(request\.headers\.get\("range"\)\)/);
});

test('V5 explicit video range clamp - non-video', () => {
  assert.equal(playbackRange('bytes=0-40547687', 'application/pdf'), 'bytes=0-40547687');
  assert.equal(playbackRange('bytes=0-100', 'image/jpeg'), 'bytes=0-100');
  assert.equal(playbackRange('bytes=0-', 'application/zip'), 'bytes=0-');
  assert.equal(playbackRange('', 'application/octet-stream'), '');
});

test('V5 explicit video range clamp - invariant: output explicit Range luôn nằm trong Range client yêu cầu', () => {
  const testSpans = [
    [0, 1],
    [0, 50],
    [0, 1048575],
    [0, 1048576],
    [0, 40547687],
    [100, 200],
    [100, 100 + STEADY_VIDEO_RANGE_BYTES - 1],
    [100, 100 + STEADY_VIDEO_RANGE_BYTES],
    [201168, 40547687],
    [5000000, 15000000]
  ];

  for (const [start, requestedEnd] of testSpans) {
    const raw = `bytes=${start}-${requestedEnd}`;
    const result = playbackRange(raw, 'video/mp4');
    const m = result.match(/^bytes=(\d+)-(\d+)$/);
    assert.ok(m, `Result ${result} must be valid bytes=start-end`);
    const outStart = Number(m[1]);
    const outEnd = Number(m[2]);

    assert.equal(outStart, start, 'Output start must equal client requested start');
    assert.ok(outEnd <= requestedEnd, `Output end ${outEnd} must not exceed client requested end ${requestedEnd}`);
    assert.ok(outEnd >= outStart, `Output end ${outEnd} must be >= output start ${outStart}`);

    const span = outEnd - outStart + 1;
    const limit = start === 0 ? STARTUP_VIDEO_RANGE_BYTES : STEADY_VIDEO_RANGE_BYTES;
    assert.ok(span <= limit, `Output span ${span} must not exceed limit ${limit}`);
  }
});
