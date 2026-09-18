import crypto from "node:crypto";
import { supabase } from "../utils/supabase.js";
import { presignDownloadObject } from "../utils/v5-r2.js";

const COURSE_ID = "719a3171-c593-45bc-9e69-946df1957510";
const EXPECTED_REF = "ops/mochi-metadata-hash-20260918";

function clean(value) {
  return String(value || "").trim();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (process.env.VERCEL_ENV !== "preview" || clean(process.env.VERCEL_GIT_COMMIT_REF) !== EXPECTED_REF) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    const { data: jobs, error: jobsError } = await supabase
      .from("v5_jobs")
      .select("id,asset_id,status,result")
      .eq("course_id", COURSE_ID)
      .eq("status", "success");
    if (jobsError) throw jobsError;

    const jobByAsset = new Map((jobs || []).map(job => [String(job.asset_id), job]));
    const assetIds = [...jobByAsset.keys()];
    if (!assetIds.length) return res.status(200).json({ ok: true, count: 0, results: [] });

    const { data: assets, error: assetsError } = await supabase
      .from("v5_media_assets")
      .select("id,r2_object_key,bytes,mime_type,original_filename,checksum_sha256,status,provider")
      .in("id", assetIds)
      .eq("mime_type", "image/jpeg")
      .eq("status", "ready")
      .eq("provider", "r2")
      .is("checksum_sha256", null);
    if (assetsError) throw assetsError;

    const results = [];
    for (const asset of assets || []) {
      const key = clean(asset.r2_object_key);
      if (!key) {
        results.push({ assetId: asset.id, ok: false, error: "missing_object_key" });
        continue;
      }
      const url = presignDownloadObject({ key, expiresSeconds: 300 });
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        results.push({ assetId: asset.id, ok: false, error: `r2_get_${response.status}` });
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const expectedBytes = Number(asset.bytes || 0);
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || buffer.length !== expectedBytes) {
        results.push({ assetId: asset.id, ok: false, error: "size_mismatch", expectedBytes, actualBytes: buffer.length });
        continue;
      }
      const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
      const job = jobByAsset.get(String(asset.id)) || null;
      results.push({
        ok: true,
        assetId: asset.id,
        jobId: job?.id || null,
        objectKey: key,
        filename: asset.original_filename || null,
        bytes: buffer.length,
        checksumSha256: checksum
      });
    }

    return res.status(200).json({
      ok: results.every(item => item.ok),
      courseId: COURSE_ID,
      count: results.length,
      results
    });
  } catch (error) {
    console.error("[ops-mochi-metadata-hash]", error);
    return res.status(500).json({ ok: false, error: clean(error?.message || error).slice(0, 300) });
  }
}
