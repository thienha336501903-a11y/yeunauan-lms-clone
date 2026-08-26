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
import healthHandler from "../../utils/lms-handlers/health.js";

export default async function handler(req, res) {
  const { endpoint } = req.query || {};

  if (endpoint === "health") return healthHandler(req, res);
  if (endpoint === "course-data") return courseDataHandler(req, res);
  if (endpoint === "lesson") return lessonHandler(req, res);
  if (endpoint === "public-config") return publicConfigHandler(req, res);
  if (endpoint === "public-lesson") return publicLessonHandler(req, res);
  if (endpoint === "verify-entry-token") return verifyEntryTokenHandler(req, res);
  if (endpoint === "learning-mode") return learningModeHandler(req, res);
  if (endpoint === "v3-bootstrap") return v3BootstrapHandler(req, res);
  if (endpoint === "student-dashboard") return studentDashboardHandler(req, res);
  if (endpoint === "legacy-entry-token") return legacyEntryTokenHandler(req, res);
  if (endpoint === "v4-course-intro") return v4CourseIntroHandler(req, res);
  if (endpoint === "v4-telegram-feed") return v4TelegramFeedHandler(req, res);
  if (endpoint === "v4-telegram-media") return v4TelegramMediaHandler(req, res);
  if (endpoint === "v4-telegram-play") return v4TelegramPlayHandler(req, res);
  if (endpoint === "v4-telegram-thumbnail") return v4TelegramThumbnailHandler(req, res);
  if (endpoint === "v4-telegram-warmup") return v4TelegramWarmupHandler(req, res);
  if (endpoint === "v5-feed") return v5FeedHandler(req, res);

  return res.status(404).json({ success: false, error: "LMS Portal Endpoint not found" });
}
