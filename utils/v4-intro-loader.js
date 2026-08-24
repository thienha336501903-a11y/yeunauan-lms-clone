import { supabase } from "./supabase.js";
import { buildV4IntroItems } from "./v4-intro-content.js";

export const V4_INTRO_PAGE_SIZE = 500;
export const MAX_V4_INTRO_ROWS = 10000;

export async function loadV4IntroContent(sourceId, messageCount) {
  const total = Number(messageCount || 0);
  if (!sourceId || total <= 0) {
    return { rows: [], items: [], complete: true, total };
  }

  const scanTotal = Math.min(total, MAX_V4_INTRO_ROWS);
  const rows = [];
  for (let from = 0; from < scanTotal; from += V4_INTRO_PAGE_SIZE) {
    const to = Math.min(scanTotal - 1, from + V4_INTRO_PAGE_SIZE - 1);
    const { data, error } = await supabase
      .from("tgcloner_source_messages")
      .select("id,source_message_id,media_group_id,text,caption,source_date,updated_at")
      .eq("source_id", sourceId)
      .order("source_message_id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    rows.push(...(data || []));
  }

  return {
    rows,
    items: buildV4IntroItems(rows),
    complete: rows.length === total,
    total
  };
}
