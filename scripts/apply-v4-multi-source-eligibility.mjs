import fs from 'node:fs';

function mustReplace(text, search, replacement, label) {
  if (!text.includes(search)) throw new Error(`Missing anchor: ${label}`);
  return text.replace(search, replacement);
}

function mustReplaceRegex(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`Missing regex anchor: ${label}`);
  pattern.lastIndex = 0;
  return text.replace(pattern, replacement);
}

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }

// ── Backend: a tgcloner source's `active` flag is the clone/mirror MASTER flag,
// not V4 playback eligibility. Registered sources remain live-indexed for V4.
const handlerPath = 'utils/lms-handlers/admin-v4-source.js';
let handler = read(handlerPath);

let activeFieldCount = 0;
handler = handler.replace(/^(\s*)active: Boolean\(source\.active\),$/gm, (match, indent) => {
  activeFieldCount += 1;
  return `${indent}active: Boolean(source.active),\n${indent}mirrorActive: Boolean(source.active),\n${indent}v4Eligible: true,`;
});
if (activeFieldCount < 3) throw new Error(`Expected >=3 source active fields, got ${activeFieldCount}`);

handler = mustReplace(
  handler,
  'const sourceHealthy = Boolean(mapping?.enabled && source?.active && indexedMessageCount > 0);',
  'const sourceHealthy = Boolean(mapping?.enabled && source && indexedMessageCount > 0);',
  'health must not depend on mirror MASTER'
);

handler = mustReplace(
  handler,
  '    } else if (source && !source.active) {\n      health = course.is_published ? "broken" : "setup";\n      issue = "Nguồn Telegram inactive";\n',
  '',
  'remove inactive-as-broken health branch'
);

handler = mustReplace(
  handler,
  '  if (!source.active) {\n    return res.status(400).json({ success: false, error: "Nguồn Telegram đang inactive, chưa thể tạo khóa V4" });\n  }\n\n',
  '',
  'allow registered non-MASTER source when creating V4 course'
);

handler = mustReplace(
  handler,
  'readyEligible: Boolean(source.active && Number(source.actualMessageCount || 0) > 0)',
  'readyEligible: Boolean(Number(source.actualMessageCount || 0) > 0)',
  'ready eligibility uses indexed content, not mirror MASTER'
);

handler = mustReplace(
  handler,
  '      if (enabled && !sourceRow.active) {\n        return res.status(400).json({ success: false, error: "Nguồn Telegram đang inactive, không thể bật cho học viên" });\n      }\n\n',
  '',
  'allow enabling registered non-MASTER source'
);

write(handlerPath, handler);

// ── Publishing guard: source must exist and contain indexed posts; it does not
// need to be the clone/mirror MASTER.
const coursesPath = 'utils/lms-handlers/admin-courses.js';
let courses = read(coursesPath);
courses = mustReplace(
  courses,
  '        // feed depends on an enabled Telegram mapping, an active source and at\n        // least one indexed message.',
  '        // feed depends on an enabled Telegram mapping, a registered source and\n        // at least one indexed message. tgcloner_sources.active is only the mirror MASTER flag.',
  'publish guard comment'
);
courses = mustReplace(courses, '.select("id,active")', '.select("id")', 'source lookup no active requirement');
courses = mustReplace(courses, '          if (!source || !source.active) {', '          if (!source) {', 'source existence guard');
courses = mustReplace(
  courses,
  '            return res.status(400).json({ success: false, error: "Nguồn Telegram V4 đang không hoạt động" });',
  '            return res.status(400).json({ success: false, error: "Không tìm thấy nguồn Telegram V4 đã đăng ký" });',
  'registered source error'
);
write(coursesPath, courses);

