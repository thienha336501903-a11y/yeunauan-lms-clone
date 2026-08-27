import crypto from "node:crypto";

const DEFAULT_TTL_MS = 10 * 60 * 1000;

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
  let jwk;
  try { jwk = JSON.parse(raw); } catch { throw new Error("V5_PLAYBACK_PRIVATE_JWK không phải JSON hợp lệ."); }
  if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || !jwk?.d || !jwk?.x || !jwk?.y) throw new Error("V5 playback private JWK phải là EC P-256.");
  return crypto.createPrivateKey({ key: jwk, format: "jwk" });
}

export function isV5PlaybackConfigured() {
  try { privateKey(); return Boolean(clean(process.env.V5_MEDIA_PUBLIC_URL)); } catch { return false; }
}

export function publicJwkFromPrivateEnv() {
  const key = privateKey();
  return crypto.createPublicKey(key).export({ format: "jwk" });
}

export function issueV5PlaybackLease({ assetId, courseSlug, objectKey, mimeType, filename, userAgent, email, ttlMs }) {
  const baseUrl = clean(process.env.V5_MEDIA_PUBLIC_URL).replace(/\/$/, "");
  if (!baseUrl) {
    const error = new Error("V5_MEDIA_PUBLIC_URL chưa được cấu hình.");
    error.code = "v5_playback_not_configured";
    throw error;
  }
  const now = Date.now();
  const maxTtl = 30 * 60 * 1000;
  const effectiveTtl = Math.min(maxTtl, Math.max(60 * 1000, Number(ttlMs || DEFAULT_TTL_MS)));
  const payload = {
    v: 1,
    aid: clean(assetId),
    c: clean(courseSlug),
    k: clean(objectKey),
    ct: clean(mimeType) || "application/octet-stream",
    fn: clean(filename) || "media",
    iat: now,
    exp: now + effectiveTtl,
    uah: sha256base64url(clean(userAgent)),
    eh: sha256base64url(clean(email).toLowerCase()),
    n: crypto.randomBytes(12).toString("base64url")
  };
  if (!payload.aid || !payload.c || !payload.k) throw new Error("Thiếu dữ liệu để cấp playback lease.");
  const encoded = base64urlJson(payload);
  const signature = crypto.sign("sha256", Buffer.from(encoded, "utf8"), { key: privateKey(), dsaEncoding: "ieee-p1363" }).toString("base64url");
  const token = `${encoded}.${signature}`;
  return { token, expiresAt: payload.exp, url: `${baseUrl}/v1/media?t=${encodeURIComponent(token)}` };
}
