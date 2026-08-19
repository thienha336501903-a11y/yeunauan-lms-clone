import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing anchor: ${label}`);
  return text.replace(from, to);
}

const handlerPath = 'utils/lms-handlers/admin-v4-source.js';
let handler = fs.readFileSync(handlerPath, 'utf8');

const helperAnchor = `async function sourceWithCount(sourceId) {`;
const helper = `async function listV4Health() {
  const { data: courses, error: coursesError } = await supabase
    .from("courses")
    .select("slug,title,is_published,active,updated_at")
    .eq("delivery_mode", "v4")
    .order("updated_at", { ascending: false });
  if (coursesError) throw coursesError;

  const slugs = (courses || []).map((row) => row.slug).filter(Boolean);
  let mappings = [];
  if (slugs.length) {
    const { data, error } = await supabase
      .from("lms_v4_telegram_course_sources")
      .select("course_slug,source_id,enabled,media_mode,updated_at")
      .in("course_slug", slugs);
    if (error) throw error;
    mappings = data || [];
  }

  const sourceIds = [...new Set(mappings.map((row) => row.source_id).filter(Boolean))];
  let sources = [];
  if (sourceIds.length) {
    const { data, error } = await supabase
      .from("tgcloner_sources")
      .select("id,title,username,active,indexed_at,indexed_message_count,updated_at")
      .in("id", sourceIds);
    if (error) throw error;
    sources = data || [];
  }

  const mappingByCourse = new Map(mappings.map((row) => [row.course_slug, row]));
  const sourceById = new Map(sources.map((row) => [row.id, row]));
  const rows = (courses || []).map((course) => {
    const mapping = mappingByCourse.get(course.slug) || null;
    const source = mapping?.source_id ? sourceById.get(mapping.source_id) || null : null;
    const indexedMessageCount = Number(source?.indexed_message_count || 0);
    const sourceHealthy = Boolean(mapping?.enabled && source?.active && indexedMessageCount > 0);
    let health = "setup";
    let issue = "Chưa gắn nguồn Telegram";
    if (mapping && !source) {
      health = "broken";
      issue = "Mapping đang trỏ tới nguồn không tồn tại";
    } else if (mapping && !mapping.enabled) {
      health = course.is_published ? "broken" : "setup";
      issue = "Nguồn đang tắt";
    } else if (source && !source.active) {
      health = course.is_published ? "broken" : "setup";
      issue = "Nguồn Telegram inactive";
    } else if (source && indexedMessageCount <= 0) {
      health = course.is_published ? "broken" : "setup";
      issue = "Nguồn chưa có bài index";
    } else if (sourceHealthy && course.is_published) {
      health = "healthy";
      issue = "Hoạt động bình thường";
    } else if (sourceHealthy) {
      health = "draft";
      issue = "Nguồn tốt, khóa đang Tạm ẩn";
    }

    return {
      course: course.slug,
      title: course.title || course.slug,
      active: course.active !== false,
      isPublished: Boolean(course.is_published),
      health,
      issue,
      sourceHealthy,
      source: source ? {
        id: source.id,
        title: source.title || source.username || "Telegram",
        active: Boolean(source.active),
        indexedAt: source.indexed_at || null,
        indexedMessageCount,
        updatedAt: source.updated_at || null
      } : null,
      mapping: mapping ? {
        enabled: Boolean(mapping.enabled),
        mediaMode: mapping.media_mode || "telegram_bot_poc",
        updatedAt: mapping.updated_at || null
      } : null
    };
  });

  const summary = rows.reduce((acc, row) => {
    acc.total += 1;
    if (row.health === "healthy") acc.healthy += 1;
    else if (row.health === "draft") acc.draft += 1;
    else acc.attention += 1;
    return acc;
  }, { total: 0, healthy: 0, draft: 0, attention: 0 });

  return { rows, summary };
}

${helperAnchor}`;
handler = replaceOnce(handler, helperAnchor, helper, 'health helper insertion');

const authAnchor = `    const admin = getAdminFromRequest(req);\n    if (!admin) return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });\n\n    const mode = String(req.query?.mode || "").trim();`;
const authReplacement = `    const admin = getAdminFromRequest(req);\n    if (!admin) return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });\n\n    const mode = String(req.query?.mode || "").trim();\n    if (req.method === "GET" && mode === "health") {\n      const health = await listV4Health();\n      return res.status(200).json({ success: true, ...health });\n    }`;
handler = replaceOnce(handler, authAnchor, authReplacement, 'health route insertion');
fs.writeFileSync(handlerPath, handler);

const pagePath = 'v4-admin.html';
let page = fs.readFileSync(pagePath, 'utf8');
page = replaceOnce(page,
  `</style>\n</head>`,
  `</style>\n<style>\n.healthSummary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.healthStat{background:#f7f9f7;border:1px solid #e5ebe6;border-radius:14px;padding:10px}.healthStat b{display:block;font-size:20px;color:#2f4936}.healthStat span{font-size:10px;color:#748078;font-weight:800}.healthList{display:grid;gap:8px;margin-top:12px}.healthItem{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #e5ebe6;background:#fafcfa;border-radius:15px;padding:11px 12px;cursor:pointer}.healthItem:hover{background:#f3f8f4}.healthName{font-size:12px;font-weight:950;color:#2f3c32}.healthMeta{font-size:10px;color:#728078;margin-top:4px;line-height:1.45}.healthPill{font-size:9px;font-weight:950;border-radius:999px;padding:6px 8px;white-space:nowrap}.healthPill.healthy{background:#e4f5e8;color:#286c3c}.healthPill.draft{background:#e8f0fb;color:#35629b}.healthPill.setup{background:#fff2d9;color:#8a6117}.healthPill.broken{background:#fde7e7;color:#973a3a}@media(max-width:560px){.healthSummary{grid-template-columns:1fr 1fr}.healthItem{grid-template-columns:1fr}}\n</style>\n</head>`,
  'health styles');

