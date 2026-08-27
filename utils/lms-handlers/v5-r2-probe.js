import {
  abortMultipartUpload,
  createMultipartUpload,
  headR2Object,
  isR2Configured,
  presignUploadPart
} from "../v5-r2.js";

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ success: false, error: "Not found" });
  }
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!isR2Configured()) {
    return res.status(503).json({ success: false, r2: false, error: "r2_not_configured" });
  }

  const requestedKey = String(req.query?.key || "").trim();
  if (requestedKey) {
    if (!/^media\/v5\/[A-Za-z0-9._/-]+$/.test(requestedKey)) {
      return res.status(400).json({ success: false, r2: true, error: "invalid_probe_key" });
    }
    try {
      const object = await headR2Object({ key: requestedKey });
      return res.status(200).json({
        success: true,
        r2: true,
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
      return res.status(200).json({ success: true, r2: true, probe: "unexpected_object_exists" });
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
        presignedPut: false,
        status: put.status,
        detail: body.slice(0, 180)
      });
    }

    return res.status(200).json({
      success: true,
      r2: true,
      probe: "presigned_put_ok",
      presignedPut: true,
      etagVisible: Boolean(etag)
    });
  } catch (error) {
    if (uploadId) await abortMultipartUpload({ key, uploadId }).catch(() => {});
    return res.status(502).json({
      success: false,
      r2: false,
      error: "r2_probe_failed",
      detail: String(error?.message || error || "unknown").slice(0, 180)
    });
  }
}
