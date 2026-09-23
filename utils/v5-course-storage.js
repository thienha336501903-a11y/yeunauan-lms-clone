import { supabase } from "./supabase.js";
import { isR2Configured, listAllR2Objects } from "./v5-r2.js";

const CACHE_TTL_MS = 60 * 1000;
let storageCache = {
  data: null,
  cachedAt: 0
};

export function invalidateStorageCache() {
  storageCache = {
    data: null,
    cachedAt: 0
  };
}

const TERMINAL_JOB_STATUSES = new Set(["success", "failed", "cancelled", "canceled"]);
const TERMINAL_UPLOAD_STATUSES = new Set(["completed", "aborted", "expired"]);

function clean(val) {
  return String(val || "").trim();
}

export function evaluateCourseDeleteEligibility({
  course,
  config,
  releases = [],
  orders = [],
  enrollments = [],
  jobs = [],
  uploads = [],
  v4Sources = [],
  courseAssets = [],
  otherCourseAssets = [],
  r2Configured = true,
  r2Verified = true,
  sharedPostAssets = [],
  sharedSourceMappings = [],
  sharedJobs = [],
  sharedUploadSessions = [],
  sharedReleaseAssets = [],
  sharedThumbnailAssets = []
}) {
  const blockedReasons = [];
  const raw = course.raw_data && typeof course.raw_data === "object" ? course.raw_data : {};

  // 0. R2 configuration and verification requirement
  if (r2Configured === false) {
    blockedReasons.push("R2 chưa được cấu hình. Cleanup bị chặn.");
  } else if (!r2Verified) {
    blockedReasons.push("Không thể xác minh R2. Cleanup bị chặn.");
  }

  // 1. delivery_mode === 'v5'
  if (clean(course.delivery_mode).toLowerCase() !== "v5") {
    blockedReasons.push("Khóa học không phải chế độ V5.");
  }

  // 2. v5CreatedFrom === 'course_channel'
  if (clean(raw.v5CreatedFrom) !== "course_channel") {
    blockedReasons.push("Khóa không có marker v5CreatedFrom='course_channel'.");
  }

  // 3. active === false
  if (course.active === true) {
    blockedReasons.push("Khóa đang bật bán (active=true).");
  }

  // 4. is_published === false
  if (course.is_published === true) {
    blockedReasons.push("Khóa đang ở trạng thái Published (is_published=true).");
  }

  // 5. v5_course_configs exists
  if (!config) {
    blockedReasons.push("Chưa có cấu hình V5 course config.");
  } else {
    // 6. v5_course_configs.status === 'draft'
    if (clean(config.status).toLowerCase() !== "draft") {
      blockedReasons.push(`Cấu hình V5 không ở trạng thái Draft (${config.status || "chưa rõ"}).`);
    }
    // 7. published_release_id is null
    if (config.published_release_id) {
      blockedReasons.push("Khóa đã có bản phát hành Published được cấu hình.");
    }
  }

  // 8. release_count === 0
  if (releases.length > 0) {
    blockedReasons.push(`Khóa đã có ${releases.length} bản phát hành (release).`);
  }

  // 9. order_count === 0
  if (orders.length > 0) {
    blockedReasons.push(`Đã có ${orders.length} đơn hàng liên kết với khóa.`);
  }

  // 10. enrollment_count === 0
  if (enrollments.length > 0) {
    blockedReasons.push(`Đã có ${enrollments.length} lượt ghi danh học viên.`);
  }

  // 11. No active/non-terminal jobs
  for (const job of jobs) {
    const status = clean(job.status).toLowerCase();
    if (!TERMINAL_JOB_STATUSES.has(status)) {
      blockedReasons.push(`Có tác vụ xử lý chưa hoàn tất (trạng thái: ${job.status || "chưa rõ"}).`);
      break;
    }
  }

  // 12. No active/non-terminal upload sessions
  const now = Date.now();
  for (const upload of uploads) {
    const status = clean(upload.status).toLowerCase();
    const isExpired = upload.expires_at && Date.parse(upload.expires_at) <= now;
    if (!TERMINAL_UPLOAD_STATUSES.has(status) && !isExpired) {
      blockedReasons.push(`Có phiên upload đang hoạt động (trạng thái: ${upload.status || "chưa rõ"}).`);
      break;
    }
  }

  // 13. No V4 source mappings
  if (v4Sources.length > 0) {
    blockedReasons.push("Khóa có liên kết nguồn dữ liệu V4 legacy.");
  }

  // 14. No shared media assets
  const courseAssetIds = new Set(courseAssets.map(a => a.id));
  for (const otherAsset of otherCourseAssets) {
    if (courseAssetIds.has(otherAsset.id)) {
      blockedReasons.push("Có tài nguyên media được chia sẻ với khóa học khác.");
      break;
    }
  }

  // 14b. Explicit cross-course shared relationship guards
  if (sharedPostAssets.length > 0) {
    blockedReasons.push("Có tài nguyên media được chia sẻ với bài viết của khóa học khác.");
  }
  if (sharedSourceMappings.length > 0) {
    blockedReasons.push("Có tài nguyên media được liên kết với nguồn dữ liệu của khóa học khác.");
  }
  if (sharedJobs.length > 0) {
    blockedReasons.push("Có tài nguyên media được liên kết với tác vụ xử lý của khóa học khác.");
  }
  if (sharedUploadSessions.length > 0) {
    blockedReasons.push("Có tài nguyên media được liên kết với phiên tải lên của khóa học khác.");
  }
  if (sharedReleaseAssets.length > 0) {
    blockedReasons.push("Có tài nguyên media được tham chiếu trong bản phát hành của khóa học khác.");
  }
  if (sharedThumbnailAssets.length > 0) {
    blockedReasons.push("Có ảnh thu nhỏ (thumbnail) được chia sẻ với khóa học khác.");
  }

  // 15. All DB assets inside course UUID namespace
  const coursePrefix = `media/v5/${course.id}/`;
  for (const asset of courseAssets) {
    const key = clean(asset.r2_object_key);
    if (key && !key.startsWith(coursePrefix)) {
      blockedReasons.push("Có tài nguyên media trỏ ra ngoài namespace của khóa.");
      break;
    }
  }

  // 16. No R2 key under course namespace is referenced by another course
  for (const otherAsset of otherCourseAssets) {
    const key = clean(otherAsset.r2_object_key);
    if (key && key.startsWith(coursePrefix)) {
      blockedReasons.push("Tài nguyên trong namespace của khóa đang bị khóa khác tham chiếu.");
      break;
    }
  }

  // 17. Commerce ownership safety
  const priceVal = clean(course.price);
  const imgVal = clean(course.image_url);
  const teacherVal = clean(course.teacher_name);
  const descVal = clean(course.description);
  if (priceVal || imgVal || teacherVal || descVal) {
    blockedReasons.push("Khóa có dữ liệu cấu hình thương mại (giá, ảnh, giảng viên hoặc mô tả).");
  }

  return {
    canDelete: blockedReasons.length === 0,
    blockedReasons
  };
}

