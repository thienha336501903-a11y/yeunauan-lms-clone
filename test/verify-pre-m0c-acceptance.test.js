// test/verify-pre-m0c-acceptance.test.js
// Regression test suite for Acceptance Harness (FIX 11)
// Invariants:
//   1. Agency row only => not fake PASS for child entities (domains, memberships, catalog, etc.).
//   2. Suspended-only memberships => membership FAIL / NOT_READY.
//   3. Missing offering items => catalog and checkout do NOT return PASS.
//   4. Synthetic flag without valid playback probe => playback does NOT return PASS.

import assert from "node:assert/strict";
import test from "node:test";
import { verifyPreM0cAcceptance } from "../scripts/verify-pre-m0c-acceptance.js";

function createMockDb(overrides = {}) {
  return {
    from: (table) => {
      const builder = {
        _table: table,
        select: () => builder,
        eq: (col, val) => {
          if (overrides[table]?.onEq) {
            return overrides[table].onEq(col, val, builder);
          }
          return builder;
        },
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (overrides[table]?.maybeSingle) return overrides[table].maybeSingle();
          return { data: overrides[table]?.data?.[0] || null, error: null };
        },
        single: async () => {
          return { data: overrides[table]?.data?.[0] || null, error: null };
        },
        then: (resolve) => {
          const res = {
            data: overrides[table]?.data || [],
            count: overrides[table]?.count !== undefined ? overrides[table].count : (overrides[table]?.data?.length || 0),
            error: overrides[table]?.error || null
          };
          resolve(res);
        }
      };
      return builder;
    },
    auth: {
      getSession: async () => overrides.auth?.getSession?.() || { data: { session: null }, error: null }
    },
    rpc: async (fn, args) => {
      if (overrides.rpc) return overrides.rpc(fn, args);
      return { data: null, error: null };
    }
  };
}

test("FIX 11 REGRESSIONS: Acceptance Harness Strict Probing", async (t) => {
  // ---------------------------------------------------------------------------
  // 1. Agency row only => not fake PASS
  // ---------------------------------------------------------------------------
  await t.test("Regression 1: Agency row only does not yield fake PASS on child categories", async () => {
    const mockDbAgencyOnly = createMockDb({
      agencies: {
        maybeSingle: async () => ({ data: { id: "mock-ag-1", slug: "test-slug", status: "active" }, error: null })
      }
    });

    const results = await verifyPreM0cAcceptance({
      slug: "test-slug",
      supabaseClient: mockDbAgencyOnly
    });

    assert.equal(results.AGENCY_RECORD.status, "PASS");
    assert.equal(results.HOST.status, "FAIL"); // 0 domains attached
    assert.equal(results.MEMBERSHIP.status, "NOT_PROVISIONED"); // 0 memberships
    assert.equal(results.CATALOG.status, "NOT_PROVISIONED"); // 0 offerings
    assert.equal(results.CHECKOUT.status, "FAIL"); // 0 banks
    assert.equal(results.LEARNER.status, "FAIL"); // Learner profile missing
  });

  // ---------------------------------------------------------------------------
  // 2. Suspended-only membership => membership FAIL
  // ---------------------------------------------------------------------------
  await t.test("Regression 2: Suspended-only membership results in membership FAIL", async () => {
    const mockDbSuspendedMembers = createMockDb({
      agencies: {
        maybeSingle: async () => ({ data: { id: "mock-ag-1", slug: "test-slug", status: "active" }, error: null })
      },
      agency_memberships: {
        data: [
          { id: "mem-1", role: "agency_owner", status: "suspended" },
          { id: "mem-2", role: "agency_staff", status: "suspended" }
        ]
      }
    });

    const results = await verifyPreM0cAcceptance({
      slug: "test-slug",
      supabaseClient: mockDbSuspendedMembers
    });

    assert.equal(results.MEMBERSHIP.status, "FAIL");
    assert.match(results.MEMBERSHIP.reason, /suspended-only/);
  });

  // ---------------------------------------------------------------------------
  // 3. Missing offering items => catalog / checkout not PASS
  // ---------------------------------------------------------------------------
  await t.test("Regression 3: Offerings without offering items prevent CATALOG / CHECKOUT from returning PASS", async () => {
    const mockDbMissingItems = createMockDb({
      agencies: {
        maybeSingle: async () => ({ data: { id: "mock-ag-1", slug: "test-slug", status: "active" }, error: null })
      },
      agency_offerings: {
        data: [{ id: "off-1", slug: "empty-course", is_published: true }]
      },
      agency_offering_items: {
        data: [] // 0 items!
      },
      agency_bank_accounts: {
        data: [{ id: "bank-1", is_active: true }]
      }
    });

    const results = await verifyPreM0cAcceptance({
      slug: "test-slug",
      supabaseClient: mockDbMissingItems
    });

    assert.equal(results.CATALOG.status, "FAIL");
    assert.match(results.CATALOG.reason, /0 offering items configured/);
    assert.equal(results.CHECKOUT.status, "FAIL");
  });

  // ---------------------------------------------------------------------------
  // 4. Synthetic flag without playback probe => playback not PASS
  // ---------------------------------------------------------------------------
  await t.test("Regression 4: Synthetic flag without successful playback probe does not yield fake PASS", async () => {
    const mockDbPlaybackFail = createMockDb({
      agencies: {
        maybeSingle: async () => ({ data: { id: "mock-ag-1", slug: "test-slug", status: "active" }, error: null })
      },
      rpc: async (fn) => {
        if (fn === "v5_authorize_agency_playback") {
          return { data: null, error: { message: "RPC access denied or function not found" } };
        }
        return { data: null, error: null };
      }
    });

    const results = await verifyPreM0cAcceptance({
      slug: "test-slug",
      synthetic: true,
      supabaseClient: mockDbPlaybackFail
    });

    assert.equal(results.PLAYBACK_AUTHORIZATION.status, "FAIL");
  });
});
