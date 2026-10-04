import crypto from "node:crypto";
import { extractAuthToken } from "./agency-auth.js";
import { parseRequestCookies } from "./cookie-utils.js";

function clean(value) {
  return String(value || "").trim();
}

function opaqueContext(kind, material) {
  const value = clean(material);
  if (!value) return "";
  return crypto
    .createHash("sha256")
    .update(`system-b-media-session-v1\n${kind}\n${value}`)
    .digest("base64url");
}

export function deriveAgencyMediaSessionContext(req) {
  const auth = extractAuthToken(req);
  if (!auth?.token || auth.isLegacy) return "";
  return opaqueContext("agency-supabase-access-token", auth.token);
}

export function deriveMainMediaSessionContext(req) {
  const lmsSessionId = clean(req?.headers?.["x-lms-session-id"]);
  const lmsDeviceId = clean(req?.headers?.["x-lms-device-id"]);
  if (lmsSessionId && lmsDeviceId) {
    return opaqueContext("main-verified-lms-session", `${lmsSessionId}\n${lmsDeviceId}`);
  }

  const cookies = parseRequestCookies(req);
  const courseSession = clean(cookies.course_session_token);
  if (courseSession) {
    return opaqueContext("main-course-session", courseSession);
  }

  return "";
}