const heroAnchor = `  <section class="hero">\n    <h1>Quản trị khóa học V4</h1>\n    <p>Tạo khóa mới, gắn nguồn Telegram, kiểm tra dữ liệu đã index và phát hành mà không cần sửa Supabase thủ công.</p>\n  </section>`;
const healthPanel = `${heroAnchor}\n\n  <section class="panel" id="healthPanel">\n    <div class="between">\n      <div class="sectionTitle"><span>♥</span><div><h2>Tổng quan sức khỏe V4</h2><p class="sub">Theo dõi trạng thái phát hành, mapping nguồn và dữ liệu index của tất cả khóa V4.</p></div></div>\n      <button id="healthRefreshBtn" class="btn muted" type="button">↻ Làm mới</button>\n    </div>\n    <div class="healthSummary">\n      <div class="healthStat"><b id="healthTotal">–</b><span>Tổng khóa V4</span></div>\n      <div class="healthStat"><b id="healthHealthy">–</b><span>Đang khỏe</span></div>\n      <div class="healthStat"><b id="healthDraft">–</b><span>Tạm ẩn, nguồn tốt</span></div>\n      <div class="healthStat"><b id="healthAttention">–</b><span>Cần chú ý</span></div>\n    </div>\n    <div id="healthList" class="healthList"><div class="details">Đang kiểm tra sức khỏe V4...</div></div>\n    <div class="notice info">Dashboard chỉ đọc trạng thái. “Lần index” là mốc index lịch sử của nguồn; bài mới sau đó vẫn được webhook Telegram cập nhật tự động.</div>\n  </section>`;
page = replaceOnce(page, heroAnchor, healthPanel, 'health panel');

page = replaceOnce(page,
  `const state={courses:[],meta:{},config:{},course:'',sourceData:null,sources:[],slugTouched:false};`,
  `const state={courses:[],meta:{},config:{},course:'',sourceData:null,sources:[],health:[],slugTouched:false};`,
  'health state');

