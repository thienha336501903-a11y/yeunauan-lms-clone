import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceExact(content, before, after, label) {
  const first = content.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (content.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }
  return content.slice(0, first) + after + content.slice(first + before.length);
}

// 1) /learning without course must never fall back to legacy/V3 feed.
{
  const path = 'api/learning.js';
  let s = read(path);
  const before = `  const requestedV4 = hasCourse ? await courseUsesV4(courseSlug) : false;\n\n  // Per-course V4 is independent from the global V4 routing flag. This lets new\n`;
  const after = `  const requestedV4 = hasCourse ? await courseUsesV4(courseSlug) : false;\n\n  // A bare /learning URL has no course context. Send students to the course\n  // manager instead of guessing a legacy runtime and accidentally opening an\n  // empty Telegram/V3 feed. Course-specific links continue through the normal\n  // V4/legacy routing below.\n  if (!hasCourse) {\n    res.setHeader(\"Cache-Control\", \"no-store\");\n    return res.redirect(307, \"/my-courses.html\");\n  }\n\n  // Per-course V4 is independent from the global V4 routing flag. This lets new\n`;
  s = replaceExact(s, before, after, 'learning bare-route redirect');
  write(path, s);
}

// 2) Admin API exposes per-course V4 release state and a guarded write action.
{
  const path = 'utils/lms-handlers/admin-courses.js';
  let s = read(path);
  s = replaceExact(
    s,
    `.select(\"slug, title, subtitle, image_url, raw_data\")`,
    `.select(\"slug, title, subtitle, image_url, raw_data, is_published, delivery_mode\")`,
    'admin courses select release fields'
  );

  s = replaceExact(
    s,
    `      const courses = (courseRows || []).map(c => c.slug);\n\n      // 2. Read Config from site_config\n`,
    `      const courses = (courseRows || []).map(c => c.slug);\n      const courseMeta = Object.fromEntries(\n        (courseRows || [])\n          .filter(c => c.slug)\n          .map(c => [c.slug, {\n            isPublished: Boolean(c.is_published),\n            deliveryMode: String(c.delivery_mode || \"lms\").trim().toLowerCase()\n          }])\n      );\n\n      // 2. Read Config from site_config\n`,
    'admin courseMeta map'
  );

  s = replaceExact(
    s,
    `      return res.status(200).json({ success: true, courses, config });`,
    `      return res.status(200).json({ success: true, courses, config, courseMeta });`,
    'admin courses GET response'
  );

  const actionBefore = `      const { action, course, config: newConfig } = req.body || {};\n\n      if (action !== \"updateConfig\") {\n        return res.status(400).json({ success: false, error: \"action không hợp lệ\" });\n      }\n`;
  const actionAfter = `      const { action, course, config: newConfig } = req.body || {};\n\n      if (action === \"setPublished\") {\n        if (!course) {\n          return res.status(400).json({ success: false, error: \"Thiếu tham số course\" });\n        }\n\n        const { data: courseRow, error: courseLookupError } = await supabase\n          .from(\"courses\")\n          .select(\"slug,delivery_mode\")\n          .eq(\"slug\", course)\n          .maybeSingle();\n        if (courseLookupError) throw courseLookupError;\n        if (!courseRow) {\n          return res.status(404).json({ success: false, error: \"Không tìm thấy khóa học\" });\n        }\n        if (String(courseRow.delivery_mode || \"\").trim().toLowerCase() !== \"v4\") {\n          return res.status(400).json({ success: false, error: \"Chỉ khóa học V4 mới dùng trạng thái Sẵn sàng/Tạm ẩn tại đây\" });\n        }\n\n        const published = req.body?.published === true;\n        const { error: publishError } = await supabase\n          .from(\"courses\")\n          .update({ is_published: published, updated_at: new Date().toISOString() })\n          .eq(\"slug\", course);\n        if (publishError) throw publishError;\n\n        return res.status(200).json({\n          success: true,\n          course,\n          deliveryMode: \"v4\",\n          isPublished: published\n        });\n      }\n\n      if (action !== \"updateConfig\") {\n        return res.status(400).json({ success: false, error: \"action không hợp lệ\" });\n      }\n`;
  s = replaceExact(s, actionBefore, actionAfter, 'admin setPublished action');
  write(path, s);
}

