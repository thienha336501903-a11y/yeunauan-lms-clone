import test from "node:test";
import assert from "node:assert/strict";
import { prepareFactoryPrincipals } from "../utils/agency-factory.js";
import { factoryManifestHash, normalizeFactoryManifest } from "../utils/agency-factory-manifest.js";

function manifest() {
  return {
    version: 1,
    profile: "TENANT_SHELL",
    agency: { slug: "agency-b", name: "Agency B" },
    domains: [
      { hostname: "b-shop.example.com", surface: "commerce" },
      { hostname: "b-learn.example.com", surface: "lms" }
    ],
    ui: { brand_name: "Agency B" },
    principals: [{ email: "owner@example.com", role: "agency_owner" }],
    bank_accounts: [],
    offerings: [],
    learning: { courses: [] },
    provider_readiness: {
      lms_host_ready: true,
      commerce_host_ready: true,
      google_lms_origin_ready: true,
      google_commerce_origin_ready: true,
      worker_lms_origin_ready: true,
      evidence_refs: ["unit"]
    }
  };
}

function clientFor(run) {
  return {
    auth: { admin: {
      listUsers: async () => ({
        data: { users: [{ id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com" }] },
        error: null
      })
    }},
    from(table) {
      assert.equal(table, "agency_provisioning_runs");
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, "id");
              assert.equal(value, run.id);
              return { maybeSingle: async () => ({ data: { ...run }, error: null }) };
            }
          };
        },
        update(patch) {
          const filters = {};
          const chain = {
            eq(column, value) {
              filters[column] = value;
              return chain;
            },
            select() {
              return {
                maybeSingle: async () => {
                  if (filters.id !== run.id || Number(filters.revision) !== Number(run.revision)) {
                    return { data: null, error: null };
                  }
                  Object.assign(run, patch);
                  return { data: { ...run }, error: null };
                }
              };
            }
          };
          return chain;
        }
      };
    }
  };
}

test("Principal preparation durably records PREPARING then PASS using current run revision", async () => {
  const normalized = normalizeFactoryManifest(manifest());
  const run = {
    id: "22222222-2222-4222-8222-222222222222",
    actor_ref: "actor-ref",
    manifest_hash: factoryManifestHash(normalized),
    phase: "DRAFT",
    revision: 1,
    resource_ledger: { created: [], reused: [] },
    step_results: {}
  };
  const client = clientFor(run);

  const out = await prepareFactoryPrincipals(
    run.id,
    normalized,
    run.actor_ref,
    { supabaseClient: client, allowCreate: false, expectedRevision: 1 }
  );

  assert.equal(out.ok, true);
  assert.equal(run.revision, 3);
  assert.equal(run.step_results.principals.status, "PASS");
  assert.equal(run.resource_ledger.principals.length, 1);
  assert.equal(run.resource_ledger.principals[0].status, "PASS");
  assert.equal(run.resource_ledger.principals[0].reused, true);
});
