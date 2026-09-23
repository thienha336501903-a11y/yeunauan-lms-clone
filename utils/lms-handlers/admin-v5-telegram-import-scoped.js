import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";
import adminV5TelegramImportHandler, { computeMirrorProgress } from "./admin-v5-telegram-import.js";
import { assertV5CourseWritable } from "../v5-course-write-guard.js";

function clean(value) {
  return String(value || "").trim();
}

export function isBenchmarkMirrorJob(job) {
  const payload = job?.payload;
  return Boolean(
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload.benchmark === true
  );
}

export function productionMirrorJobs(jobs = []) {
  return (jobs || []).filter(job => !isBenchmarkMirrorJob(job));
}

async function requireAdmin(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin?.email) {
    res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
    return null;
  }
  return admin;
}

async function loadCourse(slugInput) {
  const slug = clean(slugInput);
  if (!slug) return null;
  const { data, error } = await supabase
    .from("courses")
    .select("id,slug,title")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getProductionTelegramMirrorStatus(courseId) {
  const { data: jobs, error: jobsErr } = await supabase
    .from("v5_jobs")
    .select("id,asset_id,job_type,status,payload,progress_current,progress_total,last_error,started_at,finished_at,created_at,updated_at")
    .eq("course_id", courseId)
    .eq("job_type", "telegram_mirror")
    .order("created_at", { ascending: true });
  if (jobsErr) throw jobsErr;

  const safeJobs = productionMirrorJobs(jobs || []);
  const assetIds = [...new Set(safeJobs.map(job => job.asset_id).filter(Boolean))];

  if (assetIds.length === 0) {
    return computeMirrorProgress({ jobs: safeJobs, assets: [] });
  }

  const { data: assets, error: assetsErr } = await supabase
    .from("v5_media_assets")
    .select("id,status,bytes,original_filename,last_error,r2_object_key")
    .in("id", assetIds);
  if (assetsErr) throw assetsErr;

  return computeMirrorProgress({ jobs: safeJobs, assets: assets || [] });
}

export async function retryFailedProductionTelegramMedia(courseId) {
  if (!courseId) throw new Error("course_id_required");

  const { data: failedJobRows, error: jobsErr } = await supabase
    .from("v5_jobs")
    .select("id,asset_id,status,job_type,attempts,max_attempts,payload")
    .eq("course_id", courseId)
    .eq("job_type", "telegram_mirror")
    .eq("status", "failed");

  if (jobsErr) throw jobsErr;
  const failedJobs = productionMirrorJobs(failedJobRows || []);
  if (failedJobs.length === 0) {
    return { retried: 0, jobIds: [], assetIds: [] };
  }

  const assetIds = [...new Set(failedJobs.map(job => job.asset_id).filter(Boolean))];
  if (assetIds.length === 0) {
    return { retried: 0, jobIds: [], assetIds: [] };
  }

  const { data: failedAssets, error: assetsErr } = await supabase
    .from("v5_media_assets")
    .select("id,origin,status")
    .in("id", assetIds)
    .eq("origin", "telegram")
    .eq("status", "failed");
  if (assetsErr) throw assetsErr;

  const validAssetIds = new Set((failedAssets || []).map(asset => asset.id));
  const targetJobs = failedJobs.filter(job => validAssetIds.has(job.asset_id));
  if (targetJobs.length === 0) {
    return { retried: 0, jobIds: [], assetIds: [] };
  }

  const targetJobIds = targetJobs.map(job => job.id);
  const targetAssetIdList = Array.from(validAssetIds);
  const nowIso = new Date().toISOString();

  const { error: updateAssetsErr } = await supabase
    .from("v5_media_assets")
    .update({
      status: "processing",
      last_error: null,
      updated_at: nowIso
    })
    .in("id", targetAssetIdList);
  if (updateAssetsErr) throw updateAssetsErr;

  const { error: updateJobsErr } = await supabase
    .from("v5_jobs")
    .update({
      status: "queued",
      attempts: 0,
      last_error: null,
      locked_at: null,
      locked_by: null,
      started_at: null,
      finished_at: null,
      available_at: nowIso,
      updated_at: nowIso
    })
    .eq("course_id", courseId)
    .in("id", targetJobIds);
  if (updateJobsErr) throw updateJobsErr;

  return {
    retried: targetJobs.length,
    jobIds: targetJobIds,
    assetIds: targetAssetIdList
  };
}

export default async function adminV5TelegramImportScopedHandler(req, res) {
  const action = clean(req.query?.action || req.body?.action);
  const isMirrorStatus = action === "mirror_status" || action === "status" || action === "telegramMirrorStatus";
  const isRetryFailed = action === "retry_failed_media" || action === "retry_failed";

  if (!isMirrorStatus && !isRetryFailed) {
    if (req.method === "POST") {
      try {
        const course = await loadCourse(req.query?.course || req.body?.course);
        if (course) await assertV5CourseWritable(course.id);
      } catch (error) {
        return res.status(error?.code === "v5_course_archived" ? 409 : 500).json({
          success: false,
          code: error?.code || "v5_telegram_write_guard_failed",
          error: error?.message || "Không thể xác minh trạng thái khóa V5."
        });
      }
    }
    return adminV5TelegramImportHandler(req, res);
  }

  res.setHeader("Cache-Control", "private, no-store");
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const course = await loadCourse(req.query?.course || req.body?.course);
    if (!course) return res.status(404).json({ success: false, error: "Không tìm thấy khóa học." });

    if (isMirrorStatus) {
      const result = await getProductionTelegramMirrorStatus(course.id);
      return res.status(200).json({ success: true, result, ...result, admin: admin.email });
    }

    await assertV5CourseWritable(course.id);
    const result = await retryFailedProductionTelegramMedia(course.id);
    return res.status(200).json({ success: true, result, retried: result.retried, admin: admin.email });
  } catch (error) {
    const label = isMirrorStatus ? "mirror-status" : "retry-failed";
    console.error(`[admin-v5-telegram-${label}]`, error);
    return res.status(500).json({
      success: false,
      error: isMirrorStatus
        ? (error?.message || "Lỗi lấy trạng thái mirror Telegram.")
        : (error?.message || "Lỗi thử lại media thất bại.")
    });
  }
}