// ── Admin UI: show mirror MASTER as informational only and use v4Eligible for
// source selection/creation. Playback health depends on mapping + indexed posts.
const pagePath = 'v4-admin.html';
let page = read(pagePath);
page = mustReplace(
  page,
  "${s.active?'':' · inactive'}",
  "${s.mirrorActive?' · MASTER mirror':''}",
  'source option mirror label'
);
page = mustReplace(
  page,
  "Trạng thái: <b>${s.active?'active':'inactive'}</b> · Đã index: <b>${Number(s.indexedMessageCount||0)}</b> bài",
  "V4: <b>đã đăng ký</b> · Mirror: <b>${s.mirrorActive?'MASTER':'không MASTER'}</b> · Đã index: <b>${Number(s.indexedMessageCount||0)}</b> bài",
  'new source hint semantics'
);
page = mustReplace(page, 'btn.disabled=!s.active', 'btn.disabled=!s.v4Eligible', 'new course source eligibility');
page = mustReplace(
  page,
  'const healthy=Boolean(mapping.enabled&&current?.active&&Number(current?.actualMessageCount||0)>0);',
  'const healthy=Boolean(mapping.enabled&&current&&Number(current?.actualMessageCount||0)>0);',
  'source health ignores mirror MASTER'
);
page = mustReplace(
  page,
  " · Mode: ${esc(mapping.mediaMode||'telegram_bot_poc')}`;applySourceEditLock()",
  " · Mode: ${esc(mapping.mediaMode||'telegram_bot_poc')} · Mirror: ${current.mirrorActive?'MASTER':'không MASTER'}`;applySourceEditLock()",
  'source details mirror label'
);
page = mustReplace(
  page,
  "if(!source?.active){alert('Nguồn Telegram đang inactive');return}",
  "if(!source?.v4Eligible){alert('Nguồn Telegram chưa được đăng ký cho V4');return}",
  'create course eligibility check'
);
page = mustReplace(
  page,
  '<div class="notice info">Dashboard chỉ đọc trạng thái. “Lần index” là mốc index lịch sử của nguồn; bài mới sau đó vẫn được webhook Telegram cập nhật tự động.</div>',
  '<div class="notice info">Dashboard chỉ đọc trạng thái. “Lần index” là mốc index lịch sử của nguồn; bài mới sau đó vẫn được webhook Telegram cập nhật tự động. Trạng thái MASTER mirror chỉ phục vụ hệ thống clone, không quyết định việc nguồn có dùng được cho V4 hay không.</div>',
  'health dashboard semantics note'
);
write(pagePath, page);

// ── Regression tests lock the multi-source contract in LMS Admin.
const testPath = 'test/v4-source-admin.test.js';
let tests = read(testPath);
tests = mustReplace(
  tests,
  '  assert.match(handler, /Nguồn Telegram đang inactive/);\n',
  '  assert.match(handler, /v4Eligible: true/);\n  assert.match(handler, /mirrorActive: Boolean\\(source\\.active\\)/);\n',
  'replace old inactive assertion'
);
tests = mustReplace(
  tests,
  "test('publishing a V4 course requires a live non-empty source', () => {",
  "test('publishing a V4 course requires a registered non-empty source', () => {",
  'publish test title'
);
tests = mustReplace(
  tests,
  '  assert.match(courses, /Chưa có bài Telegram nào/);\n});\n',
  '  assert.match(courses, /Chưa có bài Telegram nào/);\n  assert.doesNotMatch(courses, /!source\\.active/);\n});\n\ntest(\'V4 multi-source eligibility is independent from clone mirror MASTER\', () => {\n  assert.match(handler, /const sourceHealthy = Boolean\\(mapping\\?\\.enabled && source && indexedMessageCount > 0\\)/);\n  assert.match(handler, /readyEligible: Boolean\\(Number\\(source\\.actualMessageCount \\|\\| 0\\) > 0\\)/);\n  assert.doesNotMatch(handler, /Nguồn Telegram đang inactive/);\n  assert.doesNotMatch(handler, /Nguồn Telegram inactive/);\n  assert.match(page, /v4Eligible/);\n  assert.match(page, /MASTER mirror/);\n});\n',
  'append multi-source regression test'
);
write(testPath, tests);

console.log('V4 multi-source eligibility patch applied.');
