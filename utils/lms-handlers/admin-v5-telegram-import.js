import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";
import { ensureHiddenTimelineLesson } from "./admin-v5-content.js";
import {
  clean,
  planImport,
  unitSourceDate
} from "../v5-telegram-planner.js";

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
  if (!slug) return null;
  const { data, error } = await supabase.from("courses").select("id,slug,title").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadConfig(courseId) {
  const { data, error } = await supabase
    .from("v5_course_configs")
    .select("course_id,status,published_release_id,source_mode,telegram_source_id,settings")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function checkSourceBinding(courseId, sourceId) {
  // 1. Check existing v5_source_mappings
  const { data: mappings, error: mapErr } = await supabase
    .from("v5_source_mappings")
    .select("source_id")
    .eq("course_id", courseId)
    .eq("source_system", "telegram")
    .limit(1);
  if (mapErr) throw mapErr;
  if (mappings && mappings.length > 0 && mappings[0].source_id !== sourceId) {
    return { bound: true, boundSourceId: mappings[0].source_id };
  }

  // 2. Check existing lessons with telegram_source_id
  const { data: lessons, error: lErr } = await supabase
    .from("v5_lessons")
    .select("metadata")
    .eq("course_id", courseId)
    .eq("metadata->>imported_from", "telegram")
    .limit(1);
  if (lErr) throw lErr;
  if (lessons && lessons.length > 0) {
    const boundSource = lessons[0].metadata?.telegram_source_id;
    if (boundSource && boundSource !== sourceId) {
      return { bound: true, boundSourceId: boundSource };
    }
  }

  // 3. Check v5_course_configs
  const config = await loadConfig(courseId);
  if (config?.telegram_source_id && config.telegram_source_id !== sourceId && (mappings?.length > 0 || lessons?.length > 0)) {
    return { bound: true, boundSourceId: config.telegram_source_id };
  }

  return { bound: false };
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

function telegramThumbnail(row) {
  if (!["video", "animation", "video_note"].includes(row.message_type)) return null;
  const raw = row.raw_message && typeof row.raw_message === "object" ? row.raw_message : {};
  const key = row.message_type === "video_note" ? "video_note" : row.message_type;
  const item = raw[key] && typeof raw[key] === "object" ? raw[key] : null;
  const thumbnail = item?.thumbnail || item?.thumb || null;
  if (!thumbnail || (!clean(thumbnail.file_id) && !thumbnail.mtproto)) return null;
  return {
    type: "image",
    mimeType: "image/jpeg",
    filename: `telegram-${row.source_message_id}-thumbnail.jpg`,
    bytes: Number(thumbnail.file_size || 0),
    width: Number(thumbnail.width || thumbnail.w || 0),
    height: Number(thumbnail.height || thumbnail.h || 0),
    telegram: { messageType: row.message_type, fileId: clean(thumbnail.file_id), mtproto: Boolean(thumbnail.mtproto || raw.from_reader), variant: "thumbnail" }
  };
}

async function nextPosition(table, courseId) {
  const { data, error } = await supabase.from(table).select("position").eq("course_id", courseId).order("position", { ascending: false }).limit(1);
  if (error) throw error;
  return Number(data?.[0]?.position || 0) + 1000;
}

async function createLesson(courseId, title, metadata = {}) {
  const position = await nextPosition("v5_lessons", courseId);
  const { data, error } = await supabase.from("v5_lessons").insert({
    course_id: courseId,
    title,
    position,
    status: "draft",
    metadata: { imported_from: "telegram", ...metadata }
  }).select("*").single();
  if (error) throw error;
  return data;
}

async function ensureDefaultLesson(courseId) {
  const { data, error } = await supabase.from("v5_lessons").select("*").eq("course_id", courseId).eq("metadata->>import_default", "true").limit(1);
  if (error) throw error;
  if (data?.[0]) return data[0];
  const position = await nextPosition("v5_lessons", courseId);
  const { data: lesson, error: insertError } = await supabase.from("v5_lessons").insert({
    course_id: courseId,
    title: "Nội dung khóa học",
    position,
    status: "draft",
    metadata: { imported_from: "telegram", import_default: "true" }
  }).select("*").single();
  if (insertError) throw insertError;
  return lesson;
}

async function loadExistingMappings(courseId, sourceId) {
  const { data, error } = await supabase
    .from("v5_source_mappings")
    .select("source_message_row_id,source_id,post_id,asset_id")
    .eq("course_id", courseId)
    .eq("source_id", sourceId)
    .eq("source_system", "telegram");
  if (error) throw error;
  return new Map((data || []).map(item => [item.source_message_row_id, item]));
}

async function loadExistingLessons(courseId) {
  const { data, error } = await supabase
    .from("v5_lessons")
    .select("*")
    .eq("course_id", courseId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function importSource(course, sourceIdInput) {
  const sourceId = clean(sourceIdInput);
  if (!sourceId) throw new Error("Thiếu Telegram source_id.");

  const binding = await checkSourceBinding(course.id, sourceId);
  if (binding.bound) {
    const err = new Error("Khóa này đã được liên kết với một nguồn Telegram khác.");
    err.code = "source_conflict";
    throw err;
  }

  const { data: source, error: sourceError } = await supabase
    .from("tgcloner_sources")
    .select("id,title,username,chat_id,indexed_message_count")
    .eq("id", sourceId)
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error("Không tìm thấy Telegram source.");

  // Preserve release lifecycle while selecting/importing Telegram
  await preserveReleaseLifecycleWhileSelectingTelegram(course.id, sourceId);

  const config = await loadConfig(course.id);
  const authoringMode = config?.settings?.authoring_mode === "lesson" ? "lesson" : "timeline";

  let hiddenLesson = null;
  if (authoringMode === "timeline") {
    hiddenLesson = await ensureHiddenTimelineLesson(course.id);
  }

  const { data: rows, error: rowsError } = await supabase
    .from("tgcloner_source_messages")
    .select("id,source_id,source_message_id,media_group_id,message_type,text,caption,raw_message,source_date,updated_at")
    .eq("source_id", sourceId)
    .order("source_message_id", { ascending: true })
    .limit(5000);
  if (rowsError) throw rowsError;

  const existingMappings = await loadExistingMappings(course.id, sourceId);
  const existingLessons = await loadExistingLessons(course.id);

  const plan = planImport({
    rows: rows || [],
    existingMappings,
    existingLessons,
    authoringMode,
    sourceId,
    hiddenLessonId: hiddenLesson?.id
  });

  let importedPosts = 0;
  let importedAssets = 0;
  let newLessonsCreated = 0;
  const queuedMirrorAssets = [];
  const lessonCache = new Map();

  for (const unit of plan.plannedUnits) {
    if (unit.isMapped) continue;

    // Handle lesson creation if unit specifies createsLesson
    if (unit.createsLesson && unit.lessonTitle) {
      let lesson = existingLessons.find(l =>
        l.metadata?.telegram_marker_row_id === unit.rows[0]?.id ||
        (unit.markerInfo?.number != null && l.metadata?.lesson_number === unit.markerInfo.number)
      );

      if (!lesson) {
        lesson = await createLesson(course.id, unit.lessonTitle, {
          telegram_source_id: sourceId,
          telegram_marker_row_id: unit.rows[0]?.id,
          telegram_source_message_id: unit.rows[0]?.source_message_id,
          lesson_number: unit.markerInfo?.number
        });
        existingLessons.push(lesson);
        newLessonsCreated++;
      }
      lessonCache.set(unit.targetLesson.id, lesson);
    }

    // Default lesson creation for lesson mode if needed
    if (unit.targetLesson?.isDefault && !lessonCache.has(unit.targetLesson.id)) {
      const defLesson = await ensureDefaultLesson(course.id);
      lessonCache.set(unit.targetLesson.id, defLesson);
    }

    // Marker-only message does not create a post in learner feed
    if (unit.markerOnly) {
      continue;
    }

    // Determine target DB lesson ID
    let finalLessonId = null;
    if (authoringMode === "timeline") {
      finalLessonId = hiddenLesson.id;
    } else {
      const cached = lessonCache.get(unit.targetLesson?.id);
      if (cached) {
        finalLessonId = cached.id;
      } else {
        const found = existingLessons.find(l => l.id === unit.targetLesson?.id);
        finalLessonId = found ? found.id : (await ensureDefaultLesson(course.id)).id;
      }
    }

    const text = unit.text;
    const hasMedia = unit.hasMedia;
    const position = await nextPosition("v5_posts", course.id);
    const { data: post, error: postError } = await supabase.from("v5_posts").insert({
      course_id: course.id,
      lesson_id: finalLessonId,
      position,
      text_content: hasMedia ? null : (text || null),
      caption: hasMedia ? (text || null) : null,
      origin: "telegram",
      origin_ref: {
        source_id: sourceId,
        message_row_ids: unit.rows.map(r => r.id),
        source_message_ids: unit.rows.map(r => r.source_message_id),
        media_group_id: unit.group || null
      },
      status: hasMedia ? "processing" : "ready",
      metadata: {
        imported_from: "telegram",
        source_title: source.title || source.username || "Telegram",
        sender_label: source.title || source.username || "Telegram",
        source_date: unitSourceDate(unit)
      }
    }).select("*").single();
    if (postError) throw postError;
    importedPosts++;

    let assetPosition = 0;
    for (const { row, media } of unit.descriptors) {
      let asset = null;
      if (media) {
        const thumbnail = telegramThumbnail(row);
        let thumbnailAsset = null;
        if (thumbnail) {
          const { data: thumbnailRow, error: thumbnailError } = await supabase.from("v5_media_assets").insert({
            type: thumbnail.type,
            provider: "telegram",
            origin: "telegram",
            telegram_source_id: sourceId,
            telegram_message_row_id: row.id,
            mime_type: thumbnail.mimeType,
            original_filename: thumbnail.filename,
            bytes: thumbnail.bytes || null,
            width: thumbnail.width || null,
            height: thumbnail.height || null,
            status: "processing",
            metadata: {
              telegram: thumbnail.telegram,
              source_message_id: row.source_message_id,
              media_group_id: row.media_group_id || null
            }
          }).select("*").single();
          if (thumbnailError) throw thumbnailError;
          thumbnailAsset = thumbnailRow;
          queuedMirrorAssets.push(thumbnailAsset.id);
          importedAssets++;
        }

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
          thumbnail_asset_id: thumbnailAsset?.id || null,
          status: "processing",
          metadata: {
            telegram: media.telegram,
            source_message_id: row.source_message_id,
            media_group_id: row.media_group_id || null
          }
        }).select("*").single();
        if (assetError) throw assetError;
        asset = assetRow;

        const { error: linkError } = await supabase.from("v5_post_assets").insert({
          post_id: post.id,
          asset_id: asset.id,
          position: assetPosition * 1000,
          role: "attachment"
        });
        if (linkError) throw linkError;

        importedAssets++;
        queuedMirrorAssets.push(asset.id);
        assetPosition++;
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
    const jobs = queuedMirrorAssets.map(assetId => ({
      course_id: course.id,
      asset_id: assetId,
      job_type: "telegram_mirror",
      status: "queued",
      payload: { source_id: sourceId }
    }));
    const { error: jobError } = await supabase.from("v5_jobs").insert(jobs);
    if (jobError) throw jobError;
  }

  const skippedRows = plan.totalRows - unitCountRows(plan.plannedUnits.filter(u => !u.isMapped));

  return {
    source: {
      id: source.id,
      title: source.title || source.username || "Telegram",
      indexedMessageCount: source.indexed_message_count || 0
    },
    authoringMode,
    totalRows: plan.totalRows,
    importedPosts,
    importedAssets,
    skippedRows,
    mirrorJobsQueued: queuedMirrorAssets.length,
    newLessonsCreated
  };
}

function unitCountRows(units) {
  let count = 0;
  for (const u of units) count += (u.rows || []).length;
  return count;
}

async function previewSource(course, sourceIdInput) {
  const sourceId = clean(sourceIdInput);
  if (!sourceId) throw new Error("Thiếu Telegram source_id.");

  const binding = await checkSourceBinding(course.id, sourceId);
  if (binding.bound) {
    const err = new Error("Khóa này đã được liên kết với một nguồn Telegram khác.");
    err.code = "source_conflict";
    throw err;
  }

  const { data: source, error: sourceError } = await supabase
    .from("tgcloner_sources")
    .select("id,title,username,chat_id,indexed_message_count")
    .eq("id", sourceId)
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error("Không tìm thấy Telegram source.");

  const config = await loadConfig(course.id);
  const authoringMode = config?.settings?.authoring_mode === "lesson" ? "lesson" : "timeline";

  const { data: rows, error: rowsError } = await supabase
    .from("tgcloner_source_messages")
    .select("id,source_id,source_message_id,media_group_id,message_type,text,caption,raw_message,source_date,updated_at")
    .eq("source_id", sourceId)
    .order("source_message_id", { ascending: true })
    .limit(5000);
  if (rowsError) throw rowsError;

  const existingMappings = await loadExistingMappings(course.id, sourceId);
  const existingLessons = await loadExistingLessons(course.id);
  const hiddenLesson = existingLessons.find(l => l.metadata?.system_lesson === true);

  const plan = planImport({
    rows: rows || [],
    existingMappings,
    existingLessons,
    authoringMode,
    sourceId,
    hiddenLessonId: hiddenLesson?.id
  });

  return {
    source: {
      id: source.id,
      title: source.title || source.username || "Telegram",
      username: source.username || null,
      indexedMessageCount: source.indexed_message_count || 0
    },
    authoringMode,
    totalRows: plan.totalRows,
    groupedUnits: plan.groupedUnits,
    alreadySyncedUnits: plan.alreadySyncedUnits,
    newUnits: plan.newUnits,
    albums: plan.albums,
    photos: plan.photos,
    videos: plan.videos,
    documents: plan.documents,
    detectedMarkers: plan.detectedMarkers,
    predictedLessons: plan.predictedLessons,
    predictedPosts: plan.predictedPosts,
    predictedMediaAssets: plan.predictedMediaAssets,
    predictedTelegramMirrorJobs: plan.predictedTelegramMirrorJobs
  };
}

export default async function adminV5TelegramImportHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  // List Telegram sources for admin selector
  if (req.method === "GET" || req.body?.action === "sources") {
    try {
      const { data: sources, error } = await supabase
        .from("tgcloner_sources")
        .select("id,title,username,chat_id,indexed_message_count,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ success: true, sources: sources || [], admin: admin.email });
    } catch (err) {
      console.error("[admin-v5-telegram-sources]", err);
      return res.status(500).json({ success: false, error: err?.message || "Lỗi lấy danh sách nguồn Telegram." });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const course = await loadCourse(req.query?.course || req.body?.course);
    if (!course) return res.status(404).json({ success: false, error: "Không tìm thấy khóa học." });

    const action = clean(req.body?.action);
    const sourceId = clean(req.body?.sourceId);

    if (action === "preview") {
      const result = await previewSource(course, sourceId);
      return res.status(200).json({ success: true, result, admin: admin.email });
    }

    if (action === "import") {
      const result = await importSource(course, sourceId);
      return res.status(200).json({ success: true, result, admin: admin.email });
    }

    return res.status(400).json({ success: false, error: "V5 Telegram action không hợp lệ. Hỗ trợ 'preview' hoặc 'import'." });
  } catch (error) {
    console.error("[admin-v5-telegram-import]", error);
    const isConflict = error.code === "source_conflict" || error.message?.includes("nguồn Telegram khác");
    return res.status(isConflict ? 409 : 500).json({
      success: false,
      code: isConflict ? "source_conflict" : (error.code || "TELEGRAM_IMPORT_ERROR"),
      error: error?.message || "V5 Telegram import error"
    });
  }
}
