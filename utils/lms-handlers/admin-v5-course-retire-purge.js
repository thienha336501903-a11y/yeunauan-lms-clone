import { getAdminFromRequest } from "../lms.js";
import { supabase } from "../supabase.js";
import { deleteR2Object, isR2Configured, listAllR2Objects, listR2Objects } from "../v5-r2.js";
import { invalidateStorageCache } from "../v5-course-storage.js";
import {
  computeRetirePlanHash,
  evaluateRetirePurgeEligibility,
  statusCounts
} from "../v5-retire-purge.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OBJECTS_PER_PASS = 100;
const CONCURRENCY = 8;

function clean(value) {
  return String(value || "").trim();
}

function requireAdmin(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin?.email) {
    res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
    return null;
  }
  return admin;
}

function dedupeById(rows = []) {
  const map = new Map();
  for (const row of rows) if (row?.id) map.set(row.id, row);
  return [...map.values()];
}

function releaseAssetIds(release) {
  const ids = [];
  const snap = release?.snapshot && typeof release.snapshot === "object" ? release.snapshot : {};
  if (Array.isArray(snap.asset_ids)) ids.push(...snap.asset_ids.filter(Boolean).map(String));
  if (Array.isArray(snap.links)) {
    for (const link of snap.links) if (link?.asset_id) ids.push(String(link.asset_id));
  }
  return ids;
}

