import fs from 'node:fs';

function replaceOnce(text, needle, replacement, label) {
  const count = text.split(needle).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  return text.replace(needle, replacement);
}

const adminHandler = `import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";

const ALLOWED_MEDIA_MODES = new Set(["telegram_bot_poc", "mtproto_gateway", "mirror"]);

async function requireV4Course(course) {
  const slug = String(course || "").trim();
  if (!slug) return { ok: false, status: 400, error: "Thiếu tham số course" };

  const { data, error } = await supabase
    .from("courses")
    .select("slug,delivery_mode")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, status: 404, error: "Không tìm thấy khóa học" };
  if (String(data.delivery_mode || "").trim().toLowerCase() !== "v4") {
    return { ok: false, status: 400, error: "Khóa học này không phải V4" };
  }
  return { ok: true, slug };
}

async function sourceWithCount(sourceId) {
  if (!sourceId) return null;
  const { data: source, error: sourceError } = await supabase
    .from("tgcloner_sources")
    .select("id,title,username,chat_id,active,indexed_at,indexed_message_count,updated_at")
    .eq("id", sourceId)
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) return null;

  const { count, error: countError } = await supabase
    .from("tgcloner_source_messages")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId);
  if (countError) throw countError;

  return {
    id: source.id,
    title: source.title || source.username || "Telegram",
    username: source.username || "",
    active: Boolean(source.active),
    indexedAt: source.indexed_at || null,
    indexedMessageCount: Number(source.indexed_message_count || 0),
    actualMessageCount: Number(count || 0),
    updatedAt: source.updated_at || null
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const admin = getAdminFromRequest(req);
    if (!admin) return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });

    const course = String(req.query?.course || req.body?.course || "").trim();
    const checked = await requireV4Course(course);
    if (!checked.ok) return res.status(checked.status).json({ success: false, error: checked.error });

    if (req.method === "GET") {
      const { data: mapping, error: mappingError } = await supabase
        .from("lms_v4_telegram_course_sources")
        .select("course_slug,source_id,enabled,media_mode,updated_at")
        .eq("course_slug", checked.slug)
        .maybeSingle();
      if (mappingError) throw mappingError;

      const { data: sourceRows, error: sourcesError } = await supabase
        .from("tgcloner_sources")
        .select("id,title,username,active,indexed_at,indexed_message_count,updated_at")
        .order("updated_at", { ascending: false });
      if (sourcesError) throw sourcesError;

      const currentSource = mapping?.source_id ? await sourceWithCount(mapping.source_id) : null;
      const sources = (sourceRows || []).map(source => ({
        id: source.id,
        title: source.title || source.username || "Telegram",
        username: source.username || "",
        active: Boolean(source.active),
        indexedAt: source.indexed_at || null,
        indexedMessageCount: Number(source.indexed_message_count || 0),
        updatedAt: source.updated_at || null
      }));

      return res.status(200).json({
        success: true,
        course: checked.slug,
        mapping: mapping ? {
          sourceId: mapping.source_id,
          enabled: Boolean(mapping.enabled),
          mediaMode: mapping.media_mode || "telegram_bot_poc",
          updatedAt: mapping.updated_at || null
        } : null,
        source: currentSource,
        sources
      });
    }

    if (req.method === "POST") {
      const action = String(req.body?.action || "").trim();
      if (action !== "saveSource") {
        return res.status(400).json({ success: false, error: "action không hợp lệ" });
      }

      const sourceId = String(req.body?.sourceId || "").trim();
      if (!sourceId) return res.status(400).json({ success: false, error: "Chưa chọn nguồn Telegram" });

      const { data: sourceRow, error: sourceError } = await supabase
        .from("tgcloner_sources")
        .select("id,title,username,active,indexed_message_count")
        .eq("id", sourceId)
        .maybeSingle();
      if (sourceError) throw sourceError;
      if (!sourceRow) return res.status(404).json({ success: false, error: "Không tìm thấy nguồn Telegram" });

      const enabled = req.body?.enabled !== false;
      if (enabled && !sourceRow.active) {
        return res.status(400).json({ success: false, error: "Nguồn Telegram đang inactive, không thể bật cho học viên" });
      }

      const { data: existing, error: existingError } = await supabase
        .from("lms_v4_telegram_course_sources")
        .select("media_mode")
        .eq("course_slug", checked.slug)
        .maybeSingle();
      if (existingError) throw existingError;

      const requestedMode = String(req.body?.mediaMode || existing?.media_mode || "telegram_bot_poc").trim();
      const mediaMode = ALLOWED_MEDIA_MODES.has(requestedMode) ? requestedMode : "telegram_bot_poc";
      const now = new Date().toISOString();

      const { error: saveError } = await supabase
        .from("lms_v4_telegram_course_sources")
        .upsert({
          course_slug: checked.slug,
          source_id: sourceId,
          enabled,
          media_mode: mediaMode,
          updated_at: now
        }, { onConflict: "course_slug" });
      if (saveError) throw saveError;

      const source = await sourceWithCount(sourceId);
      return res.status(200).json({
        success: true,
        course: checked.slug,
        mapping: { sourceId, enabled, mediaMode, updatedAt: now },
        source
      });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (error) {
    console.error("[admin-v4-source]", error);
    return res.status(500).json({ success: false, error: "Lỗi server khi quản lý nguồn Telegram V4" });
  }
}
`;

