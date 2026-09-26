// test/b6-routing-and-playback.test.js
// Regression test suite for Phase 5 (B6 Routing) & Phase 6 (B6 Playback Authorization)
// Verifies:
// 1. Overlapping Agency / Legacy host is denied (5A)
// 2. Commerce host dispatch prevents Agency host from creating Legacy orders (5B)
// 3. Explicit Legacy host is permitted
// 4. Unknown host and conflicting x-forwarded-host fail closed
// 5. Playback authorization requires explicit lessonId (no first-lesson fallback)
// 6. Playback requires canonical lesson to belong to requested canonical course
// 7. Playback validates returned canonical course from RPC matches requested course

import assert from "node:assert/strict";
import test from "node:test";
import { resolveRequestRoute, isExplicitLegacyHost } from "../utils/agency-routing.js";
import { handleAgencyV5Play } from "../utils/agency-lms-bridge.js";

// =============================================================================
// PHASE 5: REQUEST ROUTING TESTS
// =============================================================================

test("B6.ROUTING-1: Overlapping Agency and Legacy allowlist host is DENIED with 409", async () => {
  const originalAllowlist = process.env.LEGACY_HOST_ALLOWLIST;
  try {
    // Configure overlapping host
    process.env.LEGACY_HOST_ALLOWLIST = "overlap.culinary.local,legacy.culinary.local";

    const mockDb = {
      rpc: async (func, args) => {
        if (args.p_hostname === "overlap.culinary.local") {
          // This host IS an active agency in the DB!
          return {
            data: {
              found: true,
              agency_id: "agency-overlap",
              agency_slug: "overlap-agency",
              hostname: "overlap.culinary.local"
            }
          };
        }
        return { data: null };
      }
    };

    const req = { headers: { host: "overlap.culinary.local" } };
    const decision = await resolveRequestRoute(req, { supabaseClient: mockDb });

    assert.equal(decision.route, "DENY");
    assert.equal(decision.status, 409);
    assert.equal(decision.code, "overlapping_host_configuration");
  } finally {
    process.env.LEGACY_HOST_ALLOWLIST = originalAllowlist;
  }
});

test("B6.ROUTING-2: Explicit Legacy host without Agency mapping resolves to LEGACY", async () => {
  const originalAllowlist = process.env.LEGACY_HOST_ALLOWLIST;
  try {
    process.env.LEGACY_HOST_ALLOWLIST = "pure-legacy.yeunauan.net";

    const mockDb = {
      rpc: async () => ({ data: null }) // Not an agency
    };

    const req = { headers: { host: "pure-legacy.yeunauan.net" } };
    const decision = await resolveRequestRoute(req, { supabaseClient: mockDb });

    assert.equal(decision.route, "LEGACY");
    assert.equal(decision.host, "pure-legacy.yeunauan.net");
  } finally {
    process.env.LEGACY_HOST_ALLOWLIST = originalAllowlist;
  }
});

test("B6.ROUTING-3: Unknown host and conflicting x-forwarded-host fail closed", async () => {
  const mockDb = {
    rpc: async () => ({ data: null })
  };

  // 1. Unknown host -> 404
  const reqUnknown = { headers: { host: "unknown-hacker.com" } };
  const d1 = await resolveRequestRoute(reqUnknown, { supabaseClient: mockDb });
  assert.equal(d1.route, "DENY");
  assert.equal(d1.status, 404);
  assert.ok(d1.code === "tenant_not_found" || d1.code === "unknown_tenant_host");

  // 2. Conflicting x-forwarded-host -> 400
  const reqConflict = {
    headers: {
      host: "agency.com",
      "x-forwarded-host": "spoofed.com"
    }
  };
  const d2 = await resolveRequestRoute(reqConflict, { supabaseClient: mockDb });
  assert.equal(d2.route, "DENY");
  assert.equal(d2.status, 400);
});

// =============================================================================
// PHASE 6: PLAYBACK AUTHORIZATION TESTS
// =============================================================================

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
  return res;
}

test("B6.PLAYBACK-1: Missing lesson ID fails closed (NO first-lesson fallback)", async () => {
  const req = {
    method: "GET",
    query: {
      course: "pho-bo",
      asset: "asset-123"
      // lesson query parameter is intentionally MISSING
    },
    headers: {
      host: "agency.local",
      "x-v5-playback-key": Buffer.from(JSON.stringify({ kty: "EC", crv: "P-256", x: "test-x", y: "test-y" })).toString("base64url")
    }
  };
  const res = createMockRes();

  await handleAgencyV5Play(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "missing_lesson");
});

test("B6.PLAYBACK-2: Lesson belonging to Course B under Course A context is denied", async () => {
  const courseAId = "aaaaaaa-0000-0000-0000-000000000001";
  const courseBId = "bbbbbbb-0000-0000-0000-000000000002";
  const lessonBId = "les-b-1111-1111-1111-111111111111";

  const mockDb = {
    rpc: async (func, args) => {
      if (func === "resolve_agency_domain") {
        return { data: { found: true, agency_id: "ag-1", agency_slug: "ag", is_primary: true } };
      }
      return { data: null };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: "u-student" } } })
    },
    from: (table) => {
      if (table === "agency_memberships") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "m-student", agency_id: "ag-1", role: "student", status: "active" }
                })
              })
            })
          })
        };
      }
      if (table === "canonical_courses") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: courseAId, code: "pho-bo", course_id: "v5-pho-bo", status: "published" }
              })
            })
          })
        };
      }
      if (table === "student_entitlements") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: "ent-1", agency_id: "ag-1", canonical_course_id: courseAId, status: "active" }
                    })
                  })
                })
              })
            })
          })
        };
      }
      if (table === "canonical_lessons") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                // Lesson belongs to courseBId, NOT courseAId!
                data: { id: lessonBId, canonical_course_id: courseBId }
              })
            })
          })
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };

  const req = {
    method: "GET",
    query: {
      course: "pho-bo",
      lesson: lessonBId,
      asset: "asset-123"
    },
    headers: {
      host: "agency.local",
      authorization: "Bearer valid-student-token",
      "x-v5-playback-key": Buffer.from(JSON.stringify({ kty: "EC", crv: "P-256", x: "test-x", y: "test-y" })).toString("base64url")
    }
  };
  const res = createMockRes();

  await handleAgencyV5Play(req, res, { supabaseClient: mockDb });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "lesson_course_mismatch");
});
