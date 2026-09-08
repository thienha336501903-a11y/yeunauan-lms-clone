import { supabase } from "../supabase.js";
import { requireV4CourseAccess } from "../v4-telegram-access.js";
import { issueV5PlaybackLease } from "../v5-playback-lease.js";

function clean(value) {
  return String(value || "").trim();
}

function proofPublicJwk(encodedValue) {
  const encoded = clean(encodedValue);
  if (encoded.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (value?.kty !== "EC" || value?.crv !== "P-256" || !clean(value.x) || !clean(value.y) || value.d) return null;
    return value;
  } catch {
    return null;
  }
}

export default async function v5PlayHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const courseSlug = clean(req.query?.course);
    const assetId = clean(req.query?.asset);
    if (!assetId) return res.status(400).json({ success: false, code: "missing_asset", error: "Thiếu media asset." });
    const proofHeader = clean(req.headers?.["x-v5-playback-key"]);
    const playbackProofKey = proofHeader ? proofPublicJwk(proofHeader) : null;
    if (proofHeader && !playbackProofKey) return res.status(400).json({ success: false, code: "v5_playback_proof_invalid", error: "Khóa proof V5 không hợp lệ." });
    const playbackVersion = playbackProofKey ? 2 : 1;

    const access = await requireV4CourseAccess(req, courseSlug);
    if (!access.ok) return res.status(access.status).json({ success: false, code: access.code, error: access.error });

    const course = access.course;
    if (!course || clean(course.delivery_mode).toLowerCase() !== "v5") {
      return res.status(404).json({ success: false, code: "v5_course_not_found", error: "Không tìm thấy khóa V5." });
    }

    // The published-release membership check stays inside Postgres so each lease
    // does not pull the immutable release snapshot across Supabase egress.
    // Asset metadata is independent, so run both reads concurrently.
    const [authorizationResult, assetResult] = await Promise.all([
      supabase.rpc("v5_authorize_playback_asset", {
        p_course_id: course.id,
        p_asset_id: assetId
      }),
      supabase
        .from("v5_media_assets")
        .select("id,type,provider,r2_object_key,mime_type,original_filename,bytes,status")
        .eq("id", assetId)
        .maybeSingle()
    ]);

    if (authorizationResult.error) throw authorizationResult.error;
    if (assetResult.error) throw assetResult.error;

    const releaseId = clean(authorizationResult.data);
    const asset = assetResult.data;
    if (!releaseId) {
      return res.status(404).json({ success: false, code: "v5_media_not_linked", error: "Media không thuộc release V5 đang Publish." });
    }
    if (!asset || asset.status !== "ready" || asset.provider !== "r2" || !asset.r2_object_key) {
      return res.status(404).json({ success: false, code: "v5_media_not_ready", error: "Media V5 chưa sẵn sàng." });
    }

    const lease = issueV5PlaybackLease({
      version: playbackVersion,
      assetId: asset.id,
      courseSlug,
      objectKey: asset.r2_object_key,
      mediaType: asset.type,
      mimeType: asset.mime_type,
      filename: asset.original_filename,
      bytes: asset.bytes,
      userAgent: req.headers["user-agent"] || "",
      email: access.email,
      proofPublicJwk: playbackProofKey || undefined
    });

    return res.status(200).json({
      success: true,
      assetId: asset.id,
      releaseId,
      playbackUrl: lease.url,
      ...(playbackVersion === 2 ? { playbackLease: lease.token } : {}),
      mimeType: asset.mime_type,
      expiresAt: lease.expiresAt
    });
  } catch (error) {
    console.error("[v5-play]", error);
    const status = error?.code === "v5_playback_not_configured" ? 503 : 500;
    return res.status(status).json({ success: false, code: error?.code || "v5_play_failed", error: status === 503 ? error.message : "V5 playback server error" });
  }
}
