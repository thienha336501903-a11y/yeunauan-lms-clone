import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";
import { courseIntroFallback } from "../v4-intro-content.js";
import { loadV4IntroContent, MAX_V4_INTRO_ROWS } from "../v4-intro-loader.js";
import { cloneConfig } from "../clone-config.js";

const MEDIA_TYPE_LIST = ["photo", "video", "document", "audio", "voice", "animation", "video_note"];
const MEDIA_TYPES = new Set(MEDIA_TYPE_LIST);
const VIDEO_TYPES = new Set(["video", "animation", "video_note"]);
const GATEWAY_TIMEOUT_MS = 2500;
const MEDIA_SCAN_PAGE_SIZE = 500;
const MAX_MEDIA_SCAN_ROWS = 10000;

function clean(value) {
  return String(value || "").trim();
}

function mediaKey(messageType) {
  return messageType === "video_note" ? "video_note" : messageType;
}

function mediaState(row) {
  const raw = row?.raw_message && typeof row.raw_message === "object" ? row.raw_message : {};
  const messageType = clean(row?.message_type);
  if (!MEDIA_TYPES.has(messageType)) return null;

  if (messageType === "photo") {
    const photos = Array.isArray(raw.photo) ? raw.photo : [];
    const item = photos[photos.length - 1] || null;
    return {
      historical: Boolean(raw.from_reader),
      fileReady: Boolean(item?.file_id || item?.mtproto),
      thumbnailReady: true
    };
  }

  const item = raw[mediaKey(messageType)] && typeof raw[mediaKey(messageType)] === "object"
    ? raw[mediaKey(messageType)]
    : null;
  const thumbnail = item?.thumbnail || item?.thumb || null;
  return {
    historical: Boolean(raw.from_reader),
    fileReady: Boolean(item?.file_id || item?.mtproto),
    thumbnailReady: VIDEO_TYPES.has(messageType) ? Boolean(thumbnail?.file_id || thumbnail?.mtproto) : true
  };
}

function activeEnrollmentCount(rows, now = Date.now()) {
  return (rows || []).filter((row) => {
    if (clean(row?.status).toLowerCase() !== "active") return false;
    if (!row?.expired_at) return true;
    const expiry = Date.parse(row.expired_at);
    return Number.isFinite(expiry) && expiry > now;
  }).length;
}

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

