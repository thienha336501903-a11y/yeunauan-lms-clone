import courseDataHandler from "../../utils/lms-handlers/course-data.js";
import lessonHandler from "../../utils/lms-handlers/lesson.js";
import publicConfigHandler from "../../utils/lms-handlers/public-config.js";
import publicLessonHandler from "../../utils/lms-handlers/public-lesson.js";
import verifyEntryTokenHandler from "../../utils/lms-handlers/verify-entry-token.js";
import learningModeHandler from "../../utils/lms-handlers/learning-mode.js";
import v3BootstrapHandler from "../../utils/lms-handlers/v3-bootstrap.js";
import studentDashboardHandler from "../../utils/lms-handlers/student-dashboard.js";
import legacyEntryTokenHandler from "../../utils/lms-handlers/legacy-entry-token.js";
import v4CourseIntroHandler from "../../utils/lms-handlers/v4-course-intro.js";
import v4TelegramFeedHandler from "../../utils/lms-handlers/v4-telegram-feed.js";
import v4TelegramMediaHandler from "../../utils/lms-handlers/v4-telegram-media.js";
import v4TelegramPlayHandler from "../../utils/lms-handlers/v4-telegram-play.js";
import v4TelegramThumbnailHandler from "../../utils/lms-handlers/v4-telegram-thumbnail.js";
import v4TelegramWarmupHandler from "../../utils/lms-handlers/v4-telegram-warmup.js";
import v5FeedHandler from "../../utils/lms-handlers/v5-feed.js";
import v5PlayHandler from "../../utils/lms-handlers/v5-play.js";
import v5CourseIntroHandler from "../../utils/lms-handlers/v5-course-intro.js";
import healthHandler from "../../utils/lms-handlers/health.js";
import {
  resolveRequestRoute,
  handleAgencyLearnerDashboard,
  handleAgencyV5Feed,
  handleAgencyV5Play,
  handleAgencyCourseIntro
} from "../../utils/agency-lms-bridge.js";

export default async function handler(req, res) {
  const { endpoint } = req.query || {};
  const options = req.__options || {};

  // Milestone B6: Strict explicit routing model (No fallback from unmapped Agency host to Legacy)
  const routeDecision = await resolveRequestRoute(req, options);
  if (routeDecision.route === "DENY") {
    return res.status(routeDecision.status || 403).json({
      success: false,
      code: routeDecision.code,
      error: routeDecision.error
    });
  }

  // Agency domain route: only allow Agency-authorized endpoints
  if (routeDecision.route === "AGENCY") {
    if (endpoint === "health") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        status: "ok",
        app: "ok",
        service: "yeunauan-lms-clone",
        tenant: {
          agencyId: routeDecision.tenant.agencyId,
          agencySlug: routeDecision.tenant.agencySlug,
          agencyName: routeDecision.tenant.agencyName,
          hostname: routeDecision.tenant.hostname
        }
      });
    }
    if (endpoint === "student-dashboard" || endpoint === "learner-dashboard") {
      return handleAgencyLearnerDashboard(req, res);
    }
    if (endpoint === "v5-feed") {
      return handleAgencyV5Feed(req, res);
    }
    if (endpoint === "v5-play") {
      return handleAgencyV5Play(req, res);
    }
    if (endpoint === "v5-course-intro") {
      return handleAgencyCourseIntro(req, res);
    }
    return res.status(404).json({
      success: false,
      code: "agency_endpoint_not_found",
      error: "Requested endpoint is not supported on Agency tenant domain."
    });
  }

  // Explicit Legacy Host Route: Continues to legacy LMS endpoints
  if (endpoint === "health") return healthHandler(req, res);
  if (endpoint === "course-data") return courseDataHandler(req, res);
  if (endpoint === "lesson") return lessonHandler(req, res);
  if (endpoint === "public-config") return publicConfigHandler(req, res);
  if (endpoint === "public-lesson") return publicLessonHandler(req, res);
  if (endpoint === "verify-entry-token") return verifyEntryTokenHandler(req, res);
  if (endpoint === "learning-mode") return learningModeHandler(req, res);
  if (endpoint === "v3-bootstrap") return v3BootstrapHandler(req, res);
  if (endpoint === "student-dashboard" || endpoint === "learner-dashboard") {
    return studentDashboardHandler(req, res);
  }
  if (endpoint === "legacy-entry-token") return legacyEntryTokenHandler(req, res);
  if (endpoint === "v4-course-intro") return v4CourseIntroHandler(req, res);
  if (endpoint === "v4-telegram-feed") return v4TelegramFeedHandler(req, res);
  if (endpoint === "v4-telegram-media") return v4TelegramMediaHandler(req, res);
  if (endpoint === "v4-telegram-play") return v4TelegramPlayHandler(req, res);
  if (endpoint === "v4-telegram-thumbnail") return v4TelegramThumbnailHandler(req, res);
  if (endpoint === "v4-telegram-warmup") return v4TelegramWarmupHandler(req, res);
  if (endpoint === "v5-feed") return v5FeedHandler(req, res);
  if (endpoint === "v5-play") return v5PlayHandler(req, res);
  if (endpoint === "v5-course-intro") return v5CourseIntroHandler(req, res);

  return res.status(404).json({ success: false, error: "LMS Portal Endpoint not found" });
}
