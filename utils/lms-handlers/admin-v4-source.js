import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";

const ALLOWED_MEDIA_MODES = new Set(["telegram_bot_poc", "mtproto_gateway", "mirror"]);
const NEW_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeNewSlug(value) {
  return String(value || "").trim().toLowerCase();
}

async function requireV4Course(course) {
  const slug = String(course || "").trim();
  if (!slug) return { ok: false, status: 400, error: "Thiếu tham số course" };

  const { data, error } = await supabase
    .from("courses")
    .select("slug,delivery_mode,is_published")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, status: 404, error: "Không tìm thấy khóa học" };
  if (String(data.delivery_mode || "").trim().toLowerCase() !== "v4") {
    return { ok: false, status: 400, error: "Khóa học này không phải V4" };
  }
  return { ok: true, slug, isPublished: Boolean(data.is_published) };
}

async function listSources() {
  const { data: rows, error } = await supabase
    .from("tgcloner_sources")
    .select("id,title,username,active,indexed_at,indexed_message_count,last_ingested_at,last_source_date,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;

  return (rows || []).map(source => ({
    id: source.id,
    title: source.title || source.username || "Telegram",
    username: source.username || "",
    active: Boolean(source.active),
    mirrorActive: Boolean(source.active),
    v4Eligible: true,
    indexedAt: source.indexed_at || null,
    indexedMessageCount: Number(source.indexed_message_count || 0),
    lastIngestedAt: source.last_ingested_at || null,
    lastSourceDate: source.last_source_date || null,
    updatedAt: source.updated_at || null
  }));
}

async function listV4Health() {
  const { data: courses, error: coursesError } = await supabase
    .from("courses")
    .select("slug,title,is_published,active,updated_at")
    .eq("delivery_mode", "v4")
    .order("updated_at", { ascending: false });
  if (coursesError) throw coursesError;

  const slugs = (courses || []).map((row) => row.slug).filter(Boolean);
  let mappings = [];
  if (slugs.length) {
    const { data, error } = await supabase
      .from("lms_v4_telegram_course_sources")
      .select("course_slug,source_id,enabled,media_mode,updated_at")
      .in("course_slug", slugs);
    if (error) throw error;
    mappings = data || [];
  }

  const sourceIds = [...new Set(mappings.map((row) => row.source_id).filter(Boolean))];
  let sources = [];
  if (sourceIds.length) {
    const { data, error } = await supabase
      .from("tgcloner_sources")
      .select("id,title,username,active,indexed_at,indexed_message_count,last_ingested_at,last_source_date,updated_at")
      .in("id", sourceIds);
    if (error) throw error;
    sources = data || [];
  }

  const mappingByCourse = new Map(mappings.map((row) => [row.course_slug, row]));
  const sourceById = new Map(sources.map((row) => [row.id, row]));
  const rows = (courses || []).map((course) => {
    const mapping = mappingByCourse.get(course.slug) || null;
    const source = mapping?.source_id ? sourceById.get(mapping.source_id) || null : null;
    const indexedMessageCount = Number(source?.indexed_message_count || 0);
    const sourceHealthy = Boolean(mapping?.enabled && source && indexedMessageCount > 0);
    let health = "setup";
    let issue = "Chưa gắn nguồn Telegram";
    if (mapping && !source) {
      health = "broken";
      issue = "Mapping đang trỏ tới nguồn không tồn tại";
    } else if (mapping && !mapping.enabled) {
      health = course.is_published ? "broken" : "setup";
      issue = "Nguồn đang tắt";
    } else if (source && indexedMessageCount <= 0) {
      health = course.is_published ? "broken" : "setup";
      issue = "Nguồn chưa có bài index";
    } else if (sourceHealthy && course.is_published) {
      health = "healthy";
      issue = "Hoạt động bình thường";
    } else if (sourceHealthy) {
      health = "draft";
      issue = "Nguồn tốt, khóa đang Tạm ẩn";
    }

    return {
      course: course.slug,
      title: course.title || course.slug,
      active: course.active !== false,
      isPublished: Boolean(course.is_published),
      health,
      issue,
      sourceHealthy,
      source: source ? {
        id: source.id,
        title: source.title || source.username || "Telegram",
        active: Boolean(source.active),
        mirrorActive: Boolean(source.active),
        v4Eligible: true,
        indexedAt: source.indexed_at || null,
        indexedMessageCount,
        lastIngestedAt: source.last_ingested_at || null,
        lastSourceDate: source.last_source_date || null,
        updatedAt: source.updated_at || null
      } : null,
      mapping: mapping ? {
        enabled: Boolean(mapping.enabled),
        mediaMode: mapping.media_mode || "telegram_bot_poc",
        updatedAt: mapping.updated_at || null
      } : null
    };
  });

  const summary = rows.reduce((acc, row) => {
    acc.total += 1;
    if (row.health === "healthy") acc.healthy += 1;
    else if (row.health === "draft") acc.draft += 1;
    else acc.attention += 1;
    return acc;
  }, { total: 0, healthy: 0, draft: 0, attention: 0 });

  return { rows, summary };
}

async function sourceWithCount(sourceId) {
  if (!sourceId) return null;
  const { data: source, error: sourceError } = await supabase
    .from("tgcloner_sources")
    .select("id,title,username,active,indexed_at,indexed_message_count,last_ingested_at,last_source_date,updated_at")
    .eq("id", sourceId)
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) return null;

  const { count, error: countError } = await supabase
    .from("tgcloner_source_messages")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId);
  if (countError) throw countError;

  return {
    id: source.id,
    title: source.title || source.username || "Telegram",
    username: source.username || "",
    active: Boolean(source.active),
    mirrorActive: Boolean(source.active),
    v4Eligible: true,
    indexedAt: source.indexed_at || null,
    indexedMessageCount: Number(source.indexed_message_count || 0),
    actualMessageCount: Number(count || 0),
    lastIngestedAt: source.last_ingested_at || null,
    lastSourceDate: source.last_source_date || null,
    updatedAt: source.updated_at || null
  };
}

