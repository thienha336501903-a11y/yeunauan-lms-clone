import crypto from "node:crypto";
import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  headR2Object,
  isR2Configured,
  presignUploadPart
} from "../v5-r2.js";

const SESSION_TTL_MS = 60 * 60 * 1000;
const DEFAULT_PART_SIZE = 16 * 1024 * 1024;
const MIN_PART_SIZE = 5 * 1024 * 1024;
const MAX_FILE_BYTES = Number(process.env.V5_MAX_UPLOAD_BYTES || 8 * 1024 * 1024 * 1024);
const ALLOWED_TYPES = new Set(["image", "video", "document", "other"]);

function clean(value) {
  return String(value || "").trim();
}

function safeFileName(value) {
  const name = clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return (name || "file")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 160) || "file";
}

function assetTypeFromMime(mimeType, requestedType) {
  const type = clean(requestedType).toLowerCase();
  if (ALLOWED_TYPES.has(type)) return type;
  const mime = clean(mimeType).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf" || mime.includes("word") || mime.includes("excel") || mime.includes("spreadsheet") || mime.includes("zip")) return "document";
  return "other";
}

function validateUploadMetadata(body) {
  const filename = safeFileName(body?.filename);
  const mimeType = clean(body?.mimeType) || "application/octet-stream";
  const bytes = Number(body?.bytes || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error("Kích thước file không hợp lệ.");
  if (bytes > MAX_FILE_BYTES) throw new Error(`File vượt giới hạn ${MAX_FILE_BYTES} bytes.`);
  return { filename, mimeType, bytes, type: assetTypeFromMime(mimeType, body?.type) };
}

async function loadCourse(courseSlug) {
  const slug = clean(courseSlug);
  if (!slug) return null;
  const { data, error } = await supabase.from("courses").select("id,slug,title").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function requireAdmin(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin?.email) {
    res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
    return null;
  }
  return admin;
}

async function loadSession(sessionId, courseId) {
  const id = clean(sessionId);
  if (!id) throw new Error("Thiếu upload session.");
  const { data, error } = await supabase
    .from("v5_upload_sessions")
    .select("*,v5_media_assets(id,status,r2_object_key,bytes,mime_type,original_filename,type)")
    .eq("id", id)
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Upload session không tồn tại.");
  if (Date.parse(data.expires_at) <= Date.now() && !["completed", "aborted"].includes(data.status)) {
    await supabase.from("v5_upload_sessions").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", id);
    throw new Error("Upload session đã hết hạn.");
  }
  return data;
}

async function tryChecksumDedupe(course, body, meta) {
  const checksum = clean(body?.checksumSha256).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(checksum)) return null;
  const { data, error } = await supabase
    .from("v5_media_assets")
    .select("id,type,provider,origin,r2_object_key,mime_type,original_filename,bytes,status,checksum_sha256")
    .eq("checksum_sha256", checksum)
    .eq("bytes", meta.bytes)
    .eq("status", "ready")
    .eq("provider", "r2")
    .limit(1);
  if (error) throw error;
  const asset = data?.[0] || null;
  if (!asset) return null;

  const postId = clean(body?.postId);
  if (postId) {
    const { data: post, error: postError } = await supabase.from("v5_posts").select("id").eq("id", postId).eq("course_id", course.id).maybeSingle();
    if (postError) throw postError;
    if (!post) throw new Error("Post không thuộc khóa học này.");
    const { error: linkError } = await supabase.from("v5_post_assets").upsert({ post_id: postId, asset_id: asset.id, position: Number(body?.position || 0), role: clean(body?.role) || "attachment" }, { onConflict: "post_id,asset_id" });
    if (linkError) throw linkError;
  }
  return asset;
}

async function initUpload(course, admin, body) {
  if (!isR2Configured()) {
    const error = new Error("R2 chưa được cấu hình trên Vercel Preview/Production.");
    error.code = "r2_not_configured";
    throw error;
  }
  const meta = validateUploadMetadata(body);
  const duplicate = await tryChecksumDedupe(course, body, meta);
  if (duplicate) return { deduplicated: true, asset: duplicate };

  const assetId = crypto.randomUUID();
  const objectKey = `media/v5/${course.id}/${assetId}/${meta.filename}`;
  const checksum = clean(body?.checksumSha256).toLowerCase();
  const now = new Date().toISOString();
  const { data: asset, error: assetError } = await supabase
    .from("v5_media_assets")
    .insert({
      id: assetId,
      type: meta.type,
      provider: "r2",
      origin: "direct",
      r2_object_key: objectKey,
      mime_type: meta.mimeType,
      original_filename: meta.filename,
      bytes: meta.bytes,
      checksum_sha256: /^[0-9a-f]{64}$/.test(checksum) ? checksum : null,
      status: "uploading",
      upload_attempts: 1,
      updated_at: now
    })
    .select("*")
    .single();
  if (assetError) throw assetError;

  let multipart;
  try {
    multipart = await createMultipartUpload({ key: objectKey, contentType: meta.mimeType });
  } catch (error) {
    await supabase.from("v5_media_assets").update({ status: "failed", last_error: error.message, updated_at: new Date().toISOString() }).eq("id", assetId);
    throw error;
  }

  const partSize = Math.max(MIN_PART_SIZE, DEFAULT_PART_SIZE);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { data: session, error: sessionError } = await supabase
    .from("v5_upload_sessions")
    .insert({
      course_id: course.id,
      asset_id: assetId,
      admin_email: admin.email,
      provider_upload_id: multipart.uploadId,
      object_key: objectKey,
      status: "uploading",
      part_size: partSize,
      expected_bytes: meta.bytes,
      expires_at: expiresAt,
      metadata: { postId: clean(body?.postId) || null, role: clean(body?.role) || "attachment", position: Number(body?.position || 0) }
    })
    .select("*")
    .single();
  if (sessionError) {
    await abortMultipartUpload({ key: objectKey, uploadId: multipart.uploadId }).catch(() => {});
    await supabase.from("v5_media_assets").update({ status: "failed", last_error: sessionError.message }).eq("id", assetId);
    throw sessionError;
  }

  return {
    deduplicated: false,
    asset,
    session: { id: session.id, partSize, expiresAt, totalParts: Math.ceil(meta.bytes / partSize) }
  };
}

