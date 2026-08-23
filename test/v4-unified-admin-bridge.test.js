import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Commerce V4 orchestration reuses the full prepublish builder', () => {
  const sync = read('api/sync.js');
  const prepublish = read('utils/lms-handlers/admin-v4-prepublish.js');
  assert.match(prepublish, /export async function buildPrepublish/);
  assert.match(sync, /action === "v4Preflight"/);
  assert.match(sync, /await buildPrepublish\(normalizedSlug\)/);
});

test('internal V4 publish is fixed to V4 and refuses blockers', () => {
  const sync = read('api/sync.js');
  assert.match(sync, /action === "setV4Published"/);
  assert.match(sync, /course\.delivery_mode/);
  assert.match(sync, /!== "v4"/);
  assert.match(sync, /if \(!preflight\.ready\)/);
  assert.match(sync, /status\(409\)/);
  assert.match(sync, /is_published: nextPublished/);
  assert.match(sync, /deliveryMode: "v4"/);
});

test('internal V4 actions remain behind the fail-closed sync secret', () => {
  const sync = read('api/sync.js');
  const secretGate = sync.indexOf('if (!systemSecret)');
  const preflightAction = sync.indexOf('action === "v4Preflight"');
  const publishAction = sync.indexOf('action === "setV4Published"');
  assert.ok(secretGate > -1 && preflightAction > secretGate && publishAction > secretGate);
  assert.match(sync, /timingSafeEqualString\(syncSecret, systemSecret\)/);
});
