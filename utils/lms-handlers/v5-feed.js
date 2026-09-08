import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";
import { isV5PlaybackConfigured } from "../v5-playback-lease.js";
import { v5LearnerReleaseContent } from "../v5-release-snapshot.js";

const MAX_RELEASE_CACHE_ENTRIES = 64;
const releaseCache = new Map();

function clean(value) {
  return String(value || "").trim();
}

function rememberRelease(release) {
  if (!release?.id) return release;
  const key = String(release.id);
  releaseCache.delete(key);
  releaseCache.set(key, release);
  while (releaseCache.size > MAX_RELEASE_CACHE_ENTRIES) {
    const oldestKey = releaseCache.keys().next().value;
    if (!oldestKey) break;
    releaseCache.delete(oldestKey);
  }
  return release;
}

async function loadPublishedRelease(courseId, releaseId) {
  const key = clean(releaseId);
  const cached = releaseCache.get(key);
  if (cached && String(cached.course_id) === String(courseId) && cached.status === "published") {
    // Refresh insertion order for a tiny process-local LRU. Release snapshots are
    // immutable; when a new release is published, published_release_id changes.
    releaseCache.delete(key);
    releaseCache.set(key, cached);
    return cached;
  }

  const { data: release, error } = await supabase
    .from("v5_releases")
    .select("id,course_id,status,snapshot")
    .eq("id", releaseId)
    .eq("course_id", courseId)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  return release ? rememberRelease(release) : null;
}

export default async function v5FeedHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });
  try {
    const courseSlug = clean(req.query?.course);
    const access = await requireV4CourseAccess(req, courseSlug);
    if (!access.ok) return res.status(access.status).json({ success: false, code: access.code, error: access.error });

    const course = access.course;
    if (!course || clean(course.delivery_mode).toLowerCase() !== "v5") {
      return res.status(404).json({ success: false, code: "v5_course_not_found", error: "Không tìm thấy khóa V5." });
    }

    const { data: config, error: configError } = await supabase
      .from("v5_course_configs")
      .select("course_id,status,published_release_id,source_mode")
      .eq("course_id", course.id)
      .maybeSingle();
    if (configError) throw configError;
    if (!config || config.status !== "published" || !config.published_release_id) {
      return res.status(403).json({ success: false, code: "v5_not_published", error: "Khóa V5 chưa được Publish." });
    }

    const release = await loadPublishedRelease(course.id, config.published_release_id);
    const content = release ? v5LearnerReleaseContent(release.snapshot) : null;
    if (!content) {
      return res.status(403).json({ success: false, code: "v5_release_invalid", error: "Release V5 hiện tại không hợp lệ." });
    }

    const playbackConfigured = isV5PlaybackConfigured();
    let assets = [];
    if (content.assetIds.length) {
      const { data: assetRows, error: assetError } = await supabase
        .from("v5_media_assets")
        .select("id,type,provider,r2_object_key,original_filename,bytes,status,mime_type,duration_ms,width,height,thumbnail_asset_id")
        .in("id", content.assetIds)
        .eq("status", "ready");
      if (assetError) throw assetError;
      const primaryAssets = assetRows || [];
      const thumbnailIds = [...new Set(primaryAssets.map(asset => asset.thumbnail_asset_id).filter(Boolean).map(String))];
      let thumbnailRows = [];
      if (thumbnailIds.length) {
        const { data: rows, error: thumbnailError } = await supabase
          .from("v5_media_assets")
          .select("id,type,provider,r2_object_key,original_filename,bytes,status,mime_type,duration_ms,width,height")
          .in("id", thumbnailIds)
          .eq("status", "ready");
        if (thumbnailError) throw thumbnailError;
        thumbnailRows = rows || [];
      }
      const playableThumbnailIds = new Set(thumbnailRows.filter(asset => asset.provider === "r2" && asset.r2_object_key).map(asset => String(asset.id)));
      assets = [...primaryAssets, ...thumbnailRows].map(asset => ({
        id: asset.id,
        type: asset.type,
        thumbnail_asset_id: playableThumbnailIds.has(String(asset.thumbnail_asset_id || "")) ? asset.thumbnail_asset_id : null,
        original_filename: asset.original_filename,
        bytes: asset.bytes,
        mime_type: asset.mime_type || "",
        duration_ms: Number(asset.duration_ms || 0),
        width: Number(asset.width || 0),
        height: Number(asset.height || 0),
        playback_ready: Boolean(playbackConfigured && asset.provider === "r2" && asset.r2_object_key)
      }));
    }

    return res.status(200).json({
      success: true,
      course: { slug: course.slug, title: access.courseTitle || course.title, subtitle: course.subtitle || "", imageUrl: course.image_url || "" },
      sourceMode: clean(content.config?.source_mode) || config.source_mode || "direct",
      releaseId: release.id,
      playbackConfigured,
      lessons: content.lessons,
      posts: content.posts,
      links: content.links,
      assets
    });
  } catch (error) {
    console.error("[v5-feed]", error);
    return res.status(500).json({ success: false, error: "V5 server error" });
  }
}
