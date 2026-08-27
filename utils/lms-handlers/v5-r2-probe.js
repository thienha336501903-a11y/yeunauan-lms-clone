import {
  abortMultipartUpload,
  createMultipartUpload,
  headR2Object,
  isR2Configured,
  presignUploadPart
} from "../v5-r2.js";
import { supabase } from "../supabase.js";
import { issueV5PlaybackLease, publicJwkFromPrivateEnv } from "../v5-playback-lease.js";

const PLAYBACK_PROBE_COURSE = "__clone_factory_test_v5_r2_gate";
const PLAYBACK_PROBE_UA = "V5-Playback-Probe/1.0";

function playbackSigningReady() {
  try {
    const jwk = publicJwkFromPrivateEnv();
    return Boolean(jwk?.kty === "EC" && jwk?.crv === "P-256" && jwk?.x && jwk?.y);
  } catch {
    return false;
  }
}

async function loadPlaybackProbeAsset() {
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id,slug")
    .eq("slug", PLAYBACK_PROBE_COURSE)
    .maybeSingle();
  if (courseError) throw courseError;
  if (!course) throw new Error("probe_course_missing");

  const { data: posts, error: postsError } = await supabase
    .from("v5_posts")
    .select("id")
    .eq("course_id", course.id)
    .neq("status", "archived");
  if (postsError) throw postsError;
  const postIds = (posts || []).map(row => row.id).filter(Boolean);
  if (!postIds.length) throw new Error("probe_post_missing");

  const { data: links, error: linksError } = await supabase
    .from("v5_post_assets")
    .select("asset_id")
    .in("post_id", postIds);
  if (linksError) throw linksError;
  const assetIds = [...new Set((links || []).map(row => row.asset_id).filter(Boolean))];
  if (!assetIds.length) throw new Error("probe_asset_link_missing");

  const { data: assets, error: assetsError } = await supabase
    .from("v5_media_assets")
    .select("id,r2_object_key,bytes,mime_type,original_filename,status,provider")
    .in("id", assetIds)
    .eq("status", "ready")
    .eq("provider", "r2")
    .limit(1);
  if (assetsError) throw assetsError;
  const asset = assets?.[0] || null;
  if (!asset?.id || !asset?.r2_object_key || !Number(asset?.bytes || 0)) throw new Error("probe_ready_asset_missing");
  return asset;
}

async function runPlaybackProbe() {
  if (!playbackSigningReady()) throw new Error("playback_signing_not_ready");
  if (!String(process.env.V5_MEDIA_PUBLIC_URL || "").trim()) throw new Error("media_public_url_not_ready");

  const asset = await loadPlaybackProbeAsset();
  const expectedBytes = Number(asset.bytes || 0);
  const expectedRangeBytes = Math.min(10, expectedBytes);
  const expectedEnd = expectedRangeBytes - 1;
  const lease = issueV5PlaybackLease({
    assetId: asset.id,
    courseSlug: PLAYBACK_PROBE_COURSE,
    objectKey: asset.r2_object_key,
    mimeType: asset.mime_type,
    filename: asset.original_filename,
    userAgent: PLAYBACK_PROBE_UA,
    email: "preview-probe@local.invalid",
    ttlMs: 2 * 60 * 1000
  });

  const response = await fetch(lease.url, {
    method: "GET",
    headers: {
      Range: `bytes=0-${expectedEnd}`,
      "User-Agent": PLAYBACK_PROBE_UA
    },
    redirect: "error"
  });
  const body = Buffer.from(await response.arrayBuffer());
  const contentRange = response.headers.get("content-range") || "";
  const acceptRanges = response.headers.get("accept-ranges") || "";
  const expectedContentRange = `bytes 0-${expectedEnd}/${expectedBytes}`;
  const ok = response.status === 206
    && body.length === expectedRangeBytes
    && contentRange === expectedContentRange
    && acceptRanges.toLowerCase() === "bytes";

  return {
    ok,
    workerStatus: response.status,
    rangeBytes: body.length,
    expectedRangeBytes,
    objectBytes: expectedBytes,
    contentRange,
    acceptRanges: acceptRanges.toLowerCase() === "bytes"
  };
}

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ success: false, error: "Not found" });
  }
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!isR2Configured()) {
    return res.status(503).json({ success: false, r2: false, playbackSigning: playbackSigningReady(), error: "r2_not_configured" });
  }

  if (String(req.query?.playback || "") === "1") {
    try {
      const result = await runPlaybackProbe();
      return res.status(result.ok ? 200 : 502).json({
        success: result.ok,
        r2: true,
        playbackSigning: playbackSigningReady(),
        probe: "playback_range",
        ...result
      });
    } catch (error) {
      return res.status(502).json({
        success: false,
        r2: true,
        playbackSigning: playbackSigningReady(),
        probe: "playback_range",
        error: "playback_probe_failed",
        detail: String(error?.message || error || "unknown").slice(0, 180)
      });
    }
  }

  const requestedKey = String(req.query?.key || "").trim();
  if (requestedKey) {
    if (!/^media\/v5\/[A-Za-z0-9._/-]+$/.test(requestedKey)) {
      return res.status(400).json({ success: false, r2: true, playbackSigning: playbackSigningReady(), error: "invalid_probe_key" });
    }
    try {
      const object = await headR2Object({ key: requestedKey });
      return res.status(200).json({
        success: true,
        r2: true,
        playbackSigning: playbackSigningReady(),
        probe: "object_stat",
        exists: Boolean(object),
        bytes: Number(object?.bytes || 0),
        etagVisible: Boolean(object?.etag),
        contentType: object?.contentType || ""
      });
    } catch (error) {
      return res.status(502).json({
        success: false,
        r2: false,
        playbackSigning: playbackSigningReady(),
        error: "r2_stat_failed",
        detail: String(error?.message || error || "unknown").slice(0, 180)
      });
    }
  }

  const key = `__v5_probe__/presign-${Date.now()}.txt`;
  let uploadId = "";
  try {
    const object = await headR2Object({ key });
    if (object) {
      return res.status(200).json({ success: true, r2: true, playbackSigning: playbackSigningReady(), probe: "unexpected_object_exists" });
    }

    const multipart = await createMultipartUpload({ key, contentType: "text/plain" });
    uploadId = multipart.uploadId;
    const url = presignUploadPart({ key, uploadId, partNumber: 1, expiresSeconds: 300 });
    const put = await fetch(url, { method: "PUT", body: Buffer.from("v5-r2-presign-probe", "utf8") });
    const etag = put.headers.get("etag") || "";
    const body = await put.text().catch(() => "");
    await abortMultipartUpload({ key, uploadId }).catch(() => {});
    uploadId = "";

    if (!put.ok) {
      return res.status(502).json({
        success: false,
        r2: true,
        playbackSigning: playbackSigningReady(),
        presignedPut: false,
        status: put.status,
        detail: body.slice(0, 180)
      });
    }

    return res.status(200).json({
      success: true,
      r2: true,
      playbackSigning: playbackSigningReady(),
      probe: "presigned_put_ok",
      presignedPut: true,
      etagVisible: Boolean(etag)
    });
  } catch (error) {
    if (uploadId) await abortMultipartUpload({ key, uploadId }).catch(() => {});
    return res.status(502).json({
      success: false,
      r2: false,
      playbackSigning: playbackSigningReady(),
      error: "r2_probe_failed",
      detail: String(error?.message || error || "unknown").slice(0, 180)
    });
  }
}