// 3) Main Admin UI: show V4 release controls on the selected V4 course.
{
  const path = 'admin.html';
  let s = read(path);

  s = replaceExact(
    s,
    `      courses: [],\n      globalConfig: {},\n      lessons: [],`,
    `      courses: [],\n      globalConfig: {},\n      courseMeta: {},\n      lessons: [],`,
    'admin state courseMeta'
  );

  s = replaceExact(
    s,
    `        STATE.courses = d.courses || [];\n        STATE.globalConfig = d.config || {};\n`,
    `        STATE.courses = d.courses || [];\n        STATE.globalConfig = d.config || {};\n        STATE.courseMeta = d.courseMeta || {};\n`,
    'admin load courseMeta'
  );

  s = replaceExact(
    s,
    `                <button onclick=\"saveCourseMeta()\" class=\"w-full bg-brandGreen hover:bg-brandGreenLight text-white text-xs font-bold py-2.5 rounded-xl transition shadow-sm\">Lưu cấu hình</button>\n                \n                <div class=\"pt-3 border-t border-slate-100 space-y-2 hidden\">`,
    `                <button onclick=\"saveCourseMeta()\" class=\"w-full bg-brandGreen hover:bg-brandGreenLight text-white text-xs font-bold py-2.5 rounded-xl transition shadow-sm\">Lưu cấu hình</button>\n\n                <div id=\"v4ReleaseBox\" class=\"hidden pt-3 border-t border-slate-100 space-y-2\">\n                  <div class=\"flex items-start justify-between gap-3\">\n                    <div>\n                      <div class=\"text-[10px] font-black uppercase tracking-wider text-slate-400\">Phát hành V4</div>\n                      <div id=\"v4ReleaseStatus\" class=\"mt-1 text-xs font-extrabold text-slate-700\">Đang kiểm tra...</div>\n                    </div>\n                    <span id=\"v4ReleaseBadge\" class=\"text-[10px] font-black px-2.5 py-1 rounded-full bg-slate-100 text-slate-500\">V4</span>\n                  </div>\n                  <p class=\"text-[10px] leading-relaxed text-slate-500\">Sẵn sàng cho phép học viên đã được cấp quyền mở nội dung V4. Tạm ẩn chặn nội dung nhưng không xóa bài, quyền học hay nguồn Telegram.</p>\n                  <div class=\"grid grid-cols-2 gap-2\">\n                    <button id=\"v4ReadyBtn\" type=\"button\" onclick=\"setV4Release(true)\" class=\"bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold py-2.5 px-2 rounded-xl transition\">✅ Sẵn sàng</button>\n                    <button id=\"v4HideBtn\" type=\"button\" onclick=\"setV4Release(false)\" class=\"bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold py-2.5 px-2 rounded-xl transition border border-slate-200\">⏸ Tạm ẩn</button>\n                  </div>\n                </div>\n                \n                <div class=\"pt-3 border-t border-slate-100 space-y-2 hidden\">`,
    'admin V4 release markup'
  );

  s = replaceExact(
    s,
    `      if (!course) {\n        document.getElementById(\"lessonList\").innerHTML = \"\";\n        const shareLinksBox = document.getElementById(\"shareLinksBox\");\n        if (shareLinksBox) shareLinksBox.classList.add(\"hidden\");\n        initNewLesson();\n        return;\n      }`,
    `      if (!course) {\n        document.getElementById(\"lessonList\").innerHTML = \"\";\n        const shareLinksBox = document.getElementById(\"shareLinksBox\");\n        if (shareLinksBox) shareLinksBox.classList.add(\"hidden\");\n        document.getElementById(\"v4ReleaseBox\")?.classList.add(\"hidden\");\n        initNewLesson();\n        return;\n      }`,
    'admin hide V4 release when no course'
  );

  s = replaceExact(
    s,
    `      if (shareCourseUrl) shareCourseUrl.value = \`${'${window.location.origin}'}/lms.html?course=${'${encodeURIComponent(course)}'}\`;`,
    `      if (shareCourseUrl) shareCourseUrl.value = \`${'${window.location.origin}'}/learning?course=${'${encodeURIComponent(course)}'}\`;`,
    'admin canonical course share link'
  );

  s = replaceExact(
    s,
    `      document.getElementById(\"metaQrImage\").value = STATE.globalConfig[\`${'${course}'}_qrImage\`] || \"\";\n      \n      const statusDiv = document.getElementById(\"driveUtilStatus\");`,
    `      document.getElementById(\"metaQrImage\").value = STATE.globalConfig[\`${'${course}'}_qrImage\`] || \"\";\n      renderV4ReleaseControls(course);\n      \n      const statusDiv = document.getElementById(\"driveUtilStatus\");`,
    'admin render release controls on course change'
  );

  const functionAnchor = `    // ── Save Course Meta Config ────────────────────────────────────────────\n    async function saveCourseMeta() {`;
  const functionBlock = `    function renderV4ReleaseControls(course) {\n      const box = document.getElementById(\"v4ReleaseBox\");\n      const status = document.getElementById(\"v4ReleaseStatus\");\n      const badge = document.getElementById(\"v4ReleaseBadge\");\n      const readyBtn = document.getElementById(\"v4ReadyBtn\");\n      const hideBtn = document.getElementById(\"v4HideBtn\");\n      if (!box || !status || !badge || !readyBtn || !hideBtn) return;\n\n      const meta = STATE.courseMeta?.[course] || {};\n      const isV4 = String(meta.deliveryMode || \"\").trim().toLowerCase() === \"v4\";\n      if (!isV4) {\n        box.classList.add(\"hidden\");\n        return;\n      }\n\n      box.classList.remove(\"hidden\");\n      const published = Boolean(meta.isPublished);\n      status.textContent = published ? \"Đang Sẵn sàng cho học viên\" : \"Đang Tạm ẩn nội dung\";\n      status.className = \"mt-1 text-xs font-extrabold \" + (published ? \"text-emerald-700\" : \"text-amber-700\");\n      badge.textContent = published ? \"SẴN SÀNG\" : \"TẠM ẨN\";\n      badge.className = \"text-[10px] font-black px-2.5 py-1 rounded-full \" + (published ? \"bg-emerald-100 text-emerald-700\" : \"bg-amber-100 text-amber-700\");\n      readyBtn.disabled = published;\n      hideBtn.disabled = !published;\n      readyBtn.classList.toggle(\"opacity-40\", published);\n      hideBtn.classList.toggle(\"opacity-40\", !published);\n    }\n\n    async function setV4Release(published) {\n      const course = document.getElementById(\"courseSelect\")?.value || \"\";\n      if (!course) {\n        toast(\"Vui lòng chọn khóa học trước\", \"error\");\n        return;\n      }\n      const meta = STATE.courseMeta?.[course] || {};\n      if (String(meta.deliveryMode || \"\").trim().toLowerCase() !== \"v4\") {\n        toast(\"Khóa học này không phải V4\", \"error\");\n        return;\n      }\n      const verb = published ? \"mở nội dung V4 cho học viên đã được cấp quyền\" : \"tạm ẩn nội dung V4 với học viên\";\n      if (!confirm(\`Xác nhận ${'${verb}'}?\`)) return;\n\n      showLoader(published ? \"Đang bật Sẵn sàng...\" : \"Đang tạm ẩn khóa học...\");\n      try {\n        const res = await fetch(\"/api/lms/admin?endpoint=courses\", {\n          method: \"POST\",\n          headers: authHeaders(),\n          body: JSON.stringify({ action: \"setPublished\", course, published })\n        });\n        const d = await res.json();\n        if (!res.ok || !d.success) throw new Error(d.error || \"Không cập nhật được trạng thái\");\n        STATE.courseMeta[course] = { ...meta, deliveryMode: \"v4\", isPublished: Boolean(d.isPublished) };\n        renderV4ReleaseControls(course);\n        toast(d.isPublished ? \"Đã bật Sẵn sàng cho khóa V4\" : \"Đã Tạm ẩn khóa V4\");\n      } catch (err) {\n        toast(err?.message || \"Lỗi cập nhật trạng thái V4\", \"error\");\n      } finally {\n        hideLoader();\n      }\n    }\n\n    // ── Save Course Meta Config ────────────────────────────────────────────\n    async function saveCourseMeta() {`;
  s = replaceExact(s, functionAnchor, functionBlock, 'admin V4 release functions');

  write(path, s);
}

