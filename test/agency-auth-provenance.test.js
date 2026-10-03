import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAuthPrincipal } from '../utils/agency-auth-principals.js';

const runId = '22222222-2222-4222-8222-222222222222';
const userId = '11111111-1111-4111-8111-111111111111';
const options = { mode: 'create_if_missing', allowCreate: true, factoryRunId: runId };
const owner = { email: 'owner@example.test' };

function clientFor(users, createUser) {
  return { auth: { admin: {
    listUsers: async () => ({ data: { users: structuredClone(users) }, error: null }),
    getUserById: async id => ({ data: { user: structuredClone(users.find(user => user.id === id)) }, error: null }),
    createUser
  } } };
}

for (const suppliedId of [false, true]) {
  test(`Editable run marker never attributes a pre-existing shared UID (by ID: ${suppliedId})`, async () => {
    const users = [{ id: userId, email: owner.email, user_metadata: { system_b_factory: true, system_b_factory_run_id: runId } }];
    let creates = 0;
    const result = await prepareAuthPrincipal(clientFor(users, () => { creates++; }), { ...owner, ...(suppliedId ? { user_id: userId } : {}) }, { ...options, allowCreate: false });
    assert.equal(result.ok, true); assert.equal(creates, 0);
    assert.equal(result.createdByRun, false); assert.equal(result.reused, true);
  });
}

test('Admin-controlled provenance survives removed or forged editable metadata and is scoped to the exact run', async () => {
  const users = [{ id: userId, email: owner.email, app_metadata: { system_b_factory: true, system_b_factory_run_id: runId }, user_metadata: {} }];
  const client = clientFor(users);
  let result = await prepareAuthPrincipal(client, owner, options);
  assert.equal(result.createdByRun, true); assert.equal(result.reused, false);
  users[0].user_metadata.system_b_factory_run_id = 'another-run';
  result = await prepareAuthPrincipal(client, owner, options);
  assert.equal(result.createdByRun, true);
  result = await prepareAuthPrincipal(client, owner, { ...options, factoryRunId: 'another-run' });
  assert.equal(result.createdByRun, false); assert.equal(result.reused, true);
});

test('Genuine create stamps privileged provenance and lost response recovers without another creation', async () => {
  for (const loseResponse of [false, true]) {
    const users = []; let creates = 0;
    const client = clientFor(users, async input => {
      creates++;
      assert.equal(input.app_metadata?.system_b_factory_run_id, runId);
      assert.equal(input.user_metadata?.system_b_factory_run_id, undefined);
      const user = { id: userId, email: input.email, app_metadata: input.app_metadata };
      users.push(user);
      return loseResponse ? { data: null, error: new Error('synthetic_response_lost') } : { data: { user }, error: null };
    });
    const first = await prepareAuthPrincipal(client, owner, options);
    assert.equal(first.ok, true); assert.equal(first.createdByRun, true);
    assert.equal(first.recovered, loseResponse);
    const retry = await prepareAuthPrincipal(client, owner, options);
    assert.equal(retry.createdByRun, true); assert.equal(retry.user.id, userId);
    assert.equal(creates, 1);
  }
});

test('Lost create response cannot recover through a forged editable marker on a shared UID', async () => {
  const users = [];
  const client = clientFor(users, async () => {
    users.push({ id: userId, email: owner.email, user_metadata: { system_b_factory_run_id: runId } });
    return { data: null, error: new Error('synthetic_response_lost') };
  });
  const result = await prepareAuthPrincipal(client, owner, options);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'auth_principal_create_failed');
});
