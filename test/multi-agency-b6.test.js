// test/multi-agency-b6.test.js
// Automated test suite for System B Milestone B6 / M0B.1 Hardened LMS & V5 Bridge

import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {
  isAgencyRequest,
  resolveRequestRoute,
  requireAgencyCourseAccess,
  handleAgencyV5Play,
  handleAgencyLearnerDashboard,
  handleAgencyV5Feed
} from "../utils/agency-lms-bridge.js";
import { _clearTenantCache } from "../utils/tenant-resolver.js";
import portalHandler from "../api/lms/portal.js";

// Ensure V5 media environment variables are initialized for tests
if (!process.env.V5_MEDIA_PUBLIC_URL) {
  process.env.V5_MEDIA_PUBLIC_URL = "https://media.test.agency.vn";
}
if (!process.env.V5_PLAYBACK_PRIVATE_JWK) {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  process.env.V5_PLAYBACK_PRIVATE_JWK = JSON.stringify(privateKey.export({ format: "jwk" }));
}

function makeProofHeader() {
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: "f83OJ3D2xFmTEcKEFu61457mA9VTdfVI_nM8aVRScnyg",
    y: "x_daQjjUz3WMG_Ft6VEdnU44ukBlDTVHzwq3VmUfUtA"
  };
  return Buffer.from(JSON.stringify(jwk)).toString("base64url");
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, val) { this.headers[key] = val; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { return this; }
  };
}

// =============================================================================
// B6.1: EXPLICIT LEGACY ROUTE VS NO FALLBACK ON INVALID AGENCY HOST
// =============================================================================

test("B6.1-EXPLICIT-LEGACY-ALLOWLIST: Only allowlisted hosts route to Legacy; invalid Agency hosts fail closed", async () => {
  _clearTenantCache();

  process.env.LEGACY_HOST_ALLOWLIST = "legacy.yeunauan.live,legacy-internal.local";

  const mockDb = {
    rpc: async (func, args) => {
      if (args.p_hostname === "agency-valid.com") {
        return { data: { found: true, agency_id: "agency-valid-id", hostname: "agency-valid.com" } };
      }
      return { data: { found: false } };
    }
  };

  // 1. Explicit allowlisted legacy host -> routes to LEGACY
  const legReq = { headers: { host: "legacy.yeunauan.live" } };
  const legDecision = await resolveRequestRoute(legReq, { supabaseClient: mockDb });
  assert.equal(legDecision.route, "LEGACY");

  // 2. Valid agency domain -> routes to AGENCY
  const agencyReq = { headers: { host: "agency-valid.com" } };
  const agencyDecision = await resolveRequestRoute(agencyReq, { supabaseClient: mockDb });
  assert.equal(agencyDecision.route, "AGENCY");
  assert.equal(agencyDecision.tenant.agencyId, "agency-valid-id");

  // 3. Unknown host -> DENY (HTTP 404, never falls back to Legacy!)
  const unknownReq = { headers: { host: "unknown-random-domain.com" } };
  const unknownDecision = await resolveRequestRoute(unknownReq, { supabaseClient: mockDb });
  assert.equal(unknownDecision.route, "DENY");
  assert.equal(unknownDecision.status, 404);

  // 4. Conflicting forwarded host -> DENY (HTTP 400, never falls back to Legacy!)
  const conflictReq = { headers: { host: "agency-valid.com", "x-forwarded-host": "attacker.com" } };
  const conflictDecision = await resolveRequestRoute(conflictReq, { supabaseClient: mockDb });
  assert.equal(conflictDecision.route, "DENY");
  assert.equal(conflictDecision.status, 400);
});

// =============================================================================
// B6.2: ROUTER LEVEL PORTAL HANDLER DENIES UNKNOWN HOST (NEVER CALLS LEGACY)
// =============================================================================