const testFile = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../api/lms/admin.js', import.meta.url), 'utf8');
const handler = fs.readFileSync(new URL('../utils/lms-handlers/admin-v4-source.js', import.meta.url), 'utf8');
const courses = fs.readFileSync(new URL('../utils/lms-handlers/admin-courses.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

test('admin router exposes V4 Telegram source endpoint', () => {
  assert.match(router, /admin-v4-source\.js/);
  assert.match(router, /endpoint === \"v4-source\"/);
});

test('V4 source endpoint is admin-only and course-scoped', () => {
  assert.match(handler, /getAdminFromRequest\(req\)/);
  assert.match(handler, /delivery_mode/);
  assert.match(handler, /!== \"v4\"/);
  assert.match(handler, /lms_v4_telegram_course_sources/);
  assert.match(handler, /tgcloner_sources/);
  assert.match(handler, /tgcloner_source_messages/);
  assert.match(handler, /onConflict: \"course_slug\"/);
  assert.match(handler, /Nguồn Telegram đang inactive/);
});

test('admin UI exposes V4 Telegram source health and save controls', () => {
  assert.match(page, /id=\"v4SourceBox\"/);
  assert.match(page, /id=\"v4SourceSelect\"/);
  assert.match(page, /id=\"v4SourceEnabled\"/);
  assert.match(page, /function loadV4Source\(course\)/);
  assert.match(page, /function saveV4Source\(\)/);
  assert.match(page, /endpoint=v4-source/);
  assert.match(page, /actualMessageCount/);
});

test('publishing a V4 course requires a live non-empty source', () => {
  assert.match(courses, /published\)[\s\S]*lms_v4_telegram_course_sources/);
  assert.match(courses, /tgcloner_sources/);
  assert.match(courses, /tgcloner_source_messages/);
  assert.match(courses, /Chưa có bài Telegram nào/);
});
`;

fs.writeFileSync('utils/lms-handlers/admin-v4-source.js', adminHandler);
fs.writeFileSync('test/v4-source-admin.test.js', testFile);

let router = fs.readFileSync('api/lms/admin.js', 'utf8');
router = replaceOnce(
  router,
  'import adminLearningModeHandler from "../../utils/lms-handlers/admin-learning-mode.js";\n',
  'import adminLearningModeHandler from "../../utils/lms-handlers/admin-learning-mode.js";\nimport adminV4SourceHandler from "../../utils/lms-handlers/admin-v4-source.js";\n',
  'admin router import'
);
router = replaceOnce(
  router,
  '  if (endpoint === "learning-mode") {\n    return adminLearningModeHandler(req, res);\n  }\n\n  return res.status(404)',
  '  if (endpoint === "learning-mode") {\n    return adminLearningModeHandler(req, res);\n  }\n  if (endpoint === "v4-source") {\n    return adminV4SourceHandler(req, res);\n  }\n\n  return res.status(404)',
  'admin router route'
);
fs.writeFileSync('api/lms/admin.js', router);

let courses = fs.readFileSync('utils/lms-handlers/admin-courses.js', 'utf8');
courses = replaceOnce(
  courses,
  '        const published = req.body?.published === true;\n        const { error: publishError } = await supabase\n',
  `        const published = req.body?.published === true;\n\n        // A V4 course may only be marked Sẵn sàng when its Telegram source is\n        // enabled, active and already contains indexed messages. This prevents\n        // the admin from publishing a course that will immediately open an\n        // empty/broken student feed.\n        if (published) {\n          const { data: mapping, error: mappingError } = await supabase\n            .from("lms_v4_telegram_course_sources")\n            .select("source_id,enabled")\n            .eq("course_slug", course)\n            .maybeSingle();\n          if (mappingError) throw mappingError;\n          if (!mapping || !mapping.enabled) {\n            return res.status(400).json({ success: false, error: "Chưa bật nguồn Telegram V4 cho khóa học" });\n          }\n\n          const { data: source, error: sourceError } = await supabase\n            .from("tgcloner_sources")\n            .select("id,active")\n            .eq("id", mapping.source_id)\n            .maybeSingle();\n          if (sourceError) throw sourceError;\n          if (!source || !source.active) {\n            return res.status(400).json({ success: false, error: "Nguồn Telegram V4 đang không hoạt động" });\n          }\n\n          const { count, error: countError } = await supabase\n            .from("tgcloner_source_messages")\n            .select("id", { count: "exact", head: true })\n            .eq("source_id", mapping.source_id);\n          if (countError) throw countError;\n          if (!Number(count || 0)) {\n            return res.status(400).json({ success: false, error: "Chưa có bài Telegram nào được index cho khóa học" });\n          }\n        }\n\n        const { error: publishError } = await supabase\n`,
  'publish readiness guard'
);
fs.writeFileSync('utils/lms-handlers/admin-courses.js', courses);

let page = fs.readFileSync('admin.html', 'utf8');
const sourceBox = `                <div id="v4SourceBox" class="hidden pt-3 border-t border-slate-100 space-y-2">\n                  <div class="flex items-start justify-between gap-3">\n                    <div>\n                      <div class="text-[10px] font-black uppercase tracking-wider text-slate-400">Nguồn Telegram V4</div>\n                      <div id="v4SourceStatus" class="mt-1 text-xs font-extrabold text-slate-700">Đang kiểm tra...</div>\n                    </div>\n                    <span id="v4SourceBadge" class="text-[10px] font-black px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">CHƯA GẮN</span>\n                  </div>\n                  <select id="v4SourceSelect" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium bg-white"></select>\n                  <label class="flex items-center gap-2 text-[11px] font-bold text-slate-600">\n                    <input id="v4SourceEnabled" type="checkbox" class="rounded border-slate-300"/>\n                    Bật nguồn này cho học viên V4\n                  </label>\n                  <div id="v4SourceDetails" class="text-[10px] leading-relaxed text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-2.5">Chưa có dữ liệu nguồn.</div>\n                  <div class="grid grid-cols-2 gap-2">\n                    <button type="button" onclick="saveV4Source()" class="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold py-2.5 px-2 rounded-xl transition">💾 Lưu nguồn</button>\n                    <button type="button" onclick="loadV4Source(document.getElementById('courseSelect')?.value || '')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold py-2.5 px-2 rounded-xl transition border border-slate-200">↻ Kiểm tra lại</button>\n                  </div>\n                </div>\n\n`;
page = replaceOnce(
  page,
  '                </div>\n                \n                <div class="pt-3 border-t border-slate-100 space-y-2 hidden">',
  '                </div>\n\n' + sourceBox + '                <div class="pt-3 border-t border-slate-100 space-y-2 hidden">',
  'V4 source box'
);
page = replaceOnce(
  page,
  '      courseMeta: {},\n      lessons: [],',
  '      courseMeta: {},\n      v4Source: null,\n      lessons: [],',
  'admin state'
);
page = replaceOnce(
  page,
  '        document.getElementById("v4ReleaseBox")?.classList.add("hidden");\n        initNewLesson();',
  '        document.getElementById("v4ReleaseBox")?.classList.add("hidden");\n        document.getElementById("v4SourceBox")?.classList.add("hidden");\n        STATE.v4Source = null;\n        initNewLesson();',
  'clear V4 source state'
);
page = replaceOnce(
  page,
  '      renderV4ReleaseControls(course);\n      \n      const statusDiv = document.getElementById("driveUtilStatus");',
  '      renderV4ReleaseControls(course);\n      await loadV4Source(course);\n      \n      const statusDiv = document.getElementById("driveUtilStatus");',
  'load V4 source on course change'
);

const sourceFunctions = `    async function loadV4Source(course) {\n      const box = document.getElementById("v4SourceBox");\n      if (!box) return;\n      const meta = STATE.courseMeta?.[course] || {};\n      const isV4 = String(meta.deliveryMode || "").trim().toLowerCase() === "v4";\n      if (!course || !isV4) {\n        box.classList.add("hidden");\n        STATE.v4Source = null;\n        return;\n      }\n\n      box.classList.remove("hidden");\n      const status = document.getElementById("v4SourceStatus");\n      const details = document.getElementById("v4SourceDetails");\n      if (status) status.textContent = "Đang tải tình trạng nguồn...";\n      if (details) details.textContent = "Đang kiểm tra dữ liệu Telegram đã index.";\n\n      try {\n        const res = await fetch(\`/api/lms/admin?endpoint=v4-source&course=\${encodeURIComponent(course)}\`, {\n          method: "GET",\n          headers: authHeaders(),\n          cache: "no-store"\n        });\n        const d = await res.json();\n        if (!res.ok || !d.success) throw new Error(d.error || "Không tải được nguồn Telegram V4");\n        STATE.v4Source = d;\n        renderV4Source(d);\n      } catch (err) {\n        STATE.v4Source = null;\n        if (status) {\n          status.textContent = "Không kiểm tra được nguồn";\n          status.className = "mt-1 text-xs font-extrabold text-red-600";\n        }\n        if (details) details.textContent = err?.message || "Lỗi tải nguồn Telegram V4";\n      }\n    }\n\n    function renderV4Source(data) {\n      const status = document.getElementById("v4SourceStatus");\n      const badge = document.getElementById("v4SourceBadge");\n      const select = document.getElementById("v4SourceSelect");\n      const enabledInput = document.getElementById("v4SourceEnabled");\n      const details = document.getElementById("v4SourceDetails");\n      if (!status || !badge || !select || !enabledInput || !details) return;\n\n      const sources = Array.isArray(data?.sources) ? data.sources : [];\n      const mapping = data?.mapping || null;\n      const current = data?.source || null;\n      select.innerHTML = '<option value="">-- Chọn nguồn Telegram --</option>' + sources.map(source => {\n        const suffix = source.active ? '' : ' · inactive';\n        return \`<option value="\${escapeHtml(source.id)}">\${escapeHtml(source.title || source.username || source.id)}\${suffix}</option>\`;\n      }).join('');\n      select.value = mapping?.sourceId || '';\n      enabledInput.checked = Boolean(mapping?.enabled);\n\n      if (!mapping) {\n        status.textContent = "Chưa gắn nguồn Telegram";\n        status.className = "mt-1 text-xs font-extrabold text-amber-700";\n        badge.textContent = "CHƯA GẮN";\n        badge.className = "text-[10px] font-black px-2.5 py-1 rounded-full bg-amber-100 text-amber-700";\n        details.textContent = sources.length ? \`Có \${sources.length} nguồn Telegram khả dụng. Hãy chọn nguồn rồi bấm Lưu nguồn.\` : "Chưa có nguồn Telegram nào được tạo trong hệ thống Clone.";\n        return;\n      }\n\n      const healthy = Boolean(mapping.enabled && current?.active && Number(current?.actualMessageCount || 0) > 0);\n      status.textContent = healthy ? "Nguồn đang hoạt động" : (mapping.enabled ? "Nguồn cần kiểm tra" : "Nguồn đang tắt");\n      status.className = "mt-1 text-xs font-extrabold " + (healthy ? "text-emerald-700" : "text-amber-700");\n      badge.textContent = healthy ? "HOẠT ĐỘNG" : (mapping.enabled ? "CẢNH BÁO" : "ĐANG TẮT");\n      badge.className = "text-[10px] font-black px-2.5 py-1 rounded-full " + (healthy ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700");\n\n      if (!current) {\n        details.textContent = "Mapping đang trỏ tới nguồn không còn tồn tại.";\n        return;\n      }\n      const when = current.indexedAt ? new Date(current.indexedAt).toLocaleString('vi-VN') : 'chưa index';\n      details.innerHTML = \`<b>\${escapeHtml(current.title || 'Telegram')}</b><br>Đã index: <b>\${Number(current.indexedMessageCount || 0)}</b> · Dữ liệu thực tế: <b>\${Number(current.actualMessageCount || 0)}</b> bài<br>Lần index: \${escapeHtml(when)} · Mode: \${escapeHtml(mapping.mediaMode || 'telegram_bot_poc')}\`;\n    }\n\n    async function saveV4Source() {\n      const course = document.getElementById("courseSelect")?.value || "";\n      const select = document.getElementById("v4SourceSelect");\n      const enabledInput = document.getElementById("v4SourceEnabled");\n      const sourceId = select?.value || "";\n      if (!course || !sourceId) {\n        toast("Vui lòng chọn nguồn Telegram V4", "error");\n        return;\n      }\n\n      const current = STATE.v4Source?.mapping || null;\n      const enabled = Boolean(enabledInput?.checked);\n      const changingSource = Boolean(current?.sourceId && current.sourceId !== sourceId);\n      const disabling = Boolean(current?.enabled && !enabled);\n      if (changingSource || disabling) {\n        const warning = changingSource\n          ? "Bạn đang đổi nguồn Telegram của khóa học. Nội dung học viên nhìn thấy sẽ chuyển sang nguồn mới."\n          : "Bạn đang tắt nguồn Telegram. Học viên V4 sẽ không mở được feed cho đến khi bật lại.";\n        if (!confirm(warning + "\\n\\nXác nhận tiếp tục?")) return;\n      }\n\n      showLoader("Đang lưu nguồn Telegram V4...");\n      try {\n        const res = await fetch("/api/lms/admin?endpoint=v4-source", {\n          method: "POST",\n          headers: authHeaders(),\n          body: JSON.stringify({\n            action: "saveSource",\n            course,\n            sourceId,\n            enabled,\n            mediaMode: current?.mediaMode || "telegram_bot_poc"\n          })\n        });\n        const d = await res.json();\n        if (!res.ok || !d.success) throw new Error(d.error || "Không lưu được nguồn Telegram V4");\n        toast("Đã lưu nguồn Telegram V4");\n        await loadV4Source(course);\n      } catch (err) {\n        toast(err?.message || "Lỗi lưu nguồn Telegram V4", "error");\n      } finally {\n        hideLoader();\n      }\n    }\n\n`;
page = replaceOnce(
  page,
  '    // ── Save Course Meta Config ────────────────────────────────────────────\n',
  sourceFunctions + '    // ── Save Course Meta Config ────────────────────────────────────────────\n',
  'V4 source functions'
);
fs.writeFileSync('admin.html', page);

fs.rmSync('scripts/patch-v4-source-admin.mjs');
fs.rmSync('.github/workflows/one-time-v4-source-admin.yml');