// 4) Regression tests.
{
  const routeTest = 'test/learning-v4-course-route.test.js';
  let s = read(routeTest);
  s += `\n\ntest('bare /learning redirects to course manager instead of legacy feed', () => {\n  assert.match(source, /if \\(!hasCourse\\)[\\s\\S]*res\\.redirect\\(307, \\"\\/my-courses\\.html\\"\\)/);\n});\n`;
  write(routeTest, s);

  const adminTest = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\n\nconst handler = fs.readFileSync(new URL('../utils/lms-handlers/admin-courses.js', import.meta.url), 'utf8');\nconst page = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');\n\ntest('admin courses API exposes V4 release metadata', () => {\n  assert.match(handler, /is_published, delivery_mode/);\n  assert.match(handler, /courseMeta/);\n  assert.match(handler, /action === \\"setPublished\\"/);\n  assert.match(handler, /update\\(\\{ is_published: published/);\n  assert.match(handler, /delivery_mode[\\s\\S]*!== \\"v4\\"/);\n});\n\ntest('admin UI can mark a selected V4 course ready or hidden', () => {\n  assert.match(page, /id=\\"v4ReleaseBox\\"/);\n  assert.match(page, /id=\\"v4ReadyBtn\\"/);\n  assert.match(page, /id=\\"v4HideBtn\\"/);\n  assert.match(page, /function setV4Release\\(published\\)/);\n  assert.match(page, /action: \\"setPublished\\"/);\n  assert.match(page, /\\/learning\\?course=/);\n});\n`;
  write('test/v4-admin-release.test.js', adminTest);
}

console.log('V4 routing/admin release patch applied successfully.');
