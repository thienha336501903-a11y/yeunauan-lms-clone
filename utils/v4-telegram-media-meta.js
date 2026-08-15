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
