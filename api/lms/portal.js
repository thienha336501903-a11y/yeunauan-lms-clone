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
import { bridgeGoogleAccessTokenToSupabaseSession } from "../../utils/agency-google-auth-bridge.js";
import {
  listAgencyHomework,
  submitAgencyHomework,
  gradeAgencyHomework
} from "../../utils/agency-homework.js";
import {
  listAgencyLessonProgress,
  upsertAgencyLessonProgress
} from "../../utils/agency-progress.js";

function clearLearnerCookies(res) {
  const cookies = ["sb-access-token", "course_session_token", "student_session_token"].map(
    name => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
  const existing = res.getHeader("Set-Cookie");
  if (!existing) res.setHeader("Set-Cookie", cookies);
  else if (Array.isArray(existing)) res.setHeader("Set-Cookie", [...existing, ...cookies]);
  else res.setHeader("Set-Cookie", [existing, ...cookies]);
}

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
    if (endpoint === "learner-logout") {
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed" });
      }
      clearLearnerCookies(res);
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json({ success: true });
    }

    // Public OAuth bootstrap config is required before a learner can authenticate
    // on an Agency host. It exposes only the public Google OAuth client ID.
    if (endpoint === "public-config") {
      return publicConfigHandler(req, res);
    }
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
      // The shared learner page authenticates the human with Google GIS.
      // Agency authorization itself remains Supabase-session-only: on the
      // Google callback request, exchange the verified Google identity for a
      // real Supabase session, then continue through requireAgencyMembership().
      if (req.method === "POST" && req.body?.accessToken) {
        const bridge = await bridgeGoogleAccessTokenToSupabaseSession(
          req,
          res,
          routeDecision.tenant,
          options
        );
        if (!bridge.ok) {
          return res.status(bridge.status || 401).json({
            success: false,
            code: bridge.code,
            error: bridge.error
          });
        }
      }
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
    if (endpoint === "agency-progress") {
      try {
        if (req.method === "GET") {
          const result = await listAgencyLessonProgress(req, req.query?.course, options);
          return res.status(result.status || (result.ok ? 200 : 400)).json({
            success: Boolean(result.ok),
            ...result
          });
        }
        if (req.method === "POST") {
          const result = await upsertAgencyLessonProgress(req, req.body || {}, options);
          return res.status(result.status || (result.ok ? 200 : 400)).json({
            success: Boolean(result.ok),
            ...result
          });
        }
        return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed" });
      } catch (error) {
        return res.status(error?.status || 500).json({
          success: false,
          code: error?.code || "agency_progress_failed",
          error: error?.message || "Unable to read or write Agency progress."
        });
      }
    }
        if (endpoint === "agency-homework-list") {
      if (req.method !== "GET") {
        return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed" });
      }
      try {
        const rows = await listAgencyHomework(req, {
          courseId: req.query?.courseId,
          canonicalLessonId: req.query?.lessonId || req.query?.canonicalLessonId,
          status: req.query?.status
        }, options);
        if (rows?.ok === false) {
          return res.status(rows.status || 403).json({ success: false, code: rows.code, error: rows.error });
        }
        return res.status(200).json({ success: true, submissions: rows || [] });
      } catch (error) {
        return res.status(error?.status || 500).json({
          success: false,
          code: error?.code || "agency_homework_list_failed",
          error: error?.message || "Unable to list Agency homework."
        });
      }
    }
    if (endpoint === "agency-homework-submit") {
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed" });
      }
      try {
        const result = await submitAgencyHomework(req, req.body || {}, options);
        if (result?.ok === false) {
          return res.status(result.status || 403).json({ success: false, code: result.code, error: result.error });
        }
        return res.status(200).json({ success: true, ...result });
      } catch (error) {
        return res.status(error?.status || 500).json({
          success: false,
          code: error?.code || "agency_homework_submit_failed",
          error: error?.message || "Unable to submit Agency homework."
        });
      }
    }
    if (endpoint === "agency-homework-grade") {
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed" });
      }
      try {
        const result = await gradeAgencyHomework(req, req.body || {}, options);
        if (result?.ok === false) {
          return res.status(result.status || 403).json({ success: false, code: result.code, error: result.error });
        }
        return res.status(200).json({ success: true, ...result });
      } catch (error) {
        return res.status(error?.status || 500).json({
          success: false,
          code: error?.code || "agency_homework_grade_failed",
          error: error?.message || "Unable to grade Agency homework."
        });
      }
    }
    return res.status(404).json({
      success: false,
      code: "agency_endpoint_not_found",
      error: "Requested endpoint is not supported on Agency tenant domain."
    });
  }

  // Explicit Main/compatibility route. Logout is intentionally cookie-only and
  // does not depend on the paused Legacy database.
  if (endpoint === "learner-logout") {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed" });
    }
    clearLearnerCookies(res);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ success: true });
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