async function partUrl(course, body) {
  const session = await loadSession(body?.sessionId, course.id);
  if (session.status !== "uploading") throw new Error("Upload session không còn ở trạng thái uploading.");
  const partNumber = Number(body?.partNumber);
  const totalParts = Math.ceil(Number(session.expected_bytes || 0) / Number(session.part_size || DEFAULT_PART_SIZE));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalParts || partNumber > 10000) throw new Error("partNumber không hợp lệ.");
  const url = presignUploadPart({ key: session.object_key, uploadId: session.provider_upload_id, partNumber, expiresSeconds: 900 });
  return { sessionId: session.id, partNumber, url, expiresIn: 900 };
}

async function complete(course, body) {
  const session = await loadSession(body?.sessionId, course.id);
  if (session.status !== "uploading") {
    if (session.status === "completed") return { completed: true, assetId: session.asset_id, alreadyCompleted: true };
    throw new Error("Upload session không thể hoàn tất.");
  }
  const parts = Array.isArray(body?.parts) ? body.parts : [];
  const expectedParts = Math.ceil(Number(session.expected_bytes || 0) / Number(session.part_size || DEFAULT_PART_SIZE));
  if (parts.length !== expectedParts) throw new Error(`Thiếu multipart parts: cần ${expectedParts}, nhận ${parts.length}.`);
  const uniqueParts = new Set(parts.map(part => Number(part.partNumber)));
  if (uniqueParts.size !== expectedParts) throw new Error("Danh sách multipart parts bị trùng hoặc thiếu.");

  await completeMultipartUpload({ key: session.object_key, uploadId: session.provider_upload_id, parts });
  const head = await headR2Object({ key: session.object_key });
  if (!head) throw new Error("Không tìm thấy object sau khi complete.");
  if (Number(session.expected_bytes || 0) && Number(head.bytes || 0) !== Number(session.expected_bytes)) {
    throw new Error(`Kích thước object không khớp (${head.bytes}/${session.expected_bytes}).`);
  }

  const now = new Date().toISOString();
  const { data: asset, error: assetError } = await supabase
    .from("v5_media_assets")
    .update({ status: "ready", uploaded_at: now, last_verified_at: now, last_error: null, upload_id: null, updated_at: now })
    .eq("id", session.asset_id)
    .select("*")
    .single();
  if (assetError) throw assetError;

  const postId = clean(session.metadata?.postId || body?.postId);
  if (postId) {
    const { data: post, error: postError } = await supabase.from("v5_posts").select("id").eq("id", postId).eq("course_id", course.id).maybeSingle();
    if (postError) throw postError;
    if (!post) throw new Error("Post nhận media không thuộc khóa học này.");
    const { error: linkError } = await supabase.from("v5_post_assets").upsert({ post_id: postId, asset_id: asset.id, position: Number(session.metadata?.position || 0), role: clean(session.metadata?.role) || "attachment" }, { onConflict: "post_id,asset_id" });
    if (linkError) throw linkError;
    const { error: postUpdateError } = await supabase.from("v5_posts").update({ status: "ready", updated_at: now }).eq("id", postId).eq("course_id", course.id);
    if (postUpdateError) throw postUpdateError;
  }

  const { error: sessionUpdateError } = await supabase.from("v5_upload_sessions").update({ status: "completed", completed_at: now, updated_at: now }).eq("id", session.id);
  if (sessionUpdateError) throw sessionUpdateError;
  await supabase.from("v5_jobs").insert({ course_id: course.id, asset_id: asset.id, job_type: "media_probe", status: "queued", payload: { reason: "direct_upload_complete" } });
  return { completed: true, asset, object: head };
}

async function abort(course, body) {
  const session = await loadSession(body?.sessionId, course.id);
  if (["completed", "aborted"].includes(session.status)) return { aborted: session.status === "aborted", status: session.status };
  await abortMultipartUpload({ key: session.object_key, uploadId: session.provider_upload_id });
  const now = new Date().toISOString();
  await Promise.all([
    supabase.from("v5_upload_sessions").update({ status: "aborted", updated_at: now }).eq("id", session.id),
    supabase.from("v5_media_assets").update({ status: "failed", last_error: "Upload aborted by admin", updated_at: now }).eq("id", session.asset_id)
  ]);
  return { aborted: true };
}

export default async function adminV5UploadHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });
  try {
    const course = await loadCourse(req.query?.course || req.body?.course);
    if (!course) return res.status(404).json({ success: false, error: "Không tìm thấy khóa học." });
    const action = clean(req.body?.action);
    let result;
    if (action === "init") result = await initUpload(course, admin, req.body || {});
    else if (action === "partUrl") result = await partUrl(course, req.body || {});
    else if (action === "complete") result = await complete(course, req.body || {});
    else if (action === "abort") result = await abort(course, req.body || {});
    else return res.status(400).json({ success: false, error: "V5 upload action không hợp lệ." });
    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("[admin-v5-upload]", error);
    const status = error?.code === "r2_not_configured" ? 503 : 500;
    return res.status(status).json({ success: false, code: error?.code || "v5_upload_failed", error: error?.message || "V5 upload error" });
  }
}