const jsAnchor = `function updateNewSourceHint(){const s=state.sources.find(x=>x.id===$('newCourseSource').value);const hint=$('newSourceHint');const btn=$('createCourseBtn');if(!s){hint.textContent=state.sources.length?'Hãy chọn nguồn Telegram cho khóa mới.':'Chưa có nguồn Telegram nào được đăng ký.';btn.disabled=true;return}const when=s.indexedAt?new Date(s.indexedAt).toLocaleString('vi-VN'):'chưa index';hint.innerHTML=\`<b>\${esc(s.title||s.username||'Telegram')}</b><br>Trạng thái: <b>\${s.active?'active':'inactive'}</b> · Đã index: <b>\${Number(s.indexedMessageCount||0)}</b> bài · Lần index: \${esc(when)}\`;btn.disabled=!s.active}`;
const healthJs = `${jsAnchor}\nfunction healthLabel(row){if(row.health==='healthy')return '✓ KHỎE';if(row.health==='draft')return 'TẠM ẨN';if(row.health==='broken')return 'LỖI';return 'CẦN SETUP'}\nfunction renderHealth(data){state.health=Array.isArray(data?.rows)?data.rows:[];const s=data?.summary||{};$('healthTotal').textContent=Number(s.total||0);$('healthHealthy').textContent=Number(s.healthy||0);$('healthDraft').textContent=Number(s.draft||0);$('healthAttention').textContent=Number(s.attention||0);const list=$('healthList');if(!state.health.length){list.innerHTML='<div class="details">Chưa có khóa V4 nào.</div>';return}list.innerHTML=state.health.map(row=>{const source=row.source||null;const indexed=source?Number(source.indexedMessageCount||0):0;const when=source?.indexedAt?new Date(source.indexedAt).toLocaleString('vi-VN'):'chưa index';return \`<div class="healthItem" data-course="\${esc(row.course)}"><div><div class="healthName">\${esc(row.title||row.course)} <span style="color:#8a968d;font-weight:700">(\${esc(row.course)})</span></div><div class="healthMeta">\${esc(row.issue||'')}<br>Nguồn: \${esc(source?.title||'chưa gắn')} · \${indexed} bài · Lần index: \${esc(when)}</div></div><span class="healthPill \${esc(row.health||'setup')}">\${healthLabel(row)}</span></div>\`}).join('');list.querySelectorAll('[data-course]').forEach(el=>el.addEventListener('click',()=>selectCourse(el.dataset.course).catch(e=>alert(e.message||String(e)))))}\nasync function loadHealth(){const list=$('healthList');if(list)list.innerHTML='<div class="details">Đang kiểm tra sức khỏe V4...</div>';const{r,d}=await jsonFetch('/api/lms/admin?endpoint=v4-source&mode=health');if(!r.ok||!d.success)throw new Error(d.error||'Không tải được sức khỏe V4');renderHealth(d)}`;
page = replaceOnce(page, jsAnchor, healthJs, 'health JS');

page = replaceOnce(page,
  `await loadCourses(d.course);toast(d.readyEligible?'Đã tạo khóa V4. Nguồn đủ dữ liệu, có thể kiểm tra rồi bật Sẵn sàng.':'Đã tạo khóa V4 ở trạng thái Tạm ẩn. Nguồn chưa có bài nên chưa thể phát hành.')`,
  `await loadCourses(d.course);await loadHealth();toast(d.readyEligible?'Đã tạo khóa V4. Nguồn đủ dữ liệu, có thể kiểm tra rồi bật Sẵn sàng.':'Đã tạo khóa V4 ở trạng thái Tạm ẩn. Nguồn chưa có bài nên chưa thể phát hành.')`,
  'refresh health after create');
page = replaceOnce(page,
  `setReleaseUi();toast(d.isPublished?'Đã bật Sẵn sàng':'Đã Tạm ẩn khóa V4')`,
  `setReleaseUi();await loadHealth();toast(d.isPublished?'Đã bật Sẵn sàng':'Đã Tạm ẩn khóa V4')`,
  'refresh health after publish');
page = replaceOnce(page,
  `toast('Đã lưu nguồn Telegram V4');await loadSource()`,
  `toast('Đã lưu nguồn Telegram V4');await loadSource();await loadHealth()`,
  'refresh health after source save');
page = replaceOnce(page,
  `$('newCourseTitle').addEventListener('input',()=>{if(!state.slugTouched)$('newCourseSlug').value=slugify($('newCourseTitle').value)});`,
  `$('healthRefreshBtn').addEventListener('click',()=>loadHealth().catch(e=>alert(e.message||String(e))));$('newCourseTitle').addEventListener('input',()=>{if(!state.slugTouched)$('newCourseSlug').value=slugify($('newCourseTitle').value)});`,
  'health refresh listener');
page = replaceOnce(page,
  `(async()=>{try{await loadSources();await loadCourses()}catch(e){`,
  `(async()=>{try{await loadSources();await loadCourses();await loadHealth()}catch(e){`,
  'initial health load');
fs.writeFileSync(pagePath, page);

const testPath = 'test/v4-source-admin.test.js';
let test = fs.readFileSync(testPath, 'utf8');
const testAnchor = `test('publishing a V4 course requires a live non-empty source', () => {`;
const newTests = `test('V4 admin exposes a read-only health dashboard', () => {\n  assert.match(handler, /mode === "health"/);\n  assert.match(handler, /listV4Health/);\n  assert.match(handler, /sourceHealthy/);\n  assert.match(handler, /indexed_message_count/);\n  assert.match(page, /Tổng quan sức khỏe V4/);\n  assert.match(page, /endpoint=v4-source&mode=health/);\n  assert.match(page, /healthAttention/);\n  assert.match(page, /healthRefreshBtn/);\n});\n\n${testAnchor}`;
test = replaceOnce(test, testAnchor, newTests, 'health tests');
fs.writeFileSync(testPath, test);

console.log('V4 health dashboard patch applied.');
