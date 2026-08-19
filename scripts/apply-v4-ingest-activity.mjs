import fs from 'node:fs';

function replaceAllChecked(text, from, to, minCount, label) {
  const count = text.split(from).length - 1;
  if (count < minCount) throw new Error(`${label}: expected >=${minCount}, got ${count}`);
  return text.split(from).join(to);
}
function replaceChecked(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing anchor: ${label}`);
  return text.replace(from, to);
}

const handlerPath='utils/lms-handlers/admin-v4-source.js';
let handler=fs.readFileSync(handlerPath,'utf8');
handler=replaceAllChecked(
  handler,
  '.select("id,title,username,active,indexed_at,indexed_message_count,updated_at")',
  '.select("id,title,username,active,indexed_at,indexed_message_count,last_ingested_at,last_source_date,updated_at")',
  3,
  'source select fields'
);
handler=replaceAllChecked(
  handler,
  'indexedMessageCount: Number(source.indexed_message_count || 0),\n    updatedAt: source.updated_at || null',
  'indexedMessageCount: Number(source.indexed_message_count || 0),\n    lastIngestedAt: source.last_ingested_at || null,\n    lastSourceDate: source.last_source_date || null,\n    updatedAt: source.updated_at || null',
  1,
  'list source DTO ingest fields'
);
handler=replaceChecked(
  handler,
  'indexedMessageCount,\n        updatedAt: source.updated_at || null',
  'indexedMessageCount,\n        lastIngestedAt: source.last_ingested_at || null,\n        lastSourceDate: source.last_source_date || null,\n        updatedAt: source.updated_at || null',
  'health source DTO ingest fields'
);
handler=replaceChecked(
  handler,
  'indexedMessageCount: Number(source.indexed_message_count || 0),\n    actualMessageCount: Number(count || 0),\n    updatedAt: source.updated_at || null',
  'indexedMessageCount: Number(source.indexed_message_count || 0),\n    actualMessageCount: Number(count || 0),\n    lastIngestedAt: source.last_ingested_at || null,\n    lastSourceDate: source.last_source_date || null,\n    updatedAt: source.updated_at || null',
  'sourceWithCount DTO ingest fields'
);
fs.writeFileSync(handlerPath,handler);

const pagePath='v4-admin.html';
let page=fs.readFileSync(pagePath,'utf8');
page=replaceChecked(
  page,
  "const when=s.indexedAt?new Date(s.indexedAt).toLocaleString('vi-VN'):'chưa index';hint.innerHTML=`<b>${esc(s.title||s.username||'Telegram')}</b><br>V4: <b>đã đăng ký</b> · Mirror: <b>${s.mirrorActive?'MASTER':'không MASTER'}</b> · Đã index: <b>${Number(s.indexedMessageCount||0)}</b> bài · Lần index: ${esc(when)}`;btn.disabled=!s.v4Eligible",
  "const when=s.indexedAt?new Date(s.indexedAt).toLocaleString('vi-VN'):'chưa index';const ingested=s.lastIngestedAt?new Date(s.lastIngestedAt).toLocaleString('vi-VN'):'chưa có';const sourceDate=s.lastSourceDate?new Date(s.lastSourceDate).toLocaleString('vi-VN'):'chưa có';hint.innerHTML=`<b>${esc(s.title||s.username||'Telegram')}</b><br>V4: <b>đã đăng ký</b> · Mirror: <b>${s.mirrorActive?'MASTER':'không MASTER'}</b> · Đã index: <b>${Number(s.indexedMessageCount||0)}</b> bài<br>Index lịch sử: ${esc(when)} · Hệ thống ghi nhận: <b>${esc(ingested)}</b><br>Bài Telegram gần nhất: ${esc(sourceDate)}`;btn.disabled=!s.v4Eligible",
  'new source ingest hint'
);
page=replaceChecked(
  page,
  "const when=source?.indexedAt?new Date(source.indexedAt).toLocaleString('vi-VN'):'chưa index';return `<div class=\"healthItem\" data-course=\"${esc(row.course)}\"><div><div class=\"healthName\">${esc(row.title||row.course)} <span style=\"color:#8a968d;font-weight:700\">(${esc(row.course)})</span></div><div class=\"healthMeta\">${esc(row.issue||'')}<br>Nguồn: ${esc(source?.title||'chưa gắn')} · ${indexed} bài · Lần index: ${esc(when)}</div></div><span class=\"healthPill ${esc(row.health||'setup')}\">${healthLabel(row)}</span></div>`",
  "const when=source?.indexedAt?new Date(source.indexedAt).toLocaleString('vi-VN'):'chưa index';const ingested=source?.lastIngestedAt?new Date(source.lastIngestedAt).toLocaleString('vi-VN'):'chưa có';const sourceDate=source?.lastSourceDate?new Date(source.lastSourceDate).toLocaleString('vi-VN'):'chưa có';return `<div class=\"healthItem\" data-course=\"${esc(row.course)}\"><div><div class=\"healthName\">${esc(row.title||row.course)} <span style=\"color:#8a968d;font-weight:700\">(${esc(row.course)})</span></div><div class=\"healthMeta\">${esc(row.issue||'')}<br>Nguồn: ${esc(source?.title||'chưa gắn')} · ${indexed} bài<br>Hệ thống ghi nhận: ${esc(ingested)} · Bài Telegram gần nhất: ${esc(sourceDate)}<br>Index lịch sử: ${esc(when)}</div></div><span class=\"healthPill ${esc(row.health||'setup')}\">${healthLabel(row)}</span></div>`",
  'health row ingest activity'
);
page=replaceChecked(
  page,
  "const when=current.indexedAt?new Date(current.indexedAt).toLocaleString('vi-VN'):'chưa index';$('sourceDetails').innerHTML=`<b>${esc(current.title||'Telegram')}</b><br>Đã index: <b>${Number(current.indexedMessageCount||0)}</b> · Dữ liệu thực tế: <b>${Number(current.actualMessageCount||0)}</b> bài<br>Lần index: ${esc(when)} · Mode: ${esc(mapping.mediaMode||'telegram_bot_poc')} · Mirror: ${current.mirrorActive?'MASTER':'không MASTER'}`;applySourceEditLock()",
  "const when=current.indexedAt?new Date(current.indexedAt).toLocaleString('vi-VN'):'chưa index';const ingested=current.lastIngestedAt?new Date(current.lastIngestedAt).toLocaleString('vi-VN'):'chưa có';const sourceDate=current.lastSourceDate?new Date(current.lastSourceDate).toLocaleString('vi-VN'):'chưa có';$('sourceDetails').innerHTML=`<b>${esc(current.title||'Telegram')}</b><br>Đã index: <b>${Number(current.indexedMessageCount||0)}</b> · Dữ liệu thực tế: <b>${Number(current.actualMessageCount||0)}</b> bài<br>Hệ thống ghi nhận: <b>${esc(ingested)}</b> · Bài Telegram gần nhất: ${esc(sourceDate)}<br>Index lịch sử: ${esc(when)} · Mode: ${esc(mapping.mediaMode||'telegram_bot_poc')} · Mirror: ${current.mirrorActive?'MASTER':'không MASTER'}`;applySourceEditLock()",
  'source detail ingest activity'
);
page=replaceChecked(
  page,
  'Dashboard chỉ đọc trạng thái. “Lần index” là mốc index lịch sử của nguồn; bài mới sau đó vẫn được webhook Telegram cập nhật tự động. Trạng thái MASTER mirror chỉ phục vụ hệ thống clone, không quyết định việc nguồn có dùng được cho V4 hay không.',
  'Dashboard chỉ đọc trạng thái. “Hệ thống ghi nhận” cho biết lần dữ liệu Telegram được ghi vào hệ thống gần nhất; “Bài Telegram gần nhất” là thời gian của bài trên kênh. Kênh lâu không đăng bài không bị coi là lỗi. Trạng thái MASTER mirror chỉ phục vụ hệ thống clone, không quyết định việc nguồn có dùng được cho V4 hay không.',
  'health activity explanation'
);
fs.writeFileSync(pagePath,page);

const testPath='test/v4-source-admin.test.js';
let test=fs.readFileSync(testPath,'utf8');
test=replaceChecked(
  test,
  "  assert.match(handler, /indexed_message_count/);\n  assert.match(page, /Tổng quan sức khỏe V4/);",
  "  assert.match(handler, /indexed_message_count/);\n  assert.match(handler, /last_ingested_at/);\n  assert.match(handler, /last_source_date/);\n  assert.match(page, /Tổng quan sức khỏe V4/);\n  assert.match(page, /Hệ thống ghi nhận/);\n  assert.match(page, /Bài Telegram gần nhất/);\n  assert.match(page, /Kênh lâu không đăng bài không bị coi là lỗi/);",
  'health ingest regression assertions'
);
fs.writeFileSync(testPath,test);
console.log('V4 ingest activity patch applied.');
