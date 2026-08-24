export function cleanV4IntroText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildV4IntroItems(rows = []) {
  const seenAlbumTexts = new Set();
  const items = [];

  for (const row of rows || []) {
    const text = cleanV4IntroText(row?.text) || cleanV4IntroText(row?.caption);
    if (!text) continue;

    const mediaGroupId = String(row?.media_group_id || "").trim();
    if (mediaGroupId) {
      const albumKey = `${mediaGroupId}\n${text}`;
      if (seenAlbumTexts.has(albumKey)) continue;
      seenAlbumTexts.add(albumKey);
    }

    items.push({
      id: String(row?.id || row?.source_message_id || items.length + 1),
      telegramMessageId: Number(row?.source_message_id || 0),
      mediaGroupId,
      text,
      date: row?.source_date || row?.updated_at || null
    });
  }

  return items;
}

export function courseIntroFallback(course = {}) {
  const raw = course?.raw_data && typeof course.raw_data === "object" ? course.raw_data : {};
  return cleanV4IntroText(raw.studentDisplayDescription || course?.description || "");
}
