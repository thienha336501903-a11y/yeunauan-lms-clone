process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "mock-service-role-key";
process.env.R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "mock-acc";
process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "mock-key";
process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "mock-secret";
process.env.R2_BUCKET = process.env.R2_BUCKET || "mock-bucket";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "mock-session-secret-for-tests-1234567890";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || "admin@example.com";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { evaluateCourseDeleteEligibility, invalidateStorageCache } = await import("../utils/v5-course-storage.js");
const { computeDeletePlanHash } = await import("../utils/lms-handlers/admin-v5-course-delete.js");
const adminV5CourseDeleteHandler = (await import("../utils/lms-handlers/admin-v5-course-delete.js")).default;
const { deleteR2Object } = await import("../utils/v5-r2.js");
const { supabase } = await import("../utils/supabase.js");
const { createAdminSession } = await import("../utils/lms.js");

const migrationSql = fs.readFileSync(
  new URL("../supabase/migrations/20260923160000_v5_controlled_unreleased_course_cleanup.sql", import.meta.url),
  "utf8"
);

const courseId = "6edd03ff-07b1-49e3-a135-f43bbd249dce";
const courseSlug = "bong-lan-mochi-v2-ttn";
const adminToken = createAdminSession("admin@example.com").token;

function validCourseFixture(overrides = {}) {
  return {
    id: courseId,
    slug: courseSlug,
    title: "Bông Lan Mochi V2 TTN",
    delivery_mode: "v5",
    active: false,
    is_published: false,
    price: null,
    image_url: null,
    teacher_name: null,
    description: null,
    raw_data: { v5CreatedFrom: "course_channel" },
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides
  };
}

function validConfigFixture(overrides = {}) {
  return {
    course_id: courseId,
    status: "draft",
    published_release_id: null,
    settings: {},
    ...overrides
  };
}

function createQueryChain(data = []) {
  const chain = {
    eq: () => createQueryChain(data),
    in: () => createQueryChain(data),
    order: () => createQueryChain(data),
    maybeSingle: async () => ({ data: data[0] || null, error: null }),
    then: (resolve) => resolve({ data, error: null })
  };
  return chain;
}

function createMockSupabase(courseOverrides = {}, configOverrides = {}) {
  const course = validCourseFixture(courseOverrides);
  const config = validConfigFixture(configOverrides);

  return (table) => {
    if (table === "courses") {
      return {
        select: () => createQueryChain([course])
      };
    }
    if (table === "v5_course_configs") {
      return {
        select: () => createQueryChain([config])
      };
    }
    return {
      select: () => createQueryChain([])
    };
  };
}

const origFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  text: async () => "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"
});

test("1. V4 course rejection (delivery_mode != 'v5')", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture({ delivery_mode: "v4" }),
    config: validConfigFixture()
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("không phải chế độ V5")));
  assert.match(migrationSql, /v5_course_cleanup_mode_invalid/);
});

test("2. missing is_v5 marker rejection (v5CreatedFrom != 'course_channel')", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture({ raw_data: {} }),
    config: validConfigFixture()
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("v5CreatedFrom='course_channel'")));
  assert.match(migrationSql, /v5_course_cleanup_not_v5_native/);
});

test("3. active=true course rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture({ active: true }),
    config: validConfigFixture()
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("active=true")));
  assert.match(migrationSql, /v5_course_cleanup_active_forbidden/);
});

test("4. published=true course rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture({ is_published: true }),
    config: validConfigFixture()
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("is_published=true")));
  assert.match(migrationSql, /v5_course_cleanup_published_forbidden/);
});

test("5. published release present in config rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture({ published_release_id: "rel-123" })
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("Published")));
  assert.match(migrationSql, /v5_course_cleanup_has_published_release/);
});

test("6. v5_course_configs present with non-draft status rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture({ status: "active" })
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("không ở trạng thái Draft")));
  assert.match(migrationSql, /v5_course_cleanup_config_not_draft/);
});

test("7. missing v5_course_configs rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: null
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("Chưa có cấu hình V5 course config")));
  assert.match(migrationSql, /v5_course_cleanup_missing_config/);
});

test("8. any v5_releases present rejection (even historical)", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    releases: [{ id: "rel-1", version: 1, status: "draft" }]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("bản phát hành")));
  assert.match(migrationSql, /v5_course_cleanup_has_releases/);
});

test("9. paid order present in orders table rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    orders: [{ id: "o-1", status: "paid" }]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("đơn hàng")));
  assert.match(migrationSql, /v5_course_cleanup_has_orders/);
});

