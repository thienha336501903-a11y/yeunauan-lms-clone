import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";

const MEDIA_TYPES = new Set(["photo", "video", "animation", "video_note", "document", "audio", "voice"]);
const LESSON_RE = /^\s*(?:bài|bai)\s*(\d{1,3})\s*(?:[:.\-–—]\s*)?(.*)$/i;

function clean(value) { return String(value || "").trim(); }

async function requireAdmin(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin?.email) {
    res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
    return null;
  }
  return admin;
}

async function loadCourse(slugInput) {
  const slug = clean(slugInput);
  const { data, error } = await supabase.from("courses").select("id,slug,title").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function preserveReleaseLifecycleWhileSelectingTelegram(courseId, sourceId) {
  const { data: existing, error: readError } = await supabase
    .from("v5_course_configs")
    .select("course_id,status,published_release_id,source_mode,telegram_source_id")
    .eq("course_id", courseId)
    .maybeSingle();
  if (readError) throw readError;

  if (existing) {
    const { data, error } = await supabase.from("v5_course_configs").update({
      source_mode: "telegram",
      telegram_source_id: sourceId,
      updated_at: new Date().toISOString()
    }).eq("course_id", courseId).select("course_id,status,published_release_id,source_mode,telegram_source_id").single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from("v5_course_configs").insert({
    course_id: courseId,
    source_mode: "telegram",
    status: "draft",
    telegram_source_id: sourceId,
    updated_at: new Date().toISOString()
  }).select("course_id,status,published_release_id,source_mode,telegram_source_id").single();
  if (error) throw error;
  return data;
}

function telegramMedia(row) {
  const raw = row.raw_message && typeof row.raw_message === "object" ? row.raw_message : {};
  if (row.message_type === "photo") {
    const list = Array.isArray(raw.photo) ? raw.photo : [];
    const item = list[list.length - 1] || null;
    if (!item && !raw.from_reader) return null;
    return {
      type: "image",
      mimeType: "image/jpeg",
      filename: `telegram-${row.source_message_id}.jpg`,
      bytes: Number(item?.file_size || 0),
      width: Number(item?.width || 0),
      height: Number(item?.height || 0),
      durationMs: null,
      telegram: { messageType: row.message_type, fileId: clean(item?.file_id), mtproto: Boolean(item?.mtproto || raw.from_reader) }
    };
  }
  const key = row.message_type === "video_note" ? "video_note" : row.message_type;
  const item = raw[key] && typeof raw[key] === "object" ? raw[key] : null;
  if (!item && !raw.from_reader) return null;
  let type = "other";
  if (["video", "animation", "video_note"].includes(row.message_type)) type = "video";
  else if (row.message_type === "document") type = "document";
  const ext = type === "video" ? ".mp4" : "";
  return {
    type,
    mimeType: clean(item?.mime_type) || (type === "video" ? "video/mp4" : "application/octet-stream"),
    filename: clean(item?.file_name) || `telegram-${row.source_message_id}${ext}`,
    bytes: Number(item?.file_size || 0),
    width: Number(item?.width || item?.length || 0),
    height: Number(item?.height || item?.length || 0),
    durationMs: item?.duration ? Number(item.duration) * 1000 : null,
    telegram: { messageType: row.message_type, fileId: clean(item?.file_id), mtproto: Boolean(item?.mtproto || raw.from_reader) }
  };
}

function groupRows(rows) {
  const units = [];
  const byGroup = new Map();
  for (const row of rows) {
    const group = clean(row.media_group_id);
    if (group) {
      if (!byGroup.has(group)) {
        const unit = { key: `group:${group}`, group, rows: [] };
        byGroup.set(group, unit);
        units.push(unit);
      }
      byGroup.get(group).rows.push(row);
    } else {
      units.push({ key: `row:${row.id}`, group: "", rows: [row] });
    }
  }
  return units.sort((a, b) => Number(a.rows[0]?.source_message_id || 0) - Number(b.rows[0]?.source_message_id || 0));
}

function unitText(unit) {
  for (const row of unit.rows) {
    const text = clean(row.text || row.caption);
    if (text) return text;
  }
  return "";
}

async function nextPosition(table, courseId) {
  const { data, error } = await supabase.from(table).select("position").eq("course_id", courseId).order("position", { ascending: false }).limit(1);
  if (error) throw error;
  return Number(data?.[0]?.position || 0) + 1000;
}

async function createLesson(courseId, title) {
  const position = await nextPosition("v5_lessons", courseId);
  const { data, error } = await supabase.from("v5_lessons").insert({ course_id: courseId, title, position, status: "draft", metadata: { imported_from: "telegram" } }).select("*").single();
  if (error) throw error;
  return data;
}

async function ensureDefaultLesson(courseId) {
  const { data, error } = await supabase.from("v5_lessons").select("*").eq("course_id", courseId).eq("metadata->>import_default", "true").limit(1);
  if (error) throw error;
  if (data?.[0]) return data[0];
  const position = await nextPosition("v5_lessons", courseId);
  const { data: lesson, error: insertError } = await supabase.from("v5_lessons").insert({ course_id: courseId, title: "Nội dung khóa học", position, status: "draft", metadata: { imported_from: "telegram", import_default: "true" } }).select("*").single();
  if (insertError) throw insertError;
  return lesson;
}

async function loadExistingMappings(courseId, sourceId) {
  const { data, error } = await supabase.from("v5_source_mappings").select("source_message_row_id,post_id,asset_id").eq("course_id", courseId).eq("source_id", sourceId).eq("source_system", "telegram");
  if (error) throw error;
  return new Map((data || []).map(item => [item.source_message_row_id, item]));
}

async function importSource(course, sourceIdInput) {
  const sourceId = clean(sourceIdInput);
  if (!sourceId) throw new Error("Thiếu Telegram source_id.");
  const { data: source, error: sourceError } = await supabase.from("tgcloner_sources").select("id,title,username,chat_id,indexed_message_count").eq("id", sourceId).maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error("Không tìm thấy Telegram source.");

  // Selecting/importing a Telegram source is an authoring operation. Preserve
  // any current Published status + release pointer so existing learners stay on
  // the immutable release while the new Telegram draft is imported/mirrored.
  await preserveReleaseLifecycleWhileSelectingTelegram(course.id, sourceId);

  const { data: rows, error: rowsError } = await supabase
    .from("tgcloner_source_messages")
    .select("id,source_id,source_message_id,media_group_id,message_type,text,caption,raw_message,source_date,updated_at")
    .eq("source_id", sourceId)
    .order("source_message_id", { ascending: true })
    .limit(5000);
  if (rowsError) throw rowsError;

  const existing = await loadExistingMappings(course.id, sourceId);
  let currentLesson = null;
  let importedPosts = 0;
  let importedAssets = 0;
  let skippedRows = 0;
  const queuedMirrorAssets = [];

  for (const unit of groupRows(rows || [])) {
    const mappedRows = unit.rows.filter(row => existing.has(row.id));
    if (mappedRows.length === unit.rows.length) {
      skippedRows += unit.rows.length;
      continue;
    }
    if (mappedRows.length) throw new Error(`Media group ${unit.key} đang import dở từ lần trước; cần reconcile trước khi tiếp tục.`);

    const text = unitText(unit);
    const lessonMatch = text.match(LESSON_RE);
    const descriptors = unit.rows.map(row => ({ row, media: MEDIA_TYPES.has(row.message_type) ? telegramMedia(row) : null }));
    const hasMedia = descriptors.some(item => item.media);
    if (lessonMatch) {
      const number = lessonMatch[1];
      const suffix = clean(lessonMatch[2]);
      currentLesson = await createLesson(course.id, `Bài ${number}${suffix ? `: ${suffix}` : ""}`);
      if (!hasMedia && text.split(/\s+/).length <= 16) continue;
    }
    if (!currentLesson) currentLesson = await ensureDefaultLesson(course.id);

    const position = await nextPosition("v5_posts", course.id);
    const { data: post, error: postError } = await supabase.from("v5_posts").insert({
      course_id: course.id,
      lesson_id: currentLesson.id,
      position,
      text_content: text || null,
      origin: "telegram",
      origin_ref: { source_id: sourceId, message_row_ids: unit.rows.map(row => row.id), source_message_ids: unit.rows.map(row => row.source_message_id), media_group_id: unit.group || null },
      status: hasMedia ? "processing" : "ready",
      metadata: { imported_from: "telegram", source_title: source.title || source.username || "Telegram" }
    }).select("*").single();
    if (postError) throw postError;
    importedPosts += 1;

    let assetPosition = 0;
    for (const { row, media } of descriptors) {
      let asset = null;
      if (media) {
        const { data: assetRow, error: assetError } = await supabase.from("v5_media_assets").insert({
          type: media.type,
          provider: "telegram",
          origin: "telegram",
          telegram_source_id: sourceId,
          telegram_message_row_id: row.id,
          mime_type: media.mimeType,
          original_filename: media.filename,
          bytes: media.bytes || null,
          width: media.width || null,
          height: media.height || null,
          duration_ms: media.durationMs,
          status: "processing",
          metadata: { telegram: media.telegram, source_message_id: row.source_message_id, media_group_id: row.media_group_id || null }
        }).select("*").single();
        if (assetError) throw assetError;
        asset = assetRow;
        const { error: linkError } = await supabase.from("v5_post_assets").insert({ post_id: post.id, asset_id: asset.id, position: assetPosition * 1000, role: "attachment" });
        if (linkError) throw linkError;
        importedAssets += 1;
        queuedMirrorAssets.push(asset.id);
        assetPosition += 1;
      }
      const { error: mapError } = await supabase.from("v5_source_mappings").insert({
        course_id: course.id,
        source_system: "telegram",
        source_id: sourceId,
        source_message_row_id: row.id,
        source_message_id: row.source_message_id,
        media_group_id: row.media_group_id || null,
        post_id: post.id,
        asset_id: asset?.id || null
      });
      if (mapError) throw mapError;
    }
  }

  if (queuedMirrorAssets.length) {
    const jobs = queuedMirrorAssets.map(assetId => ({ course_id: course.id, asset_id: assetId, job_type: "telegram_mirror", status: "queued", payload: { source_id: sourceId } }));
    const { error: jobError } = await supabase.from("v5_jobs").insert(jobs);
    if (jobError) throw jobError;
  }

  return {
    source: { id: source.id, title: source.title || source.username || "Telegram", indexedMessageCount: source.indexed_message_count || 0 },
    totalRows: (rows || []).length,
    importedPosts,
    importedAssets,
    skippedRows,
    mirrorJobsQueued: queuedMirrorAssets.length
  };
}

export default async function adminV5TelegramImportHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });
  try {
    const course = await loadCourse(req.query?.course || req.body?.course);
    if (!course) return res.status(404).json({ success: false, error: "Không tìm thấy khóa học." });
    const action = clean(req.body?.action);
    if (action !== "import") return res.status(400).json({ success: false, error: "V5 Telegram action không hợp lệ." });
    return res.status(200).json({ success: true, result: await importSource(course, req.body?.sourceId), admin: admin.email });
  } catch (error) {
    console.error("[admin-v5-telegram-import]", error);
    return res.status(500).json({ success: false, error: error?.message || "V5 Telegram import error" });
  }
}