test("B6.2-ROUTER-PORTAL-DENY: Portal handler rejects unknown host or conflict without entering Legacy", async () => {
  _clearTenantCache();

  const mockDb = {
    rpc: async () => ({ data: { found: false } })
  };

  const req = {
    headers: { host: "unregistered-agency.com" },
    query: { endpoint: "v5-play" },
    __options: { supabaseClient: mockDb }
  };
  const res = mockResponse();

  await portalHandler(req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
});

// =============================================================================
// B6.3: B1.1 RPC v5_authorize_agency_playback IS CALLED ON AGENCY PLAYBACK
// =============================================================================

test("B6.3-V5-PLAY-BRIDGE: Agency v5-play verifies proof, validates B1.1 RPC, and issues lease", async () => {
  _clearTenantCache();

  let b1_1_called = false;
  let b1_1_args = null;

  const mockDb = {
    rpc: async (func, args) => {
      if (func === "resolve_agency_domain") {
        return { data: { found: true, agency_id: "agency-1", hostname: "agency-1.com" } };
      }
      if (func === "v5_authorize_agency_playback") {
        b1_1_called = true;
        b1_1_args = args;
        return {
          data: {
            authorized: true,
            agency_id: "agency-1",
            membership_id: "mem-101",
            canonical_course_id: "canonical-course-pho",
            canonical_lesson_id: "lesson-knife-1",
            v5_course_id: "v5-course-uuid-999",
            release_id: "release-v5-october",
            asset_id: "asset-pho-video-01"
          }
        };
      }
      return { data: null };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: "user-101", email: "student@agency1.com" } } })
    },
    from: (table) => {
      const filters = {};
      const builder = {
        select: () => builder,
        eq: (col, val) => {
          filters[col] = val;
          return builder;
        },
        limit: () => builder,
        order: () => builder,
        maybeSingle: async () => {
          if (table === "agency_memberships") {
            return {
              data: { id: "mem-101", agency_id: "agency-1", user_id: "user-101", role: "student", status: "active" }
            };
          }
          if (table === "canonical_courses") {
            return {
              data: {
                id: "canonical-course-pho",
                course_id: "v5-course-uuid-999",
                code: "pho-bo-mastery",
                default_title: "Phở Bò Mastery",
                status: "published"
              }
            };
          }
          if (table === "student_entitlements") {
            return { data: { id: "ent-101", status: "active", expires_at: null } };
          }
          if (table === "canonical_lessons") {
            return { data: { id: "lesson-knife-1", canonical_course_id: "canonical-course-pho" } };
          }
          if (table === "v5_media_assets") {
            return {
              data: {
                id: "asset-pho-video-01",
                type: "video",
                provider: "r2",
                r2_object_key: "v5/releases/release-v5-october/hls/asset-pho-video-01/master.m3u8",
                mime_type: "application/vnd.apple.mpegurl",
                original_filename: "pho-video.mp4",
                bytes: 104857600,
                status: "ready"
              }
            };
          }
          return { data: null };
        }
      };
      return builder;
    }
  };

  const req = {
    method: "GET",
    headers: {
      host: "agency-1.com",
      authorization: "Bearer valid-student-jwt",
      "x-v5-playback-key": makeProofHeader()
    },
    query: {
      course: "pho-bo-mastery",
      asset: "asset-pho-video-01",
      lesson: "lesson-knife-1"
    }
  };

  const res = mockResponse();
  await handleAgencyV5Play(req, res, { supabaseClient: mockDb });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.playbackLease);
  assert.equal(res.body.releaseId, "release-v5-october");

  // CRITICAL: B1.1 RPC MUST HAVE BEEN CALLED WITH VERIFIED SERVER INPUTS
  assert.equal(b1_1_called, true, "v5_authorize_agency_playback MUST be invoked");
  assert.equal(b1_1_args.p_agency_id, "agency-1");
  assert.equal(b1_1_args.p_membership_id, "mem-101");
  assert.equal(b1_1_args.p_lesson_id, "lesson-knife-1");
  assert.equal(b1_1_args.p_asset_id, "asset-pho-video-01");
});

// =============================================================================
// B6.4: CROSS-TENANT PLAYBACK STRICTLY DENIED
// =============================================================================

test("B6.4-CROSS-TENANT-PLAYBACK-DENIED: User with entitlement in Agency 1 cannot play on Agency 2 host", async () => {
  _clearTenantCache();

  const mockDb = {
    rpc: async (func, args) => {
      if (func === "resolve_agency_domain") {
        if (args.p_hostname === "agency-2.com") {
          return { data: { found: true, agency_id: "agency-2", hostname: "agency-2.com" } };
        }
      }
      return { data: null };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: "user-101" } } })
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            // User has NO membership in Agency 2
            maybeSingle: async () => ({ data: null })
          })
        })
      })
    })
  };

  const req = {
    method: "GET",
    headers: {
      host: "agency-2.com",
      authorization: "Bearer valid-student-jwt",
      "x-v5-playback-key": makeProofHeader()
    },
    query: {
      course: "pho-bo-mastery",
      asset: "asset-pho-video-01"
    }
  };

  const res = mockResponse();
  await handleAgencyV5Play(req, res, { supabaseClient: mockDb });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "membership_not_found");
});
