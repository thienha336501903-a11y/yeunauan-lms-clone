import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20261004113000_agency_factory_v1_1_upgrade.sql", import.meta.url),
  "utf8"
);
const factory = fs.readFileSync(new URL("../utils/agency-factory.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../api/factory.js", import.meta.url), "utf8");

test("V1.1 upgrade requires READY + suspended and forbids profile downgrade", () => {
  assert.match(migration, /v_run\.phase <> 'READY'/i);
  assert.match(migration, /v_agency_status <> 'suspended'/i);
  assert.match(migration, /factory_profile_downgrade_forbidden/i);
  assert.match(factory, /factory_upgrade_requires_ready_suspended_run/);
  assert.match(factory, /factory_upgrade_requires_suspended_tenant/);
});

test("V1.1 upgrade preserves platform-owned canonical learning metadata", () => {
  assert.match(migration, /v_engine_manifest := v_staged - 'learning'/i);
  assert.match(migration, /factory_prepared_canonical_course_required/i);
  assert.match(migration, /factory_canonical_course_mapping_conflict/i);
  assert.match(migration, /factory_prepared_v5_release_required/i);
});

test("V1.1 upgrade keeps commerce staged until explicit resume", () => {
  assert.match(migration, /jsonb_build_object\('is_published', false\)/i);
  assert.match(migration, /jsonb_build_object\('status','suspended'\)/i);
  assert.match(migration, /phase = 'PREPARING'/i);
});

test("V1.1 learning access creates a provenance-backed manual grant", () => {
  assert.match(migration, /source_type[\s\S]*'manual_admin'/i);
  assert.match(migration, /Agency Factory baseline learning access/i);
  assert.match(migration, /recompute_effective_entitlement/i);
  assert.match(migration, /factory:' \|\| v_run\.id::text/i);
  assert.match(factory, /learning_access_provenance_not_ready/);
});

test("V1.1 privileged RPCs remain service-role only", () => {
  assert.match(migration, /revoke all on function public\.apply_agency_factory_v1_1_learning_access[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.apply_agency_factory_v1_1_learning_access[\s\S]*to service_role/i);
  assert.match(migration, /revoke all on function public\.upgrade_agency_factory_v1_1_atomic[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.upgrade_agency_factory_v1_1_atomic[\s\S]*to service_role/i);
});

test("Factory API exposes upgrade with optimistic revision", () => {
  assert.match(api, /"upgrade"/);
  assert.match(api, /upgradeFactoryRun\(runId, manifest, auth\.actorRef, \{[\s\S]*expectedRevision,[\s\S]*sourceCommerceSha:[\s\S]*\}\)/);
  assert.match(factory, /p_expected_revision: expectedRevision/);
  assert.match(factory, /p_manifest_summary: summary/);
});


test("V1.1.1 upgrade path binds Commerce provenance and exposes UI upgrade controls", () => {
  const ui = fs.readFileSync(new URL("../factory-admin.html", import.meta.url), "utf8");
  assert.match(ui, /id="upgrade"/);
  assert.match(ui, /id="loadRun"/);
  assert.match(ui, /id="sourceCommerceSha"/);
  assert.match(ui, /call\('upgrade',\{sourceCommerceSha\}\)/);
  assert.match(factory, /factory_source_commerce_sha_required/);
  assert.match(factory, /factory_source_commerce_sha_conflict/);
  assert.match(factory, /source_commerce_sha:\s*requestedSourceCommerceSha/);
  assert.match(api, /sourceCommerceSha:\s*clean\(req\.body\?\.sourceCommerceSha\)/);
});