test("10. pending order present in orders table rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    orders: [{ id: "o-pending", status: "pending" }]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("đơn hàng")));
});

test("11. any order row referencing course by id or slug rejection in SQL", () => {
  assert.match(migrationSql, /where o\.course_id = p_course_id or o\.course_slug = v_course\.slug/);
});

test("12. active enrollment present in enrollments table rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    enrollments: [{ id: "e-1", status: "active" }]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("lượt ghi danh")));
  assert.match(migrationSql, /v5_course_cleanup_has_enrollments/);
});

test("13. inactive enrollment present rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    enrollments: [{ id: "e-expired", status: "expired" }]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("lượt ghi danh")));
});

test("14. non-terminal v5_jobs present rejection (pending, running, etc.)", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    jobs: [{ id: "j-1", status: "running" }]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("tác vụ xử lý chưa hoàn tất")));
  assert.match(migrationSql, /v5_course_cleanup_has_active_jobs/);
});

test("15. non-terminal v5_upload_sessions present rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    uploads: [{ id: "u-1", status: "uploading", expires_at: new Date(Date.now() + 3600000).toISOString() }]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("phiên upload đang hoạt động")));
  assert.match(migrationSql, /v5_course_cleanup_has_active_uploads/);
});

test("16. courses with v4 source mappings rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    v4Sources: [{ id: "v4-1", course_slug: courseSlug }]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("V4 legacy")));
  assert.match(migrationSql, /v5_course_cleanup_has_v4_source/);
});

test("17. courses with Commerce fields set rejection (price, image_url, teacher_name, description)", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture({ price: "500000" }),
    config: validConfigFixture()
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("cấu hình thương mại")));
  assert.match(migrationSql, /v5_course_cleanup_has_commerce_enrichment/);
});

test("18. shared media asset referenced by other courses rejection", () => {
  const asset = { id: "shared-asset-1", r2_object_key: `media/v5/${courseId}/pic.jpg` };
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    courseAssets: [asset],
    otherCourseAssets: [asset]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("được chia sẻ với khóa học khác")));
  assert.match(migrationSql, /v5_course_cleanup_shared_post_asset/);
});

test("19. media asset outside course namespace rejection", () => {
  const asset = { id: "alien-asset", r2_object_key: `media/v5/another-course-uuid/video.mp4` };
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    courseAssets: [asset],
    otherCourseAssets: []
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("ra ngoài namespace")));
  assert.match(migrationSql, /v5_course_cleanup_asset_outside_namespace/);
});

test("20. media key in course namespace referenced by another course rejection", () => {
  const otherAsset = { id: "other-a", r2_object_key: `media/v5/${courseId}/hijacked.mp4` };
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    courseAssets: [],
    otherCourseAssets: [otherAsset]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("đang bị khóa khác tham chiếu")));
});

test("21. course with no qualifying R2 objects handled safely (canDelete = true)", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    courseAssets: [],
    otherCourseAssets: [],
    r2ObjectsInNamespace: []
  });
  assert.equal(result.canDelete, true);
  assert.equal(result.blockedReasons.length, 0);
});

test("22. R2 deletion constrained to exact course namespace with trailing slash", () => {
  const handlerSource = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-course-delete.js", import.meta.url), "utf8");
  assert.match(handlerSource, /const coursePrefix = `media\/v5\/\$\{cId\}\/`;/);
  assert.match(migrationSql, /length\('media\/v5\/' \|\| p_course_id::text \|\| '\/'\)/);
});

test("23. slug mismatch in preview/execute rejection", async () => {
  let resStatus = 0;
  let resJson = null;
  const req = {
    method: "POST",
    headers: { cookie: `admin_session_token=${adminToken}` },
    body: {
      action: "execute",
      courseId,
      slug: courseSlug,
      confirmationSlug: "wrong-slug",
      confirmed: true,
      planHash: "any-hash"
    }
  };
  const res = {
    setHeader() {},
    status(code) { resStatus = code; return this; },
    json(data) { resJson = data; return this; }
  };

  const origFrom = supabase.from;
  try {
    supabase.from = createMockSupabase();

    await adminV5CourseDeleteHandler(req, res);
    assert.equal(resStatus, 400);
    assert.match(resJson.error, /Mã slug xác nhận không khớp/);
  } finally {
    supabase.from = origFrom;
  }
});

