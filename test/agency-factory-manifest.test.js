import test from "node:test";
import assert from "node:assert/strict";
import {
  factoryManifestHash,
  normalizeFactoryManifest,
  providerReadinessBlockers
} from "../utils/agency-factory-manifest.js";

function base(profile = "TENANT_SHELL") {
  return {
    version: 1,
    profile,
    agency: { slug: "agency-b", name: "Agency B" },
    domains: [
      { hostname: "agency-b-shop.vercel.app", surface: "commerce" },
      { hostname: "agency-b-learn.vercel.app", surface: "lms" }
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
      evidence_refs: ["read-only-preflight"]
    }
  };
}

test("Factory manifest normalizes two typed hosts and forces suspended/unpublished", () => {
  const input = base();
  const normalized = normalizeFactoryManifest(input);
  assert.equal(normalized.agency.status, "suspended");
  assert.deepEqual(normalized.domains.map(x => x.surface).sort(), ["commerce", "lms"]);
  assert.equal(normalized.principals[0].role, "agency_owner");
});

test("Factory manifest hash is stable across object key ordering", () => {
  const a = base();
  const b = {
    provider_readiness: a.provider_readiness,
    principals: a.principals,
    learning: a.learning,
    offerings: a.offerings,
    bank_accounts: a.bank_accounts,
    ui: a.ui,
    domains: a.domains,
    agency: { name: "Agency B", slug: "agency-b" },
    profile: a.profile,
    version: 1
  };
  assert.equal(factoryManifestHash(normalizeFactoryManifest(a)), factoryManifestHash(normalizeFactoryManifest(b)));
});

test("Factory manifest rejects duplicate or missing typed surfaces", () => {
  const input = base();
  input.domains = [
    { hostname: "one.example.com", surface: "lms" },
    { hostname: "two.example.com", surface: "lms" }
  ];
  assert.throws(() => normalizeFactoryManifest(input), /requires_one_(?:lms|commerce)_host/);
});

test("Factory manifest rejects secret-bearing fields", () => {
  const input = base();
  input.private_jwk = "do-not-allow";
  assert.throws(() => normalizeFactoryManifest(input), /secret_field_forbidden/);
});

test("Learning profile requires prepared course references", () => {
  assert.throws(() => normalizeFactoryManifest(base("LEARNING_READY")), /learning_required/);
});

test("Commerce test profile requires bank and offering", () => {
  const input = base("COMMERCE_TEST_READY");
  input.learning.courses = [{ code: "b-course", course_id: "00000000-0000-4000-8000-000000000001" }];
  assert.throws(() => normalizeFactoryManifest(input), /bank_required/);
});

test("Provider readiness is explicit and fail-closed for learning", () => {
  const input = base("LEARNING_READY");
  input.learning.courses = [{ code: "b-course", course_id: "00000000-0000-4000-8000-000000000001" }];
  input.provider_readiness.google_lms_origin_ready = false;
  assert.deepEqual(providerReadinessBlockers(input), ["google_lms_origin_not_verified"]);
});
