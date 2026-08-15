export const BOT_API_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

const VIDEO_MESSAGE_TYPES = new Set(["video", "animation", "video_note"]);

export function telegramVideoMessageTypes() {
  return [...VIDEO_MESSAGE_TYPES];
}

function videoMetadata(raw, messageType) {
  if (!VIDEO_MESSAGE_TYPES.has(messageType)) return null;
  const value = raw && typeof raw === "object" ? raw : {};
  const key = messageType === "video_note" ? "video_note" : messageType;
  const item = value[key] && typeof value[key] === "object" ? value[key] : null;
  if (!item) return null;
  return {
    fileId: String(item.file_id || ""),
    size: Number(item.file_size || 0)
  };
}

export function findMtprotoVideoMessage(rows) {
  return (Array.isArray(rows) ? rows : []).find((row) => {
    const media = videoMetadata(row?.raw_message, row?.message_type);
    return Boolean(media && media.size > BOT_API_DOWNLOAD_LIMIT);
  }) || null;
}

export function findWarmupVideoMessages(rows) {
  let bot = null;
  let mtproto = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const media = videoMetadata(row?.raw_message, row?.message_type);
    if (!media || media.size <= 0) continue;
    if (!bot && media.fileId && media.size <= BOT_API_DOWNLOAD_LIMIT) bot = row;
    if (!mtproto && media.size > BOT_API_DOWNLOAD_LIMIT) mtproto = row;
    if (bot && mtproto) break;
  }
  return [bot, mtproto].filter(Boolean);
}