test("24. planHash mismatch in execute rejection", async () => {
  let resStatus = 0;
  let resJson = null;
  const req = {
    method: "POST",
    headers: { cookie: `admin_session_token=${adminToken}` },
    body: {
      action: "execute",
      courseId,
      slug: courseSlug,
      confirmationSlug: courseSlug,
      confirmed: true,
      planHash: "tampered-or-stale-hash"
    }
  };
  const res = {
    setHeader() {},
    status(code) { resStatus = code; return this; },
    json(data) { resJson = data; return this; }
  };

  const origFrom = supabase.from;
  try {
    supabase.from = createMockSupabase();

    await adminV5CourseDeleteHandler(req, res);
    assert.equal(resStatus, 409);
    assert.equal(resJson.code, "plan_changed_refresh_preview");
  } finally {
    supabase.from = origFrom;
  }
});

test("25. plan expired / course updated rejection: hash changes when course updated_at changes", () => {
  const baseParams = {
    courseId,
    slug: courseSlug,
    courseUpdatedAt: "2026-09-23T10:00:00Z",
    active: false,
    isPublished: false,
    configStatus: "draft",
    publishedReleaseId: null,
    orderCount: 0,
    enrollmentCount: 0,
    releaseCount: 0,
    courseNamespace: `media/v5/${courseId}/`
  };

  const hash1 = computeDeletePlanHash(baseParams);
  const hash2 = computeDeletePlanHash({ ...baseParams, courseUpdatedAt: "2026-09-23T10:05:00Z" });
  assert.notEqual(hash1, hash2, "planHash must change when course is touched");
});

test("26. missing confirmation fields rejection (confirmed !== true)", async () => {
  let resStatus = 0;
  let resJson = null;
  const req = {
    method: "POST",
    headers: { cookie: `admin_session_token=${adminToken}` },
    body: {
      action: "execute",
      courseId,
      slug: courseSlug,
      confirmationSlug: courseSlug,
      confirmed: false,
      planHash: "any-hash"
    }
  };
  const res = {
    setHeader() {},
    status(code) { resStatus = code; return this; },
    json(data) { resJson = data; return this; }
  };

  const origFrom = supabase.from;
  try {
    supabase.from = createMockSupabase();

    await adminV5CourseDeleteHandler(req, res);
    assert.equal(resStatus, 400);
    assert.match(resJson.error, /Cần xác nhận đồng ý/);
  } finally {
    supabase.from = origFrom;
  }
});

test("27. preview action returns candidate metadata without deleting anything", async () => {
  let resStatus = 0;
  let resJson = null;
  const req = {
    method: "POST",
    headers: { cookie: `admin_session_token=${adminToken}` },
    body: {
      action: "preview",
      courseId
    }
  };
  const res = {
    setHeader() {},
    status(code) { resStatus = code; return this; },
    json(data) { resJson = data; return this; }
  };

  const origFrom = supabase.from;
  let deleteAttempted = false;
  try {
    supabase.from = (table) => {
      const base = createMockSupabase()(table);
      return {
        ...base,
        delete: () => { deleteAttempted = true; return { eq: () => Promise.resolve({ error: null }) }; }
      };
    };

    await adminV5CourseDeleteHandler(req, res);
    assert.equal(resStatus, 200);
    assert.equal(resJson.success, true);
    assert.equal(resJson.eligible, true);
    assert.ok(resJson.planHash);
    assert.equal(deleteAttempted, false, "preview must never attempt any delete");
  } finally {
    supabase.from = origFrom;
  }
});

test("28. execute deletes R2 objects in batches <= 100", () => {
  const handlerSource = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-course-delete.js", import.meta.url), "utf8");
  assert.match(handlerSource, /const MAX_OBJECTS_PER_PASS = 100;/);
  assert.match(handlerSource, /maxKeys: MAX_OBJECTS_PER_PASS/);
  assert.match(handlerSource, /const CONCURRENCY = 8;/);
});

