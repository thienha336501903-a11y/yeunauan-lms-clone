import crypto from "node:crypto";

export const TERMINAL_ORDER_STATUSES = new Set(["Đã duyệt", "Từ chối"]);
export const TERMINAL_JOB_STATUSES = new Set(["success", "failed", "cancelled", "canceled"]);
export const TERMINAL_UPLOAD_STATUSES = new Set(["completed", "aborted", "expired"]);

function clean(value) {
  return String(value || "").trim();
}

function sortedObject(input = {}) {
  return Object.keys(input).sort().reduce((acc, key) => {
    acc[key] = input[key];
    return acc;
  }, {});
}

export function computeRetirePlanHash({
  courseId,
  slug,
  courseUpdatedAt,
  active,
  isPublished,
  configStatus,
  publishedReleaseId,
  releaseIds = [],
  orderStatusCounts = {},
  enrollmentStatusCounts = {},
  jobStatusCounts = {},
  uploadStatusCounts = {},
  assetIds = [],
  registeredR2Keys = [],
  courseNamespace
}) {
  const payload = {
    courseId: clean(courseId),
    slug: clean(slug),
    courseUpdatedAt: clean(courseUpdatedAt),
    active: Boolean(active),
    isPublished: Boolean(isPublished),
    configStatus: clean(configStatus),
    publishedReleaseId: publishedReleaseId ? String(publishedReleaseId) : null,
    releaseIds: [...new Set(releaseIds.map(String))].sort(),
    orderStatusCounts: sortedObject(orderStatusCounts),
    enrollmentStatusCounts: sortedObject(enrollmentStatusCounts),
    jobStatusCounts: sortedObject(jobStatusCounts),
    uploadStatusCounts: sortedObject(uploadStatusCounts),
    assetIds: [...new Set(assetIds.map(String))].sort(),
    registeredR2Keys: [...new Set(registeredR2Keys.map(String))].sort(),
    courseNamespace: clean(courseNamespace)
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function evaluateRetirePurgeEligibility({
  course,
  config,
  orders = [],
  jobs = [],
  uploads = [],
  v4Sources = [],
  courseAssets = [],
  missingAssetRefs = [],
  sharedPostAssets = [],
  sharedSourceMappings = [],
  sharedJobs = [],
  sharedUploadSessions = [],
  sharedReleaseAssets = [],
  sharedThumbnailAssets = [],
  r2Configured = false,
  r2Verified = false
} = {}) {
  const blockedReasons = [];
  if (!course) blockedReasons.push("Không tìm thấy khóa học.");
  if (course && clean(course.delivery_mode).toLowerCase() !== "v5") {
    blockedReasons.push("Khóa không phải chế độ V5.");
  }
  if (!config) {
    blockedReasons.push("Thiếu cấu hình V5.");
  } else {
    const status = clean(config.status).toLowerCase();
    if (status !== "published") blockedReasons.push("Khóa phải đang ở trạng thái Published để bắt đầu Retire/Purge.");
    if (!config.published_release_id) blockedReasons.push("Khóa Published nhưng thiếu canonical published release.");
  }

  for (const order of orders) {
    if (!TERMINAL_ORDER_STATUSES.has(clean(order.status))) {
      blockedReasons.push(`Còn đơn hàng chưa terminal: ${clean(order.status) || "unknown"}.`);
      break;
    }
  }

  for (const job of jobs) {
    if (!TERMINAL_JOB_STATUSES.has(clean(job.status).toLowerCase())) {
      blockedReasons.push(`Còn V5 job chưa terminal: ${clean(job.status) || "unknown"}.`);
      break;
    }
  }

  const now = Date.now();
  for (const upload of uploads) {
    const status = clean(upload.status).toLowerCase();
    const expired = upload.expires_at && Date.parse(upload.expires_at) <= now;
    if (!TERMINAL_UPLOAD_STATUSES.has(status) && !expired) {
      blockedReasons.push(`Còn upload session đang hoạt động/không rõ trạng thái: ${clean(upload.status) || "unknown"}.`);
      break;
    }
  }

  if (v4Sources.length) blockedReasons.push("Khóa còn V4 legacy source mapping.");
  if (missingAssetRefs.length) blockedReasons.push("Release/content đang tham chiếu media asset không còn tồn tại.");

  const coursePrefix = course?.id ? `media/v5/${course.id}/` : "";
  if (coursePrefix && courseAssets.some(asset => !clean(asset.r2_object_key).startsWith(coursePrefix))) {
    blockedReasons.push("Có media asset nằm ngoài namespace UUID của khóa.");
  }

  if (sharedPostAssets.length) blockedReasons.push("Có media asset được post của khóa khác tham chiếu.");
  if (sharedSourceMappings.length) blockedReasons.push("Có media asset được source mapping của khóa khác tham chiếu.");
  if (sharedJobs.length) blockedReasons.push("Có media asset được job của khóa khác tham chiếu.");
  if (sharedUploadSessions.length) blockedReasons.push("Có media asset được upload session của khóa khác tham chiếu.");
  if (sharedReleaseAssets.length) blockedReasons.push("Có media asset được release của khóa khác tham chiếu.");
  if (sharedThumbnailAssets.length) blockedReasons.push("Có media asset được dùng làm thumbnail ngoài khóa.");

  if (!r2Configured) blockedReasons.push("R2 chưa được cấu hình.");
  else if (!r2Verified) blockedReasons.push("Không thể xác minh namespace R2.");

  return {
    eligible: blockedReasons.length === 0,
    blockedReasons
  };
}

export function statusCounts(rows = []) {
  const counts = {};
  for (const row of rows) {
    const status = clean(row?.status) || "unknown";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}
