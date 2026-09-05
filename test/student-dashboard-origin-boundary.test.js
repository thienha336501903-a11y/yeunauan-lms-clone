import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { applySameOriginCors, getRequestOrigin } from '../utils/lms-request-origin.js';

function responseHarness() {
  const values = new Map();
  return {
    setHeader(name, value) { values.set(String(name).toLowerCase(), String(value)); },
    getHeader(name) { return values.get(String(name).toLowerCase()); },
    header(name) { return values.get(String(name).toLowerCase()); }
  };
}

test('same-origin browser request is allowed and origin is echoed exactly', () => {
  const req = { headers: {
    origin: 'https://hoc.yeubep.shop',
    host: 'hoc.yeubep.shop',
    'x-forwarded-proto': 'https'
  } };
  const res = responseHarness();
  assert.equal(applySameOriginCors(req, res), true);
  assert.equal(res.header('access-control-allow-origin'), 'https://hoc.yeubep.shop');
  assert.match(res.header('vary') || '', /Origin/);
});

test('foreign browser origin is denied without an allow-origin response', () => {
  const req = { headers: {
    origin: 'https://evil.example',
    host: 'hoc.yeubep.shop',
    'x-forwarded-proto': 'https'
  } };
  const res = responseHarness();
  assert.equal(applySameOriginCors(req, res), false);
  assert.equal(res.header('access-control-allow-origin'), undefined);
});

test('preview/custom domains work when browser origin matches the actual forwarded host', () => {
  const req = { headers: {
    origin: 'https://preview-123.vercel.app',
    host: 'internal.vercel.app',
    'x-forwarded-host': 'preview-123.vercel.app',
    'x-forwarded-proto': 'https'
  } };
  const res = responseHarness();
  assert.equal(getRequestOrigin(req), 'https://preview-123.vercel.app');
  assert.equal(applySameOriginCors(req, res), true);
});

test('origin-less server/non-browser request remains compatible', () => {
  const req = { headers: { host: 'hoc.yeubep.shop' } };
  const res = responseHarness();
  assert.equal(applySameOriginCors(req, res), true);
  assert.equal(res.header('access-control-allow-origin'), undefined);
});

test('malformed browser origin fails closed', () => {
  const req = { headers: { origin: 'not a url', host: 'hoc.yeubep.shop' } };
  const res = responseHarness();
  assert.equal(applySameOriginCors(req, res), false);
});

test('student dashboard no longer exposes wildcard CORS and fails foreign origin before auth', () => {
  const handler = fs.readFileSync(new URL('../utils/lms-handlers/student-dashboard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(handler, /Access-Control-Allow-Origin["'],["']\*/);
  assert.match(handler, /applySameOriginCors/);
  assert.match(handler, /origin_not_allowed/);
});
