import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFactoryPrincipals } from '../utils/agency-factory.js';
import { normalizeFactoryManifest, factoryManifestHash } from '../utils/agency-factory-manifest.js';

function fixture({ secondPrincipal = false, loseResponse = false, failSecond = false, casConflict = false, forged = false } = {}) {
  const manifest = normalizeFactoryManifest({
    version: 1, profile: 'TENANT_SHELL', agency: { slug: 'fixture', name: 'Fixture' },
    domains: [{ hostname: 'shop.example.test', surface: 'commerce' }, { hostname: 'learn.example.test', surface: 'lms' }],
    ui: { brand_name: 'Fixture' }, principals: [{ email: 'owner@example.test', role: 'agency_owner' }, ...(secondPrincipal ? [{ email: 'student@example.test', role: 'student' }] : [])],
    bank_accounts: [], offerings: [], learning: { courses: [] }
  });
  const run = { id: '22222222-2222-4222-8222-222222222222', actor_ref: 'fixture-actor', manifest_hash: factoryManifestHash(manifest), phase: 'DRAFT', revision: 1, resource_ledger: { created: [], reused: [] }, step_results: {} };
  const users = forged ? [{ id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', user_metadata: { system_b_factory_run_id: run.id } }] : [];
  const writes = []; let creates = 0, conflicts = casConflict ? 1 : 0, successfulCreates = 0;
  const client = { auth: { admin: {
    listUsers: async () => ({ data: { users: structuredClone(users) }, error: null }),
    createUser: async input => {
      creates++;
      if (users.some(user => user.email === input.email)) return { data: null, error: new Error('synthetic_duplicate_email') };
      if (failSecond && creates === 2) return { data: null, error: new Error('synthetic_provider_failure_with_token_canary') };
      successfulCreates++;
      const user = { id: `11111111-1111-4111-8111-${String(successfulCreates).padStart(12, '0')}`, email: input.email, app_metadata: input.app_metadata };
      users.push(user);
      return loseResponse ? { data: null, error: new Error('synthetic_lost_response') } : { data: { user }, error: null };
    }
  } }, from(table) {
    assert.equal(table, 'agency_provisioning_runs');
    let patch = null; const filters = {};
    const query = { select() { return query; }, eq(key, value) { filters[key] = value; return query; }, update(value) { patch = value; return query; }, async maybeSingle() {
      if (patch) {
        if (conflicts > 0) { conflicts--; run.revision++; return { data: null, error: null }; }
        if (filters.id !== run.id || Number(filters.revision) !== run.revision) return { data: null, error: null };
        Object.assign(run, structuredClone(patch)); writes.push(structuredClone(patch));
      }
      return { data: structuredClone(run), error: null };
    } };
    return query;
  } };
  return { manifest, run, writes, users, get creates() { return creates; }, get successfulCreates() { return successfulCreates; }, prepare: () => prepareFactoryPrincipals(run.id, manifest, run.actor_ref, { supabaseClient: client, allowCreate: !forged, expectedRevision: run.revision }) };
}

test('Factory forged editable marker yields a reused UID and zero created ledger entries', async () => {
  const h = fixture({ forged: true });
  const result = await h.prepare();
  assert.equal(result.ok, true); assert.equal(h.creates, 0);
  const principal = h.run.resource_ledger.principals[0];
  assert.equal(principal.created_by_run, false); assert.equal(principal.reused, true);
  assert.equal(h.run.step_results.principals.created, 0);
});

test('Factory retains durable first-principal ownership when a later principal fails and ledger is redacted', async () => {
  const h = fixture({ secondPrincipal: true, failSecond: true });
  const result = await h.prepare();
  assert.equal(result.ok, false);
  assert.equal(h.writes[0].resource_ledger.principals[0].status, 'PREPARING');
  const [first, second] = h.run.resource_ledger.principals;
  assert.equal(first.status, 'PASS'); assert.equal(first.created_by_run, true);
  assert.ok(first.first_created_at); assert.equal(second.status, 'FAIL');
  assert.equal(JSON.stringify(h.run.resource_ledger).includes('token_canary'), false);
});

test('Factory lost-response retry and CAS conflict preserve UID and first creation timestamp', async () => {
  const h = fixture({ loseResponse: true, casConflict: true });
  const first = await h.prepare(); assert.equal(first.ok, true);
  const before = structuredClone(h.run.resource_ledger.principals[0]);
  h.users[0].user_metadata = { system_b_factory_run_id: 'editable-forgery' };
  const retry = await h.prepare(); assert.equal(retry.ok, true);
  const after = h.run.resource_ledger.principals[0];
  assert.equal(h.creates, 1); assert.equal(after.user_id, before.user_id);
  assert.equal(after.first_created_at, before.first_created_at); assert.equal(after.created_by_run, true);
});

test('Concurrent Factory preparation reconciles a single created account and CAS ledger', async () => {
  const h = fixture();
  const results = await Promise.all([h.prepare(), h.prepare()]);
  assert.equal(results.every(result => result.ok), true);
  assert.equal(h.successfulCreates, 1);
  assert.equal(h.run.resource_ledger.principals[0].created_by_run, true);
  assert.equal(h.run.resource_ledger.principals[0].status, 'PASS');
});
