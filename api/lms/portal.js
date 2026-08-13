import courseDataHandler from "../../utils/lms-handlers/course-data.js";
import lessonHandler from "../../utils/lms-handlers/lesson.js";
import publicConfigHandler from "../../utils/lms-handlers/public-config.js";
import publicLessonHandler from "../../utils/lms-handlers/public-lesson.js";
import verifyEntryTokenHandler from "../../utils/lms-handlers/verify-entry-token.js";
import learningModeHandler from "../../utils/lms-handlers/learning-mode.js";
import v3BootstrapHandler from "../../utils/lms-handlers/v3-bootstrap.js";

export default async function handler(req, res) {
  const { endpoint } = req.query || {};

  if (endpoint === "course-data") {
    return courseDataHandler(req, res);
  }
  if (endpoint === "lesson") {
    return lessonHandler(req, res);
  }
  if (endpoint === "public-config") {
    return publicConfigHandler(req, res);
  }
  if (endpoint === "public-lesson") {
    return publicLessonHandler(req, res);
  }
  if (endpoint === "verify-entry-token") {
    return verifyEntryTokenHandler(req, res);
  }
  if (endpoint === "learning-mode") {
    return learningModeHandler(req, res);
  }
  if (endpoint === "v3-bootstrap") {
    return v3BootstrapHandler(req, res);
  }

  return res.status(404).json({ success: false, error: "LMS Portal Endpoint not found" });
}
