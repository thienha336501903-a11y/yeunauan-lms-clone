import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing anchor: ${label}`);
  return text.replace(from, to);
}

const pagePath = 'v4-admin.html';
let page = fs.readFileSync(pagePath, 'utf8');

page = replaceOnce(
  page,
  '.healthList{display:grid;gap:8px;margin-top:12px}',
  '.healthTools{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:8px;margin-top:12px}.healthTools input,.healthTools select{margin:0}.healthCount{font-size:10px;color:#748078;margin-top:7px;text-align:right}.healthList{display:grid;gap:8px;margin-top:9px}',
  'health tools css'
);
page = replaceOnce(
  page,
  '@media(max-width:560px){.healthSummary{grid-template-columns:1fr 1fr}.healthItem{grid-template-columns:1fr}}',
  '@media(max-width:560px){.healthSummary{grid-template-columns:1fr 1fr}.healthTools{grid-template-columns:1fr}.healthCount{text-align:left}.healthItem{grid-template-columns:1fr}}',
  'health tools mobile css'
);

page = replaceOnce(
  page,
  '    </div>\n    <div id="healthList" class="healthList"><div class="details">Đang kiểm tra sức khỏe V4...</div></div>',
  '    </div>\n    <div class="healthTools"><input id="healthSearch" type="search" placeholder="Tìm khóa, slug hoặc nguồn Telegram…" autocomplete="off"><select id="healthFilter"><option value="all">Tất cả trạng thái</option><option value="attention">Cần chú ý</option><option value="healthy">Đang khỏe</option><option value="draft">Tạm ẩn, nguồn tốt</option></select></div>\n    <div id="healthCount" class="healthCount">Đang tải…</div>\n    <div id="healthList" class="healthList"><div class="details">Đang kiểm tra sức khỏe V4...</div></div>',
  'health filter controls'
);

page = replaceOnce(
  page,
  "const state={courses:[],meta:{},config:{},course:'',sourceData:null,sources:[],health:[],slugTouched:false};",
  "const state={courses:[],meta:{},config:{},course:'',sourceData:null,sources:[],health:[],slugTouched:false,healthFilter:'all',healthSearch:''};",
  'health filter state'
);

const oldBlockStart = 'function healthLabel(row){';
const oldBlockEnd = 'async function loadHealth(){';
const start = page.indexOf(oldBlockStart);
const end = page.indexOf(oldBlockEnd);
if (start < 0 || end < 0 || end <= start) throw new Error('Missing health render block');
const replacement = `function healthLabel(row){if(row.health==='healthy')return '✓ KHỎE';if(row.health==='draft')return 'TẠM ẨN';if(row.health==='broken')return 'LỖI';return 'CẦN SETUP'}
function healthPriority(row){return row.health==='broken'?0:row.health==='setup'?1:row.health==='draft'?2:3}
function searchNorm(value){return String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/đ/g,'d')}
function healthMatches(row){const filter=state.healthFilter,health=String(row.health||'setup');if(filter==='attention'&&!['broken','setup'].includes(health))return false;if(filter==='healthy'&&health!=='healthy')return false;if(filter==='draft'&&health!=='draft')return false;const q=searchNorm(state.healthSearch);if(!q)return true;const source=row.source||{};return searchNorm([row.title,row.course,row.issue,source.title,source.username].join(' ')).includes(q)}
function renderHealthRows(){const list=$('healthList');if(!list)return;const rows=state.health.filter(healthMatches).sort((a,b)=>healthPriority(a)-healthPriority(b)||String(a.title||a.course||'').localeCompare(String(b.title||b.course||''),'vi'));$('healthCount').textContent=\`Hiển thị \${rows.length}/\${state.health.length} khóa · Cần chú ý trước\`;if(!rows.length){list.innerHTML='<div class="details">Không có khóa phù hợp với tìm kiếm/bộ lọc hiện tại.</div>';return}list.innerHTML=rows.map(row=>{const source=row.source||null;const indexed=source?Number(source.indexedMessageCount||0):0;const when=source?.indexedAt?new Date(source.indexedAt).toLocaleString('vi-VN'):'chưa index';const ingested=source?.lastIngestedAt?new Date(source.lastIngestedAt).toLocaleString('vi-VN'):'chưa có';const sourceDate=source?.lastSourceDate?new Date(source.lastSourceDate).toLocaleString('vi-VN'):'chưa có';return \`<div class="healthItem" data-course="\${esc(row.course)}"><div><div class="healthName">\${esc(row.title||row.course)} <span style="color:#8a968d;font-weight:700">(\${esc(row.course)})</span></div><div class="healthMeta">\${esc(row.issue||'')}<br>Nguồn: \${esc(source?.title||'chưa gắn')} · \${indexed} bài<br>Hệ thống ghi nhận: \${esc(ingested)} · Bài Telegram gần nhất: \${esc(sourceDate)}<br>Index lịch sử: \${esc(when)}</div></div><span class="healthPill \${esc(row.health||'setup')}">\${healthLabel(row)}</span></div>\`}).join('');list.querySelectorAll('[data-course]').forEach(el=>el.addEventListener('click',()=>selectCourse(el.dataset.course).catch(e=>alert(e.message||String(e)))))}
function renderHealth(data){state.health=Array.isArray(data?.rows)?data.rows:[];const s=data?.summary||{};$('healthTotal').textContent=Number(s.total||0);$('healthHealthy').textContent=Number(s.healthy||0);$('healthDraft').textContent=Number(s.draft||0);$('healthAttention').textContent=Number(s.attention||0);renderHealthRows()}
`;
page = page.slice(0, start) + replacement + page.slice(end);

page = replaceOnce(
  page,
  "$('healthRefreshBtn').addEventListener('click',()=>loadHealth().catch(e=>alert(e.message||String(e))));",
  "$('healthRefreshBtn').addEventListener('click',()=>loadHealth().catch(e=>alert(e.message||String(e))));$('healthSearch').addEventListener('input',()=>{state.healthSearch=$('healthSearch').value;renderHealthRows()});$('healthFilter').addEventListener('change',()=>{state.healthFilter=$('healthFilter').value;renderHealthRows()});",
  'health filter listeners'
);

fs.writeFileSync(pagePath, page);

const testPath = 'test/v4-source-admin.test.js';
let test = fs.readFileSync(testPath, 'utf8');
test = replaceOnce(
  test,
  "test('V4 admin links to safe Cloner source registration and can reload sources', () => {",
  "test('V4 health dashboard can search, filter and prioritise attention rows', () => {\n  assert.match(page, /id=\"healthSearch\"/);\n  assert.match(page, /id=\"healthFilter\"/);\n  assert.match(page, /id=\"healthCount\"/);\n  assert.match(page, /function healthPriority/);\n  assert.match(page, /function healthMatches/);\n  assert.match(page, /function renderHealthRows/);\n  assert.match(page, /Cần chú ý trước/);\n  assert.match(page, /\\['broken','setup'\\]\\.includes/);\n  assert.match(page, /localeCompare/);\n});\n\ntest('V4 admin links to safe Cloner source registration and can reload sources', () => {",
  'health filter regression test'
);
fs.writeFileSync(testPath, test);
console.log('V4 health filter/search patch applied.');