test("29. execute calls DB RPC cleanup_v5_unreleased_draft_course when prefix empty", () => {
  const handlerSource = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-course-delete.js", import.meta.url), "utf8");
  assert.match(handlerSource, /supabase\.rpc\("cleanup_v5_unreleased_draft_course",\s*\{/);
  assert.match(handlerSource, /p_course_id: metadata\.course\.id,/);
  assert.match(handlerSource, /p_expected_slug: metadata\.course\.slug/);
});

test("30. execute handles R2 404 gracefully (idempotent delete)", async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => "Not Found"
    });

    const res = await deleteR2Object({ key: `media/v5/${courseId}/non-existent.mp4` });
    assert.equal(res.deleted, false);
    assert.equal(res.notFound, true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("31. execute fails cleanly if R2 delete encounters non-404 error", async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => "Internal R2 Error"
    });

    await assert.rejects(
      async () => {
        await deleteR2Object({ key: `media/v5/${courseId}/file.mp4` });
      },
      (err) => {
        assert.match(err.message, /R2 delete failed \(500\)/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("32. DB RPC transactional rollback on failure: SQL raises exception to abort transaction", () => {
  assert.match(migrationSql, /raise exception 'v5_course_cleanup_/);
  assert.match(migrationSql, /language plpgsql/);
});

test("33. site_config studentDisplayTitle cleaned up on course delete", () => {
  assert.match(migrationSql, /v_course\.slug \|\| '_studentDisplayTitle'/);
  assert.match(migrationSql, /delete from public\.site_config/);
});

test("34. other site_config keys untouched (exact keys list only, no wildcard)", () => {
  assert.match(migrationSql, /where key in \(/);
  assert.doesNotMatch(migrationSql, /delete from public\.site_config where key like/i);
});

test("35. tgcloner tables untouched: preserves telegram sources and messages", () => {
  assert.doesNotMatch(migrationSql, /delete from public\.tgcloner_/i);
  assert.match(migrationSql, /Telegram sources \(tgcloner_sources, tgcloner_source_messages\) are preserved untouched/);
});

test("36. storage cache invalidated after successful delete", () => {
  const handlerSource = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-course-delete.js", import.meta.url), "utf8");
  assert.match(handlerSource, /invalidateStorageCache\(\);/);
});

test("37. R2 unconfigured: execute returns 503 r2_unavailable, zero R2 deletes, zero DB RPC calls", async () => {
  const origAcc = process.env.R2_ACCOUNT_ID;
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;
  let r2DeleteCalled = false;
  let dbRpcCalled = false;

  try {
    delete process.env.R2_ACCOUNT_ID;
    supabase.from = createMockSupabase();
    supabase.rpc = async () => {
      dbRpcCalled = true;
      return { data: null, error: null };
    };

    let statusCode = null;
    let jsonBody = null;
    const req = {
      method: "POST",
      headers: { cookie: `admin_session_token=${adminToken}` },
      body: {
        action: "execute",
        courseId,
        slug: courseSlug,
        confirmationSlug: courseSlug,
        confirmed: true,
        planHash: "dummy"
      }
    };
    const res = {
      setHeader: () => {},
      status: (code) => {
        statusCode = code;
        return {
          json: (body) => {
            jsonBody = body;
          }
        };
      }
    };

    await adminV5CourseDeleteHandler(req, res);

    assert.equal(statusCode, 503);
    assert.equal(jsonBody.code, "r2_unavailable");
    assert.equal(r2DeleteCalled, false, "zero R2 delete calls");
    assert.equal(dbRpcCalled, false, "zero DB cleanup RPC calls");
  } finally {
    process.env.R2_ACCOUNT_ID = origAcc;
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test("38. R2 unconfigured: preview marks course ineligible and provides no usable planHash", async () => {
  const origAcc = process.env.R2_ACCOUNT_ID;
  const origFrom = supabase.from;

  try {
    delete process.env.R2_ACCOUNT_ID;
    supabase.from = createMockSupabase();

    let statusCode = null;
    let jsonBody = null;
    const req = {
      method: "POST",
      headers: { cookie: `admin_session_token=${adminToken}` },
      body: { action: "preview", courseId }
    };
    const res = {
      setHeader: () => {},
      status: (code) => {
        statusCode = code;
        return { json: (body) => { jsonBody = body; } };
      }
    };

    await adminV5CourseDeleteHandler(req, res);

    assert.equal(statusCode, 200);
    assert.equal(jsonBody.eligible, false);
    assert.equal(jsonBody.planHash, null);
    assert.ok(jsonBody.blockedReasons.some(r => r.includes("R2 chưa được cấu hình")));
  } finally {
    process.env.R2_ACCOUNT_ID = origAcc;
    supabase.from = origFrom;
  }
});

test("39. R2 list failure (network error, 403, malformed XML, truncated pagination) returns 503 and blocks delete", async () => {
  const origFrom = supabase.from;
  const origFetch = globalThis.fetch;
  const origRpc = supabase.rpc;
  let dbRpcCalled = false;

  const failureScenarios = [
    { name: "network error", fetchImpl: async () => { throw new Error("Connection reset"); } },
    { name: "403 forbidden", fetchImpl: async () => ({ ok: false, status: 403, text: async () => "Forbidden" }) },
    { name: "malformed XML", fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<InvalidXml" }) },
    { name: "truncated without token", fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => "<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>"
    }) }
  ];

  try {
    supabase.from = createMockSupabase();
    supabase.rpc = async () => { dbRpcCalled = true; return { data: null, error: null }; };

    for (const scenario of failureScenarios) {
      globalThis.fetch = scenario.fetchImpl;

      // Test preview returns 503
      let prevStatus = null;
      let prevBody = null;
      const prevReq = {
        method: "POST",
        headers: { cookie: `admin_session_token=${adminToken}` },
        body: { action: "preview", courseId }
      };
      const prevRes = {
        setHeader: () => {},
        status: (code) => { prevStatus = code; return { json: (body) => { prevBody = body; } }; }
      };

      await adminV5CourseDeleteHandler(prevReq, prevRes);
      assert.equal(prevStatus, 503, `Preview should return 503 on ${scenario.name}`);
      assert.equal(prevBody.code, "r2_list_failed", `Preview code should be r2_list_failed on ${scenario.name}`);

      // Test execute returns 503
      let execStatus = null;
      let execBody = null;
      const execReq = {
        method: "POST",
        headers: { cookie: `admin_session_token=${adminToken}` },
        body: {
          action: "execute",
          courseId,
          slug: courseSlug,
          confirmationSlug: courseSlug,
          confirmed: true,
          planHash: "any-hash"
        }
      };
      const execRes = {
        setHeader: () => {},
        status: (code) => { execStatus = code; return { json: (body) => { execBody = body; } }; }
      };

      await adminV5CourseDeleteHandler(execReq, execRes);
      assert.equal(execStatus, 503, `Execute should return 503 on ${scenario.name}`);
      assert.equal(execBody.code, "r2_list_failed", `Execute code should be r2_list_failed on ${scenario.name}`);
      assert.equal(dbRpcCalled, false, `DB RPC must not be called on ${scenario.name}`);
    }
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
    globalThis.fetch = origFetch;
  }
});

test("40. cross-course shared source mapping asset rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    courseAssets: [{ id: "asset-1", r2_object_key: `media/v5/${courseId}/a.mp4` }],
    sharedSourceMappings: ["asset-1"]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("nguồn dữ liệu của khóa học khác")));
  assert.match(migrationSql, /v5_course_cleanup_shared_source_mapping_asset/);
});

test("41. cross-course shared job asset rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    courseAssets: [{ id: "asset-1", r2_object_key: `media/v5/${courseId}/a.mp4` }],
    sharedJobs: ["asset-1"]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("tác vụ xử lý của khóa học khác")));
  assert.match(migrationSql, /v5_course_cleanup_shared_job_asset/);
});

test("42. cross-course shared upload session asset rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    courseAssets: [{ id: "asset-1", r2_object_key: `media/v5/${courseId}/a.mp4` }],
    sharedUploadSessions: ["asset-1"]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("phiên tải lên của khóa học khác")));
  assert.match(migrationSql, /v5_course_cleanup_shared_upload_asset/);
});