async function loadMediaRows(sourceId, mediaCount) {
  const total = Number(mediaCount || 0);
  if (!sourceId || total <= 0) return { rows: [], complete: true };
  if (total > MAX_MEDIA_SCAN_ROWS) return { rows: [], complete: false };

  const rows = [];
  for (let from = 0; from < total; from += MEDIA_SCAN_PAGE_SIZE) {
    const to = Math.min(total - 1, from + MEDIA_SCAN_PAGE_SIZE - 1);
    const { data, error } = await supabase
      .from("tgcloner_source_messages")
      .select("id,source_message_id,message_type,raw_message,updated_at")
      .eq("source_id", sourceId)
      .in("message_type", MEDIA_TYPE_LIST)
      .order("source_message_id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return { rows, complete: rows.length === total };
}

async function probeClonerHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  try {
    const url = cloneConfig().telegramClonerHealthUrl;
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const payload = await response.json().catch(() => null);
    const serviceOkay = response.ok && payload?.ok !== false;
    const databaseOkay = payload?.checks?.database !== false && payload?.database !== false;
    const botConfigured = payload?.configured?.telegramBot !== false;
    const webhookConfigured = payload?.configured?.telegramWebhook !== false;
    const gatewayOkay = Boolean(serviceOkay && databaseOkay && botConfigured && webhookConfigured);
    return {
      ok: gatewayOkay,
      statusCode: response.status,
      detail: gatewayOkay
        ? "Cloner, database và Telegram bot/webhook đang phản hồi bình thường"
        : `Cloner health chưa đạt: HTTP ${response.status}, DB=${databaseOkay ? "ok" : "lỗi"}, bot=${botConfigured ? "ok" : "thiếu"}, webhook=${webhookConfigured ? "ok" : "thiếu"}`
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      detail: error?.name === "AbortError"
        ? "Cloner health không phản hồi trong 2.5 giây"
        : "Không kiểm tra được Cloner/media gateway lúc này"
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function buildPrepublish(courseSlug) {
  const slug = clean(courseSlug);
  if (!slug) {
    const error = new Error("Thiếu khóa học V4");
    error.statusCode = 400;
    throw error;
  }

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id,slug,title,description,raw_data,delivery_mode,is_published")
    .eq("slug", slug)
    .maybeSingle();
  if (courseError) throw courseError;
  if (!course || clean(course.delivery_mode).toLowerCase() !== "v4") {
    const error = new Error("Khóa học không tồn tại hoặc không phải V4");
    error.statusCode = 400;
    throw error;
  }

  const { data: mapping, error: mappingError } = await supabase
    .from("lms_v4_telegram_course_sources")
    .select("source_id,enabled,media_mode,updated_at")
    .eq("course_slug", slug)
    .maybeSingle();
  if (mappingError) throw mappingError;

  let source = null;
  let actualMessageCount = 0;
  let mediaCount = 0;
  let mediaScan = { rows: [], complete: true };
  let introContent = { rows: [], items: [], complete: true, total: 0 };
  if (mapping?.source_id) {
    const [sourceResult, countResult, mediaCountResult] = await Promise.all([
      supabase
        .from("tgcloner_sources")
        .select("id,title,username,chat_id,active,indexed_at,indexed_message_count,last_ingested_at,last_source_date,updated_at")
        .eq("id", mapping.source_id)
        .maybeSingle(),
      supabase
        .from("tgcloner_source_messages")
        .select("id", { count: "exact", head: true })
        .eq("source_id", mapping.source_id),
      supabase
        .from("tgcloner_source_messages")
        .select("id", { count: "exact", head: true })
        .eq("source_id", mapping.source_id)
        .in("message_type", MEDIA_TYPE_LIST)
    ]);
    if (sourceResult.error) throw sourceResult.error;
    if (countResult.error) throw countResult.error;
    if (mediaCountResult.error) throw mediaCountResult.error;
    source = sourceResult.data || null;
    actualMessageCount = Number(countResult.count || 0);
    mediaCount = Number(mediaCountResult.count || 0);
    [mediaScan, introContent] = await Promise.all([
      loadMediaRows(mapping.source_id, mediaCount),
      loadV4IntroContent(mapping.source_id, actualMessageCount)
    ]);
  }

  const { data: enrollmentRows, error: enrollmentError } = await supabase
    .from("student_enrollments")
    .select("id,status,expired_at")
    .eq("course_slug", slug);
  if (enrollmentError) throw enrollmentError;

  const gateway = await probeClonerHealth();
  const checks = [];

  if (!mapping) {
    checks.push(check("mapping", "Mapping nguồn Telegram", "block", "Khóa chưa gắn nguồn Telegram V4"));
  } else if (!mapping.enabled) {
    checks.push(check("mapping", "Mapping nguồn Telegram", "block", "Nguồn Telegram đang bị tắt cho khóa này"));
  } else {
    checks.push(check("mapping", "Mapping nguồn Telegram", "pass", `Đang bật · mode ${mapping.media_mode || "telegram_bot_poc"}`));
  }

  if (!source) {
    checks.push(check("source", "Nguồn Telegram đã đăng ký", "block", "Không tìm thấy source mà mapping đang trỏ tới"));
  } else if (!clean(source.chat_id)) {
    checks.push(check("source", "Nguồn Telegram đã đăng ký", "block", "Source thiếu Telegram chat_id"));
  } else {
    checks.push(check("source", "Nguồn Telegram đã đăng ký", "pass", `${source.title || source.username || "Telegram"} · ${source.active ? "MASTER mirror" : "Nguồn V4"}`));
  }

  if (!actualMessageCount) {
    checks.push(check("messages", "Nội dung đã index", "block", "Chưa có bài Telegram nào trong nguồn"));
  } else {
    checks.push(check("messages", "Nội dung đã index", "pass", `${actualMessageCount} bài thực tế`));
  }

  const fallbackDescription = courseIntroFallback(course);
  if (!introContent.complete) {
    checks.push(check("intro-text", "Công thức & Hướng dẫn", "block", actualMessageCount > MAX_V4_INTRO_ROWS
      ? `Nguồn có ${actualMessageCount} bài, vượt giới hạn tổng hợp an toàn ${MAX_V4_INTRO_ROWS}; chưa thể xác nhận đầy đủ nội dung chữ`
      : `Chỉ đọc được ${introContent.rows.length}/${actualMessageCount} bài; hãy chạy Preflight lại`));
  } else if (introContent.items.length) {
    checks.push(check("intro-text", "Công thức & Hướng dẫn", "pass", `${introContent.items.length} đoạn text/caption sẽ tự động hiển thị`));
  } else if (fallbackDescription) {
    checks.push(check("intro-text", "Công thức & Hướng dẫn", "warn", "Nguồn Telegram chưa có text/caption; đang dùng mô tả khóa học làm nội dung thay thế"));
  } else {
    checks.push(check("intro-text", "Công thức & Hướng dẫn", "block", "Nguồn Telegram không có text/caption và khóa học cũng chưa có mô tả thay thế"));
  }

  if (!mediaScan.complete) {
    checks.push(check("media-scan", "Quét media trước phát hành", "block", mediaCount > MAX_MEDIA_SCAN_ROWS
      ? `Nguồn có ${mediaCount} media, vượt giới hạn quét an toàn ${MAX_MEDIA_SCAN_ROWS}; chưa thể xác nhận toàn bộ media`
      : `Chỉ đọc được ${mediaScan.rows.length}/${mediaCount} media; hãy chạy Preflight lại`));
  } else {
    checks.push(check("media-scan", "Quét media trước phát hành", "pass", `Đã kiểm tra ${mediaCount} media`));
  }

  const mediaStates = mediaScan.rows
    .map((row) => ({ row, state: mediaState(row) }))
    .filter((item) => item.state);
  const historicalMedia = mediaStates.filter((item) => item.state.historical);
  const missingFileIds = mediaStates.filter((item) => !item.state.fileReady);
  const missingThumbnails = mediaStates.filter((item) => item.state.fileReady && !item.state.thumbnailReady);

  if (mediaScan.complete && missingFileIds.length) {
    const ids = missingFileIds.slice(0, 5).map((item) => item.row.source_message_id).join(", ");
    const historicalMissing = missingFileIds.filter((item) => item.state.historical).length;
    checks.push(check("media-metadata", "File media Telegram", "block", `${missingFileIds.length} media thiếu file_id/MTProto${historicalMissing ? ` (${historicalMissing} bài import lịch sử)` : ""}${ids ? ` · Telegram ID ${ids}` : ""}`));
  } else if (mediaScan.complete) {
    checks.push(check("media-metadata", "File media Telegram", "pass", `${mediaStates.length} media có metadata tải file`));
  }

  if (mediaScan.complete && historicalMedia.length) {
    checks.push(check("historical-media", "Media import lịch sử", "pass", `${historicalMedia.length} media lịch sử đã có metadata Bot API/MTProto`));
  } else if (mediaScan.complete) {
    checks.push(check("historical-media", "Media import lịch sử", "pass", "Không có media reader cần hydrate riêng"));
  }

  if (mediaScan.complete && missingThumbnails.length) {
    checks.push(check("video-thumbnail", "Thumbnail video", "warn", `${missingThumbnails.length} video đã có media nhưng thiếu thumbnail`));
  } else if (mediaScan.complete) {
    checks.push(check("video-thumbnail", "Thumbnail video", "pass", "Không phát hiện video thiếu thumbnail"));
  }

  if (source && Number(source.indexed_message_count || 0) !== actualMessageCount) {
    checks.push(check("index-count", "Đối chiếu số bài", "warn", `Cache source=${Number(source.indexed_message_count || 0)}, thực tế=${actualMessageCount}`));
  } else if (source) {
    checks.push(check("index-count", "Đối chiếu số bài", "pass", `Khớp ${actualMessageCount}/${actualMessageCount}`));
  }

  const activeEnrollments = activeEnrollmentCount(enrollmentRows);
  checks.push(activeEnrollments > 0
    ? check("enrollments", "Học viên đã được cấp quyền", "pass", `${activeEnrollments} quyền đang hoạt động`)
    : check("enrollments", "Học viên đã được cấp quyền", "warn", "Chưa có học viên active; có thể Publish nhưng nên cấp quyền và kiểm tra Draft gate trước"));

  checks.push(gateway.ok
    ? check("gateway", "Cloner / media gateway", "pass", gateway.detail)
    : check("gateway", "Cloner / media gateway", "warn", `${gateway.detail}; đây là cảnh báo tạm thời, không tự chặn Publish`));

  const blockers = checks.filter((item) => item.status === "block").length;
  const warnings = checks.filter((item) => item.status === "warn").length;
  const passed = checks.filter((item) => item.status === "pass").length;

  return {
    course: {
      id: course.id,
      slug: course.slug,
      title: course.title || course.slug,
      isPublished: Boolean(course.is_published)
    },
    mapping: mapping ? {
      sourceId: mapping.source_id,
      enabled: Boolean(mapping.enabled),
      mediaMode: mapping.media_mode || "telegram_bot_poc"
    } : null,
    source: source ? {
      id: source.id,
      title: source.title || source.username || "Telegram",
      username: source.username || "",
      chatId: source.chat_id || "",
      mirrorActive: Boolean(source.active),
      indexedMessageCount: Number(source.indexed_message_count || 0),
      actualMessageCount,
      lastIngestedAt: source.last_ingested_at || null,
      lastSourceDate: source.last_source_date || null
    } : null,
    stats: {
      actualMessageCount,
      introTextItemCount: introContent.items.length,
      introTextScanComplete: introContent.complete,
      mediaCount,
      mediaScanComplete: mediaScan.complete,
      historicalMediaCount: historicalMedia.length,
      missingFileIdCount: missingFileIds.length,
      missingThumbnailCount: missingThumbnails.length,
      activeEnrollmentCount: activeEnrollments
    },
    gateway: { ok: gateway.ok, statusCode: gateway.statusCode },
    checks,
    summary: { passed, warnings, blockers },
    ready: blockers === 0
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const admin = getAdminFromRequest(req);
    if (!admin) return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

    const result = await buildPrepublish(req.query?.course);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("[admin-v4-prepublish]", error);
    return res.status(Number(error.statusCode || 500)).json({
      success: false,
      error: error.message || "Lỗi kiểm tra trước khi phát hành V4"
    });
  }
}
