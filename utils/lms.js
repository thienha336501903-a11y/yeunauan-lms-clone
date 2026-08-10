import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import crypto from "crypto";

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const STUDENT_SESSION_COOKIE = "course_session_token";
const ADMIN_SESSION_COOKIE = "admin_session_token";

// Normalizes email string
export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Check if email is in ADMIN_EMAILS list
export function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  return getAdminEmails().includes(normalizeEmail(email));
}

// Session secrets
function sessionSecrets() {
  const secret = String(process.env.SESSION_SECRET || "").trim();
  return secret ? [secret] : [];
}

function sessionSecret() {
  const secret = sessionSecrets()[0];
  if (!secret) {
    throw new Error("SESSION_SECRET is required for LMS sessions");
  }
  return secret;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payloadBase64, secret = sessionSecret()) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadBase64)
    .digest("base64url");
}

// Student Sessions
export function createStudentSession(email) {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = { email: normalizeEmail(email), exp: expiresAt };
  const payloadBase64 = base64url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64);

  return {
    token: `${payloadBase64}.${signature}`,
    expiresAt
  };
}

export function verifyStudentSession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  const validSignature = sessionSecrets().some(secret => {
    const expectedSignature = signPayload(payloadBase64, secret);
    try {
      const a = Buffer.from(signature);
      const b = Buffer.from(expectedSignature);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });

  if (!validSignature) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
    if (!payload.email || !payload.exp) return null;
    if (Date.now() > Number(payload.exp)) return null;

    return {
      email: normalizeEmail(payload.email),
      expiresAt: Number(payload.exp)
    };
  } catch {
    return null;
  }
}

// Admin Sessions
export function createAdminSession(email) {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = { email: normalizeEmail(email), role: "admin", exp: expiresAt };
  const payloadBase64 = base64url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64);

  return {
    token: `${payloadBase64}.${signature}`,
    expiresAt
  };
}

export function verifyAdminSession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  const validSignature = sessionSecrets().some(secret => {
    const expectedSignature = signPayload(payloadBase64, secret);
    try {
      const a = Buffer.from(signature);
      const b = Buffer.from(expectedSignature);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });

  if (!validSignature) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
    if (!payload.email || !payload.exp || payload.role !== "admin") return null;
    if (Date.now() > Number(payload.exp)) return null;
    if (!isAdminEmail(payload.email)) return null;

    return {
      email: normalizeEmail(payload.email),
      expiresAt: Number(payload.exp)
    };
  } catch {
    return null;
  }
}

// Extract cookies
export function parseCookies(req) {
  const header = req.headers?.cookie || "";
  return header.split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
    return cookies;
  }, {});
}

// Get admin session from request
export function getAdminFromRequest(req) {
  const cookies = parseCookies(req);
  const token =
    req.body?.sessionToken ||
    req.query?.sessionToken ||
    (req.headers?.authorization || "").replace(/^Bearer\s+/i, "") ||
    cookies[ADMIN_SESSION_COOKIE];
  if (!token) return null;
  return verifyAdminSession(token);
}

// Google ID token verify
export async function verifyGoogleIdToken(credential) {
  if (!credential) return null;
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return normalizeEmail(payload?.email);
}

