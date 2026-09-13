const MEDIA_TYPES = new Set(["photo", "video", "animation", "video_note", "document", "audio", "voice"]);
const LESSON_RE = /^\s*(?:bài|bai)\s*(\d{1,3})\s*(?:[:.\-–—]\s*)?(.*)$/i;

export function clean(value) {
  return String(value || "").trim();
}

export function parseLessonMarker(textInput) {
  const text = clean(textInput);
  const match = text.match(LESSON_RE);
  if (!match) return { isMarker: false };
  const number = Number(match[1]);
  const suffix = clean(match[2]);
  return {
    isMarker: true,
    number,
    suffix,
    title: `Bài ${number}${suffix ? `: ${suffix}` : ""}`
  };
}

export function isMarkerOnly(textInput, hasMedia) {
  if (hasMedia) return false;
  const words = clean(textInput).split(/\s+/).filter(Boolean);
  return words.length <= 16;
}

export function telegramMedia(row) {
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

export function telegramThumbnail(row) {
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

export function groupRows(rows) {
  const units = [];
  const byGroup = new Map();
  for (const row of rows || []) {
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

export function unitText(unit) {
  for (const row of unit.rows) {
    const text = clean(row.text || row.caption);
    if (text) return text;
  }
  return "";
}

export function unitSourceDate(unit) {
  for (const row of unit.rows) {
    if (!row.source_date) continue;
    const date = new Date(row.source_date);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
}

/**
 * Shared planning and analysis for Telegram V5 import & incremental sync.
 * Strictly pure logic: no DB queries or mutations inside planImport.
 */
export function planImport({
  rows = [],
  existingMappings = new Map(),
  existingLessons = [],
  authoringMode = "timeline",
  sourceId = "",
  hiddenLessonId = null
}) {
  const units = groupRows(rows);
  const isTimeline = authoringMode === "timeline";

  let totalRows = rows.length;
  let albums = 0;
  let photos = 0;
  let videos = 0;
  let documents = 0;

  for (const row of rows) {
    if (row.message_type === "photo") photos++;
    else if (["video", "animation", "video_note"].includes(row.message_type)) videos++;
    else if (row.message_type === "document") documents++;
  }

  // Pre-index existing lessons for fast marker lookup
  const lessonsByNumber = new Map();
  const lessonsByMarkerRowId = new Map();
  let defaultLesson = null;

  for (const lesson of existingLessons || []) {
    const meta = lesson.metadata || {};
    if (meta.system_lesson) continue;
    if (meta.import_default || lesson.title === "Nội dung khóa học") {
      defaultLesson = lesson;
    }
    if (meta.telegram_marker_row_id) {
      lessonsByMarkerRowId.set(String(meta.telegram_marker_row_id), lesson);
    }
    if (meta.lesson_number != null) {
      lessonsByNumber.set(Number(meta.lesson_number), lesson);
    }
  }

  // Check partial media groups and mapping status
  for (const unit of units) {
    if (unit.group) albums++;
    const mappedRows = unit.rows.filter(row => existingMappings.has(row.id));
    if (mappedRows.length > 0 && mappedRows.length < unit.rows.length) {
      throw new Error(`Media group ${unit.key} đang import dở từ lần trước; cần reconcile trước khi tiếp tục.`);
    }

    let isMapped = mappedRows.length === unit.rows.length && unit.rows.length > 0;

    // In lesson mode, marker-only messages don't create posts (v5_source_mappings requires post_id NOT NULL),
    // but their identity is preserved in v5_lessons.metadata (telegram_marker_row_id / lesson_number).
    if (!isMapped && !isTimeline && unit.rows.length === 1) {
      const text = unitText(unit);
      const marker = parseLessonMarker(text);
      const descriptors = unit.rows.map(row => ({
        row,
        media: MEDIA_TYPES.has(row.message_type) ? telegramMedia(row) : null
      }));
      const hasMedia = descriptors.some(item => item.media);
      if (marker.isMarker && isMarkerOnly(text, hasMedia)) {
        const existingLesson = lessonsByMarkerRowId.get(String(unit.rows[0]?.id))
          || lessonsByNumber.get(marker.number);
        if (existingLesson) {
          isMapped = true;
        }
      }
    }

    unit.isMapped = isMapped;
  }

  const plannedUnits = [];
  const detectedMarkers = [];
  let alreadySyncedUnits = 0;
  let newUnits = 0;
  let predictedLessons = 0;
  let predictedPosts = 0;
  let predictedMediaAssets = 0;
  let predictedTelegramMirrorJobs = 0;

  let activeLesson = null;
  const newlyCreatedLessons = new Map();

  for (const unit of units) {
    if (unit.isMapped) {
      alreadySyncedUnits++;
    } else {
      newUnits++;
    }

    const text = unitText(unit);
    const marker = isTimeline ? { isMarker: false } : parseLessonMarker(text);
    const descriptors = unit.rows.map(row => ({
      row,
      media: MEDIA_TYPES.has(row.message_type) ? telegramMedia(row) : null
    }));
    const hasMedia = descriptors.some(item => item.media);

    let targetLesson = null;
    let createsLesson = false;
    let lessonTitle = null;
    let markerOnly = false;

    if (isTimeline) {
      targetLesson = { id: hiddenLessonId || "hidden-timeline-lesson" };
    } else {
      // Lesson Mode
      if (marker.isMarker) {
        detectedMarkers.push({
          unitKey: unit.key,
          number: marker.number,
          title: marker.title,
          sourceMessageId: unit.rows[0]?.source_message_id
        });

        // Check if this marker already exists in DB or was planned earlier in this run
        let matchedLesson = lessonsByMarkerRowId.get(String(unit.rows[0]?.id))
          || lessonsByNumber.get(marker.number)
          || newlyCreatedLessons.get(marker.number);

        if (!matchedLesson) {
          matchedLesson = {
            id: `predicted-lesson-${marker.number}`,
            title: marker.title,
            number: marker.number,
            markerRowId: unit.rows[0]?.id,
            isNew: true
          };
          newlyCreatedLessons.set(marker.number, matchedLesson);
          createsLesson = true;
          predictedLessons++;
        }

        activeLesson = matchedLesson;
        targetLesson = activeLesson;
        lessonTitle = marker.title;

        if (isMarkerOnly(text, hasMedia)) {
          markerOnly = true;
        }
      } else {
        if (!activeLesson) {
          if (!defaultLesson) {
            defaultLesson = {
              id: "predicted-default-lesson",
              title: "Nội dung khóa học",
              isDefault: true,
              isNew: true
            };
            predictedLessons++;
          }
          activeLesson = defaultLesson;
        }
        targetLesson = activeLesson;
      }
    }

    // Determine post & asset predictions
    let createsPost = false;
    let unitAssetsCount = 0;

    if (!unit.isMapped) {
      if (!markerOnly) {
        createsPost = true;
        predictedPosts++;
        for (const desc of descriptors) {
          if (desc.media) {
            unitAssetsCount++;
            predictedMediaAssets++;
            predictedTelegramMirrorJobs++;
            const thumb = telegramThumbnail(desc.row);
            if (thumb) {
              unitAssetsCount++;
              predictedMediaAssets++;
              predictedTelegramMirrorJobs++;
            }
          }
        }
      }
    }

    plannedUnits.push({
      unitKey: unit.key,
      group: unit.group,
      rows: unit.rows,
      text,
      hasMedia,
      descriptors,
      isMapped: unit.isMapped,
      markerOnly,
      createsLesson,
      lessonTitle,
      targetLesson,
      markerInfo: marker.isMarker ? marker : null,
      createsPost,
      assetsCount: unitAssetsCount
    });
  }

  return {
    authoringMode,
    totalRows,
    groupedUnits: units.length,
    albums,
    photos,
    videos,
    documents,
    alreadySyncedUnits,
    newUnits,
    detectedMarkers,
    predictedLessons,
    predictedPosts,
    predictedMediaAssets,
    predictedTelegramMirrorJobs,
    plannedUnits
  };
}
