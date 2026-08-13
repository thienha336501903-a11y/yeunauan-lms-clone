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

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "500mb",
    },
  },
};

export default async function handler(req, res) {
  const { endpoint } = req.query || {};

  if (endpoint === "auth") {
    return adminAuthHandler(req, res);
  }
  if (endpoint === "drive-auth" || endpoint === "drive-status") {
    return adminDriveAuthHandler(req, res);
  }
  if (endpoint === "courses") {
    return adminCoursesHandler(req, res);
  }
  if (endpoint === "lessons") {
    return adminLessonsHandler(req, res);
  }
  if (endpoint === "students") {
    return adminStudentsHandler(req, res);
  }
  if (endpoint === "enrollments") {
    return adminEnrollmentsHandler(req, res);
  }
  if (endpoint === "upload-image") {
    return adminUploadImageHandler(req, res);
  }
  if (endpoint === "upload-recipe") {
    return adminUploadRecipeHandler(req, res);
  }
  if (endpoint === "bulk-enroll") {
    return adminBulkEnrollHandler(req, res);
  }
  if (endpoint === "upload-gdrive-video") {
    return adminUploadGDriveVideoHandler(req, res);
  }
  if (endpoint === "upload-material") {
    return adminUploadMaterialHandler(req, res);
  }
  if (endpoint === "sync-drive-permissions") {
    return adminSyncDrivePermissionsHandler(req, res);
  }
  if (endpoint === "repair-drive") {
    return adminRepairDriveHandler(req, res);
  }
  if (endpoint === "drive-permission") {
    return adminDrivePermissionHandler(req, res);
  }
  if (endpoint === "drive-health") {
    return adminDriveHealthHandler(req, res);
  }
  if (endpoint === "drive-retry") {
    return adminDriveRetryHandler(req, res);
  }
  if (endpoint === "verify-media") {
    return adminVerifyMediaHandler(req, res);
  }
  if (endpoint === "student-trace") {
    return adminStudentTraceHandler(req, res);
  }
  if (endpoint === "account-sharing-alerts") {
    return adminAccountSharingAlertsHandler(req, res);
  }

  return res.status(404).json({ success: false, error: "LMS Admin Endpoint not found" });
}
