import adminAuthHandler from "../../utils/lms-handlers/admin-auth.js";
import adminDriveAuthHandler from "../../utils/lms-handlers/admin-drive-auth.js";
import adminCoursesHandler from "../../utils/lms-handlers/admin-courses.js";
import adminLessonsHandler from "../../utils/lms-handlers/admin-lessons.js";
import adminStudentsHandler from "../../utils/lms-handlers/admin-students.js";
import adminEnrollmentsHandler from "../../utils/lms-handlers/admin-enrollments.js";
import adminUploadImageHandler from "../../utils/lms-handlers/admin-upload-image.js";
import adminUploadRecipeHandler from "../../utils/lms-handlers/admin-upload-recipe.js";
import adminBulkEnrollHandler from "../../utils/lms-handlers/admin-bulk-enroll.js";
import adminUploadGDriveVideoHandler from "../../utils/lms-handlers/admin-upload-gdrive-video.js";
import adminUploadMaterialHandler from "../../utils/lms-handlers/admin-upload-material.js";
import adminSyncDrivePermissionsHandler from "../../utils/lms-handlers/admin-sync-drive-permissions.js";
import adminRepairDriveHandler from "../../utils/lms-handlers/admin-repair-drive.js";
import adminDrivePermissionHandler from "../../utils/lms-handlers/admin-drive-permission.js";
import adminDriveHealthHandler from "../../utils/lms-handlers/admin-drive-health.js";
import adminDriveRetryHandler from "../../utils/lms-handlers/admin-drive-retry.js";
import adminVerifyMediaHandler from "../../utils/lms-handlers/admin-verify-media.js";
import adminStudentTraceHandler from "../../utils/lms-handlers/admin-student-trace.js";
import adminAccountSharingAlertsHandler from "../../utils/lms-handlers/admin-account-sharing-alerts.js";
import adminLearningModeHandler from "../../utils/lms-handlers/admin-learning-mode.js";
import adminV4SourceHandler from "../../utils/lms-handlers/admin-v4-source.js";
import adminV4EnrollmentsHandler from "../../utils/lms-handlers/admin-v4-enrollments.js";
import adminV4PrepublishHandler from "../../utils/lms-handlers/admin-v4-prepublish.js";
import adminV5ContentHandler from "../../utils/lms-handlers/admin-v5-content.js";
import adminV5UploadHandler from "../../utils/lms-handlers/admin-v5-upload.js";
import adminV5ReleaseHandler from "../../utils/lms-handlers/admin-v5-release.js";
import adminV5TelegramImportHandler from "../../utils/lms-handlers/admin-v5-telegram-import-scoped.js";
import adminV5CapabilitiesHandler from "../../utils/lms-handlers/admin-v5-capabilities.js";
import adminV5CreateCourseHandler from "../../utils/lms-handlers/admin-v5-create-course.js";
import adminV5TestCleanupHandler from "../../utils/lms-handlers/admin-v5-test-cleanup.js";
import adminV5PreviewAccessHandler from "../../utils/lms-handlers/admin-v5-preview-access.js";
import adminV5StorageHandler from "../../utils/lms-handlers/admin-v5-storage.js";
import adminV5CourseDeleteHandler from "../../utils/lms-handlers/admin-v5-course-delete.js";
import adminV5CourseRetirePurgeHandler from "../../utils/lms-handlers/admin-v5-course-retire-purge.js";
import { resolveRequestRoute } from "../../utils/agency-routing.js";
import {
  listAgencyOrders,
  approveAgencyOrder,
  refundAgencyOrder
} from "../../utils/agency-commerce.js";

export const config = { api: { bodyParser: { sizeLimit: "500mb" } } };

