import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const script = fs.readFileSync(new URL('../factory-admin.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const response = data => ({ ok: true, json: async () => data });
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

async function harness() {
  const nodes = new Map(), calls = [], stored = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', checked: true, textContent: '', disabled: false, listeners: new Map(), addEventListener(type, fn) { this.listeners.set(type, fn); } });
    return nodes.get(id);
  };
  for (const [id, value] of Object.entries({
    slug: 'fixture-a',
    name: 'Fixture A',
    profile: 'TENANT_SHELL',
    commerceHost: 'shop.example.test',
    lmsHost: 'learn.example.test',
    ownerEmail: 'owner@example.test',
    sourceCommerceSha: '823ddd23c3edd32d57c6a05f1c1bc6350c6216c4',
    loadRunId: '',
    banks: '[]',
    offerings: '[]',
    learning: '{"courses":[]}',
    evidenceRefs: 'unit'
  })) get(id).value = value;
  let handler = async body => response(body.action === 'preflight' ? { ok: true } : { ok: true, run: { id: 'run-a', revision: 1 } });
  const context = vm.createContext({
    crypto, document: { getElementById: get },
    localStorage: { getItem: key => stored.get(key) || '', setItem: (key, value) => stored.set(key, value) },
    fetch: async (url, options = {}) => {
      if (!options.method) {
        if (String(url).includes('action=run')) {
          const runId = new URL(String(url), 'https://fixture.test').searchParams.get('runId');
          return response({ ok: true, run: { id: runId, target_slug: 'fixture-a', profile: 'TENANT_SHELL', phase: 'READY', revision: 9 } });
        }
        return response({ ok: true, csrf: 'csrf-fixture', admin: 'fixture' });
      }
      const body = JSON.parse(options.body); calls.push(body); return handler(body);
    }
  });
  vm.runInContext(script, context);
  await settle();
  return { get, calls, setHandler: fn => { handler = fn; }, call: action => vm.runInContext(`call(${JSON.stringify(action)})`, context), state: expression => vm.runInContext(expression, context) };
}

test('Factory actual inline UI carries each returned revision through all run actions', async () => {
  const h = await harness();
  await h.call('preflight');
  await h.get('createRun').onclick();
  assert.equal(h.calls[0].expectedRevision, undefined);
  assert.equal(h.calls[1].expectedRevision, undefined);
  assert.equal(h.calls[1].sourceCommerceSha, '823ddd23c3edd32d57c6a05f1c1bc6350c6216c4');
  assert.equal(h.state('currentIdem'), h.calls[1].idempotencyKey);
  let revision = 1;
  h.setHandler(async body => {
    assert.equal(body.runId, 'run-a');
    assert.equal(body.expectedRevision, revision);
    revision++;
    return response(body.action === 'activate' ? { ok: true, result: { revision } } : { ok: true, run: { id: 'run-a', revision } });
  });
  for (const button of ['prepare', 'apply', 'validate', 'activate', 'suspend']) await h.get(button).onclick();
  assert.equal(h.state('currentRevision'), 6);
});

test('Factory switching targets ignores a pending response and resets run/revision binding', async () => {
  const h = await harness();
  await h.get('createRun').onclick();
  let resolve;
  h.setHandler(() => new Promise(r => { resolve = r; }));
  const pending = h.get('validate').onclick();
  await settle();
  h.get('slug').value = 'fixture-b';
  h.get('slug').listeners.get('input')?.();
  resolve(response({ ok: true, run: { id: 'run-a', revision: 9 } }));
  await pending;
  h.setHandler(async body => {
    assert.equal(body.runId, '');
    assert.equal(body.expectedRevision, undefined);
    return response({ ok: true, run: { id: 'run-b', revision: 1 } });
  });
  await h.get('createRun').onclick();
  assert.equal(h.state('currentRun'), 'run-b');
  assert.equal(h.state('currentRevision'), 1);
});

test('Factory prevents concurrent revision writes and rejects an unrelated returned run', async () => {
  const h = await harness();
  await h.get('createRun').onclick();
  let resolve;
  h.setHandler(() => new Promise(r => { resolve = r; }));
  const pending = h.get('validate').onclick();
  await settle();
  const count = h.calls.length;
  await h.get('activate').onclick();
  assert.equal(h.calls.length, count);
  resolve(response({ ok: true, run: { id: 'unrelated-run', revision: 20 } }));
  await pending;
  assert.equal(h.state('currentRun'), 'run-a');
  assert.equal(h.state('currentRevision'), 1);
});


test('Factory UI can reload an existing run and send Commerce provenance on upgrade', async () => {
  const h = await harness();
  h.get('loadRunId').value = 'run-existing';
  await h.get('loadRun').onclick();
  assert.equal(h.state('currentRun'), 'run-existing');
  assert.equal(h.state('currentRevision'), 9);
  assert.equal(h.get('slug').value, 'fixture-a');

  h.get('profile').value = 'LEARNING_READY';
  h.setHandler(async body => {
    assert.equal(body.action, 'upgrade');
    assert.equal(body.runId, 'run-existing');
    assert.equal(body.expectedRevision, 9);
    assert.equal(body.sourceCommerceSha, '823ddd23c3edd32d57c6a05f1c1bc6350c6216c4');
    return response({ ok: true, run: { id: 'run-existing', revision: 12 } });
  });

  await h.get('upgrade').onclick();
  assert.equal(h.state('currentRevision'), 12);
});

test('Factory UI blocks create or upgrade when Commerce source SHA is missing or malformed', async () => {
  const h = await harness();
  h.get('sourceCommerceSha').value = 'bad-sha';
  const before = h.calls.length;
  await h.get('createRun').onclick();
  assert.equal(h.calls.length, before);

  h.get('loadRunId').value = 'run-existing';
  await h.get('loadRun').onclick();
  await h.get('upgrade').onclick();
  assert.equal(h.calls.length, before);
});
