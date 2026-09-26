import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {
  isAgencyRequest,
  requireAgencyCourseAccess,
  handleAgencyV5Play,
  handleAgencyLearnerDashboard,
  handleAgencyV5Feed
} from "../utils/agency-lms-bridge.js";
import { _clearTenantCache } from "../utils/tenant-resolver.js";

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
    x: "f83OJ3D2xFmTEcKEFu61457mA9VTdfVI nM8aVRScnyg".replace(/\s/g, "_"),
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
// B6.1: AGENCY LMS COURSE ACCESS & ENTITLEMENT VALIDATION
// =============================================================================

test("B6.1-LMS-ACCESS: Entitled member gets course access; unentitled member denied", async () => {
  _clearTenantCache();

  const mockDb = {
    rpc: async (func, args) => {
      if (func === "resolve_agency_domain") {
        return { data: { found: true, agency_id: "agency-1", hostname: "agency-1.com" } };
      }
      return { data: null };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: "user-101", email: "student@agency1.com" } } })
    },
    from: (table) => ({
      select: () => ({
        eq: (col1, val1) => ({
          eq: (col2, val2) => ({
            maybeSingle: async () => {
              if (table === "agency_memberships") {
                return {
                  data: {
                    id: "mem-101",
                    agency_id: "agency-1",
                    user_id: "user-101",
                    role: "student",
                    status: "active"
                  }
                };
              }
              if (table === "canonical_courses") {
                if (val1 === "pho-bo-mastery") {
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
                return { data: null };
              }
              return { data: null };
            },
            // For student_entitlements
            eq: (col3, val3) => ({
              eq: (col4, val4) => ({
                maybeSingle: async () => {
                  if (table === "student_entitlements") {
                    if (val3 === "canonical-course-pho") {
                      return {
                        data: {
                          id: "ent-101",
                          agency_id: "agency-1",
                          membership_id: "mem-101",
                          canonical_course_id: "canonical-course-pho",
                          status: "active",
                          expires_at: null // Lifetime
                        }
                      };
                    }
                  }
                  return { data: null };
                }
              })
            })
          }),
          maybeSingle: async () => {
            if (table === "canonical_courses" && val1 === "pho-bo-mastery") {
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
            return { data: null };
          }
        })
      })
    })
  };

  const reqEntitled = {
    headers: { host: "agency-1.com", authorization: "Bearer valid_jwt" }
  };

  // Case A: Entitled course
  const resEntitled = await requireAgencyCourseAccess(reqEntitled, "pho-bo-mastery", { supabaseClient: mockDb });
  assert.equal(resEntitled.ok, true);
  assert.equal(resEntitled.canonicalCourse.code, "pho-bo-mastery");
  assert.equal(resEntitled.v5CourseId, "v5-course-uuid-999");

  // Case B: Non-entitled course
  const resNotEntitled = await requireAgencyCourseAccess(reqEntitled, "baking-mastery", { supabaseClient: mockDb });
  assert.equal(resNotEntitled.ok, false);
});

// =============================================================================
// B6.2: FORBIDDEN OLD AUTH FALLBACK ON AGENCY PATH
// =============================================================================

test("B6.2-OLD-AUTH-FORBIDDEN: Legacy HMAC cookie or missing JWT on agency path fails closed (NO FALLBACK)", async () => {
  _clearTenantCache();

  const mockDb = {
    rpc: async () => ({
      data: { found: true, agency_id: "agency-1", hostname: "agency-1.com" }
    })
  };

  // Attacker presents legacy HMAC session token cookie on new agency host
  const reqLegacy = {
    headers: {
      host: "agency-1.com",
      cookie: "admin_session_token=old_legacy_hmac_secret"
    }
  };

  const access = await requireAgencyCourseAccess(reqLegacy, "pho-bo-mastery", { supabaseClient: mockDb });
  assert.equal(access.ok, false);
  assert.equal(access.status, 401);
  assert.equal(access.code, "legacy_auth_rejected");
});

// =============================================================================
// B6.3: V5 PLAYBACK BRIDGE & CRYPTOGRAPHIC LEASE PRESERVATION
// =============================================================================