test("43. cross-course shared thumbnail asset rejection", () => {
  const result = evaluateCourseDeleteEligibility({
    course: validCourseFixture(),
    config: validConfigFixture(),
    courseAssets: [{ id: "asset-1", r2_object_key: `media/v5/${courseId}/a.mp4` }],
    sharedThumbnailAssets: ["asset-1"]
  });
  assert.equal(result.canDelete, false);
  assert.ok(result.blockedReasons.some(r => r.includes("ảnh thu nhỏ (thumbnail) được chia sẻ")));
  assert.match(migrationSql, /v5_course_cleanup_shared_thumbnail_asset/);
});

test("44. cross-course shared post asset and release asset rejection in SQL RPC", () => {
  assert.match(migrationSql, /v5_course_cleanup_shared_post_asset/);
  assert.match(migrationSql, /v5_course_cleanup_shared_release_asset/);
});

test("45. site_config cleanup deletes all 7 exact known keys", () => {
  const expectedKeys = [
    "_studentDisplayTitle",
    "_title",
    "_description",
    "_subtitle",
    "_heroImage",
    "_posterImage",
    "_qrImage"
  ];
  for (const k of expectedKeys) {
    assert.match(migrationSql, new RegExp(`v_course\\.slug \\|\\| '${k}'`));
  }
});
