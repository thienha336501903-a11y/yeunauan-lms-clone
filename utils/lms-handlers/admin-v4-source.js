import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";

const ALLOWED_MEDIA_MODES = new Set(["telegram_bot_poc", "mtproto_gateway", "mirror"]);

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

async function sourceWithCount(sourceId) {
  if (!sourceId) return null;
  const { data: source, error: sourceError } = await supabase
    .from("tgcloner_sources")
    .select("id,title,username,active,indexed_at,indexed_message_count,updated_at")
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
    indexedAt: source.indexed_at || null,
    indexedMessageCount: Number(source.indexed_message_count || 0),
    actualMessageCount: Number(count || 0),
    updatedAt: source.updated_at || null
  };
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

      const { data: sourceRows, error: sourcesError } = await supabase
        .from("tgcloner_sources")
        .select("id,title,username,active,indexed_at,indexed_message_count,updated_at")
        .order("updated_at", { ascending: false });
      if (sourcesError) throw sourcesError;

      const currentSource = mapping?.source_id ? await sourceWithCount(mapping.source_id) : null;
      const sources = (sourceRows || []).map(source => ({
        id: source.id,
        title: source.title || source.username || "Telegram",
        username: source.username || "",
        active: Boolean(source.active),
        indexedAt: source.indexed_at || null,
        indexedMessageCount: Number(source.indexed_message_count || 0),
        updatedAt: source.updated_at || null
      }));

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
        sources
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
      if (enabled && !sourceRow.active) {
        return res.status(400).json({ success: false, error: "Nguồn Telegram đang inactive, không thể bật cho học viên" });
      }

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