test("B6.3-V5-PLAY-BRIDGE: Agency v5-play verifies proof, validates entitlement, issues V5 lease", async () => {
  _clearTenantCache();

  const mockDb = {
    rpc: async (func, args) => {
      if (func === "resolve_agency_domain") {
        return { data: { found: true, agency_id: "agency-1", hostname: "agency-1.com" } };
      }
      if (func === "v5_authorize_playback_asset") {
        // Returns published release UUID
        return { data: "release-uuid-published-888", error: null };
      }
      return { data: null };
    },
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-101", email: "student@agency1.com" } }
      })
    },
    from: (table) => ({
      select: () => ({
        eq: (col1, val1) => ({
          maybeSingle: async () => {
            if (table === "v5_media_assets") {
              return {
                data: {
                  id: "asset-uuid-777",
                  type: "video",
                  provider: "r2",
                  r2_object_key: "courses/v5-pho/lesson-1.mp4",
                  mime_type: "video/mp4",
                  original_filename: "lesson-1.mp4",
                  bytes: 104857600,
                  status: "ready"
                }
              };
            }
            if (table === "canonical_courses") {
              return {
                data: {
                  id: "canonical-pho",
                  course_id: "v5-course-uuid-999",
                  code: "pho-bo-mastery",
                  status: "published"
                }
              };
            }
            return { data: null };
          },
          eq: (col2, val2) => ({
            maybeSingle: async () => {
              if (table === "agency_memberships") {
                return {
                  data: {
                    id: "mem-101",
                    agency_id: "agency-1",
                    user_id: "user-101",
                    role: "student",
                    status: "active"
                  }
                };
              }
              return { data: null };
            },
            eq: (col3, val3) => ({
              eq: (col4, val4) => ({
                maybeSingle: async () => {
                  if (table === "student_entitlements") {
                    return {
                      data: {
                        id: "ent-101",
                        agency_id: "agency-1",
                        membership_id: "mem-101",
                        canonical_course_id: "canonical-pho",
                        status: "active"
                      }
                    };
                  }
                  return { data: null };
                }
              })
            })
          })
        })
      })
    })
  };

  const req = {
    method: "GET",
    headers: {
      host: "agency-1.com",
      authorization: "Bearer valid_jwt",
      "x-v5-playback-key": makeProofHeader()
    },
    query: {
      course: "pho-bo-mastery",
      asset: "asset-uuid-777"
    }
  };

  const res = mockResponse();
  await handleAgencyV5Play(req, res, { supabaseClient: mockDb });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.assetId, "asset-uuid-777");
  assert.equal(res.body.releaseId, "release-uuid-published-888");
  assert.ok(res.body.playbackLease);
  assert.ok(res.body.playbackUrl);
});

// =============================================================================
// B6.4: CROSS-TENANT PLAYBACK IS STRICTLY DENIED
// =============================================================================

test("B6.4-CROSS-TENANT-PLAYBACK-DENIED: User with entitlement in Agency 1 cannot play on Agency 2 host", async () => {
  _clearTenantCache();

  const mockDb = {
    rpc: async (func, args) => {
      // Request host is Agency 2
      if (func === "resolve_agency_domain") {
        return { data: { found: true, agency_id: "agency-2", hostname: "agency-2.com" } };
      }
      return { data: null };
    },
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-101", email: "student@agency1.com" } }
      })
    },
    from: (table) => ({
      select: () => ({
        eq: (col1, val1) => ({
          maybeSingle: async () => {
            if (table === "canonical_courses") {
              return {
                data: {
                  id: "canonical-pho",
                  course_id: "v5-course-uuid-999",
                  code: "pho-bo-mastery"
                }
              };
            }
            return { data: null };
          },
          eq: (col2, val2) => ({
            maybeSingle: async () => {
              // User has NO membership in Agency 2!
              if (table === "agency_memberships" && val2 === "agency-2") {
                return { data: null };
              }
              return { data: null };
            }
          })
        })
      })
    })
  };

  const req = {
    method: "GET",
    headers: {
      host: "agency-2.com", // Target host is Agency 2!
      authorization: "Bearer valid_jwt",
      "x-v5-playback-key": makeProofHeader()
    },
    query: {
      course: "pho-bo-mastery",
      asset: "asset-uuid-777"
    }
  };

  const res = mockResponse();
  await handleAgencyV5Play(req, res, { supabaseClient: mockDb });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "membership_not_found");
});
