import crypto from "node:crypto";
import { getAdminFromRequest } from "../lms.js";
import { supabase } from "../supabase.js";
import { deleteR2Object, isR2Configured, listAllR2Objects, listR2Objects } from "../v5-r2.js";
import { evaluateCourseDeleteEligibility, invalidateStorageCache } from "../v5-course-storage.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OBJECTS_PER_PASS = 100;
const CONCURRENCY = 8;
const TERMINAL_UPLOAD_STATUSES = new Set(["completed", "aborted", "expired"]);

function clean(val) {
  return String(val || "").trim();
}

function requireAdmin(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin?.email) {
    res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
    return null;
  }
  return admin;
}

export function computeDeletePlanHash({
  courseId,
  slug,
  courseUpdatedAt,
  active,
  isPublished,
  configStatus,
  publishedReleaseId,
  orderCount,
  enrollmentCount,
  releaseCount,
  jobStatusCounts = {},
  uploadSessionStatusCounts = {},
  assetIds = [],
  registeredR2Keys = [],
  courseNamespace
}) {
  const sortedJobCounts = Object.keys(jobStatusCounts).sort().reduce((acc, k) => {
    acc[k] = jobStatusCounts[k];
    return acc;
  }, {});

  const sortedUploadCounts = Object.keys(uploadSessionStatusCounts).sort().reduce((acc, k) => {
    acc[k] = uploadSessionStatusCounts[k];
    return acc;
  }, {});

  const payload = {
    courseId: String(courseId || ""),
    slug: String(slug || ""),
    courseUpdatedAt: String(courseUpdatedAt || ""),
    active: Boolean(active),
    isPublished: Boolean(isPublished),
    configStatus: String(configStatus || ""),
    publishedReleaseId: publishedReleaseId ? String(publishedReleaseId) : null,
    orderCount: Number(orderCount || 0),
    enrollmentCount: Number(enrollmentCount || 0),
    releaseCount: Number(releaseCount || 0),
    jobStatusCounts: sortedJobCounts,
    uploadSessionStatusCounts: sortedUploadCounts,
    assetIds: [...new Set(assetIds.map(String))].sort(),
    registeredR2Keys: [...new Set(registeredR2Keys.map(String))].sort(),
    courseNamespace: String(courseNamespace || "")
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function loadCourseAndMetadata(courseIdOrSlug) {
  const input = clean(courseIdOrSlug);
  if (!input) throw new Error("Thiếu định danh khóa học.");

  let query = supabase.from("courses").select("id, slug, title, delivery_mode, active, is_published, price, image_url, teacher_name, description, raw_data, created_at, updated_at");
  if (UUID_REGEX.test(input)) {
    query = query.eq("id", input);
  } else {
    query = query.eq("slug", input);
  }

  const { data: course, error: cErr } = await query.maybeSingle();
  if (cErr) throw cErr;
  if (!course) return null;

  const cId = course.id;
  const cSlug = course.slug;
  const now = Date.now();

  const [
    configRes,
    releasesRes,
    ordersIdRes,
    ordersSlugRes,
    enrollIdRes,
    enrollSlugRes,
    jobsRes,
    uploadsRes,
    v4Res,
    postsRes,
    lessonsRes,
    mappingsRes,
    allDbAssetsRes,
    postAssetsRes
  ] = await Promise.all([
    supabase.from("v5_course_configs").select("course_id, status, published_release_id, settings, telegram_source_id").eq("course_id", cId).maybeSingle(),
    supabase.from("v5_releases").select("id, course_id, version, status").eq("course_id", cId),
    supabase.from("orders").select("id, course_id, course_slug, status").eq("course_id", cId),
    supabase.from("orders").select("id, course_id, course_slug, status").eq("course_slug", cSlug),
    supabase.from("student_enrollments").select("id, course_id, course_slug, status").eq("course_id", cId),
    supabase.from("student_enrollments").select("id, course_id, course_slug, status").eq("course_slug", cSlug),
    supabase.from("v5_jobs").select("id, course_id, asset_id, status, job_type, created_at").eq("course_id", cId),
    supabase.from("v5_upload_sessions").select("id, course_id, asset_id, status, object_key, expires_at").eq("course_id", cId),
    supabase.from("lms_v4_telegram_course_sources").select("id, course_slug").eq("course_slug", cSlug),
    supabase.from("v5_posts").select("id, status").eq("course_id", cId),
    supabase.from("v5_lessons").select("id, status").eq("course_id", cId),
    supabase.from("v5_source_mappings").select("id").eq("course_id", cId),
    supabase.from("v5_media_assets").select("id, r2_object_key, bytes, status, original_filename"),
    supabase.from("v5_post_assets").select("post_id, asset_id, v5_posts!inner(course_id)")
  ]);

  if (configRes.error) throw configRes.error;
  if (releasesRes.error) throw releasesRes.error;
  if (ordersIdRes.error) throw ordersIdRes.error;
  if (ordersSlugRes.error) throw ordersSlugRes.error;
  if (enrollIdRes.error) throw enrollIdRes.error;
  if (enrollSlugRes.error) throw enrollSlugRes.error;
  if (jobsRes.error) throw jobsRes.error;
  if (uploadsRes.error) throw uploadsRes.error;
  if (v4Res.error) throw v4Res.error;
  if (postsRes.error) throw postsRes.error;
  if (lessonsRes.error) throw lessonsRes.error;
  if (mappingsRes.error) throw mappingsRes.error;
  if (allDbAssetsRes.error) throw allDbAssetsRes.error;

  // Deduplicate orders and enrollments
  const orderMap = new Map();
  for (const o of (ordersIdRes.data || []).concat(ordersSlugRes.data || [])) {
    orderMap.set(o.id, o);
  }
  const enrollMap = new Map();
  for (const e of (enrollIdRes.data || []).concat(enrollSlugRes.data || [])) {
    enrollMap.set(e.id, e);
  }

  // Post asset ownership map: asset_id -> Set of course_ids
  const assetCourseOwnership = new Map();
  for (const row of postAssetsRes.data || []) {
    const cid = row.v5_posts?.course_id;
    if (cid && row.asset_id) {
      if (!assetCourseOwnership.has(row.asset_id)) assetCourseOwnership.set(row.asset_id, new Set());
      assetCourseOwnership.get(row.asset_id).add(cid);
    }
  }

  // Partition assets
  const courseAssets = [];
  const otherCourseAssets = [];
  const coursePrefix = `media/v5/${cId}/`;

  for (const asset of allDbAssetsRes.data || []) {
    const key = clean(asset.r2_object_key);
    let belongsToCourse = false;
    if (key.startsWith(coursePrefix)) {
      belongsToCourse = true;
    } else if (assetCourseOwnership.has(asset.id)) {
      const owners = assetCourseOwnership.get(asset.id);
      if (owners.has(cId)) belongsToCourse = true;
    }

    if (belongsToCourse) {
      courseAssets.push(asset);
    } else {
      otherCourseAssets.push(asset);
    }
  }

  const jobs = jobsRes.data || [];
  const uploads = uploadsRes.data || [];
  const releases = releasesRes.data || [];
  const config = configRes.data || null;
  const v4Sources = v4Res.data || [];
  const posts = postsRes.data || [];
  const lessons = lessonsRes.data || [];
  const mappings = mappingsRes.data || [];

  // Fetch actual R2 objects under course prefix if R2 is configured
  let r2Objects = [];
  if (isR2Configured()) {
    try {
      r2Objects = await listAllR2Objects({ prefix: coursePrefix });
    } catch (err) {
      console.error("[admin-v5-course-delete] Error listing R2 objects for prefix:", coursePrefix, err.message);
    }
  }

  const actualR2Bytes = r2Objects.reduce((sum, o) => sum + Number(o.size || 0), 0);
  const actualR2Objects = r2Objects.length;

  const courseDbKeys = new Set(courseAssets.map(a => clean(a.r2_object_key)).filter(Boolean));
  const activeUploadKeys = new Set();
  for (const u of uploads) {
    const status = clean(u.status).toLowerCase();
    const isExpired = u.expires_at && Date.parse(u.expires_at) <= now;
    if (!TERMINAL_UPLOAD_STATUSES.has(status) && !isExpired && clean(u.object_key)) {
      activeUploadKeys.add(clean(u.object_key));
    }
  }

  let untrackedInsidePrefix = 0;
  for (const obj of r2Objects) {
    if (!courseDbKeys.has(obj.key) && !activeUploadKeys.has(obj.key)) {
      untrackedInsidePrefix++;
    }
  }

  const jobStatusCounts = {};
  for (const j of jobs) {
    const s = j.status || "unknown";
    jobStatusCounts[s] = (jobStatusCounts[s] || 0) + 1;
  }

  const uploadSessionStatusCounts = {};
  for (const u of uploads) {
    const s = u.status || "unknown";
    uploadSessionStatusCounts[s] = (uploadSessionStatusCounts[s] || 0) + 1;
  }

  const terminalJobs = jobs.filter(j => TERMINAL_UPLOAD_STATUSES.has(j.status) || ["success", "failed", "cancelled", "canceled"].includes(j.status)).length;

  // Evaluate eligibility
  const { canDelete, blockedReasons } = evaluateCourseDeleteEligibility({
    course,
    config,
    releases,
    orders: [...orderMap.values()],
    enrollments: [...enrollMap.values()],
    jobs,
    uploads,
    v4Sources,
    courseAssets,
    otherCourseAssets,
    r2ObjectsInNamespace: r2Objects
  });

  const planHash = computeDeletePlanHash({
    courseId: cId,
    slug: cSlug,
    courseUpdatedAt: course.updated_at,
    active: course.active,
    isPublished: course.is_published,
    configStatus: config?.status || "",
    publishedReleaseId: config?.published_release_id || null,
    orderCount: orderMap.size,
    enrollmentCount: enrollMap.size,
    releaseCount: releases.length,
    jobStatusCounts,
    uploadSessionStatusCounts,
    assetIds: courseAssets.map(a => a.id),
    registeredR2Keys: [...courseDbKeys],
    courseNamespace: coursePrefix
  });

  return {
    course,
    config,
    eligible: canDelete,
    blockedReasons,
    counts: {
      lessons: lessons.length,
      posts: posts.length,
      sourceMappings: mappings.length,
      terminalJobs,
      orders: orderMap.size,
      enrollments: enrollMap.size,
      releases: releases.length
    },
    storage: {
      actualR2Bytes,
      actualR2Objects,
      trackedObjects: courseAssets.length,
      untrackedObjectsInsidePrefix: untrackedInsidePrefix
    },
    planHash,
    courseAssets,
    coursePrefix
  };
}

async function runParallelR2BatchDelete(keys, concurrency = CONCURRENCY) {
  const results = [];
  for (let i = 0; i < keys.length; i += concurrency) {
    const batch = keys.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async key => {
        try {
          const res = await deleteR2Object({ key });
          return { key, success: true, deleted: res.deleted, notFound: res.notFound };
        } catch (err) {
          console.error(`[admin-v5-course-delete] Error deleting ${key}:`, err.message);
          return { key, success: false, error: err.message };
        }
      })
    );
    results.push(...batchResults);
  }
  return results;
}

