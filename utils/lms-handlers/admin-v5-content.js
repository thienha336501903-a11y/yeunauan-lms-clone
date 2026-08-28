import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";

const V5_STATUSES = new Set(["draft", "processing", "ready", "published", "archived"]);

function clean(value) {
  return String(value || "").trim();
}

async function requireAdmin(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin?.email) {
    res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
    return null;
  }
  return admin;
}

async function loadCourse(courseSlug) {
  const slug = clean(courseSlug);
  if (!slug) return null;
  const { data, error } = await supabase
    .from("courses")
    .select("id,slug,title,subtitle,image_url,active,is_published,delivery_mode")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function ensureConfig(course) {
  const { data: existing, error: readError } = await supabase
    .from("v5_course_configs")
    .select("*")
    .eq("course_id", course.id)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from("v5_course_configs")
    .insert({ course_id: course.id, source_mode: "direct", status: "draft" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function loadState(course) {
  const config = await ensureConfig(course);
  const [{ data: lessons, error: lessonError }, { data: posts, error: postError }] = await Promise.all([
    supabase.from("v5_lessons").select("*").eq("course_id", course.id).order("position", { ascending: true }),
    supabase.from("v5_posts").select("*").eq("course_id", course.id).order("position", { ascending: true })
  ]);
  if (lessonError) throw lessonError;
  if (postError) throw postError;

  const postIds = (posts || []).map(item => item.id);
  let links = [];
  let assets = [];
  if (postIds.length) {
    const { data: linkRows, error: linkError } = await supabase
      .from("v5_post_assets")
      .select("post_id,asset_id,position,role,metadata")
      .in("post_id", postIds)
      .order("position", { ascending: true });
    if (linkError) throw linkError;
    links = linkRows || [];
    const assetIds = [...new Set(links.map(item => item.asset_id).filter(Boolean))];
    if (assetIds.length) {
      const { data: assetRows, error: assetError } = await supabase
        .from("v5_media_assets")
        .select("id,type,provider,origin,r2_object_key,mime_type,original_filename,bytes,width,height,duration_ms,status,thumbnail_asset_id,metadata,last_error,uploaded_at")
        .in("id", assetIds);
      if (assetError) throw assetError;
      assets = assetRows || [];
    }
  }

  return { course, config, lessons: lessons || [], posts: posts || [], links, assets };
}

async function nextPosition(table, filters = {}) {
  let query = supabase.from(table).select("position").order("position", { ascending: false }).limit(1);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { data, error } = await query;
  if (error) throw error;
  return Number(data?.[0]?.position || 0) + 1000;
}

async function createLesson(course, body) {
  const title = clean(body.title) || "Bài học mới";
  const position = await nextPosition("v5_lessons", { course_id: course.id });
  const { data, error } = await supabase
    .from("v5_lessons")
    .insert({ course_id: course.id, title, position, status: "draft" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function createPost(course, body) {
  const lessonId = clean(body.lessonId) || null;
  if (lessonId) {
    const { data: lesson, error } = await supabase
      .from("v5_lessons")
      .select("id")
      .eq("id", lessonId)
      .eq("course_id", course.id)
      .maybeSingle();
    if (error) throw error;
    if (!lesson) throw new Error("Bài học không thuộc khóa này.");
  }
  const textContent = String(body.textContent || "").trim();
  const caption = String(body.caption || "").trim();
  const hasAttachments = body.hasAttachments === true;
  if (!textContent && !caption && !hasAttachments) throw new Error("Post cần có nội dung hoặc media.");
  const position = await nextPosition("v5_posts", { course_id: course.id });
  const { data, error } = await supabase
    .from("v5_posts")
    .insert({
      course_id: course.id,
      lesson_id: lessonId,
      position,
      text_content: textContent || null,
      caption: caption || null,
      origin: "direct",
      status: hasAttachments ? "processing" : "ready",
      metadata: hasAttachments ? { pending_attachments: true } : {}
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function updatePost(course, body) {
  const postId = clean(body.postId);
  if (!postId) throw new Error("Thiếu postId.");
  const patch = { updated_at: new Date().toISOString() };
  if (body.textContent !== undefined) patch.text_content = String(body.textContent || "").trim() || null;
  if (body.caption !== undefined) patch.caption = String(body.caption || "").trim() || null;
  if (body.lessonId !== undefined) patch.lesson_id = clean(body.lessonId) || null;
  if (body.status !== undefined) {
    const status = clean(body.status);
    if (!V5_STATUSES.has(status)) throw new Error("Trạng thái V5 không hợp lệ.");
    patch.status = status;
  }
  const { data, error } = await supabase
    .from("v5_posts")
    .update(patch)
    .eq("id", postId)
    .eq("course_id", course.id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Không tìm thấy Post.");
  return data;
}

async function deletePost(course, body) {
  const postId = clean(body.postId);
  if (!postId) throw new Error("Thiếu postId.");
  const { data: links, error: linkError } = await supabase
    .from("v5_post_assets")
    .select("asset_id")
    .eq("post_id", postId);
  if (linkError) throw linkError;
  if ((links || []).length) throw new Error("Post có media; hãy gỡ media trước khi xóa.");
  const { error } = await supabase.from("v5_posts").delete().eq("id", postId).eq("course_id", course.id);
  if (error) throw error;
  return { id: postId };
}

async function reorder(table, course, ids) {
  const safeIds = Array.isArray(ids) ? ids.map(clean).filter(Boolean) : [];
  if (!safeIds.length) return;
  const { data: rows, error } = await supabase.from(table).select("id").eq("course_id", course.id).in("id", safeIds);
  if (error) throw error;
  if ((rows || []).length !== safeIds.length) throw new Error("Danh sách sắp xếp chứa dữ liệu ngoài khóa học.");
  for (let index = 0; index < safeIds.length; index += 1) {
    const { error: tempError } = await supabase.from(table).update({ position: 1000000 + index, updated_at: new Date().toISOString() }).eq("id", safeIds[index]).eq("course_id", course.id);
    if (tempError) throw tempError;
  }
  for (let index = 0; index < safeIds.length; index += 1) {
    const { error: finalError } = await supabase.from(table).update({ position: (index + 1) * 1000, updated_at: new Date().toISOString() }).eq("id", safeIds[index]).eq("course_id", course.id);
    if (finalError) throw finalError;
  }
}

async function updateConfig(course, body) {
  // Content authoring must not own the learner-visible release lifecycle.
  // Published/Draft transitions and published_release_id are changed only by
  // the atomic V5 release handler/RPC. This keeps the current Published release
  // online while an admin authors the next draft.
  if (body.status !== undefined || body.publishedReleaseId !== undefined || body.published_release_id !== undefined) {
    const error = new Error("Lifecycle config V5 chỉ được thay đổi bằng Preflight / Publish / Rollback.");
    error.code = "v5_config_lifecycle_owned_by_release";
    throw error;
  }

  const patch = { updated_at: new Date().toISOString() };
  if (body.sourceMode !== undefined) {
    const sourceMode = clean(body.sourceMode);
    if (!["direct", "telegram", "hybrid"].includes(sourceMode)) throw new Error("sourceMode không hợp lệ.");
    patch.source_mode = sourceMode;
  }
  const { data, error } = await supabase.from("v5_course_configs").update(patch).eq("course_id", course.id).select("*").single();
  if (error) throw error;
  return data;
}

export default async function adminV5ContentHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const course = await loadCourse(req.query?.course || req.body?.course);
    if (!course) return res.status(404).json({ success: false, error: "Không tìm thấy khóa học." });
    if (req.method === "GET") {
      return res.status(200).json({ success: true, ...(await loadState(course)) });
    }
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

    const action = clean(req.body?.action);
    let result;
    if (action === "init") result = await ensureConfig(course);
    else if (action === "createLesson") result = await createLesson(course, req.body || {});
    else if (action === "createPost") result = await createPost(course, req.body || {});
    else if (action === "updatePost") result = await updatePost(course, req.body || {});
    else if (action === "deletePost") result = await deletePost(course, req.body || {});
    else if (action === "reorderLessons") { await reorder("v5_lessons", course, req.body?.ids); result = { reordered: true }; }
    else if (action === "reorderPosts") { await reorder("v5_posts", course, req.body?.ids); result = { reordered: true }; }
    else if (action === "updateConfig") result = await updateConfig(course, req.body || {});
    else return res.status(400).json({ success: false, error: "V5 action không hợp lệ." });

    return res.status(200).json({ success: true, result, state: await loadState(course), admin: admin.email });
  } catch (error) {
    console.error("[admin-v5-content]", error);
    const status = error?.code === "v5_config_lifecycle_owned_by_release" ? 409 : 500;
    return res.status(status).json({ success: false, code: error?.code || "v5_content_error", error: error?.message || "V5 server error" });
  }
}