export async function getV5StorageSnapshot({ refresh = false } = {}) {
  const now = Date.now();
  if (!refresh && storageCache.data && (now - storageCache.cachedAt < CACHE_TTL_MS)) {
    return { ...storageCache.data, cached: true };
  }

  // 1. Fetch DB V5 Courses & Configs
  const { data: courses, error: coursesErr } = await supabase
    .from("courses")
    .select("id, slug, title, delivery_mode, active, is_published, price, image_url, teacher_name, description, raw_data, created_at, updated_at")
    .eq("delivery_mode", "v5")
    .order("created_at", { ascending: false });
  if (coursesErr) throw coursesErr;

  const courseList = courses || [];
  const courseIds = courseList.map(c => c.id);
  const courseSlugs = courseList.map(c => c.slug);

  // Parallel fetch auxiliary DB data
  const [
    configsRes,
    releasesRes,
    ordersRes,
    enrollRes,
    jobsRes,
    uploadsRes,
    v4Res,
    assetsRes,
    postAssetsRes,
    sourceMappingsRes
  ] = await Promise.all([
    supabase.from("v5_course_configs").select("course_id, status, published_release_id, settings, telegram_source_id").in("course_id", courseIds),
    supabase.from("v5_releases").select("id, course_id, version, status, snapshot").in("course_id", courseIds),
    supabase.from("orders").select("id, course_id, course_slug, status"),
    supabase.from("student_enrollments").select("id, course_id, course_slug, status"),
    supabase.from("v5_jobs").select("id, course_id, asset_id, status, job_type, created_at"),
    supabase.from("v5_upload_sessions").select("id, course_id, asset_id, status, object_key, expires_at"),
    supabase.from("lms_v4_telegram_course_sources").select("course_slug, source_id"),
    supabase.from("v5_media_assets").select("id, r2_object_key, bytes, status, original_filename, thumbnail_asset_id"),
    supabase.from("v5_post_assets").select("post_id, asset_id, v5_posts!inner(course_id)"),
    supabase.from("v5_source_mappings").select("id, course_id, asset_id")
  ]);

  if (configsRes.error) throw configsRes.error;
  if (releasesRes.error) throw releasesRes.error;
  if (ordersRes.error) throw ordersRes.error;
  if (enrollRes.error) throw enrollRes.error;
  if (jobsRes.error) throw jobsRes.error;
  if (uploadsRes.error) throw uploadsRes.error;
  if (v4Res.error) throw v4Res.error;
  if (assetsRes.error) throw assetsRes.error;

  const configsByCourse = new Map((configsRes.data || []).map(cfg => [cfg.course_id, cfg]));
  
  const releasesByCourse = new Map();
  for (const r of releasesRes.data || []) {
    if (!releasesByCourse.has(r.course_id)) releasesByCourse.set(r.course_id, []);
    releasesByCourse.get(r.course_id).push(r);
  }

  const ordersByCourse = new Map();
  for (const o of ordersRes.data || []) {
    if (o.course_id) {
      if (!ordersByCourse.has(o.course_id)) ordersByCourse.set(o.course_id, []);
      ordersByCourse.get(o.course_id).push(o);
    }
    if (o.course_slug) {
      if (!ordersByCourse.has(o.course_slug)) ordersByCourse.set(o.course_slug, []);
      ordersByCourse.get(o.course_slug).push(o);
    }
  }

  const enrollByCourse = new Map();
  for (const e of enrollRes.data || []) {
    if (e.course_id) {
      if (!enrollByCourse.has(e.course_id)) enrollByCourse.set(e.course_id, []);
      enrollByCourse.get(e.course_id).push(e);
    }
    if (e.course_slug) {
      if (!enrollByCourse.has(e.course_slug)) enrollByCourse.set(e.course_slug, []);
      enrollByCourse.get(e.course_slug).push(e);
    }
  }

  const jobsByCourse = new Map();
  for (const j of jobsRes.data || []) {
    if (!jobsByCourse.has(j.course_id)) jobsByCourse.set(j.course_id, []);
    jobsByCourse.get(j.course_id).push(j);
  }

  const uploadsByCourse = new Map();
  for (const u of uploadsRes.data || []) {
    if (!uploadsByCourse.has(u.course_id)) uploadsByCourse.set(u.course_id, []);
    uploadsByCourse.get(u.course_id).push(u);
  }

  const v4BySlug = new Map();
  for (const v of v4Res.data || []) {
    if (!v4BySlug.has(v.course_slug)) v4BySlug.set(v.course_slug, []);
    v4BySlug.get(v.course_slug).push(v);
  }

  // Post asset ownership map: asset_id -> Set of course_ids
  const assetCourseOwnership = new Map();
  for (const row of postAssetsRes.data || []) {
    const courseId = row.v5_posts?.course_id;
    if (courseId && row.asset_id) {
      if (!assetCourseOwnership.has(row.asset_id)) assetCourseOwnership.set(row.asset_id, new Set());
      assetCourseOwnership.get(row.asset_id).add(courseId);
    }
  }

  // Source mapping asset ownership map: asset_id -> Set of course_ids
  const sourceMappingAssetOwners = new Map();
  for (const sm of sourceMappingsRes.data || []) {
    if (sm.course_id && sm.asset_id) {
      if (!sourceMappingAssetOwners.has(sm.asset_id)) sourceMappingAssetOwners.set(sm.asset_id, new Set());
      sourceMappingAssetOwners.get(sm.asset_id).add(sm.course_id);
    }
  }

  // Jobs asset ownership map: asset_id -> Set of course_ids
  const jobAssetOwners = new Map();
  for (const j of jobsRes.data || []) {
    if (j.course_id && j.asset_id) {
      if (!jobAssetOwners.has(j.asset_id)) jobAssetOwners.set(j.asset_id, new Set());
      jobAssetOwners.get(j.asset_id).add(j.course_id);
    }
  }

  // Upload sessions asset ownership map: asset_id -> Set of course_ids
  const uploadAssetOwners = new Map();
  for (const u of uploadsRes.data || []) {
    if (u.course_id && u.asset_id) {
      if (!uploadAssetOwners.has(u.asset_id)) uploadAssetOwners.set(u.asset_id, new Set());
      uploadAssetOwners.get(u.asset_id).add(u.course_id);
    }
  }

  // Release snapshots referencing asset_id: asset_id -> Set of course_ids
  const releaseAssetOwners = new Map();
  for (const r of releasesRes.data || []) {
    const snap = r.snapshot;
    if (snap && typeof snap === "object") {
      const assetIds = Array.isArray(snap.asset_ids) ? snap.asset_ids : [];
      for (const aId of assetIds) {
        if (!releaseAssetOwners.has(aId)) releaseAssetOwners.set(aId, new Set());
        releaseAssetOwners.get(aId).add(r.course_id);
      }
      const links = Array.isArray(snap.links) ? snap.links : [];
      for (const l of links) {
        if (l?.asset_id) {
          if (!releaseAssetOwners.has(l.asset_id)) releaseAssetOwners.set(l.asset_id, new Set());
          releaseAssetOwners.get(l.asset_id).add(r.course_id);
        }
      }
    }
  }

  // Assets in DB
  const allDbAssets = assetsRes.data || [];
  const dbTrackedKeysSet = new Set();
  let dbTrackedBytes = 0;
  for (const asset of allDbAssets) {
    const key = clean(asset.r2_object_key);
    if (key) {
      dbTrackedKeysSet.add(key);
      dbTrackedBytes += Number(asset.bytes || 0);
    }
  }

  // Active upload session keys (should NOT be classified as orphan)
  const activeUploadKeys = new Set();
  for (const u of uploadsRes.data || []) {
    const status = clean(u.status).toLowerCase();
    const isExpired = u.expires_at && Date.parse(u.expires_at) <= now;
    if (!TERMINAL_UPLOAD_STATUSES.has(status) && !isExpired && clean(u.object_key)) {
      activeUploadKeys.add(clean(u.object_key));
    }
  }

  // 2. Fetch actual R2 objects
  let r2Objects = [];
  let r2Configured = isR2Configured();
  let r2Verified = false;
  let r2Error = null;
  if (r2Configured) {
    try {
      r2Objects = await listAllR2Objects();
      r2Verified = true;
    } catch (err) {
      console.error("[v5-course-storage] Error listing R2 objects:", err.message);
      r2Verified = false;
      r2Error = err.message;
    }
  }

  const r2KeyMap = new Map();
  let bucketBytes = 0;
  let v5Bytes = 0;
  let v5ObjectCount = 0;

  if (r2Verified) {
    for (const obj of r2Objects) {
      r2KeyMap.set(obj.key, obj);
      bucketBytes += Number(obj.size || 0);
      if (obj.key.startsWith("media/v5/")) {
        v5Bytes += Number(obj.size || 0);
        v5ObjectCount++;
      }
    }
  }

  // Classify orphans & missing
  let orphanCandidateBytes = 0;
  let orphanCandidateObjects = 0;
  if (r2Verified) {
    for (const obj of r2Objects) {
      if (obj.key.startsWith("media/v5/")) {
        if (!dbTrackedKeysSet.has(obj.key) && !activeUploadKeys.has(obj.key)) {
          orphanCandidateBytes += Number(obj.size || 0);
          orphanCandidateObjects++;
        }
      }
    }
  }

  let missingTrackedObjects = 0;
  if (r2Verified) {
    for (const key of dbTrackedKeysSet) {
      if (!r2KeyMap.has(key)) {
        missingTrackedObjects++;
      }
    }
  }

  // Group R2 objects by course UUID namespace
  // Prefix format: media/v5/<COURSE_UUID>/...
  const r2ObjectsByCourseId = new Map();
  if (r2Verified) {
    for (const obj of r2Objects) {
      if (obj.key.startsWith("media/v5/")) {
        const parts = obj.key.split("/");
        const courseId = parts[2];
        if (courseId) {
          if (!r2ObjectsByCourseId.has(courseId)) r2ObjectsByCourseId.set(courseId, []);
          r2ObjectsByCourseId.get(courseId).push(obj);
        }
      }
    }
  }

  // Group DB assets by course
  // An asset belongs to a course if its r2_object_key starts with media/v5/<courseId>/
  // or it is linked via v5_post_assets
  const dbAssetsByCourseId = new Map();
  for (const asset of allDbAssets) {
    const key = clean(asset.r2_object_key);
    let matchedCourseId = null;
    if (key.startsWith("media/v5/")) {
      const parts = key.split("/");
      matchedCourseId = parts[2];
    }
    if (!matchedCourseId && assetCourseOwnership.has(asset.id)) {
      const owners = [...assetCourseOwnership.get(asset.id)];
      if (owners.length === 1) matchedCourseId = owners[0];
    }
    if (matchedCourseId) {
      if (!dbAssetsByCourseId.has(matchedCourseId)) dbAssetsByCourseId.set(matchedCourseId, []);
      dbAssetsByCourseId.get(matchedCourseId).push(asset);
    }
  }

  // 3. Compute per-course metrics
  const coursesReport = courseList.map(course => {
    const cId = course.id;
    const cSlug = course.slug;
    const config = configsByCourse.get(cId) || null;
    const releases = releasesByCourse.get(cId) || [];
    
    // Deduplicate orders and enrollments by id
    const ordersList = [];
    const seenOrders = new Set();
    for (const o of (ordersByCourse.get(cId) || []).concat(ordersByCourse.get(cSlug) || [])) {
      if (!seenOrders.has(o.id)) {
        seenOrders.add(o.id);
        ordersList.push(o);
      }
    }

    const enrollList = [];
    const seenEnroll = new Set();
    for (const e of (enrollByCourse.get(cId) || []).concat(enrollByCourse.get(cSlug) || [])) {
      if (!seenEnroll.has(e.id)) {
        seenEnroll.add(e.id);
        enrollList.push(e);
      }
    }

    const jobs = jobsByCourse.get(cId) || [];
    const uploads = uploadsByCourse.get(cId) || [];
    const v4Sources = v4BySlug.get(cSlug) || [];
    const courseAssets = dbAssetsByCourseId.get(cId) || [];

    const otherCourseAssets = [];
    for (const [otherId, assets] of dbAssetsByCourseId.entries()) {
      if (otherId !== cId) otherCourseAssets.push(...assets);
    }

    const courseAssetIds = new Set(courseAssets.map(a => a.id));

    // Cross-course shared reference identification
    const sharedPostAssets = [];
    for (const aId of courseAssetIds) {
      const owners = assetCourseOwnership.get(aId);
      if (owners) {
        for (const oId of owners) {
          if (oId !== cId) sharedPostAssets.push(aId);
        }
      }
    }

    const sharedSourceMappings = [];
    for (const aId of courseAssetIds) {
      const owners = sourceMappingAssetOwners.get(aId);
      if (owners) {
        for (const oId of owners) {
          if (oId !== cId) sharedSourceMappings.push(aId);
        }
      }
    }

    const sharedJobs = [];
    for (const aId of courseAssetIds) {
      const owners = jobAssetOwners.get(aId);
      if (owners) {
        for (const oId of owners) {
          if (oId !== cId) sharedJobs.push(aId);
        }
      }
    }

    const sharedUploadSessions = [];
    for (const aId of courseAssetIds) {
      const owners = uploadAssetOwners.get(aId);
      if (owners) {
        for (const oId of owners) {
          if (oId !== cId) sharedUploadSessions.push(aId);
        }
      }
    }

    const sharedReleaseAssets = [];
    for (const aId of courseAssetIds) {
      const owners = releaseAssetOwners.get(aId);
      if (owners) {
        for (const oId of owners) {
          if (oId !== cId) sharedReleaseAssets.push(aId);
        }
      }
    }

    const sharedThumbnailAssets = [];
    for (const otherAsset of otherCourseAssets) {
      if (otherAsset.thumbnail_asset_id && courseAssetIds.has(otherAsset.thumbnail_asset_id)) {
        sharedThumbnailAssets.push(otherAsset.thumbnail_asset_id);
      }
    }
    for (const a of courseAssets) {
      if (a.thumbnail_asset_id && !courseAssetIds.has(a.thumbnail_asset_id)) {
        // Thumbnail belongs to another course or is outside course
        sharedThumbnailAssets.push(a.thumbnail_asset_id);
      }
    }

    const r2Objs = r2ObjectsByCourseId.get(cId) || [];
    const actualR2Bytes = r2Verified ? r2Objs.reduce((sum, o) => sum + Number(o.size || 0), 0) : null;
    const actualR2Objects = r2Verified ? r2Objs.length : null;

    const dbTrackedBytesForCourse = courseAssets.reduce((sum, a) => sum + Number(a.bytes || 0), 0);
    const dbTrackedObjectsForCourse = courseAssets.length;

    const courseDbKeys = new Set(courseAssets.map(a => clean(a.r2_object_key)).filter(Boolean));
    let untrackedInsidePrefix = 0;
    if (r2Verified) {
      for (const obj of r2Objs) {
        if (!courseDbKeys.has(obj.key) && !activeUploadKeys.has(obj.key)) {
          untrackedInsidePrefix++;
        }
      }
    }

    let missingTrackedForCourse = 0;
    if (r2Verified) {
      for (const key of courseDbKeys) {
        if (!r2KeyMap.has(key)) {
          missingTrackedForCourse++;
        }
      }
    }

    // Breakdown jobs & uploads by status
    const jobsByStatus = {};
    for (const j of jobs) {
      const s = j.status || "unknown";
      jobsByStatus[s] = (jobsByStatus[s] || 0) + 1;
    }

    const uploadsByStatus = {};
    for (const u of uploads) {
      const s = u.status || "unknown";
      uploadsByStatus[s] = (uploadsByStatus[s] || 0) + 1;
    }

    // Eligibility check
    const { canDelete, blockedReasons } = evaluateCourseDeleteEligibility({
      course,
      config,
      releases,
      orders: ordersList,
      enrollments: enrollList,
      jobs,
      uploads,
      v4Sources,
      courseAssets,
      otherCourseAssets,
      r2ObjectsInNamespace: r2Objs,
      r2Verified,
      sharedPostAssets,
      sharedSourceMappings,
      sharedJobs,
      sharedUploadSessions,
      sharedReleaseAssets,
      sharedThumbnailAssets
    });

    const isCloneFactoryFixture = clean(course.slug).startsWith("__clone_factory_test")
      || clean(course.title).startsWith("__clone_factory_test")
      || course.raw_data?.test_fixture === true;

    return {
      courseId: cId,
      slug: cSlug,
      title: course.title || cSlug,
      actualR2Bytes,
      actualR2Objects,
      dbTrackedBytes: dbTrackedBytesForCourse,
      dbTrackedObjects: dbTrackedObjectsForCourse,
      reclaimableBytes: actualR2Bytes,
      untrackedObjectsInsideCoursePrefix: r2Verified ? untrackedInsidePrefix : null,
      missingTrackedObjects: r2Verified ? missingTrackedForCourse : null,
      active: Boolean(course.active),
      isPublished: Boolean(course.is_published),
      configStatus: config?.status || "none",
      orderCount: ordersList.length,
      enrollmentCount: enrollList.length,
      releaseCount: releases.length,
      jobsByStatus,
      uploadsByStatus,
      canDelete,
      blockedReasons,
      isCloneFactoryFixture,
      r2Verified,
      createdAt: course.created_at,
      updatedAt: course.updated_at
    };
  });

  // Sort courses by actualR2Bytes DESC (or dbTrackedBytes if r2 not verified)
  coursesReport.sort((a, b) => (b.actualR2Bytes ?? b.dbTrackedBytes) - (a.actualR2Bytes ?? a.dbTrackedBytes));

  const snapshotGb = r2Verified ? Number((v5Bytes / 1e9).toFixed(3)) : null;
  const freeTierGb = 10;
  const headroomGb = r2Verified ? Number(Math.max(0, freeTierGb - snapshotGb).toFixed(3)) : null;

  const result = {
    summary: {
      snapshotAt: new Date().toISOString(),
      r2Configured,
      r2Verified,
      r2Error,
      bucketBytes: r2Verified ? bucketBytes : null,
      bucketObjectCount: r2Verified ? r2Objects.length : null,
      v5Bytes: r2Verified ? v5Bytes : null,
      v5ObjectCount: r2Verified ? v5ObjectCount : null,
      dbTrackedBytes,
      dbTrackedObjectCount: dbTrackedKeysSet.size,
      orphanCandidateBytes: r2Verified ? orphanCandidateBytes : null,
      orphanCandidateObjects: r2Verified ? orphanCandidateObjects : null,
      missingTrackedObjects: r2Verified ? missingTrackedObjects : null,
      r2StandardFreeTierGbMonthReference: freeTierGb,
      currentSnapshotGb: snapshotGb,
      estimatedHeadroomGb: headroomGb,
      freeTierReferenceOnly: true,
      freeTierDisclaimer: "Ước tính theo snapshot hiện tại. Cloudflare tính storage theo GB-month, không phải quota ổ đĩa cố định."
    },
    courses: coursesReport
  };

  storageCache = {
    data: result,
    cachedAt: now
  };

  return { ...result, cached: false };
}