async function loadRetireMetadata(courseIdOrSlug) {
  const input = clean(courseIdOrSlug);
  if (!input) throw new Error("Thiếu định danh khóa học.");

  let courseQuery = supabase
    .from("courses")
    .select("id,slug,title,delivery_mode,active,is_published,price,image_url,teacher_name,description,raw_data,created_at,updated_at");
  courseQuery = UUID_REGEX.test(input) ? courseQuery.eq("id", input) : courseQuery.eq("slug", input);

  const { data: course, error: courseError } = await courseQuery.maybeSingle();
  if (courseError) throw courseError;
  if (!course) return null;

  const courseId = course.id;
  const slug = course.slug;
  const prefix = `media/v5/${courseId}/`;

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
    allAssetsRes,
    postAssetsRes,
    allSourceMappingsRes,
    allJobsRes,
    allUploadsRes,
    allReleasesRes
  ] = await Promise.all([
    supabase.from("v5_course_configs").select("course_id,status,published_release_id,settings,telegram_source_id,updated_at").eq("course_id", courseId).maybeSingle(),
    supabase.from("v5_releases").select("id,course_id,version,status,snapshot,created_at").eq("course_id", courseId).order("version", { ascending: true }),
    supabase.from("orders").select("id,course_id,course_slug,status").eq("course_id", courseId),
    supabase.from("orders").select("id,course_id,course_slug,status").eq("course_slug", slug),
    supabase.from("student_enrollments").select("id,course_id,course_slug,status").eq("course_id", courseId),
    supabase.from("student_enrollments").select("id,course_id,course_slug,status").eq("course_slug", slug),
    supabase.from("v5_jobs").select("id,course_id,asset_id,status,job_type").eq("course_id", courseId),
    supabase.from("v5_upload_sessions").select("id,course_id,asset_id,status,object_key,expires_at").eq("course_id", courseId),
    supabase.from("lms_v4_telegram_course_sources").select("course_slug,source_id").eq("course_slug", slug),
    supabase.from("v5_posts").select("id,status").eq("course_id", courseId),
    supabase.from("v5_lessons").select("id,status").eq("course_id", courseId),
    supabase.from("v5_source_mappings").select("id,course_id,asset_id").eq("course_id", courseId),
    supabase.from("v5_media_assets").select("id,r2_object_key,bytes,status,thumbnail_asset_id"),
    supabase.from("v5_post_assets").select("post_id,asset_id,v5_posts!inner(course_id)"),
    supabase.from("v5_source_mappings").select("id,course_id,asset_id"),
    supabase.from("v5_jobs").select("id,course_id,asset_id"),
    supabase.from("v5_upload_sessions").select("id,course_id,asset_id"),
    supabase.from("v5_releases").select("id,course_id,version,status,snapshot")
  ]);

  for (const result of [
    configRes,releasesRes,ordersIdRes,ordersSlugRes,enrollIdRes,enrollSlugRes,jobsRes,uploadsRes,
    v4Res,postsRes,lessonsRes,mappingsRes,allAssetsRes,postAssetsRes,allSourceMappingsRes,
    allJobsRes,allUploadsRes,allReleasesRes
  ]) {
    if (result.error) throw result.error;
  }

  const config = configRes.data || null;
  const releases = releasesRes.data || [];
  const orders = dedupeById([...(ordersIdRes.data || []), ...(ordersSlugRes.data || [])]);
  const enrollments = dedupeById([...(enrollIdRes.data || []), ...(enrollSlugRes.data || [])]);
  const jobs = jobsRes.data || [];
  const uploads = uploadsRes.data || [];
  const v4Sources = v4Res.data || [];
  const allAssets = allAssetsRes.data || [];
  const assetMap = new Map(allAssets.map(asset => [String(asset.id), asset]));
  const candidateIds = new Set();

  for (const asset of allAssets) {
    if (clean(asset.r2_object_key).startsWith(prefix)) candidateIds.add(String(asset.id));
  }

  for (const row of postAssetsRes.data || []) {
    if (String(row.v5_posts?.course_id || "") === String(courseId) && row.asset_id) candidateIds.add(String(row.asset_id));
  }
  for (const row of mappingsRes.data || []) if (row.asset_id) candidateIds.add(String(row.asset_id));
  for (const row of jobs) if (row.asset_id) candidateIds.add(String(row.asset_id));
  for (const row of uploads) if (row.asset_id) candidateIds.add(String(row.asset_id));
  for (const release of releases) for (const id of releaseAssetIds(release)) candidateIds.add(id);

  for (const id of [...candidateIds]) {
    const asset = assetMap.get(id);
    if (asset?.thumbnail_asset_id) candidateIds.add(String(asset.thumbnail_asset_id));
  }

  const missingAssetRefs = [...candidateIds].filter(id => !assetMap.has(id));
  const courseAssets = [...candidateIds].map(id => assetMap.get(id)).filter(Boolean);
  const courseAssetIds = new Set(courseAssets.map(asset => String(asset.id)));
  const registeredR2Keys = courseAssets.map(asset => clean(asset.r2_object_key)).filter(Boolean);

  const postOwners = new Map();
  for (const row of postAssetsRes.data || []) {
    if (!row.asset_id || !row.v5_posts?.course_id) continue;
    const id = String(row.asset_id);
    if (!postOwners.has(id)) postOwners.set(id, new Set());
    postOwners.get(id).add(String(row.v5_posts.course_id));
  }

  const sharedPostAssets = [];
  for (const id of courseAssetIds) {
    for (const owner of postOwners.get(id) || []) if (owner !== String(courseId)) sharedPostAssets.push(id);
  }
  const sharedSourceMappings = (allSourceMappingsRes.data || [])
    .filter(row => row.asset_id && courseAssetIds.has(String(row.asset_id)) && String(row.course_id) !== String(courseId))
    .map(row => String(row.asset_id));
  const sharedJobs = (allJobsRes.data || [])
    .filter(row => row.asset_id && courseAssetIds.has(String(row.asset_id)) && String(row.course_id) !== String(courseId))
    .map(row => String(row.asset_id));
  const sharedUploadSessions = (allUploadsRes.data || [])
    .filter(row => row.asset_id && courseAssetIds.has(String(row.asset_id)) && String(row.course_id) !== String(courseId))
    .map(row => String(row.asset_id));

  const sharedReleaseAssets = [];
  for (const release of allReleasesRes.data || []) {
    if (String(release.course_id) === String(courseId)) continue;
    for (const id of releaseAssetIds(release)) if (courseAssetIds.has(String(id))) sharedReleaseAssets.push(String(id));
  }

  const sharedThumbnailAssets = [];
  for (const asset of allAssets) {
    if (asset.thumbnail_asset_id && courseAssetIds.has(String(asset.thumbnail_asset_id)) && !courseAssetIds.has(String(asset.id))) {
      sharedThumbnailAssets.push(String(asset.thumbnail_asset_id));
    }
  }

  const r2Configured = isR2Configured();
  let r2Verified = false;
  let r2Objects = [];
  let r2Error = null;
  if (r2Configured) {
    try {
      r2Objects = await listAllR2Objects({ prefix });
      r2Verified = true;
    } catch (error) {
      r2Error = error;
      r2Verified = false;
    }
  }

  const actualR2Bytes = r2Verified ? r2Objects.reduce((sum, obj) => sum + Number(obj.size || 0), 0) : null;
  const actualR2Objects = r2Verified ? r2Objects.length : null;
  const { eligible, blockedReasons } = evaluateRetirePurgeEligibility({
    course, config, orders, jobs, uploads, v4Sources, courseAssets, missingAssetRefs,
    sharedPostAssets, sharedSourceMappings, sharedJobs, sharedUploadSessions,
    sharedReleaseAssets, sharedThumbnailAssets, r2Configured, r2Verified: r2Verified && !r2Error
  });

  const orderStatusCounts = statusCounts(orders);
  const enrollmentStatusCounts = statusCounts(enrollments);
  const jobStatusCounts = statusCounts(jobs);
  const uploadStatusCounts = statusCounts(uploads);

  const planHash = eligible ? computeRetirePlanHash({
    courseId,
    slug,
    courseUpdatedAt: course.updated_at,
    active: course.active,
    isPublished: course.is_published,
    configStatus: config?.status,
    publishedReleaseId: config?.published_release_id,
    releaseIds: releases.map(r => r.id),
    orderStatusCounts,
    enrollmentStatusCounts,
    jobStatusCounts,
    uploadStatusCounts,
    assetIds: courseAssets.map(a => a.id),
    registeredR2Keys,
    courseNamespace: prefix
  }) : null;

  const manifest = {
    schema: "v5-retire-purge-v1",
    course: {
      id: course.id,
      slug: course.slug,
      updated_at: course.updated_at,
      active: course.active,
      is_published: course.is_published
    },
    config: {
      status: config?.status || null,
      published_release_id: config?.published_release_id || null
    },
    releases: releases.map(r => ({ id: r.id, version: r.version, status: r.status })),
    order_status_counts: orderStatusCounts,
    enrollment_status_counts: enrollmentStatusCounts,
    job_status_counts: jobStatusCounts,
    upload_status_counts: uploadStatusCounts,
    asset_ids: [...courseAssetIds].sort(),
    registered_r2_keys: [...new Set(registeredR2Keys)].sort(),
    namespace: prefix,
    actual_r2: { objects: actualR2Objects, bytes: actualR2Bytes },
    ownership: {
      missing_asset_refs: missingAssetRefs.length,
      shared_post_assets: sharedPostAssets.length,
      shared_source_assets: sharedSourceMappings.length,
      shared_job_assets: sharedJobs.length,
      shared_upload_assets: sharedUploadSessions.length,
      shared_release_assets: sharedReleaseAssets.length,
      shared_thumbnail_assets: sharedThumbnailAssets.length
    }
  };

  return {
    course, config, releases, orders, enrollments, jobs, uploads,
    eligible, blockedReasons, planHash, manifest,
    coursePrefix: prefix,
    r2Configured, r2Verified, r2Error,
    storage: {
      actualR2Bytes,
      actualR2Objects,
      dbTrackedObjects: courseAssets.length,
      dbTrackedBytes: courseAssets.reduce((sum, asset) => sum + Number(asset.bytes || 0), 0)
    },
    counts: {
      lessons: (lessonsRes.data || []).length,
      posts: (postsRes.data || []).length,
      sourceMappings: (mappingsRes.data || []).length,
      jobs: jobs.length,
      uploads: uploads.length,
      releases: releases.length,
      orders: orders.length,
      enrollments: enrollments.length
    }
  };
}