export default async function adminV5CourseDeleteHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { action, courseId, slug, planHash, confirmationSlug, confirmed } = req.body || {};

  if (action === "preview") {
    try {
      const metadata = await loadCourseAndMetadata(courseId || slug);
      if (!metadata) {
        return res.status(404).json({ success: false, error: "Không tìm thấy khóa học V5." });
      }

      return res.status(200).json({
        success: true,
        eligible: metadata.eligible,
        blockedReasons: metadata.blockedReasons,
        course: {
          id: metadata.course.id,
          slug: metadata.course.slug,
          title: metadata.course.title
        },
        counts: metadata.counts,
        storage: metadata.storage,
        planHash: metadata.planHash
      });
    } catch (error) {
      console.error("[admin-v5-course-delete] preview error:", error);
      return res.status(500).json({ success: false, error: error.message || "Lỗi xem trước kế hoạch xóa." });
    }
  }

  if (action === "execute") {
    try {
      const metadata = await loadCourseAndMetadata(courseId || slug);
      if (!metadata) {
        // Course may have already been deleted
        const cPrefix = `media/v5/${courseId}/`;
        let remainingObjs = [];
        if (isR2Configured() && courseId) {
          try {
            const listRes = await listR2Objects({ prefix: cPrefix, maxKeys: 1 });
            remainingObjs = listRes.objects;
          } catch (_) {}
        }
        if (remainingObjs.length === 0) {
          return res.status(200).json({
            success: true,
            done: true,
            alreadyDeleted: true,
            message: "Khóa học đã được xóa thành công từ trước."
          });
        }
        return res.status(404).json({ success: false, error: "Không tìm thấy khóa học V5 để xóa." });
      }

      // Revalidate confirmation
      if (confirmed !== true) {
        return res.status(400).json({ success: false, error: "Cần xác nhận đồng ý xóa vĩnh viễn media R2 và nội dung V5." });
      }
      if (clean(confirmationSlug) !== metadata.course.slug) {
        return res.status(400).json({ success: false, error: "Mã slug xác nhận không khớp chính xác với slug khóa học." });
      }

      // Revalidate eligibility
      if (!metadata.eligible) {
        return res.status(409).json({
          success: false,
          error: "Khóa học không đủ điều kiện xóa Safe Draft.",
          blockedReasons: metadata.blockedReasons
        });
      }

      // Revalidate planHash
      if (clean(planHash) !== metadata.planHash) {
        return res.status(409).json({
          success: false,
          code: "plan_changed_refresh_preview",
          error: "Dữ liệu khóa học đã thay đổi so với bản xem trước. Vui lòng làm mới lại."
        });
      }

      // Batch delete R2 objects in course namespace
      // Keys derived strictly server-side from ListObjectsV2
      let deletedThisPass = 0;
      let remainingObjects = 0;
      let remainingBytes = 0;

      if (isR2Configured()) {
        const listResult = await listR2Objects({ prefix: metadata.coursePrefix, maxKeys: MAX_OBJECTS_PER_PASS });
        const objectsToDelete = listResult.objects || [];

        if (objectsToDelete.length > 0) {
          const keysToDelete = objectsToDelete.map(o => o.key);
          const deleteResults = await runParallelR2BatchDelete(keysToDelete, CONCURRENCY);
          const failed = deleteResults.filter(r => !r.success);
          if (failed.length > 0) {
            throw new Error(`Xóa R2 media thất bại ${failed.length}/${keysToDelete.length} object: ${failed[0].error}`);
          }
          deletedThisPass = keysToDelete.length;
        }

        // Check if prefix is now empty
        const recheck = await listR2Objects({ prefix: metadata.coursePrefix, maxKeys: 100 });
        remainingObjects = recheck.objects.length;
        remainingBytes = recheck.objects.reduce((sum, o) => sum + Number(o.size || 0), 0);

        if (recheck.isTruncated || remainingObjects > 0) {
          return res.status(200).json({
            success: true,
            done: false,
            deletedThisPass,
            remainingObjects,
            remainingBytes,
            message: `Đã dọn ${deletedThisPass} object. Bấm Tiếp tục dọn.`
          });
        }
      }

      // Prefix is empty! Call DB cleanup RPC
      const { data: dbResult, error: dbErr } = await supabase.rpc("cleanup_v5_unreleased_draft_course", {
        p_course_id: metadata.course.id,
        p_expected_slug: metadata.course.slug
      });

      if (dbErr) {
        console.error("[admin-v5-course-delete] DB RPC error:", dbErr);
        throw new Error(dbErr.message || "Lỗi xóa dữ liệu khóa học trong cơ sở dữ liệu.");
      }

      // Invalidate storage cache
      invalidateStorageCache();

      console.log(`[admin-v5-course-delete] SUCCESS deleted course ${metadata.course.id} (${metadata.course.slug}) by ${admin.email}`);

      return res.status(200).json({
        success: true,
        done: true,
        deletedThisPass,
        dbCleanup: dbResult,
        message: `Đã dọn hoàn tất khóa học "${metadata.course.title}" và toàn bộ media liên quan.`
      });
    } catch (error) {
      console.error("[admin-v5-course-delete] execute error:", error);
      return res.status(409).json({ success: false, error: error.message || "Lỗi thực thi xóa khóa V5." });
    }
  }

  return res.status(400).json({ success: false, error: "Action không hợp lệ (hỗ trợ preview, execute)." });
}
