export const BOT_API_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
export const WARMUP_WINDOW_MAX = 4;
export const WARMUP_PER_TRANSPORT_MAX = 2;

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
    size: Number(item.file_size || 0),
    mtproto: Boolean(item.mtproto)
  };
}

export function findMtprotoVideoMessage(rows) {
  return (Array.isArray(rows) ? rows : []).find((row) => {
    const media = videoMetadata(row?.raw_message, row?.message_type);
    return Boolean(media && (media.mtproto || media.size > BOT_API_DOWNLOAD_LIMIT));
  }) || null;
}

export function findWarmupVideoMessages(
  rows,
  { maxTotal = WARMUP_WINDOW_MAX, maxPerTransport = WARMUP_PER_TRANSPORT_MAX } = {}
) {
  const totalLimit = Math.max(1, Math.min(8, Number(maxTotal) || WARMUP_WINDOW_MAX));
  const perTransportLimit = Math.max(
    1,
    Math.min(totalLimit, Number(maxPerTransport) || WARMUP_PER_TRANSPORT_MAX)
  );
  const selected = [];
  const counts = { bot: 0, mtproto: 0 };

  for (const row of Array.isArray(rows) ? rows : []) {
    const media = videoMetadata(row?.raw_message, row?.message_type);
    if (!media || (media.size <= 0 && !media.mtproto)) continue;

    const transport = media.mtproto || media.size > BOT_API_DOWNLOAD_LIMIT
      ? "mtproto"
      : media.fileId
        ? "bot"
        : null;
    if (!transport || counts[transport] >= perTransportLimit) continue;

    selected.push(row);
    counts[transport] += 1;
    if (selected.length >= totalLimit) break;
  }

  return selected;
}
