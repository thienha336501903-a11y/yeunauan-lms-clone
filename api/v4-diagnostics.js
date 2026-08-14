import { supabase } from '../utils/supabase.js';

const COURSE = 'cagiatay';
const BOT_LIMIT = 20 * 1024 * 1024;

function mediaFromRow(row) {
  const raw = row?.raw_message || {};
  const item = raw?.video || null;
  if (!item) return null;
  return {
    size: Number(item.file_size || 0),
    fileId: String(item.file_id || ''),
    name: String(item.file_name || ''),
    mimeType: String(item.mime_type || '')
  };
}

async function botProbe(token, row) {
  const media = mediaFromRow(row);
  if (!media?.fileId) return { messageId: row?.source_message_id || null, size: media?.size || 0, hasFileId: false, getFile: null };
  const infoResponse = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(media.fileId)}`);
  const info = await infoResponse.json().catch(() => null);
  const result = {
    messageId: row.source_message_id,
    size: media.size,
    name: media.name,
    withinBotLimit: media.size <= BOT_LIMIT,
    hasFileId: true,
    getFile: { status: infoResponse.status, ok: Boolean(info?.ok), description: info?.description || null },
    range: null
  };
  if (infoResponse.ok && info?.ok && info?.result?.file_path && media.size <= BOT_LIMIT) {
    const fileResponse = await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`, { headers: { Range: 'bytes=0-1023' } });
    result.range = {
      status: fileResponse.status,
      contentLength: fileResponse.headers.get('content-length'),
      contentRange: fileResponse.headers.get('content-range'),
      acceptRanges: fileResponse.headers.get('accept-ranges')
    };
    try { await fileResponse.body?.cancel(); } catch {}
  }
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ ok: false, error: 'not_found' });
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    const { data: mapping, error: mappingError } = await supabase
      .from('lms_v4_telegram_course_sources')
      .select('source_id,enabled,media_mode')
      .eq('course_slug', COURSE)
      .maybeSingle();
    if (mappingError) throw mappingError;

    const { data: rows, error: rowsError } = await supabase
      .from('tgcloner_source_messages')
      .select('id,source_message_id,message_type,raw_message')
      .eq('source_id', mapping?.source_id || '')
      .order('source_message_id', { ascending: true });
    if (rowsError) throw rowsError;

    const videos = (rows || []).filter((row) => row.message_type === 'video');
    const small = videos.find((row) => (mediaFromRow(row)?.size || Infinity) < 10 * 1024 * 1024) || videos[0] || null;
    const nearLimit = videos.find((row) => {
      const size = mediaFromRow(row)?.size || 0;
      return size > 18 * 1024 * 1024 && size <= BOT_LIMIT;
    }) || null;
    const large = videos.find((row) => (mediaFromRow(row)?.size || 0) > BOT_LIMIT) || null;

    const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const probes = [];
    if (token) {
      for (const row of [small, nearLimit, large].filter(Boolean)) probes.push(await botProbe(token, row));
    }

    const stats = videos.reduce((acc, row) => {
      const media = mediaFromRow(row);
      if (!media) return acc;
      if (media.fileId && media.size <= BOT_LIMIT) acc.botProxy += 1;
      else if (media.fileId && media.size > BOT_LIMIT) acc.mtprotoRequired += 1;
      return acc;
    }, { totalPosts: (rows || []).length, videos: videos.length, botProxy: 0, mtprotoRequired: 0 });

    return res.status(200).json({
      ok: true,
      course: COURSE,
      mapping: mapping ? { enabled: Boolean(mapping.enabled), mediaMode: mapping.media_mode, sourceId: mapping.source_id } : null,
      botTokenConfigured: Boolean(token),
      stats,
      probes
    });
  } catch (error) {
    console.error('[v4-diagnostics]', error);
    return res.status(500).json({ ok: false, error: error?.message || 'diagnostics_failed' });
  }
}