async function createV4Course(req, res) {
  const title = String(req.body?.title || "").trim();
  const slug = normalizeNewSlug(req.body?.slug);
  const sourceId = String(req.body?.sourceId || "").trim();

  if (!title) return res.status(400).json({ success: false, error: "Chưa nhập tên khóa học" });
  if (title.length > 160) return res.status(400).json({ success: false, error: "Tên khóa học quá dài" });
  if (!slug || slug.length > 80 || !NEW_SLUG_RE.test(slug)) {
    return res.status(400).json({
      success: false,
      error: "Slug chỉ dùng chữ thường a-z, số và dấu gạch ngang"
    });
  }
  if (!sourceId) return res.status(400).json({ success: false, error: "Chưa chọn nguồn Telegram" });

  const { data: existingCourse, error: existingError } = await supabase
    .from("courses")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingCourse) {
    return res.status(409).json({ success: false, error: "Slug khóa học đã tồn tại" });
  }

  const source = await sourceWithCount(sourceId);
  if (!source) return res.status(404).json({ success: false, error: "Không tìm thấy nguồn Telegram" });
  const now = new Date().toISOString();
  const { error: courseError } = await supabase
    .from("courses")
    .insert({
      slug,
      title,
      active: true,
      is_published: false,
      delivery_mode: "v4",
      raw_data: { studentDisplayTitle: title },
      updated_at: now
    });

  if (courseError) {
    if (courseError.code === "23505") {
      return res.status(409).json({ success: false, error: "Slug khóa học đã tồn tại" });
    }
    throw courseError;
  }

  const { error: mappingError } = await supabase
    .from("lms_v4_telegram_course_sources")
    .insert({
      course_slug: slug,
      source_id: sourceId,
      enabled: true,
      media_mode: "telegram_bot_poc",
      updated_at: now
    });

  if (mappingError) {
    // Best-effort rollback so a failed mapping never leaves a half-created V4
    // course in the shared Clone database.
    await supabase
      .from("lms_v4_telegram_course_sources")
      .delete()
      .eq("course_slug", slug);
    await supabase
      .from("courses")
      .delete()
      .eq("slug", slug);
    throw mappingError;
  }

  return res.status(201).json({
    success: true,
    course: slug,
    title,
    deliveryMode: "v4",
    isPublished: false,
    mapping: {
      sourceId,
      enabled: true,
      mediaMode: "telegram_bot_poc",
      updatedAt: now
    },
    source,
    readyEligible: Boolean(Number(source.actualMessageCount || 0) > 0)
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const admin = getAdminFromRequest(req);
    if (!admin) return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });

    if (req.method === "GET" && String(req.query?.mode || "") === "health") {
      const health = await listV4Health();
      return res.status(200).json({ success: true, ...health });
    }

    if (req.method === "GET" && String(req.query?.mode || "") === "sources") {
      return res.status(200).json({ success: true, sources: await listSources() });
    }

    if (req.method === "POST" && String(req.body?.action || "").trim() === "createCourse") {
      return createV4Course(req, res);
    }

    const course = String(req.query?.course || req.body?.course || "").trim();
    const checked = await requireV4Course(course);
    if (!checked.ok) return res.status(checked.status).json({ success: false, error: checked.error });

    if (req.method === "GET") {
      const { data: mapping, error: mappingError } = await supabase
        .from("lms_v4_telegram_course_sources")
        .select("course_slug,source_id,enabled,media_mode,updated_at")
        .eq("course_slug", checked.slug)
        .maybeSingle();
      if (mappingError) throw mappingError;

      const currentSource = mapping?.source_id ? await sourceWithCount(mapping.source_id) : null;
      return res.status(200).json({
        success: true,
        course: checked.slug,
        isPublished: checked.isPublished,
        mapping: mapping ? {
          sourceId: mapping.source_id,
          enabled: Boolean(mapping.enabled),
          mediaMode: mapping.media_mode || "telegram_bot_poc",
          updatedAt: mapping.updated_at || null
        } : null,
        source: currentSource,
        sources: await listSources()
      });
    }

    if (req.method === "POST") {
      const action = String(req.body?.action || "").trim();
      if (action !== "saveSource") {
        return res.status(400).json({ success: false, error: "action không hợp lệ" });
      }

      const sourceId = String(req.body?.sourceId || "").trim();
      if (!sourceId) return res.status(400).json({ success: false, error: "Chưa chọn nguồn Telegram" });

      const { data: sourceRow, error: sourceError } = await supabase
        .from("tgcloner_sources")
        .select("id,title,username,active,indexed_message_count")
        .eq("id", sourceId)
        .maybeSingle();
      if (sourceError) throw sourceError;
      if (!sourceRow) return res.status(404).json({ success: false, error: "Không tìm thấy nguồn Telegram" });

      const enabled = req.body?.enabled !== false;
      const { data: existing, error: existingError } = await supabase
        .from("lms_v4_telegram_course_sources")
        .select("source_id,enabled,media_mode")
        .eq("course_slug", checked.slug)
        .maybeSingle();
      if (existingError) throw existingError;

      // Do not let a live course change its delivery source underneath active
      // learners. Hide the course first, then change/disable its source, verify
      // the new mapping, and publish it again.
      const sourceChanged = Boolean(existing?.source_id && existing.source_id !== sourceId);
      const sourceDisabled = Boolean(existing?.enabled && !enabled);
      if (checked.isPublished && (sourceChanged || sourceDisabled)) {
        return res.status(409).json({
          success: false,
          error: "Hãy Tạm ẩn khóa học trước khi đổi hoặc tắt nguồn Telegram V4"
        });
      }

      const requestedMode = String(req.body?.mediaMode || existing?.media_mode || "telegram_bot_poc").trim();
      const mediaMode = ALLOWED_MEDIA_MODES.has(requestedMode) ? requestedMode : "telegram_bot_poc";
      const now = new Date().toISOString();

      const { error: saveError } = await supabase
        .from("lms_v4_telegram_course_sources")
        .upsert({
          course_slug: checked.slug,
          source_id: sourceId,
          enabled,
          media_mode: mediaMode,
          updated_at: now
        }, { onConflict: "course_slug" });
      if (saveError) throw saveError;

      const source = await sourceWithCount(sourceId);
      return res.status(200).json({
        success: true,
        course: checked.slug,
        isPublished: checked.isPublished,
        mapping: { sourceId, enabled, mediaMode, updatedAt: now },
        source
      });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (error) {
    console.error("[admin-v4-source]", error);
    return res.status(500).json({ success: false, error: "Lỗi server khi quản lý nguồn Telegram V4" });
  }
}
