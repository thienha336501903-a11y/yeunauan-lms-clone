import { supabase } from '../utils/supabase.js';
import feedHandler from '../utils/lms-handlers/v4-telegram-feed.js';
import mediaHandler from '../utils/lms-handlers/v4-telegram-media.js';

const EMAIL = '__clone_factory_test_v4_canonical_20260814@example.invalid';
const LMS_SESSION_ID = '__clone_factory_test_lms_canonical_20260814';
const LMS_DEVICE_ID = '__clone_factory_test_lms_device_canonical_20260814';
const COURSE = 'cagiatay';
const CANONICAL = 'https://telegram-channel-cloner.vercel.app/api/telegram/media?ticket=';

function makeResponse() {
  const headers = new Map();
  let body = null;
  const res = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); return this; },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    status(code) { this.statusCode = Number(code); return this; },
    json(value) { body = value; this.headersSent = true; this.writableEnded = true; return this; },
    end(value) { if (value !== undefined) body = value; this.headersSent = true; this.writableEnded = true; return this; }
  };
  return { res, headers, getBody: () => body };
}

function makeRequest(query = {}) {
  return {
    method: 'GET',
    query,
    headers: {
      'x-lms-session-id': LMS_SESSION_ID,
      'x-lms-device-id': LMS_DEVICE_ID
    }
  };
}

async function callHandler(handler, query) {
  const { res, headers, getBody } = makeResponse();
  await handler(makeRequest(query), res);
  return { status: res.statusCode, body: getBody(), headers: Object.fromEntries(headers.entries()) };
}

async function cleanup() {
  await supabase.from('lms_v4_media_tickets').delete().eq('email', EMAIL);
  await supabase.from('lms_verified_sessions').delete().eq('email', EMAIL);
  await supabase.from('student_active_sessions').delete().eq('email', EMAIL);
  await supabase.from('student_enrollments').delete().eq('email', EMAIL);
}

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ ok: false });
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  try {
    const feed = await callHandler(feedHandler, { course: COURSE });
    if (feed.status !== 200 || !feed.body?.success) throw new Error(`feed_${feed.status}`);
    const posts = Array.isArray(feed.body.posts) ? feed.body.posts : [];
    const botPost = posts.find((post) => post?.media?.delivery === 'telegram_gateway_bot');
    const mtprotoPost = posts.find((post) => post?.media?.delivery === 'telegram_gateway_mtproto');
    if (!botPost || !mtprotoPost) throw new Error('hybrid_media_missing');

    const botMedia = await callHandler(mediaHandler, { course: COURSE, message: botPost.id });
    const mtprotoMedia = await callHandler(mediaHandler, { course: COURSE, message: mtprotoPost.id });
    const botLocation = String(botMedia.headers.location || '');
    const mtprotoLocation = String(mtprotoMedia.headers.location || '');
    if (botMedia.status !== 307 || !botLocation.startsWith(CANONICAL)) throw new Error('bot_redirect_not_canonical');
    if (mtprotoMedia.status !== 307 || !mtprotoLocation.startsWith(CANONICAL)) throw new Error('mtproto_redirect_not_canonical');

    return res.status(200).json({
      ok: true,
      feed: {
        total: feed.body?.stats?.total ?? null,
        playable: feed.body?.stats?.playable ?? null,
        botGateway: feed.body?.stats?.botGateway ?? null,
        mtprotoGateway: feed.body?.stats?.mtprotoGateway ?? null
      },
      bot: { status: botMedia.status, canonical: true },
      mtproto: { status: mtprotoMedia.status, canonical: true }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  } finally {
    await cleanup();
  }
}
