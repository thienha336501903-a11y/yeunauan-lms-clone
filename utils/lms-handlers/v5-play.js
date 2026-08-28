import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";
import { issueV5PlaybackLease } from "../v5-playback-lease.js";
import { v5ReleaseHasAsset } from "../v5-release-snapshot.js";

function clean(value) {
  return String(value || "").trim();
}

export default async function v5PlayHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const courseSlug = clean(req.query?.course);
    const assetId = clean(req.query?.asset);
    if (!assetId) return res.status(400).json({ success: false, code: "missing_asset", error: "Thiếu media asset." });

    const access = await requireV4CourseAccess(req, courseSlug);
    if (!access.ok) return res.status(access.status).json({ success: false, code: access.code, error: access.error });

    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("id,slug,delivery_mode")
      .eq("slug", courseSlug)
      .maybeSingle();
    if (courseError) throw courseError;
    if (!course || clean(course.delivery_mode).toLowerCase() !== "v5") {
      return res.status(404).json({ success: false, code: "v5_course_not_found", error: "Không tìm thấy khóa V5." });
    }

    const { data: config, error: configError } = await supabase
      .from("v5_course_configs")
      .select("status,published_release_id")
      .eq("course_id", course.id)
      .maybeSingle();
    if (configError) throw configError;
    if (!config || config.status !== "published" || !config.published_release_id) {
      return res.status(403).json({ success: false, code: "v5_not_published", error: "Khóa V5 chưa được Publish." });
    }

    const { data: release, error: releaseError } = await supabase
      .from("v5_releases")
      .select("id,status,snapshot")
      .eq("id", config.published_release_id)
      .eq("course_id", course.id)
      .maybeSingle();
    if (releaseError) throw releaseError;
    if (!release || release.status !== "published" || !v5ReleaseHasAsset(release.snapshot, assetId)) {
      return res.status(404).json({ success: false, code: "v5_media_not_linked", error: "Media không thuộc release V5 đang Publish." });
    }

    const { data: asset, error: assetError } = await supabase
      .from("v5_media_assets")
      .select("id,type,provider,r2_object_key,mime_type,original_filename,status")
      .eq("id", assetId)
      .maybeSingle();
    if (assetError) throw assetError;
    if (!asset || asset.status !== "ready" || asset.provider !== "r2" || !asset.r2_object_key) {
      return res.status(404).json({ success: false, code: "v5_media_not_ready", error: "Media V5 chưa sẵn sàng." });
    }

    const lease = issueV5PlaybackLease({
      assetId: asset.id,
      courseSlug,
      objectKey: asset.r2_object_key,
      mimeType: asset.mime_type,
      filename: asset.original_filename,
      userAgent: req.headers["user-agent"] || "",
      email: access.email
    });

    return res.status(200).json({
      success: true,
      assetId: asset.id,
      releaseId: release.id,
      playbackUrl: lease.url,
      expiresAt: lease.expiresAt
    });
  } catch (error) {
    console.error("[v5-play]", error);
    const status = error?.code === "v5_playback_not_configured" ? 503 : 500;
    return res.status(status).json({ success: false, code: error?.code || "v5_play_failed", error: status === 503 ? error.message : "V5 playback server error" });
  }
}
