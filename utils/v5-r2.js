import crypto from "node:crypto";

const REGION = "auto";
const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";

function env() {
  const accountId = String(process.env.R2_ACCOUNT_ID || "").trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = String(process.env.R2_BUCKET || process.env.V5_R2_BUCKET || "").trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    const error = new Error("R2 chưa được cấu hình đầy đủ.");
    error.code = "r2_not_configured";
    throw error;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function isR2Configured() {
  try { env(); return true; } catch { return false; }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function signingKey(secret, date) {
  const kDate = hmac(Buffer.from(`AWS4${secret}`, "utf8"), date);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

function amzTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function rfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function objectPath(bucket, key) {
  return `/${rfc3986(bucket)}/${String(key).split("/").map(rfc3986).join("/")}`;
}

function canonicalQuery(params) {
  return [...params.entries()]
    .map(([key, value]) => [rfc3986(key), rfc3986(value)])
    .sort(([aKey, aVal], [bKey, bVal]) => {
      if (aKey < bKey) return -1;
      if (aKey > bKey) return 1;
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
      return 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function hostFor(accountId) {
  return `${accountId}.r2.cloudflarestorage.com`;
}

function scope(dateStamp) {
  return `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
}

function signedRequest({ method, key, query = new URLSearchParams(), body = "", headers = {} }) {
  const cfg = env();
  const host = hostFor(cfg.accountId);
  const now = new Date();
  const amzDate = amzTimestamp(now);
  const dateStamp = amzDate.slice(0, 8);
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : String(body || "");
  const payloadHash = sha256(payload);
  const canonicalUri = objectPath(cfg.bucket, key);
  const queryString = canonicalQuery(query);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method.toUpperCase(), canonicalUri, queryString, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = [ALGORITHM, amzDate, scope(dateStamp), sha256(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(cfg.secretAccessKey, dateStamp), stringToSign, "hex");
  const authorization = `${ALGORITHM} Credential=${cfg.accessKeyId}/${scope(dateStamp)}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `https://${host}${canonicalUri}${queryString ? `?${queryString}` : ""}`;
  return {
    url,
    headers: {
      ...headers,
      Host: host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorization
    }
  };
}

export function presignUploadPart({ key, uploadId, partNumber, expiresSeconds = 900 }) {
  const cfg = env();
  const host = hostFor(cfg.accountId);
  const now = new Date();
  const amzDate = amzTimestamp(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = scope(dateStamp);
  const query = new URLSearchParams();
  query.set("partNumber", String(partNumber));
  query.set("uploadId", String(uploadId));
  query.set("X-Amz-Algorithm", ALGORITHM);
  query.set("X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD");
  query.set("X-Amz-Credential", `${cfg.accessKeyId}/${credentialScope}`);
  query.set("X-Amz-Date", amzDate);
  query.set("X-Amz-Expires", String(Math.min(3600, Math.max(60, Number(expiresSeconds) || 900))));
  query.set("X-Amz-SignedHeaders", "host");
  const canonicalUri = objectPath(cfg.bucket, key);
  const canonicalRequest = ["PUT", canonicalUri, canonicalQuery(query), `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(cfg.secretAccessKey, dateStamp), stringToSign, "hex");
  query.set("X-Amz-Signature", signature);
  return `https://${host}${canonicalUri}?${canonicalQuery(query)}`;
}

function xmlValue(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() || "";
}

function xmlEscape(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export async function createMultipartUpload({ key, contentType }) {
  const query = new URLSearchParams();
  query.set("uploads", "");
  const request = signedRequest({ method: "POST", key, query, headers: contentType ? { "Content-Type": contentType } : {} });
  const response = await fetch(request.url, { method: "POST", headers: request.headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`R2 create multipart failed (${response.status}): ${text.slice(0, 300)}`);
  const uploadId = xmlValue(text, "UploadId");
  if (!uploadId) throw new Error("R2 không trả UploadId.");
  return { uploadId };
}

export async function completeMultipartUpload({ key, uploadId, parts }) {
  const safeParts = (Array.isArray(parts) ? parts : [])
    .map(part => ({ partNumber: Number(part.partNumber), etag: String(part.etag || "").trim() }))
    .filter(part => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag)
    .sort((a, b) => a.partNumber - b.partNumber);
  if (!safeParts.length) throw new Error("Không có multipart parts để hoàn tất upload.");
  const body = `<CompleteMultipartUpload>${safeParts.map(part => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
  const query = new URLSearchParams();
  query.set("uploadId", String(uploadId));
  const request = signedRequest({ method: "POST", key, query, body, headers: { "Content-Type": "application/xml" } });
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body });
  const text = await response.text();
  if (!response.ok) throw new Error(`R2 complete multipart failed (${response.status}): ${text.slice(0, 300)}`);
  return { etag: xmlValue(text, "ETag"), location: xmlValue(text, "Location") };
}

export async function abortMultipartUpload({ key, uploadId }) {
  const query = new URLSearchParams();
  query.set("uploadId", String(uploadId));
  const request = signedRequest({ method: "DELETE", key, query });
  const response = await fetch(request.url, { method: "DELETE", headers: request.headers });
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`R2 abort multipart failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return { aborted: true };
}

export async function headR2Object({ key }) {
  const request = signedRequest({ method: "HEAD", key });
  const response = await fetch(request.url, { method: "HEAD", headers: request.headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`R2 HEAD failed (${response.status}).`);
  return {
    etag: response.headers.get("etag") || "",
    bytes: Number(response.headers.get("content-length") || 0),
    contentType: response.headers.get("content-type") || ""
  };
}
