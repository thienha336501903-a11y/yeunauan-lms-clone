import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeFactoryManifest } from "../utils/agency-factory-manifest.js";
import { prepareAuthPrincipal } from "../utils/agency-auth-principals.js";

function base() {
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
      evidence_refs: ["review"]
    }
  };
}

test("Factory manifest rejects nested credential-shaped public UI fields", () => {
  const input = base();
  input.ui.design_tokens = { api_key: "canary" };
  assert.throws(() => normalizeFactoryManifest(input), /secret_field_forbidden|unknown_design_token/);

  const camel = base();
  camel.ui.design_tokens = { apiKey: "canary" };
  assert.throws(() => normalizeFactoryManifest(camel), /secret_field_forbidden|unknown_design_token/);

  const flags = base();
  flags.ui.feature_flags = { connectionString: "canary" };
  assert.throws(() => normalizeFactoryManifest(flags), /secret_field_forbidden|unknown_feature_flag/);
});

test("Factory public UI fields use strict allowlists and primitive types", () => {
  const input = base();
  input.ui.design_tokens = { primary_color: "#111111", border_radius: "12px" };
  input.ui.feature_flags = { homework_enabled: true };
  const normalized = normalizeFactoryManifest(input);
  assert.equal(normalized.ui.design_tokens.primary_color, "#111111");
  assert.equal(normalized.ui.feature_flags.homework_enabled, true);

  input.ui.feature_flags = { arbitrary_new_flag: true };
  assert.throws(() => normalizeFactoryManifest(input), /unknown_feature_flag/);
});

test("Auth create lost-response recovery preserves Factory run provenance", async () => {
  let listCalls = 0;
  const created = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
    user_metadata: {
      system_b_factory: true,
      system_b_factory_run_id: "run-123"
    }
  };
  const client = {
    auth: { admin: {
      listUsers: async () => {
        listCalls += 1;
        return listCalls === 1
          ? { data: { users: [] }, error: null }
          : { data: { users: [created] }, error: null };
      },
      createUser: async () => ({ data: { user: null }, error: new Error("provider_response_lost") })
    }}
  };

  const result = await prepareAuthPrincipal(
    client,
    { email: "owner@example.com" },
    { mode: "create_if_missing", allowCreate: true, factoryRunId: "run-123" }
  );
  assert.equal(result.ok, true);
  assert.equal(result.createdByRun, true);
  assert.equal(result.recovered, true);
  assert.equal(result.reused, false);
  assert.equal(result.user.id, created.id);
});

test("Factory migration is create-only and strips shared canonical learning writes from generic engine", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261002140000_agency_factory_v1_foundation.sql", import.meta.url), "utf8");
  assert.match(sql, /factory_target_already_exists/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('agency_factory_v1:' \|\| v_slug\)\)/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('agency_provision:' \|\| v_slug\)\)/);
  assert.match(sql, /v_engine_manifest := v_staged - 'learning'/);
  assert.match(sql, /factory_prepared_canonical_course_required/);
  assert.match(sql, /ux_agency_provisioning_runs_target_slug/);
});

test("Factory apply and runtime transitions carry expected revision through privileged RPCs", () => {
  const factory = fs.readFileSync(new URL("../utils/agency-factory.js", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../api/factory.js", import.meta.url), "utf8");
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261002140000_agency_factory_v1_foundation.sql", import.meta.url), "utf8");
  assert.match(factory, /p_expected_revision: requestedRevision/);
  assert.match(factory, /expectedRevision\s*\+\s*1/);
  assert.match(api, /expectedRevision: validation\.run\?\.revision/);
  assert.match(sql, /v_run\.revision <> p_expected_revision/);
  assert.match(sql, /revision = p_expected_revision/);
});
