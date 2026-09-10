import crypto from "node:crypto";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
let cachedPrivateJwkRaw = "";
let cachedPrivateKey = null;

function clean(value) {
  return String(value || "").trim();
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sha256base64url(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("base64url");
}

function privateKey() {
  const raw = clean(process.env.V5_PLAYBACK_PRIVATE_JWK);
  if (!raw) {
    const error = new Error("V5 playback signing key chưa được cấu hình.");
    error.code = "v5_playback_not_configured";
    throw error;
  }
  if (cachedPrivateKey && cachedPrivateJwkRaw === raw) return cachedPrivateKey;
  let jwk;
  try { jwk = JSON.parse(raw); } catch { throw new Error("V5_PLAYBACK_PRIVATE_JWK không phải JSON hợp lệ."); }
  if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || !jwk?.d || !jwk?.x || !jwk?.y) throw new Error("V5 playback private JWK phải là EC P-256.");
  const key = crypto.createPrivateKey({ key: jwk, format: "jwk" });
  cachedPrivateJwkRaw = raw;
  cachedPrivateKey = key;
  return key;
}

export function isV5PlaybackConfigured() {
  try { privateKey(); return Boolean(clean(process.env.V5_MEDIA_PUBLIC_URL)); } catch { return false; }
}

export function publicJwkFromPrivateEnv() {
  const key = privateKey();
  return crypto.createPublicKey(key).export({ format: "jwk" });
}

function normalizedProofPublicJwk(value) {
  if (!value || typeof value !== "object" || value.kty !== "EC" || value.crv !== "P-256" || !clean(value.x) || !clean(value.y) || value.d) {
    const error = new Error("V5 playback proof key không hợp lệ.");
    error.code = "v5_playback_proof_invalid";
    throw error;
  }
  return { kty: "EC", crv: "P-256", x: clean(value.x), y: clean(value.y), ext: true };
}

export function issueV5PlaybackLease({ version = 1, assetId, courseSlug, objectKey, mediaType, mimeType, filename, bytes, userAgent, email, ttlMs, proofPublicJwk }) {
  const baseUrl = clean(process.env.V5_MEDIA_PUBLIC_URL).replace(/\/$/, "");
  if (!baseUrl) {
    const error = new Error("V5_MEDIA_PUBLIC_URL chưa được cấu hình.");
    error.code = "v5_playback_not_configured";
    throw error;
  }
  const now = Date.now();
  const maxTtl = 30 * 60 * 1000;
  const effectiveTtl = Math.min(maxTtl, Math.max(60 * 1000, Number(ttlMs || DEFAULT_TTL_MS)));
  const leaseVersion = Number(version) === 2 ? 2 : 1;
  const payload = {
    v: leaseVersion,
    aid: clean(assetId),
    c: clean(courseSlug),
    k: clean(objectKey),
    mt: clean(mediaType).toLowerCase(),
    ct: clean(mimeType) || "application/octet-stream",
    fn: clean(filename) || "media",
    iat: now,
    exp: now + effectiveTtl,
    uah: sha256base64url(clean(userAgent)),
    eh: sha256base64url(clean(email).toLowerCase()),
    n: crypto.randomBytes(12).toString("base64url")
  };
  if (bytes !== undefined && bytes !== null && bytes !== "") {
    const objectBytes = Number(bytes);
    if (Number.isSafeInteger(objectBytes) && objectBytes >= 0) payload.sz = objectBytes;
  }
  if (leaseVersion === 2) payload.pk = normalizedProofPublicJwk(proofPublicJwk);
  if (!payload.aid || !payload.c || !payload.k) throw new Error("Thiếu dữ liệu để cấp playback lease.");
  const encoded = base64urlJson(payload);
  const signature = crypto.sign("sha256", Buffer.from(encoded, "utf8"), { key: privateKey(), dsaEncoding: "ieee-p1363" }).toString("base64url");
  const token = `${encoded}.${signature}`;
  return {
    token,
    expiresAt: payload.exp,
    url: leaseVersion === 2 ? `${baseUrl}/v2/media` : `${baseUrl}/v1/media?t=${encodeURIComponent(token)}`
  };
}
