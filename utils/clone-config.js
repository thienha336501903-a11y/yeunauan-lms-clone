const DEFAULTS = Object.freeze({
  systemId: "system-b",
  systemName: "YeuBep",
  commercePublicUrl: "https://yeubep.shop",
  lmsPublicUrl: "https://hoc.yeubep.shop",
  v4PublicUrl: "https://v4.daubepnho.store",
  telegramClonerUrl: "https://reader.yeubep.shop",
  legacyPostPublicUrl: "https://yeunauan.live"
});

function clean(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

export function normalizeHttpsOrigin(value, fallback = "") {
  const candidate = clean(value || fallback);
  if (!candidate) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) && !/^https:\/\//i.test(candidate)) {
    throw new Error("clone_config_invalid_https_origin");
  }
  const withProtocol = /^https:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("clone_config_invalid_https_origin");
  }
  return url.origin;
}

export function cloneConfig(env = process.env) {
  const telegramClonerUrl = normalizeHttpsOrigin(env.TELEGRAM_CLONER_URL, DEFAULTS.telegramClonerUrl);
  return Object.freeze({
    systemId: clean(env.SYSTEM_ID) || DEFAULTS.systemId,
    systemName: clean(env.SYSTEM_NAME) || DEFAULTS.systemName,
    commercePublicUrl: normalizeHttpsOrigin(env.COMMERCE_PUBLIC_URL, DEFAULTS.commercePublicUrl),
    lmsPublicUrl: normalizeHttpsOrigin(env.LMS_PUBLIC_URL, DEFAULTS.lmsPublicUrl),
    v4PublicUrl: normalizeHttpsOrigin(env.V4_PUBLIC_URL, DEFAULTS.v4PublicUrl),
    legacyPostPublicUrl: normalizeHttpsOrigin(env.LEGACY_POST_PUBLIC_URL, DEFAULTS.legacyPostPublicUrl),
    telegramClonerUrl,
    telegramMediaGatewayUrl: clean(env.TELEGRAM_MEDIA_GATEWAY_URL) || `${telegramClonerUrl}/api/telegram/media`,
    telegramThumbnailGatewayUrl: clean(env.TELEGRAM_THUMBNAIL_GATEWAY_URL) || `${telegramClonerUrl}/api/telegram/thumbnail`,
    telegramMtprotoGatewayUrl: clean(env.TELEGRAM_MTPROTO_GATEWAY_URL) || `${telegramClonerUrl}/api/telegram/warmup`,
    telegramClonerHealthUrl: clean(env.TELEGRAM_CLONER_HEALTH_URL) || `${telegramClonerUrl}/api/health`
  });
}

export { DEFAULTS as CLONE_CONFIG_DEFAULTS };