// Cookie Options helper
export function cookieOptions(maxAgeMs) {
  const parts = [
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

// Bunny Stream Token Signing
function extractIframeSrc(input) {
  const text = String(input || "").trim();
  const match = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ? match[1].trim() : text;
}

function parseBunnyVideoIdAndLibraryId(videoUrl) {
  let src = extractIframeSrc(videoUrl).replace(/&amp;/g, "&").trim();
  if (!src) return null;

  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, "");
    if (
      host !== "player.mediadelivery.net" &&
      host !== "iframe.mediadelivery.net" &&
      host !== "video.bunnycdn.com"
    ) {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const mode = parts[0];
    const libraryId = parts[1];
    const videoId = parts[2];

    if ((mode !== "embed" && mode !== "play") || !libraryId || !videoId) {
      return null;
    }
    return { libraryId, videoId };
  } catch {
    const match = src.match(/(?:player|iframe)\.mediadelivery\.net\/embed\/([^/]+)\/([^/?#]+)/);
    if (match) return { libraryId: match[1], videoId: match[2] };
    const matchPlay = src.match(/(?:player|iframe)\.mediadelivery\.net\/play\/([^/]+)\/([^/?#]+)/);
    if (matchPlay) return { libraryId: matchPlay[1], videoId: matchPlay[2] };
    return null;
  }
}

export function signBunnyEmbedUrl(videoUrl) {
  const parsed = parseBunnyVideoIdAndLibraryId(videoUrl);
  if (!parsed) {
    return {
      secureVideoUrl: videoUrl || "",
      videoProvider: "",
      videoAuthStatus: "not_bunny_embed"
    };
  }

  const { libraryId, videoId } = parsed;
  const normalizedVideoUrl = `https://player.mediadelivery.net/embed/${libraryId}/${videoId}`;
  const tokenKey = String(process.env.BUNNY_STREAM_TOKEN_KEY || "").trim();

  if (!tokenKey) {
    return {
      secureVideoUrl: "",
      videoProvider: "bunny_embed",
      videoAuthStatus: "missing_bunny_stream_token_key",
      normalizedVideoUrl
    };
  }

  const expires = Math.floor(Date.now() / 1000) + 600; // 10 minutes
  const token = crypto
    .createHash("sha256")
    .update(`${tokenKey}${videoId}${expires}`)
    .digest("hex");

  return {
    secureVideoUrl: `${normalizedVideoUrl}?token=${token}&expires=${expires}`,
    videoProvider: "bunny_embed",
    videoAuthStatus: "signed",
    normalizedVideoUrl,
    secureVideoExpiresAt: expires
  };
}

export function signMediaUrls(rawMediaUrlsStr) {
  const raw = rawMediaUrlsStr || "";
  if (!raw) return "";

  const tokenKey = String(process.env.BUNNY_STREAM_TOKEN_KEY || "").trim();

  return raw.split("\n").map(line => {
    const trimmed = line.trim();
    if (!trimmed) return "";

    const firstPipe = trimmed.indexOf("|");
    if (firstPipe === -1) return line;
    const secondPipe = trimmed.indexOf("|", firstPipe + 1);
    if (secondPipe === -1) return line;
    const thirdPipe = trimmed.indexOf("|", secondPipe + 1);

    const type = trimmed.slice(0, firstPipe).trim();
    const title = trimmed.slice(firstPipe + 1, secondPipe).trim();
    const rawUrl = (thirdPipe === -1 ? trimmed.slice(secondPipe + 1) : trimmed.slice(secondPipe + 1, thirdPipe)).trim();
    const captionPart = thirdPipe === -1 ? "" : trimmed.slice(thirdPipe + 1).trim();
    const captionSuffix = captionPart ? `|${captionPart}` : "";
    const url = extractIframeSrc(rawUrl).replace(/&amp;/g, "&").trim();

    if (type === "video") {
      if (
        url.includes("drive.google.com/file/d/") ||
        /drive\.google\.com\/open\?id=/.test(url) ||
        /drive\.google\.com\/uc\?id=/.test(url)
      ) {
        let fileId = "";
        let match = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
        if (match) fileId = match[1];
        else {
          match = url.match(/[?&]id=([^&#]+)/);
          if (match) fileId = match[1];
        }
        const previewUrl = fileId ? `https://drive.google.com/file/d/${fileId}/preview` : url;
        return `${type}|${title}|${previewUrl}${captionSuffix}`;
      }

      const parsed = parseBunnyVideoIdAndLibraryId(url);
      if (parsed) {
        const { libraryId, videoId } = parsed;
        if (url.includes("token=") && url.includes("expires=")) {
          return `${type}|${title}|${url}${captionSuffix}`;
        }
        if (!tokenKey) {
          const errorMessage = "Thieu BUNNY_STREAM_TOKEN_KEY nen khong ky duoc media";
          return `video|${title}|error:${errorMessage}${captionSuffix}`;
        }

        let queryParams = "";
        try {
          const urlObj = new URL(url);
          urlObj.searchParams.delete("token");
          urlObj.searchParams.delete("expires");
          const search = urlObj.search;
          if (search) queryParams = search.startsWith("?") ? search : "?" + search;
        } catch {
          const qIdx = url.indexOf("?");
          if (qIdx !== -1) {
            const searchParams = new URLSearchParams(url.slice(qIdx));
            searchParams.delete("token");
            searchParams.delete("expires");
            const searchStr = searchParams.toString();
            if (searchStr) queryParams = "?" + searchStr;
          }
        }

        const expires = Math.floor(Date.now() / 1000) + 600;
        const token = crypto
          .createHash("sha256")
          .update(`${tokenKey}${videoId}${expires}`)
          .digest("hex");

        const normalizedVideoUrl = `https://player.mediadelivery.net/embed/${libraryId}/${videoId}`;
        let secureUrl = `${normalizedVideoUrl}?token=${token}&expires=${expires}`;
        if (queryParams) {
          secureUrl = `${normalizedVideoUrl}${queryParams}&token=${token}&expires=${expires}`;
        }
        return `${type}|${title}|${secureUrl}${captionSuffix}`;
      }
    }
    return `${type}|${title}|${url}${captionSuffix}`;
  }).filter(Boolean).join("\n");
}

// Auto Enroll Logic when orders are approved
export async function autoEnroll(supabase, { email, courseSlug, name, phone, orderId }) {
  if (!email || !courseSlug) return;
  const cleanEmail = normalizeEmail(email);

  try {
    let studentId;
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (studentError) {
      console.error("Error checking student in autoEnroll:", studentError);
    }

    if (student) {
      studentId = student.id;
      await supabase
        .from("students")
        .update({
          full_name: name || undefined,
          phone: phone || undefined,
          updated_at: new Date().toISOString()
        })
        .eq("id", studentId);
    } else {
      const { data: newStudent, error: insertError } = await supabase
        .from("students")
        .insert({
          id: crypto.randomUUID(),
          email: cleanEmail,
          full_name: name || null,
          phone: phone || null,
          status: "active",
          updated_at: new Date().toISOString()
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("Error inserting student in autoEnroll:", insertError);
        return;
      }
      studentId = newStudent.id;
    }

    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("id")
      .eq("slug", courseSlug)
      .maybeSingle();

    const courseId = course?.id || null;

    const { data: existingEnrollment, error: enrollmentLookupError } = await supabase
      .from("student_enrollments")
      .select("id")
      .eq("email", cleanEmail)
      .eq("course_slug", courseSlug)
      .maybeSingle();

    if (enrollmentLookupError) {
      console.error("Error checking enrollment in autoEnroll:", enrollmentLookupError);
      return;
    }

    const enrollmentPayload = {
      student_id: studentId,
      course_id: courseId,
      course_slug: courseSlug,
      email: cleanEmail,
      status: "active",
      source_order_id: orderId || null,
      updated_at: new Date().toISOString()
    };

    const { error: enrollError } = existingEnrollment
      ? await supabase
          .from("student_enrollments")
          .update(enrollmentPayload)
          .eq("id", existingEnrollment.id)
      : await supabase
          .from("student_enrollments")
          .insert({ id: crypto.randomUUID(), ...enrollmentPayload });

    if (enrollError) {
      console.error("Error upserting enrollment in autoEnroll:", enrollError);
    } else {
      console.log(`AutoEnroll success: Enrolled ${cleanEmail} to ${courseSlug}`);
    }
  } catch (err) {
    console.error("Unexpected error in autoEnroll:", err);
  }
}

export function getDriveClientWithToken(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

export function getDocsClientWithToken(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.docs({ version: "v1", auth });
}

export async function getCourseDriveFolderId(supabase, courseSlug) {
  const { data } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", `${courseSlug}_gdrive_folder_id`)
    .maybeSingle();
  if (data) {
    const val = data.value;
    return (val && typeof val === "object" && val.val !== undefined) ? val.val : val;
  }
  try {
    const { data: course, error } = await supabase
      .from("courses")
      .select("drive_folder_id")
      .eq("slug", courseSlug)
      .maybeSingle();
    if (!error && course?.drive_folder_id) return course.drive_folder_id;
  } catch {
    // Older databases may not have courses.drive_folder_id yet.
  }
  return null;
}

export async function addDriveFolderPermission(accessToken, folderId, emailAddress) {
  if (!accessToken || !folderId || !emailAddress) return;
  const drive = getDriveClientWithToken(accessToken);
  try {
    await drive.permissions.create({
      fileId: folderId,
      requestBody: {
        role: "reader",
        type: "user",
        emailAddress: emailAddress
      },
      supportsAllDrives: true,
      sendNotificationEmail: false
    });
  } catch (err) {
    console.error(`[addDriveFolderPermission] Failed for ${emailAddress} on ${folderId}:`, err.message);
  }
}

export async function removeDriveFolderPermission(accessToken, folderId, emailAddress) {
  if (!accessToken || !folderId || !emailAddress) return;
  const drive = getDriveClientWithToken(accessToken);
  try {
    const listRes = await drive.permissions.list({
      fileId: folderId,
      fields: "permissions(id, emailAddress)",
      supportsAllDrives: true
    });
    const permissions = listRes.data.permissions || [];
    const matched = permissions.find(p => p.emailAddress && p.emailAddress.toLowerCase() === emailAddress.toLowerCase());
    if (matched) {
      await drive.permissions.delete({
        fileId: folderId,
        permissionId: matched.id,
        supportsAllDrives: true
      });
    }
  } catch (err) {
    console.error(`[removeDriveFolderPermission] Failed for ${emailAddress} on ${folderId}:`, err.message);
  }
}

export function sanitizeFolderName(name) {
  return String(name || "")
    .trim()
    .replace(/[/\\?%*:|"<>']/g, "-")
    .replace(/\s+/g, " ");
}

export async function getOrCreateFolder(drive, name, parentId = null) {
  const cleanName = sanitizeFolderName(name);
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${cleanName}' and trashed = false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  } else {
    query += ` and 'root' in parents`;
  }

  let files = [];
  try {
    const res = await drive.files.list({
      q: query,
      fields: "files(id, name)",
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    files = res.data.files || [];
  } catch {
    try {
      const res = await drive.files.list({
        q: query,
        fields: "files(id, name)",
        spaces: "drive"
      });
      files = res.data.files || [];
    } catch (fallbackErr) {
      throw new Error(`Không thể liệt kê thư mục Drive: ${fallbackErr.message}`);
    }
  }

  if (files.length > 0) return files[0].id;

  const fileMetadata = {
    name: cleanName,
    mimeType: "application/vnd.google-apps.folder"
  };
  if (parentId) fileMetadata.parents = [parentId];

  let folder;
  try {
    folder = await drive.files.create({
      requestBody: fileMetadata,
      fields: "id",
      supportsAllDrives: true
    });
  } catch {
    try {
      folder = await drive.files.create({
        requestBody: fileMetadata,
        fields: "id"
      });
    } catch (fallbackErr) {
      throw new Error(`Không thể tạo thư mục "${cleanName}": ${fallbackErr.message}`);
    }
  }

  return folder.data.id;
}

export async function resolveCourseFolderTree(drive, { course_slug, course_title, lesson_no, lesson_title, type }) {
  const culinaryLmsId = await getOrCreateFolder(drive, "Culinary LMS");
  const coursesId = await getOrCreateFolder(drive, "Courses", culinaryLmsId);
  
  const slugUpper = String(course_slug).toUpperCase().trim();
  const titleVal = String(course_title || slugUpper).trim();
  const courseFolderName = `${slugUpper} - ${titleVal}`;
  const courseFolderId = await getOrCreateFolder(drive, courseFolderName, coursesId);

  if (type === "course_folder") {
    return { courseFolderId, targetFolderId: courseFolderId };
  }

  if (type === "course_hero" || type === "course_poster" || type === "course_qr" || type === "course_other") {
    const courseAssetsId = await getOrCreateFolder(drive, "Course Assets", courseFolderId);
    let targetFolderName = "Other Course Images";
    if (type === "course_hero") targetFolderName = "Hero Images";
    else if (type === "course_poster") targetFolderName = "Poster Images";
    else if (type === "course_qr") targetFolderName = "QR Images";
    
    const targetFolderId = await getOrCreateFolder(drive, targetFolderName, courseAssetsId);
    return { courseFolderId, targetFolderId };
  }

  const lNo = String(lesson_no || "1").trim();
  const lTitle = String(lesson_title || "Untitled").trim();
  const lessonFolderName = `Lesson ${lNo} - ${lTitle}`;
  const lessonFolderId = await getOrCreateFolder(drive, lessonFolderName, courseFolderId);

  if (type === "main_video") {
    const targetFolderId = await getOrCreateFolder(drive, "Main Video", lessonFolderId);
    return { courseFolderId, targetFolderId };
  }

  if (type === "lesson_thumbnail" || type === "lesson_hero") {
    const mainImagesId = await getOrCreateFolder(drive, "Main Images", lessonFolderId);
    let targetFolderName = "Thumbnail Images";
    if (type === "lesson_hero") targetFolderName = "Hero Images";
    const targetFolderId = await getOrCreateFolder(drive, targetFolderName, mainImagesId);
    return { courseFolderId, targetFolderId };
  }

  if (type === "lesson_media_image" || type === "lesson_media" || type === "lesson_media_video" || type === "lesson_material") {
    const mediaId = await getOrCreateFolder(drive, "Media", lessonFolderId);
    let targetFolderName = "Images";
    if (type === "lesson_media_video") targetFolderName = "Videos";
    if (type === "lesson_material") targetFolderName = "Documents";
    const targetFolderId = await getOrCreateFolder(drive, targetFolderName, mediaId);
    return { courseFolderId, targetFolderId };
  }

  return { courseFolderId, targetFolderId: courseFolderId };
}

export async function saveCourseFolderId(supabase, courseSlug, folderId) {
  if (!courseSlug || !folderId) return;
  const slug = courseSlug.trim().toLowerCase();
  
  try {
    await supabase.from("site_config").upsert({
      key: `${slug}_gdrive_folder_id`,
      value: { val: folderId },
      updated_at: new Date().toISOString()
    }, { onConflict: "key" });
  } catch (err) {
    console.error(`[saveCourseFolderId] Failed to save to site_config:`, err.message);
  }

  try {
    const { data: course } = await supabase
      .from("courses")
      .select("raw_data")
      .eq("slug", courseSlug)
      .maybeSingle();
      
    if (course) {
      const rawData = course.raw_data || {};
      rawData.course_folder_id = folderId;
      await supabase
        .from("courses")
        .update({
          raw_data: rawData,
          updated_at: new Date().toISOString()
        })
        .eq("slug", courseSlug);
    }
  } catch (err) {
    console.error(`[saveCourseFolderId] Failed to save to courses:`, err.message);
  }

  try {
    const { error } = await supabase
      .from("courses")
      .update({
        drive_folder_id: folderId,
        drive_permission_mode: "folder",
        updated_at: new Date().toISOString()
      })
      .eq("slug", courseSlug);
    if (error) throw error;
  } catch (err) {
    console.warn(`[saveCourseFolderId] courses.drive_folder_id unavailable:`, err.message);
  }
}

export async function getCourseFolderIdOrDiscover(supabase, drive, courseSlug, courseTitle = "") {
  let folderId = await getCourseDriveFolderId(supabase, courseSlug);
  if (folderId) return folderId;

  try {
    const { data: course } = await supabase
      .from("courses")
      .select("raw_data, title")
      .eq("slug", courseSlug)
      .maybeSingle();
      
    if (course && course.raw_data && course.raw_data.course_folder_id) {
      folderId = course.raw_data.course_folder_id;
      await saveCourseFolderId(supabase, courseSlug, folderId);
      return folderId;
    }
    
    if (drive) {
      const title = courseTitle || course?.title || courseSlug.toUpperCase();
      const resolved = await resolveCourseFolderTree(drive, {
        course_slug: courseSlug,
        course_title: title,
        type: "course_folder"
      });
      if (resolved && resolved.courseFolderId) {
        folderId = resolved.courseFolderId;
        await saveCourseFolderId(supabase, courseSlug, folderId);
        return folderId;
      }
    }
  } catch (err) {
    console.error(`[getCourseFolderIdOrDiscover] Error:`, err.message);
  }
  return null;
}

export function getDriveFileId(url) {
  if (!url || typeof url !== "string") return null;
  const match1 = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (match1) return match1[1];
  const match2 = url.match(/[?&]id=([^&#]+)/);
  if (match2) return match2[1];
  
  const cleanId = url.trim();
  if (/^[a-zA-Z0-9_-]{25,50}$/.test(cleanId)) return cleanId;
  return null;
}

// ── Centralized Google Drive Client and Sync Enrollment functions ──────────────

export async function getGoogleDriveClient(supabase) {
  // 1. Service Account authentication
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    try {
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      const auth = new google.auth.JWT(
        creds.client_email,
        null,
        creds.private_key.replace(/\\n/g, '\n'),
        ['https://www.googleapis.com/auth/drive']
      );
      const tokenRes = await auth.getAccessToken();
      const accessToken = tokenRes.token || tokenRes;
      return { drive: google.drive({ version: "v3", auth }), isServiceAccount: true, accessToken };
    } catch (err) {
      console.error("Failed to initialize Service Account drive client:", err);
    }
  }

  // 2. OAuth Refresh Token authentication fallback
  const { data: configToken } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "google_drive_access_token")
    .maybeSingle();

  const { data: configRefresh } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "google_drive_refresh_token")
    .maybeSingle();

  const accessTokenVal = configToken?.value?.val;
  const expiresAt = configToken?.value?.expires_at || 0;
  const refreshToken = configRefresh?.value?.val;

  if (!refreshToken && !accessTokenVal) {
    throw new Error("Chưa kết nối Google Drive (thiếu Access/Refresh Token hoặc Service Account)");
  }

  // Check if token is still valid (5 mins buffer)
  if (accessTokenVal && expiresAt > Date.now() + 300000) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessTokenVal });
    return { drive: google.drive({ version: "v3", auth }), accessToken: accessTokenVal };
  }

  // Needs refresh
  if (!refreshToken) {
    throw new Error("Access Token hết hạn và thiếu Refresh Token. Vui lòng kết nối lại Google Drive.");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const tokenRes = await oauth2Client.getAccessToken();
  const newAccessToken = tokenRes.token;
  if (!newAccessToken) {
    throw new Error("Không thể làm mới Google Drive Access Token");
  }

  const newExpiresAt = Date.now() + 3500 * 1000;
  await supabase.from("site_config").upsert({
    key: "google_drive_access_token",
    value: { val: newAccessToken, expires_at: newExpiresAt },
    updated_at: new Date().toISOString()
  }, { onConflict: "key" });

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: newAccessToken });
  return { drive: google.drive({ version: "v3", auth }), accessToken: newAccessToken };
}

export async function addDriveFolderPermissionDirect(drive, folderId, emailAddress) {
  if (!drive || !folderId || !emailAddress) return;
  const res = await drive.permissions.create({
    fileId: folderId,
    requestBody: {
      role: "reader",
      type: "user",
      emailAddress: emailAddress
    },
    supportsAllDrives: true,
    sendNotificationEmail: false,
    fields: "id"
  });
  return res?.data?.id || null;
}

export async function removeDriveFolderPermissionDirect(drive, folderId, emailAddress) {
  if (!drive || !folderId || !emailAddress) return;
  const listRes = await drive.permissions.list({
    fileId: folderId,
    fields: "permissions(id, emailAddress)",
    supportsAllDrives: true
  });
  const permissions = listRes.data.permissions || [];
  const matched = permissions.find(p => p.emailAddress && p.emailAddress.toLowerCase() === emailAddress.toLowerCase());
  if (matched) {
    await drive.permissions.delete({
      fileId: folderId,
      permissionId: matched.id,
      supportsAllDrives: true
    });
  }
}

export async function writeDriveLog(supabase, { course_slug, folder_id, email, action, status, message, error_message = null, request_id = null }) {
  try {
    const cleanEmail = normalizeEmail(email);
    const course = await getCourseIdBySlug(supabase, course_slug);
    const isError = String(status || "").toLowerCase() === "failed" || String(status || "").toLowerCase() === "error";
    const now = new Date().toISOString();

    await supabase.from("drive_permission_logs").insert({
      course_slug,
      folder_id,
      drive_folder_id: folder_id,
      email: cleanEmail,
      student_email: cleanEmail,
      action,
      status,
      message,
      error_message: error_message || (isError ? message : null),
      course_id: course?.id || null,
      drive_admin_email: process.env.GOOGLE_CLIENT_EMAIL || null,
      request_id,
      time: now,
      created_at: now,
      updated_at: now
    });
  } catch (err) {
    console.error("Failed to write to drive_permission_logs:", err.message);
  }
}

function getDriveAdminEnvAccounts() {
  const accounts = [];
  for (let i = 1; i <= 3; i++) {
    const email = normalizeEmail(process.env[`DRIVE_ADMIN_${i}_EMAIL`]);
    const clientId = process.env[`DRIVE_ADMIN_${i}_CLIENT_ID`];
    const clientSecret = process.env[`DRIVE_ADMIN_${i}_CLIENT_SECRET`];
    const refreshToken = process.env[`DRIVE_ADMIN_${i}_REFRESH_TOKEN`];
    if (email && clientId && clientSecret && refreshToken) {
      accounts.push({
        slot: i,
        email,
        display_name: `Drive Admin ${i}`,
        clientId,
        clientSecret,
        refreshToken,
        status: "active",
        daily_share_count: 0
      });
    }
  }
  return accounts;
}

function createDriveClientFromAdmin(account) {
  const auth = new google.auth.OAuth2(account.clientId, account.clientSecret);
  auth.setCredentials({ refresh_token: account.refreshToken });
  return google.drive({ version: "v3", auth });
}

function extractDriveErrorCode(err) {
  return err?.errors?.[0]?.reason || err?.response?.data?.error || err?.code || "unknown";
}

function isDriveQuotaError(err) {
  const text = [
    err?.message,
    err?.code,
    err?.errors?.map(e => `${e.reason || ""} ${e.message || ""}`).join(" "),
    err?.response?.data ? JSON.stringify(err.response.data) : ""
  ].filter(Boolean).join(" ").toLowerCase();
  return [
    "ratelimit",
    "rate limit",
    "quota",
    "user_rate_limit",
    "userratelimitexceeded",
    "sharingratelimitexceeded",
    "dailylimitexceeded",
    "quotaexceeded"
  ].some(token => text.includes(token));
}

async function safeUpsertDriveAdminAccount(supabase, account, patch = {}) {
  try {
    const { error } = await supabase.from("drive_admin_accounts").upsert({
      email: account.email,
      display_name: account.display_name || `Drive Admin ${account.slot}`,
      status: patch.status || account.status || "active",
      last_used_at: patch.last_used_at || null,
      last_error: patch.last_error || null,
      last_error_at: patch.last_error_at || null,
      daily_share_count: patch.daily_share_count ?? account.daily_share_count ?? 0,
      updated_at: new Date().toISOString()
    }, { onConflict: "email" });
    if (error) throw error;
  } catch (err) {
    console.warn("[drive-admin-pool] drive_admin_accounts unavailable:", err.message);
  }
}

async function getDriveAdminPoolAccounts(supabase) {
  const envAccounts = getDriveAdminEnvAccounts();
  if (!envAccounts.length) return [];

  let dbByEmail = new Map();
  try {
    const { data } = await supabase
      .from("drive_admin_accounts")
      .select("email, display_name, status, daily_share_count, last_used_at, last_error, last_error_at");
    dbByEmail = new Map((data || []).map(row => [normalizeEmail(row.email), row]));
  } catch (err) {
    console.warn("[drive-admin-pool] Could not read drive_admin_accounts:", err.message);
  }

  const accounts = envAccounts.map(account => {
    const db = dbByEmail.get(account.email);
    return {
      ...account,
      display_name: db?.display_name || account.display_name,
      status: db?.status || account.status,
      daily_share_count: Number(db?.daily_share_count || 0),
      last_used_at: db?.last_used_at || null,
      last_error: db?.last_error || null,
      last_error_at: db?.last_error_at || null
    };
  });

  await Promise.all(accounts.map(account => safeUpsertDriveAdminAccount(supabase, account)));
  return accounts;
}

async function getDrivePoolCursor(supabase) {
  try {
    const { data } = await supabase
      .from("site_config")
      .select("value")
      .eq("key", "drive_admin_pool_cursor")
      .maybeSingle();
    return Number(data?.value?.val || 0) || 0;
  } catch {
    return 0;
  }
}

async function setDrivePoolCursor(supabase, cursor) {
  try {
    await supabase.from("site_config").upsert({
      key: "drive_admin_pool_cursor",
      value: { val: cursor },
      updated_at: new Date().toISOString()
    }, { onConflict: "key" });
  } catch (err) {
    console.warn("[drive-admin-pool] Could not save cursor:", err.message);
  }
}

async function orderDriveAdminsRoundRobin(supabase, accounts) {
  if (!accounts.length) return [];
  const cursor = await getDrivePoolCursor(supabase);
  const start = cursor % accounts.length;
  return [...accounts.slice(start), ...accounts.slice(0, start)];
}

async function advanceDrivePoolCursor(supabase, accounts, usedEmail) {
  const idx = accounts.findIndex(a => a.email === usedEmail);
  if (idx >= 0) {
    await setDrivePoolCursor(supabase, (idx + 1) % accounts.length);
  }
}

async function writeDrivePermissionLog(supabase, {
  email,
  courseSlug,
  courseId = null,
  folderId = null,
  adminEmail = null,
  permissionId = null,
  action = "create",
  status,
  errorCode = null,
  errorMessage = null,
  retryCount = 0,
  requestId = null
}) {
  const cleanEmail = normalizeEmail(email);
  const now = new Date().toISOString();
  let resolvedCourseId = courseId;
  if (!resolvedCourseId) {
    const course = await getCourseIdBySlug(supabase, courseSlug);
    resolvedCourseId = course?.id || null;
  }

  try {
    const { error } = await supabase.from("drive_permission_logs").insert({
      student_email: cleanEmail,
      email: cleanEmail,
      course_slug: courseSlug,
      course_id: resolvedCourseId,
      drive_folder_id: folderId,
      folder_id: folderId,
      drive_admin_email: adminEmail,
      permission_id: permissionId,
      action,
      status,
      error_code: errorCode,
      error_message: errorMessage,
      message: (status === "success" || status === "SUCCESS")
        ? (action === "create" ? "Cấp quyền Drive thành công" : "Thu hồi quyền Drive thành công")
        : (action === "create" ? "Cấp quyền Drive thất bại" : "Thu hồi quyền Drive thất bại"),
      retry_count: retryCount,
      last_retry_at: retryCount > 0 ? now : null,
      updated_at: now,
      request_id: requestId,
      time: now
    });
    if (error) throw error;
  } catch (err) {
    console.error("[writeDrivePermissionLog] First insert failed, falling back to legacy log wrapper:", err.message);
    await writeDriveLog(supabase, {
      course_slug: courseSlug,
      folder_id: folderId,
      email: cleanEmail,
      action,
      status: (status === "success" || status === "SUCCESS") ? "success" : "failed",
      message: (status === "success" || status === "SUCCESS")
        ? (action === "create" ? "Cấp quyền Drive thành công" : "Thu hồi quyền Drive thành công")
        : (action === "create" ? "Cấp quyền Drive thất bại" : "Thu hồi quyền Drive thất bại"),
      error_message: [adminEmail ? `Admin: ${adminEmail}` : "", errorMessage || status].filter(Boolean).join(" | "),
      request_id: requestId
    });
  }
}

async function safeUpdateEnrollmentDriveState(supabase, {
  email,
  courseSlug,
  status,
  adminEmail = null,
  permissionId = null,
  folderId = null,
  errorMessage = null,
  retryCount = null
}) {
  const payload = {
    drive_permission_status: status,
    drive_permission_admin_email: adminEmail,
    drive_permission_id: permissionId,
    drive_folder_id: folderId,
    drive_permission_error: errorMessage,
    drive_permission_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (retryCount !== null) payload.drive_permission_retry_count = retryCount;

  try {
    const { error } = await supabase
      .from("student_enrollments")
      .update(payload)
      .eq("email", normalizeEmail(email))
      .eq("course_slug", courseSlug);
    if (error) throw error;
  } catch (err) {
    console.warn("[drive-admin-pool] Could not update enrollment drive state:", err.message);
  }
}

async function getCourseIdBySlug(supabase, courseSlug) {
  try {
    const { data } = await supabase
      .from("courses")
      .select("id, title")
      .eq("slug", courseSlug)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

async function ensureAdminHasFolderAccess(supabase, folderId, adminEmail) {
  try {
    const { drive } = await getGoogleDriveClient(supabase);

    // 1. List permissions to check if the admin already has Editor or Owner access
    let existingPermissions = [];
    try {
      const listRes = await drive.permissions.list({
        fileId: folderId,
        fields: "permissions(id, emailAddress, role)",
        supportsAllDrives: true
      });
      existingPermissions = listRes.data.permissions || [];
    } catch (listErr) {
      console.warn(`[drive-admin-pool] Could not list permissions to check admin access:`, listErr.message);
    }

    const matched = existingPermissions.find(
      p => p.emailAddress && p.emailAddress.toLowerCase().trim() === adminEmail.toLowerCase().trim()
    );

    if (matched && (matched.role === "writer" || matched.role === "owner")) {
      // Admin already has Editor/Owner access, skip sharing API call!
      return;
    }

    // 2. Grant writer permission if not present, do not send email notification
    await drive.permissions.create({
      fileId: folderId,
      requestBody: {
        role: "writer",
        type: "user",
        emailAddress: adminEmail
      },
      supportsAllDrives: true,
      sendNotificationEmail: false
    });
    console.log(`[drive-admin-pool] Proactively shared folder ${folderId} with admin ${adminEmail} as Editor`);
  } catch (err) {
    console.warn(`[drive-admin-pool] Could not proactively share folder ${folderId} with admin ${adminEmail}:`, err.message);
  }
}

async function syncGoogleDrivePermissionWithAdminPool(supabase, { email, courseSlug, action }) {
  const cleanEmail = normalizeEmail(email);
  const actionName = action === "create" || action === "syncEnrollment" ? "create" : "revoke";
  const course = await getCourseIdBySlug(supabase, courseSlug);
  const accounts = await getDriveAdminPoolAccounts(supabase);
  const activeAccounts = accounts.filter(account => (account.status || "active") === "active");

  if (!activeAccounts.length) {
    const errorMsg = "Không có Gmail admin active trong Drive admin pool";
    await writeDrivePermissionLog(supabase, {
      email: cleanEmail,
      courseSlug,
      courseId: course?.id || null,
      action: actionName,
      status: "pending_retry",
      errorCode: "no_active_drive_admin",
      errorMessage: errorMsg
    });
    await addToDriveSyncQueue(supabase, { email: cleanEmail, course_slug: courseSlug, action: actionName, error: errorMsg });
    return { success: false, error: errorMsg, pendingRetry: true };
  }

  let folderId = await getCourseFolderIdOrDiscover(supabase, null, courseSlug);
  const orderedAccounts = await orderDriveAdminsRoundRobin(supabase, activeAccounts);
  let lastError = null;
  let attempt = 0;

  for (const account of orderedAccounts) {
    attempt++;
    let drive;
    try {
      drive = createDriveClientFromAdmin(account);
      if (!folderId) {
        folderId = await getCourseFolderIdOrDiscover(supabase, drive, courseSlug, course?.title || "");
      }
      if (!folderId) {
        throw new Error(`Thư mục khóa học chưa được cấu hình Drive cho slug: ${courseSlug}`);
      }

      // Proactively ensure the admin account has Editor/Writer access to the folder via main service account
      await ensureAdminHasFolderAccess(supabase, folderId, account.email);

      if (actionName === "create") {
        let existingPermissionId = null;
        try {
          const listRes = await drive.permissions.list({
            fileId: folderId,
            fields: "permissions(id, emailAddress)",
            supportsAllDrives: true
          });
          const permissions = listRes.data.permissions || [];
          existingPermissionId = permissions.find(
            p => p.emailAddress && p.emailAddress.toLowerCase().trim() === cleanEmail
          )?.id || null;
        } catch (listErr) {
          console.warn(`[drive-admin-pool] Could not list folder permissions with ${account.email}:`, listErr.message);
        }

        const permissionId = existingPermissionId || await addDriveFolderPermissionDirect(drive, folderId, cleanEmail);
        await safeUpsertDriveAdminAccount(supabase, account, {
          status: "active",
          last_used_at: new Date().toISOString(),
          daily_share_count: (account.daily_share_count || 0) + (existingPermissionId ? 0 : 1)
        });
        await advanceDrivePoolCursor(supabase, activeAccounts, account.email);
        await writeDrivePermissionLog(supabase, {
          email: cleanEmail,
          courseSlug,
          courseId: course?.id || null,
          folderId,
          adminEmail: account.email,
          permissionId,
          action: actionName,
          status: "success",
          retryCount: attempt - 1
        });
        await safeUpdateEnrollmentDriveState(supabase, {
          email: cleanEmail,
          courseSlug,
          status: "success",
          adminEmail: account.email,
          permissionId,
          folderId,
          errorMessage: null,
          retryCount: attempt - 1
        });
        return { success: true, skipped: !!existingPermissionId, driveAdminEmail: account.email, folderId, permissionId };
      }

      await removeDriveFolderPermissionDirect(drive, folderId, cleanEmail);
      await safeUpsertDriveAdminAccount(supabase, account, {
        status: "active",
        last_used_at: new Date().toISOString()
      });
      await advanceDrivePoolCursor(supabase, activeAccounts, account.email);
      await writeDrivePermissionLog(supabase, {
        email: cleanEmail,
        courseSlug,
        courseId: course?.id || null,
        folderId,
        adminEmail: account.email,
        action: actionName,
        status: "success",
        retryCount: attempt - 1
      });
      await safeUpdateEnrollmentDriveState(supabase, {
        email: cleanEmail,
        courseSlug,
        status: "revoked",
        adminEmail: account.email,
        folderId,
        errorMessage: null,
        retryCount: attempt - 1
      });
      return { success: true, driveAdminEmail: account.email, folderId };
    } catch (err) {
      lastError = err;
      const quota = isDriveQuotaError(err);
      const errorMessage = err.message || "Lỗi Google Drive không xác định";
      const errorCode = extractDriveErrorCode(err);
      await safeUpsertDriveAdminAccount(supabase, account, {
        status: quota ? "quota_limited" : "error",
        last_error: errorMessage,
        last_error_at: new Date().toISOString()
      });
      await writeDrivePermissionLog(supabase, {
        email: cleanEmail,
        courseSlug,
        courseId: course?.id || null,
        folderId,
        adminEmail: account.email,
        action: actionName,
        status: quota ? "quota_limited" : "failed",
        errorCode,
        errorMessage,
        retryCount: attempt - 1
      });
      console.error(`[drive-admin-pool] ${account.email} failed for ${cleanEmail}/${courseSlug}:`, errorMessage);
    }
  }

  const finalError = lastError?.message || "Tất cả Gmail admin cấp quyền Drive đều lỗi";
  await safeUpdateEnrollmentDriveState(supabase, {
    email: cleanEmail,
    courseSlug,
    status: "pending_retry",
    folderId,
    errorMessage: finalError,
    retryCount: Math.max(0, attempt - 1)
  });
  await addToDriveSyncQueue(supabase, {
    email: cleanEmail,
    course_slug: courseSlug,
    action: actionName,
    error: finalError
  });
  return { success: false, error: finalError, pendingRetry: true, attempts: attempt };
}

export async function addToDriveSyncQueue(supabase, { email, course_slug, action, error }) {
  try {
    const cleanEmail = normalizeEmail(email);
    const { data: existing } = await supabase
      .from("drive_sync_queue")
      .select("id, attempts")
      .eq("email", cleanEmail)
      .eq("course_slug", course_slug)
      .eq("action", action)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("drive_sync_queue")
        .update({
          attempts: (existing.attempts || 0) + 1,
          error_message: error,
          updated_at: new Date().toISOString()
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("drive_sync_queue").insert({
        email: cleanEmail,
        course_slug,
        action,
        attempts: 1,
        error_message: error,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error("Failed to add to drive_sync_queue:", err.message);
  }
}

async function syncGoogleDrivePermissionLegacy(supabase, { email, courseSlug, action }) {
  const cleanEmail = normalizeEmail(email);
  const actionName = action === "create" || action === "syncEnrollment" ? "create" : "revoke";
  
  let driveClientInfo;
  let folderId = null;
  let attempt = 0;
  const maxAttempts = 3;
  let lastError = null;

  try {
    folderId = await getCourseFolderIdOrDiscover(supabase, null, courseSlug);
  } catch (err) {
    console.error(`[syncDrive] Failed to get folder ID for ${courseSlug}:`, err.message);
    lastError = err;
  }

  if (!folderId) {
    const errorMsg = `Thư mục khóa học chưa được cấu hình Drive cho slug: ${courseSlug}`;
    await writeDriveLog(supabase, {
      course_slug: courseSlug,
      folder_id: null,
      email: cleanEmail,
      action: actionName,
      status: "failed",
      message: actionName === "create" ? "Cấp quyền Drive thất bại" : "Thu hồi quyền Drive thất bại",
      error_message: errorMsg
    });
    await addToDriveSyncQueue(supabase, { email: cleanEmail, course_slug: courseSlug, action: actionName, error: errorMsg });
    return { success: false, error: errorMsg };
  }

  try {
    driveClientInfo = await getGoogleDriveClient(supabase);
  } catch (err) {
    const errorMsg = `Không khởi tạo được GDrive Client: ${err.message}`;
    console.error(`[syncDrive] ${errorMsg}`);
    await writeDriveLog(supabase, {
      course_slug: courseSlug,
      folder_id: folderId,
      email: cleanEmail,
      action: actionName,
      status: "failed",
      message: actionName === "create" ? "Cấp quyền Drive thất bại" : "Thu hồi quyền Drive thất bại",
      error_message: errorMsg
    });
    await addToDriveSyncQueue(supabase, { email: cleanEmail, course_slug: courseSlug, action: actionName, error: errorMsg });
    return { success: false, error: errorMsg };
  }

  const { drive } = driveClientInfo;

  while (attempt < maxAttempts) {
    try {
      if (actionName === "create") {
        let alreadyHasPermission = false;
        try {
          const listRes = await drive.permissions.list({
            fileId: folderId,
            fields: "permissions(id, emailAddress)",
            supportsAllDrives: true
          });
          const permissions = listRes.data.permissions || [];
          alreadyHasPermission = permissions.some(
            p => p.emailAddress && p.emailAddress.toLowerCase().trim() === cleanEmail
          );
        } catch (listErr) {
          console.warn(`[syncDrive] Failed to list permissions (attempt ${attempt + 1}):`, listErr.message);
        }

        if (alreadyHasPermission) {
          await writeDriveLog(supabase, {
            course_slug: courseSlug,
            folder_id: folderId,
            email: cleanEmail,
            action: actionName,
            status: "success",
            message: "Gmail đã được chia sẻ trước đó (bỏ qua)"
          });
          await safeUpdateEnrollmentDriveState(supabase, {
            email: cleanEmail,
            courseSlug,
            status: "success",
            folderId,
            errorMessage: null,
            retryCount: attempt
          });
          return { success: true, skipped: true };
        }

        await addDriveFolderPermissionDirect(drive, folderId, cleanEmail);
      } else {
        await removeDriveFolderPermissionDirect(drive, folderId, cleanEmail);
      }

      await writeDriveLog(supabase, {
        course_slug: courseSlug,
        folder_id: folderId,
        email: cleanEmail,
        action: actionName,
        status: "success",
        message: actionName === "create" ? "Cấp quyền Drive thành công" : "Thu hồi quyền Drive thành công"
      });
      await safeUpdateEnrollmentDriveState(supabase, {
        email: cleanEmail,
        courseSlug,
        status: actionName === "create" ? "success" : "revoked",
        folderId,
        errorMessage: null,
        retryCount: attempt
      });
      return { success: true };
    } catch (err) {
      attempt++;
      lastError = err;
      console.error(`[syncDrive] Attempt ${attempt} failed for ${cleanEmail} on ${courseSlug}:`, err.message);
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  const finalErrorMsg = lastError ? lastError.message : "Lỗi Google API không xác định";
  await writeDriveLog(supabase, {
    course_slug: courseSlug,
    folder_id: folderId,
    email: cleanEmail,
    action: actionName,
    status: "failed",
    message: actionName === "create" ? "Cấp quyền Drive thất bại" : "Thu hồi quyền Drive thất bại",
    error_message: `Thất bại sau 3 lần thử. Chi tiết: ${finalErrorMsg}`
  });

  await safeUpdateEnrollmentDriveState(supabase, {
    email: cleanEmail,
    courseSlug,
    status: "failed",
    folderId,
    errorMessage: finalErrorMsg,
    retryCount: attempt
  });

  await addToDriveSyncQueue(supabase, {
    email: cleanEmail,
    course_slug: courseSlug,
    action: actionName,
    error: finalErrorMsg
  });

  return { success: false, error: finalErrorMsg };
}

export async function syncGoogleDrivePermission(supabase, { email, courseSlug, action }) {
  const poolAccounts = getDriveAdminEnvAccounts();
  if (poolAccounts.length > 0) {
    return syncGoogleDrivePermissionWithAdminPool(supabase, { email, courseSlug, action });
  }
  return syncGoogleDrivePermissionLegacy(supabase, { email, courseSlug, action });
}

export async function syncEnrollment(supabase, { email, courseSlug, action, name = null, phone = null, orderId = null, expiredAt = null }) {
  if (!email || !courseSlug || !action) {
    throw new Error("Missing required parameters for syncEnrollment");
  }

  const cleanEmail = normalizeEmail(email);
  const normalizedAction = action === "create" || action === "syncEnrollment" ? "create" : "revoke";

  let enrollmentResult = null;

  if (normalizedAction === "create") {
    // 1. Get or create student
    let studentId;
    const { data: student, error: studentFetchErr } = await supabase
      .from("students")
      .select("id")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (studentFetchErr) throw studentFetchErr;

    if (student) {
      studentId = student.id;
      if (name || phone) {
        await supabase
          .from("students")
          .update({
            full_name: name || undefined,
            phone: phone || undefined,
            updated_at: new Date().toISOString()
          })
          .eq("id", studentId);
      }
    } else {
      const { data: newStudent, error: studentInsertErr } = await supabase
        .from("students")
        .insert({
          id: crypto.randomUUID(),
          email: cleanEmail,
          full_name: name || null,
          phone: phone || null,
          status: "active",
          updated_at: new Date().toISOString()
        })
        .select("id")
        .single();

      if (studentInsertErr) throw studentInsertErr;
      studentId = newStudent.id;
    }

    // 2. Fetch course ID by slug
    const { data: courseRec } = await supabase
      .from("courses")
      .select("id")
      .eq("slug", courseSlug.trim())
      .maybeSingle();

    // 3. Create or update enrollment without relying on a database conflict constraint.
    const normalizedCourseSlug = courseSlug.trim();
    const { data: existingEnrollment, error: enrollmentLookupError } = await supabase
      .from("student_enrollments")
      .select("id")
      .eq("email", cleanEmail)
      .eq("course_slug", normalizedCourseSlug)
      .maybeSingle();

    if (enrollmentLookupError) throw enrollmentLookupError;

    const enrollmentPayload = {
      student_id: studentId,
      course_id: courseRec?.id || null,
      course_slug: normalizedCourseSlug,
      email: cleanEmail,
      status: "active",
      expired_at: expiredAt || null,
      source_order_id: orderId || null,
      updated_at: new Date().toISOString()
    };

    const enrollmentWrite = existingEnrollment
      ? supabase
          .from("student_enrollments")
          .update(enrollmentPayload)
          .eq("id", existingEnrollment.id)
      : supabase
          .from("student_enrollments")
          .insert({ id: crypto.randomUUID(), ...enrollmentPayload });

    const { data, error: enrollErr } = await enrollmentWrite.select().single();

    if (enrollErr) throw enrollErr;
    enrollmentResult = data;
  } else {
    // Delete enrollment
    const { error: deleteErr } = await supabase
      .from("student_enrollments")
      .delete()
      .eq("email", cleanEmail)
      .eq("course_slug", courseSlug.trim());

    if (deleteErr) throw deleteErr;
  }

  // 4. Sync Google Drive permission (runs asynchronously so it doesn't block but is fully executed)
  const driveResult = await syncGoogleDrivePermission(supabase, {
    email: cleanEmail,
    courseSlug,
    action: normalizedAction
  });

  return {
    success: true,
    action: normalizedAction,
    enrollment: enrollmentResult,
    driveSync: driveResult
  };
}