async function updateOperation(operationId, patch) {
  const { data, error } = await supabase
    .from("v5_course_retire_operations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", operationId)
    .select("id,course_id,course_slug,status,order_count,enrollment_count,release_count,r2_object_count,r2_total_bytes,deleted_r2_count,remaining_r2_count,last_error,retired_at,completed_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Không tìm thấy Retire/Purge operation.");
  return data;
}

async function loadOperation(operationId) {
  if (!UUID_REGEX.test(clean(operationId))) throw new Error("Operation ID không hợp lệ.");
  const { data, error } = await supabase
    .from("v5_course_retire_operations")
    .select("id,course_id,course_slug,status,order_count,enrollment_count,release_count,r2_object_count,r2_total_bytes,deleted_r2_count,remaining_r2_count,last_error,retired_at,completed_at")
    .eq("id", operationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Không tìm thấy Retire/Purge operation.");
  return data;
}

function publicOperation(operation) {
  return {
    id: operation.id,
    courseId: operation.course_id,
    slug: operation.course_slug,
    status: operation.status,
    orderCount: operation.order_count,
    enrollmentCount: operation.enrollment_count,
    releaseCount: operation.release_count,
    r2ObjectCount: operation.r2_object_count,
    r2TotalBytes: operation.r2_total_bytes,
    deletedR2Count: operation.deleted_r2_count,
    remainingR2Count: operation.remaining_r2_count,
    lastError: operation.last_error || null,
    retiredAt: operation.retired_at || null,
    completedAt: operation.completed_at || null
  };
}

async function runDeleteBatch(keys) {
  const results = [];
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const batch = keys.slice(i, i + CONCURRENCY);
    results.push(...await Promise.all(batch.map(async key => {
      try {
        const result = await deleteR2Object({ key });
        return { success: true, deleted: result.deleted, notFound: result.notFound };
      } catch (error) {
        return { success: false, error: error.message };
      }
    })));
  }
  return results;
}

