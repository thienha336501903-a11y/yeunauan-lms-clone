// Preview-only learner E2E trigger; remove after PASS.
import { supabase } from '../utils/supabase.js';
import feedHandler from '../utils/lms-handlers/v4-telegram-feed.js';
import mediaHandler from '../utils/lms-handlers/v4-telegram-media.js';

const EMAIL = '__clone_factory_test_v4_ui_20260814@example.invalid';
const STUDENT_SESSION_ID = '__clone_factory_test_student_session_20260814';
const LMS_SESSION_ID = '__clone_factory_test_lms_session_20260814';
const LMS_DEVICE_ID = '__clone_factory_test_lms_device_20260814';
const COURSE = 'cagiatay';

if (process.env.VERCEL_ENV !== 'preview') process.exit(0);

function makeResponse() {
  const headers = new Map();
  let body = null;
  const res = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
      return this;
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    status(code) {
      this.statusCode = Number(code);
      return this;
    },
    json(value) {
      body = value;
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    },
    end(value) {
      if (value !== undefined) body = value;
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    }
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
  return {
    status: res.statusCode,
    body: getBody(),
    headers: Object.fromEntries(headers.entries())
  };
}

async function cleanup() {
  await supabase.from('lms_v4_media_tickets').delete().eq('email', EMAIL);
  await supabase.from('lms_verified_sessions').delete().eq('email', EMAIL);
  await supabase.from('student_active_sessions').delete().eq('email', EMAIL);
  await supabase.from('student_enrollments').delete().eq('email', EMAIL);
}

try {
  const feed = await callHandler(feedHandler, { course: COURSE });
  if (feed.status !== 200 || !feed.body?.success) {
    throw new Error(`Feed failed: ${JSON.stringify(feed)}`);
  }

  const posts = Array.isArray(feed.body.posts) ? feed.body.posts : [];
  const botPost = posts.find((post) => post?.media?.delivery === 'telegram_gateway_bot');
  const mtprotoPost = posts.find((post) => post?.media?.delivery === 'telegram_gateway_mtproto');
  if (!botPost || !mtprotoPost) {
    throw new Error(`Missing hybrid media paths: bot=${Boolean(botPost)} mtproto=${Boolean(mtprotoPost)}`);
  }

  const botMedia = await callHandler(mediaHandler, { course: COURSE, message: botPost.id });
  const mtprotoMedia = await callHandler(mediaHandler, { course: COURSE, message: mtprotoPost.id });

  for (const [label, result] of [['bot', botMedia], ['mtproto', mtprotoMedia]]) {
    const location = String(result.headers.location || '');
    if (result.status !== 307 || !location.includes('/api/telegram/media?ticket=')) {
      throw new Error(`${label} media redirect failed: ${JSON.stringify(result)}`);
    }
  }

  const { data: tickets, error: ticketError } = await supabase
    .from('lms_v4_media_tickets')
    .select('token,message_id,email,expires_at,revoked_at')
    .eq('email', EMAIL);
  if (ticketError) throw ticketError;
  if (!Array.isArray(tickets) || tickets.length !== 2) {
    throw new Error(`Expected 2 issued media tickets, got ${Array.isArray(tickets) ? tickets.length : 'invalid'}`);
  }

  const result = {
    ok: true,
    feed: {
      total: feed.body?.stats?.total ?? null,
      playable: feed.body?.stats?.playable ?? null,
      botGateway: feed.body?.stats?.botGateway ?? null,
      mtprotoGateway: feed.body?.stats?.mtprotoGateway ?? null,
      posts: posts.length
    },
    bot: {
      telegramMessageId: botPost.telegramMessageId,
      size: botPost.media?.size || 0,
      status: botMedia.status,
      hasTicketRedirect: true
    },
    mtproto: {
      telegramMessageId: mtprotoPost.telegramMessageId,
      size: mtprotoPost.media?.size || 0,
      status: mtprotoMedia.status,
      hasTicketRedirect: true
    },
    issuedTickets: tickets.length
  };

  console.log(`[v4-ui-e2e-probe] ${JSON.stringify(result)}`);
} finally {
  await cleanup();
}
