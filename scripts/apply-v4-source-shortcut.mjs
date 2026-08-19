import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing anchor: ${label}`);
  return text.replace(from, to);
}

const pagePath='v4-admin.html';
let page=fs.readFileSync(pagePath,'utf8');
page=replaceOnce(
  page,
  '      <div id="newSourceHint" class="details">Đang kiểm tra các nguồn Telegram đã đăng ký.</div>\n    </div>\n    <button id="createCourseBtn"',
  '      <div id="newSourceHint" class="details">Đang kiểm tra các nguồn Telegram đã đăng ký.</div>\n      <div class="actions" style="margin-top:9px"><a id="registerSourceLink" class="btn muted" href="https://telegram-channel-cloner.vercel.app/?mode=v4-source" target="_blank" rel="noopener">＋ Đăng ký nguồn Telegram mới</a><button id="reloadSourcesBtn" class="btn muted" type="button">↻ Tải lại danh sách nguồn</button></div>\n      <div class="notice info">Nếu kênh chưa có trong danh sách: mở Cloner Admin, đăng ký nguồn V4, sau đó quay lại đây và bấm <b>Tải lại danh sách nguồn</b>. Đăng ký nguồn V4 không thay đổi MASTER mirror.</div>\n    </div>\n    <button id="createCourseBtn"',
  'source registration shortcut UI'
);
page=replaceOnce(
  page,
  "$('healthRefreshBtn').addEventListener('click',()=>loadHealth().catch(e=>alert(e.message||String(e))));",
  "$('healthRefreshBtn').addEventListener('click',()=>loadHealth().catch(e=>alert(e.message||String(e))));$('reloadSourcesBtn').addEventListener('click',async()=>{const b=$('reloadSourcesBtn');b.disabled=true;try{await loadSources();await loadHealth();toast('Đã tải lại danh sách nguồn Telegram')}catch(e){alert(e.message||String(e))}finally{b.disabled=false}});",
  'reload sources handler'
);
fs.writeFileSync(pagePath,page);

const testPath='test/v4-source-admin.test.js';
let test=fs.readFileSync(testPath,'utf8');
test=replaceOnce(
  test,
  "test('V4 ingest activity is maintained by an idempotent database trigger', () => {",
  "test('V4 admin links to safe Cloner source registration and can reload sources', () => {\n  assert.match(page, /id=\"registerSourceLink\"/);\n  assert.match(page, /telegram-channel-cloner\\.vercel\\.app\\/\\?mode=v4-source/);\n  assert.match(page, /id=\"reloadSourcesBtn\"/);\n  assert.match(page, /Đăng ký nguồn V4 không thay đổi MASTER mirror/);\n  assert.match(page, /await loadSources\\(\\);await loadHealth\\(\\)/);\n});\n\ntest('V4 ingest activity is maintained by an idempotent database trigger', () => {",
  'source shortcut regression test'
);
fs.writeFileSync(testPath,test);
console.log('V4 source registration shortcut applied.');