export default async function handler(req, res) {
  const { endpoint } = req.query || {};
  const options = req.__options || {};

  // M0D: Agency Admin requests must be dispatched before any legacy admin handler.
  // Unknown hosts fail closed; only explicitly allowlisted Legacy hosts can reach
  // the historical admin stack below.
  const routeDecision = await resolveRequestRoute(req, options);
  if (routeDecision.route === "DENY") {
    return res.status(routeDecision.status || 403).json({
      success: false,
      code: routeDecision.code,
      error: routeDecision.error
    });
  }

  if (routeDecision.route === "AGENCY") {
    res.setHeader("Cache-Control", "private, no-store");

    if (endpoint === "agency-orders") {
      if (req.method !== "GET") {
        return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed" });
      }
      const result = await listAgencyOrders(req, options);
      return res.status(result.status || (result.ok ? 200 : 400)).json({
        success: Boolean(result.ok),
        ...result
      });
    }

    if (endpoint === "agency-order-approve") {
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed" });
      }
      const orderId = String(req.body?.orderId || "").trim();
      if (!orderId) {
        return res.status(400).json({ success: false, code: "missing_order_id", error: "orderId is required." });
      }
      const result = await approveAgencyOrder(req, orderId, options);
      return res.status(result.status && typeof result.status === "number" ? result.status : (result.ok ? 200 : 400)).json({
        success: Boolean(result.ok),
        ...result
      });
    }

    if (endpoint === "agency-order-refund") {
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed" });
      }
      const orderId = String(req.body?.orderId || "").trim();
      const reason = String(req.body?.reason || "Customer refund").trim() || "Customer refund";
      if (!orderId) {
        return res.status(400).json({ success: false, code: "missing_order_id", error: "orderId is required." });
      }
      const result = await refundAgencyOrder(req, orderId, reason, options);
      return res.status(result.status && typeof result.status === "number" ? result.status : (result.ok ? 200 : 400)).json({
        success: Boolean(result.ok),
        ...result
      });
    }

    return res.status(404).json({
      success: false,
      code: "agency_admin_endpoint_not_found",
      error: "Requested endpoint is not supported on Agency Admin."
    });
  }

  // Explicit Legacy host only: preserve the historical admin behavior unchanged.
  if (endpoint === "auth") return adminAuthHandler(req, res);
  if (endpoint === "drive-auth" || endpoint === "drive-status") return adminDriveAuthHandler(req, res);
  if (endpoint === "courses") return adminCoursesHandler(req, res);
  if (endpoint === "lessons") return adminLessonsHandler(req, res);
  if (endpoint === "students") return adminStudentsHandler(req, res);
  if (endpoint === "enrollments") return adminEnrollmentsHandler(req, res);
  if (endpoint === "upload-image") return adminUploadImageHandler(req, res);
  if (endpoint === "upload-recipe") return adminUploadRecipeHandler(req, res);
  if (endpoint === "bulk-enroll") return adminBulkEnrollHandler(req, res);
  if (endpoint === "upload-gdrive-video") return adminUploadGDriveVideoHandler(req, res);
  if (endpoint === "upload-material") return adminUploadMaterialHandler(req, res);
  if (endpoint === "sync-drive-permissions") return adminSyncDrivePermissionsHandler(req, res);
  if (endpoint === "repair-drive") return adminRepairDriveHandler(req, res);
  if (endpoint === "drive-permission") return adminDrivePermissionHandler(req, res);
  if (endpoint === "drive-health") return adminDriveHealthHandler(req, res);
  if (endpoint === "drive-retry") return adminDriveRetryHandler(req, res);
  if (endpoint === "verify-media") return adminVerifyMediaHandler(req, res);
  if (endpoint === "student-trace") return adminStudentTraceHandler(req, res);
  if (endpoint === "account-sharing-alerts") return adminAccountSharingAlertsHandler(req, res);
  if (endpoint === "learning-mode") return adminLearningModeHandler(req, res);
  if (endpoint === "v4-source") return adminV4SourceHandler(req, res);
  if (endpoint === "v4-enrollments") return adminV4EnrollmentsHandler(req, res);
  if (endpoint === "v4-prepublish") return adminV4PrepublishHandler(req, res);
  if (endpoint === "v5-content") return adminV5ContentHandler(req, res);
  if (endpoint === "v5-upload") return adminV5UploadHandler(req, res);
  if (endpoint === "v5-release") return adminV5ReleaseHandler(req, res);
  if (endpoint === "v5-telegram-import") return adminV5TelegramImportHandler(req, res);
  if (endpoint === "v5-capabilities") return adminV5CapabilitiesHandler(req, res);
  if (endpoint === "v5-create-course") return adminV5CreateCourseHandler(req, res);
  if (endpoint === "v5-test-cleanup") return adminV5TestCleanupHandler(req, res);
  if (endpoint === "v5-preview-access") return adminV5PreviewAccessHandler(req, res);
  if (endpoint === "v5-storage") return adminV5StorageHandler(req, res);
  if (endpoint === "v5-course-delete") return adminV5CourseDeleteHandler(req, res);
  if (endpoint === "v5-course-retire-purge") return adminV5CourseRetirePurgeHandler(req, res);
  return res.status(404).json({ success: false, error: "LMS Admin Endpoint not found" });
}
