import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";
import { isV5PlaybackConfigured } from "../v5-playback-lease.js";

function clean(value) {
  return String(value || "").trim();
}

export default async function v5FeedHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });
  try {
    const courseSlug = clean(req.query?.course);
    const access = await requireV4CourseAccess(req, courseSlug);
    if (!access.ok) return res.status(access.status).json({ success: false, code: access.code, error: access.error });

    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("id,slug,title,subtitle,image_url,delivery_mode")
      .eq("slug", courseSlug)
      .maybeSingle();
    if (courseError) throw courseError;
    if (!course || clean(course.delivery_mode).toLowerCase() !== "v5") {
      return res.status(404).json({ success: false, code: "v5_course_not_found", error: "Không tìm thấy khóa V5." });
    }

    const { data: config, error: configError } = await supabase
      .from("v5_course_configs")
      .select("course_id,status,published_release_id,source_mode,settings")
      .eq("course_id", course.id)
      .maybeSingle();
    if (configError) throw configError;
    if (!config || config.status !== "published") {
      return res.status(403).json({ success: false, code: "v5_not_published", error: "Khóa V5 chưa được Publish." });
    }

    const [{ data: lessons, error: lessonError }, { data: posts, error: postError }] = await Promise.all([
      supabase.from("v5_lessons").select("id,title,position,metadata").eq("course_id", course.id).eq("status", "published").order("position", { ascending: true }),
      supabase.from("v5_posts").select("id,lesson_id,position,text_content,caption,origin,metadata").eq("course_id", course.id).eq("status", "published").order("position", { ascending: true })
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
          .select("id,type,provider,origin,r2_object_key,mime_type,original_filename,bytes,width,height,duration_ms,status,thumbnail_asset_id,metadata")
          .in("id", assetIds)
          .eq("status", "ready");
        if (assetError) throw assetError;
        const playbackConfigured = isV5PlaybackConfigured();
        assets = (assetRows || []).map(asset => ({
          id: asset.id,
          type: asset.type,
          provider: asset.provider,
          origin: asset.origin,
          mime_type: asset.mime_type,
          original_filename: asset.original_filename,
          bytes: asset.bytes,
          width: asset.width,
          height: asset.height,
          duration_ms: asset.duration_ms,
          status: asset.status,
          thumbnail_asset_id: asset.thumbnail_asset_id,
          metadata: asset.metadata || {},
          playback_ready: Boolean(playbackConfigured && asset.provider === "r2" && asset.r2_object_key)
        }));
      }
    }

    return res.status(200).json({
      success: true,
      course: { slug: course.slug, title: access.courseTitle || course.title, subtitle: course.subtitle || "", imageUrl: course.image_url || "" },
      sourceMode: config.source_mode,
      releaseId: config.published_release_id,
      playbackConfigured: isV5PlaybackConfigured(),
      lessons: lessons || [],
      posts: posts || [],
      links,
      assets
    });
  } catch (error) {
    console.error("[v5-feed]", error);
    return res.status(500).json({ success: false, error: "V5 server error" });
  }
}