export default async function adminV5CourseRetirePurgeHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const action = clean(req.body?.action);

    if (action === "preview") {
      const metadata = await loadRetireMetadata(req.body?.courseId || req.body?.slug);
      if (!metadata) return res.status(404).json({ success: false, error: "Không tìm thấy khóa V5." });
      return res.status(200).json({
        success: true,
        eligible: metadata.eligible,
        blockedReasons: metadata.blockedReasons,
        course: { id: metadata.course.id, slug: metadata.course.slug, title: metadata.course.title },
        configStatus: metadata.config?.status || null,
        counts: metadata.counts,
        storage: metadata.storage,
        retained: { orders: metadata.counts.orders, enrollments: metadata.counts.enrollments, course: true, commerceMetadata: true },
        purged: { releases: metadata.counts.releases, content: true, r2Media: true },
        planHash: metadata.planHash
      });
    }

    if (action === "begin") {
      if (req.body?.confirmed !== true) {
        return res.status(400).json({ success: false, error: "Cần xác nhận đồng ý trước khi Retire/Purge." });
      }
      const metadata = await loadRetireMetadata(req.body?.courseId || req.body?.slug);
      if (!metadata) return res.status(404).json({ success: false, error: "Không tìm thấy khóa V5." });
      if (clean(req.body?.confirmationSlug) !== metadata.course.slug) {
        return res.status(400).json({ success: false, error: "Mã slug xác nhận không khớp." });
      }
      if (!metadata.eligible || !metadata.planHash) {
        return res.status(409).json({ success: false, code: "retire_purge_blocked", error: "Khóa chưa đủ điều kiện Retire/Purge.", blockedReasons: metadata.blockedReasons });
      }
      if (clean(req.body?.planHash) !== metadata.planHash) {
        return res.status(409).json({ success: false, code: "plan_changed_refresh_preview", error: "Dữ liệu khóa đã thay đổi. Hãy Preview lại." });
      }

      const { data, error } = await supabase.rpc("begin_v5_course_retire_purge", {
        p_course_id: metadata.course.id,
        p_expected_slug: metadata.course.slug,
        p_plan_hash: metadata.planHash,
        p_admin_email: admin.email,
        p_manifest: metadata.manifest,
        p_r2_object_count: metadata.storage.actualR2Objects || 0,
        p_r2_total_bytes: metadata.storage.actualR2Bytes || 0
      });
      if (error) throw error;
      invalidateStorageCache();
      console.info("[v5-retire-purge]", { action: "begin", courseId: metadata.course.id, slug: metadata.course.slug, admin: admin.email, operationId: data?.operation_id, objects: metadata.storage.actualR2Objects, bytes: metadata.storage.actualR2Bytes });
      return res.status(200).json({ success: true, operation: {
        id: data.operation_id,
        courseId: data.course_id,
        slug: data.slug,
        status: data.status,
        orderCount: data.order_count,
        enrollmentCount: data.enrollment_count,
        releaseCount: data.release_count,
        r2ObjectCount: data.r2_object_count,
        r2TotalBytes: data.r2_total_bytes
      }});
    }

    if (action === "status") {
      const operation = await loadOperation(req.body?.operationId);
      return res.status(200).json({ success: true, operation: publicOperation(operation) });
    }

    if (action === "continue") {
      const operation = await loadOperation(req.body?.operationId);
      if (operation.status === "completed") return res.status(200).json({ success: true, done: true, readyToFinalize: false, operation: publicOperation(operation) });
      if (!["retired","r2_deleting","failed","r2_verified_empty"].includes(operation.status)) {
        return res.status(409).json({ success: false, error: `Operation đang ở trạng thái không thể tiếp tục: ${operation.status}` });
      }
      if (operation.status === "r2_verified_empty") {
        return res.status(200).json({ success: true, done: false, readyToFinalize: true, operation: publicOperation(operation) });
      }
      if (!isR2Configured()) {
        return res.status(503).json({ success: false, code: "r2_unavailable", error: "Không thể xác minh R2. Retire/Purge bị chặn." });
      }

      // Destructive R2 deletion gets a fresh DB-side ownership/safety check.
      // Never rely only on the earlier Preview/Begin snapshot because another
      // course/reference could have changed since the operation was retired.
      const { error: safetyError } = await supabase.rpc("validate_v5_retire_purge_r2_delete_safe", {
        p_operation_id: operation.id
      });
      if (safetyError) {
        await updateOperation(operation.id, { status: "failed", last_error: safetyError.message });
        return res.status(409).json({
          success: false,
          code: "r2_delete_safety_revalidation_failed",
          error: safetyError.message || "Ownership R2 đã thay đổi. Cleanup bị chặn trước khi xóa bytes."
        });
      }

      const prefix = `media/v5/${operation.course_id}/`;
      let page;
      try {
        page = await listR2Objects({ prefix, maxKeys: MAX_OBJECTS_PER_PASS });
      } catch (error) {
        await updateOperation(operation.id, { status: "failed", last_error: error.message });
        return res.status(503).json({ success: false, code: "r2_list_failed", error: "Không thể liệt kê R2. Có thể tiếp tục lại sau." });
      }

      await updateOperation(operation.id, { status: "r2_deleting", last_error: null });
      const results = await runDeleteBatch(page.objects.map(obj => obj.key));
      const failed = results.filter(result => !result.success);
      if (failed.length) {
        const message = failed[0].error || "R2 delete failed";
        await updateOperation(operation.id, { status: "failed", last_error: message });
        return res.status(502).json({ success: false, code: "r2_delete_failed", error: "Dọn R2 chưa hoàn tất. Có thể tiếp tục an toàn.", failedCount: failed.length });
      }

      let remainingObjects;
      try {
        remainingObjects = await listAllR2Objects({ prefix });
      } catch (error) {
        await updateOperation(operation.id, { status: "failed", last_error: error.message });
        return res.status(503).json({ success: false, code: "r2_verify_failed", error: "Đã xóa một batch nhưng chưa xác minh được R2. Có thể tiếp tục lại." });
      }

      const remaining = remainingObjects.length;
      const deletedCount = Math.max(Number(operation.r2_object_count || 0) - remaining, 0);
      const next = await updateOperation(operation.id, {
        status: remaining === 0 ? "r2_verified_empty" : "r2_deleting",
        deleted_r2_count: deletedCount,
        remaining_r2_count: remaining,
        last_error: null
      });
      console.info("[v5-retire-purge]", { action: "r2_batch", operationId: operation.id, courseId: operation.course_id, slug: operation.course_slug, admin: admin.email, deletedThisPass: results.length, remaining });
      return res.status(200).json({
        success: true,
        done: false,
        readyToFinalize: remaining === 0,
        deletedThisPass: results.length,
        remainingObjects: remaining,
        operation: publicOperation(next)
      });
    }

    if (action === "finalize") {
      const operation = await loadOperation(req.body?.operationId);
      if (operation.status === "completed") return res.status(200).json({ success: true, done: true, operation: publicOperation(operation) });
      if (operation.status !== "r2_verified_empty") {
        return res.status(409).json({ success: false, error: "R2 chưa được xác minh trống." });
      }
      if (!isR2Configured()) {
        return res.status(503).json({ success: false, code: "r2_unavailable", error: "Không thể xác minh R2 trước finalize." });
      }
      const prefix = `media/v5/${operation.course_id}/`;
      const remaining = await listAllR2Objects({ prefix });
      if (remaining.length) {
        const next = await updateOperation(operation.id, { status: "r2_deleting", remaining_r2_count: remaining.length, last_error: null });
        return res.status(409).json({ success: false, code: "r2_not_empty", error: "R2 namespace vẫn còn object. Hãy tiếp tục dọn.", remainingObjects: remaining.length, operation: publicOperation(next) });
      }

      const { data, error } = await supabase.rpc("finalize_v5_course_retire_purge", {
        p_operation_id: operation.id,
        p_course_id: operation.course_id,
        p_expected_slug: operation.course_slug
      });
      if (error) throw error;
      invalidateStorageCache();
      const completed = await loadOperation(operation.id);
      console.info("[v5-retire-purge]", { action: "finalize", operationId: operation.id, courseId: operation.course_id, slug: operation.course_slug, admin: admin.email, result: data });
      return res.status(200).json({ success: true, done: true, result: data, operation: publicOperation(completed) });
    }

    return res.status(400).json({ success: false, error: "Action Retire/Purge không hợp lệ." });
  } catch (error) {
    console.error("[admin-v5-course-retire-purge]", error);
    return res.status(500).json({ success: false, error: error.message || "V5 Retire/Purge server error" });
  }
}

export { loadRetireMetadata };
