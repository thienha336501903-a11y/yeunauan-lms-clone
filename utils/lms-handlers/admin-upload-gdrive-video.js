import { PassThrough } from "stream";
import { getAdminFromRequest, getGoogleDriveClient, resolveCourseFolderTree, saveCourseFolderId } from "../lms.js";
import { supabase } from "../supabase.js";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB limit

const VIDEO_MIME_MAP = {
  "mp4":  "video/mp4",
  "m4v":  "video/mp4",
  "mov":  "video/quicktime",
  "qt":   "video/quicktime",
  "avi":  "video/mp4",
  "mkv":  "video/mp4",
  "webm": "video/webm",
  "wmv":  "video/mp4",
  "flv":  "video/mp4",
  "3gp":  "video/3gpp",
  "3g2":  "video/3gpp2",
  "mpeg": "video/mpeg",
  "mpg":  "video/mpeg",
  "ts":   "video/mp2t",
  "mts":  "video/mp2t",
  "m2ts": "video/mp2t",
  "ogv":  "video/ogg",
  "vob":  "video/mp4",
};

const MIME_TO_EXT = {
  "video/mp4":          "mp4",
  "video/quicktime":    "mov",
  "video/webm":         "webm",
  "video/3gpp":         "3gp",
  "video/3gpp2":        "3g2",
  "video/mpeg":         "mpg",
  "video/mp2t":         "ts",
  "video/ogg":          "ogv",
};

const DRIVE_FOLDER_MEDIA_TYPES = new Set([
  "main_video",
  "lesson_media_video",
  "lesson_media_image",
  "lesson_media",
  "lesson_material"
]);

function resolveFolderMediaType(mediaType) {
  const normalized = String(mediaType || "").trim();
  return DRIVE_FOLDER_MEDIA_TYPES.has(normalized) ? normalized : "lesson_media_video";
}

function resolveVideoMime(rawMimeFromBrowser, fileName) {
  let mime = (rawMimeFromBrowser || "").trim();

  const unacceptedMimes = [
    "video/x-matroska",
    "video/x-msvideo",
    "video/x-ms-wmv",
    "video/x-flv",
    "video/x-ms-vob",
    "video/x-generic"
  ];
  if (unacceptedMimes.includes(mime)) {
    mime = "video/mp4";
  }

  if (mime && mime.startsWith("video/") && mime !== "video/x-generic") {
    return mime;
  }

  const ext = String(fileName || "").split(".").pop().toLowerCase().trim();
  if (ext && VIDEO_MIME_MAP[ext]) {
    return VIDEO_MIME_MAP[ext];
  }

  return "video/mp4";
}

function bufferToStream(buffer) {
  const pass = new PassThrough();
  pass.end(buffer);
  return pass;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    const {
      action,
      fileData,
      fileName,
      mimeType,
      course_slug,
      course_title,
      lesson_no,
      lesson_title,
      media_type,
      accessToken
    } = req.body || {};

    let drive;
    try {
      const clientInfo = await getGoogleDriveClient(supabase);
      drive = clientInfo.drive;
    } catch (driveErr) {
      return res.status(200).json({ success: false, needsOAuth: true, error: driveErr.message || "Chưa kết nối Google Drive" });
    }

    if (!course_slug) {
      return res.status(400).json({ success: false, error: "Thiếu slug khóa học (course_slug)" });
    }

    // Direct frontend upload helper: resolve folder structure and return folderId.
    // The Telegram-style composer also uses this branch for images and documents,
    // so preserve the requested attachment type instead of forcing every file into Videos.
    if (action === "get-folder") {
      const resolved = await resolveCourseFolderTree(drive, {
        course_slug,
        course_title: course_title || course_slug.toUpperCase(),
        lesson_no: lesson_no || "1",
        lesson_title: lesson_title || "Untitled",
        type: resolveFolderMediaType(media_type)
      });

      if (resolved.courseFolderId) {
        await saveCourseFolderId(supabase, course_slug, resolved.courseFolderId);
      }

      return res.status(200).json({ success: true, folderId: resolved.targetFolderId });
    }

    if (!fileData || typeof fileData !== "string") {
      return res.status(400).json({ success: false, error: "Thiếu dữ liệu video (fileData)" });
    }

    let cleanBase64 = fileData;
    let mimeFromDataUrl = "";

    if (fileData.includes(";base64,")) {
      const parts = fileData.split(";base64,");
      const mimeMatch = parts[0].match(/data:([^;]+)/);
      if (mimeMatch) mimeFromDataUrl = mimeMatch[1];
      cleanBase64 = parts[1];
    }

    const effectiveMime = resolveVideoMime(mimeType || mimeFromDataUrl, fileName);
    
    let buffer;
    try {
      buffer = Buffer.from(cleanBase64, "base64");
    } catch {
      return res.status(400).json({ success: false, error: "Dữ liệu video base64 không hợp lệ" });
    }

    if (buffer.byteLength === 0) {
      return res.status(400).json({ success: false, error: "File video rỗng, không thể tải lên" });
    }

    if (buffer.byteLength > MAX_VIDEO_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Video quá lớn (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB). Tối đa 500 MB.`
      });
    }

    // Resolve directory tree in Google Drive
    const resolved = await resolveCourseFolderTree(drive, {
      course_slug,
      course_title: course_title || course_slug.toUpperCase(),
      lesson_no: lesson_no || "1",
      lesson_title: lesson_title || "Untitled",
      type: resolveFolderMediaType(media_type)
    });

    const targetFolderId = resolved.targetFolderId;
    if (resolved.courseFolderId) {
      await saveCourseFolderId(supabase, course_slug, resolved.courseFolderId);
    }

    const origExt = String(fileName || "").split(".").pop().toLowerCase().trim();
    const fallbackExt = MIME_TO_EXT[effectiveMime] || "mp4";
    const finalExt = origExt || fallbackExt;
    const finalFileName = fileName || `${media_type}_${Date.now()}.${finalExt}`;

    const fileMetadata = {
      name: finalFileName.replace(/[/\\?%*:|"<>']/g, "-"),
      parents: [targetFolderId],
      copyRequiresWriterPermission: true
    };

    let driveFile;
    try {
      driveFile = await drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: effectiveMime,
          body: bufferToStream(buffer)
        },
        fields: "id, webViewLink, webContentLink",
        supportsAllDrives: true
      });
    } catch (err) {
      console.warn("[upload-video] Upload with supportsAllDrives failed, retrying without...", err.message);
      try {
        driveFile = await drive.files.create({
          requestBody: fileMetadata,
          media: {
            mimeType: effectiveMime,
            body: bufferToStream(buffer)
          },
          fields: "id, webViewLink, webContentLink"
        });
      } catch (fallbackErr) {
        throw new Error(`Upload lên Drive thất bại: ${fallbackErr.message}`);
      }
    }

    const fileId = driveFile?.data?.id;
    if (!fileId) {
      return res.status(500).json({ success: false, error: "Google API không trả về ID file sau khi upload" });
    }

    return res.status(200).json({
      success: true,
      fileId,
      directUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
      webViewLink: driveFile.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`
    });

  } catch (err) {
    console.error("[admin-upload-gdrive-video] Error:", err);
    return res.status(500).json({
      success: false,
      error: `Upload thất bại: ${err.message}`,
      message: err.message
    });
  }
}
