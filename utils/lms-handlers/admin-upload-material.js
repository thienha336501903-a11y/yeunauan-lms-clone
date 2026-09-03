import { PassThrough } from "stream";
import { getAdminFromRequest, getGoogleDriveClient, resolveCourseFolderTree, saveCourseFolderId } from "../lms.js";
import { supabase } from "../supabase.js";

const MAX_MATERIAL_BYTES = 50 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "doc", "docx",
  "xls", "xlsx",
  "ppt", "pptx",
  "txt",
  "jpg", "jpeg", "png", "webp", "gif"
]);

const EXTENSION_MIME = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif"
};

function bufferToStream(buffer) {
  const pass = new PassThrough();
  pass.end(buffer);
  return pass;
}

function getExtension(fileName = "") {
  return String(fileName || "").split(".").pop().toLowerCase().trim();
}

function cleanFileName(fileName = "document") {
  return String(fileName || "document").replace(/[/\\?%*:|"<>']/g, "-").trim() || `document_${Date.now()}`;
}

function decodeBase64Strict(value) {
  const compact = String(value || "").replace(/\s/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error("invalid_base64");
  }
  return Buffer.from(compact, "base64");
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
      return res.status(401).json({ success: false, error: "Chua dang nhap admin" });
    }

    const {
      fileData,
      fileName,
      mimeType,
      course_slug,
      course_title,
      lesson_no,
      lesson_title,
      course,
      courseTitle: courseTitleInput,
      lesson,
      title
    } = req.body || {};

    const courseSlug = String(course_slug || course || "").trim();
    const courseTitle = String(course_title || courseTitleInput || courseSlug.toUpperCase()).trim();
    const lessonNo = String(lesson_no || lesson || "1").trim();
    const lessonTitle = String(lesson_title || title || "Untitled").trim();

    if (!courseSlug) {
      return res.status(400).json({ success: false, error: "Thieu slug khoa hoc (course_slug)" });
    }

    if (!fileData || typeof fileData !== "string") {
      return res.status(400).json({ success: false, error: "Thieu du lieu tai lieu (fileData)" });
    }

    const ext = getExtension(fileName);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return res.status(400).json({
        success: false,
        error: "Dinh dang tai lieu khong duoc ho tro"
      });
    }

    let cleanBase64 = fileData;
    let mimeFromDataUrl = "";
    if (fileData.includes(";base64,")) {
      const parts = fileData.split(";base64,");
      const mimeMatch = parts[0].match(/data:([^;]+)/);
      if (mimeMatch) mimeFromDataUrl = mimeMatch[1];
      cleanBase64 = parts[1];
    }

    let buffer;
    try {
      buffer = decodeBase64Strict(cleanBase64);
    } catch {
      return res.status(400).json({ success: false, error: "Du lieu tai lieu base64 khong hop le" });
    }

    if (!buffer.byteLength) {
      return res.status(400).json({ success: false, error: "File tai lieu rong" });
    }

    if (buffer.byteLength > MAX_MATERIAL_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Tai lieu qua lon (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB). Toi da 50 MB.`
      });
    }

    let drive;
    try {
      const clientInfo = await getGoogleDriveClient(supabase);
      drive = clientInfo.drive;
    } catch (driveErr) {
      return res.status(200).json({
        success: false,
        needsOAuth: true,
        error: driveErr.message || "Chua ket noi Google Drive"
      });
    }

    const resolved = await resolveCourseFolderTree(drive, {
      course_slug: courseSlug,
      course_title: courseTitle || courseSlug.toUpperCase(),
      lesson_no: lessonNo,
      lesson_title: lessonTitle,
      type: "lesson_material"
    });

    if (resolved.courseFolderId) {
      await saveCourseFolderId(supabase, courseSlug, resolved.courseFolderId);
    }

    const finalFileName = cleanFileName(fileName || `document_${Date.now()}.${ext}`);
    const effectiveMime = EXTENSION_MIME[ext] || "application/octet-stream";
    const fileMetadata = {
      name: finalFileName,
      parents: [resolved.targetFolderId]
    };

    const driveFile = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: effectiveMime,
        body: bufferToStream(buffer)
      },
      fields: "id, webViewLink, webContentLink",
      supportsAllDrives: true
    });

    const fileId = driveFile?.data?.id;
    if (!fileId) {
      return res.status(500).json({ success: false, error: "Google API khong tra ve ID file" });
    }

    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
        supportsAllDrives: true
      });
    } catch (err) {
      console.warn("[admin-upload-material] Could not share file publicly:", err.message);
    }

    return res.status(200).json({
      success: true,
      material: {
        id: fileId,
        name: finalFileName,
        url: driveFile.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
        downloadUrl: driveFile.data.webContentLink || `https://drive.google.com/uc?export=download&id=${fileId}`,
        mimeType: effectiveMime,
        size: buffer.byteLength,
        source: "google_drive"
      }
    });
  } catch (err) {
    console.error("[admin-upload-material] Error:", err);
    return res.status(500).json({
      success: false,
      error: `Upload tai lieu that bai: ${err.message}`,
      message: err.message
    });
  }
}
