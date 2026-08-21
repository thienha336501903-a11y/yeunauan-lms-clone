import fs from 'node:fs';

function replaceOnce(path, from, to) {
  const before = fs.readFileSync(path, 'utf8');
  const count = before.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: expected exactly one match, found ${count}`);
  fs.writeFileSync(path, before.replace(from, to));
}

replaceOnce(
  'admin.html',
  '<a href="/v4-admin.html" class="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition whitespace-nowrap">🚀 V4 Admin</a>',
  '<a href="/v4-course-wizard.html" class="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition whitespace-nowrap">🚀 Mở khóa V4</a>'
);

replaceOnce(
  'v4-admin.html',
  '</head>\n<body>',
  `<script>\n(()=>{const params=new URLSearchParams(location.search);if(!params.get('course')&&params.get('advanced')!=='1'){location.replace('/v4-course-wizard.html')}})();\n</script>\n</head>\n<body>`
);

replaceOnce(
  'v4-admin.html',
  '    <h1>Quản trị khóa học V4</h1>\n    <p>Tạo khóa mới, gắn nguồn Telegram, kiểm tra dữ liệu đã index và phát hành mà không cần sửa Supabase thủ công.</p>',
  '    <h1>Quản trị V4 nâng cao</h1>\n    <p>Health dashboard, nguồn Telegram, học viên và thao tác nâng cao. Khóa mới nên được mở bằng Wizard để có Draft gate + Preflight đầy đủ.</p>\n    <div class="actions" style="margin-top:14px"><a class="btn primary" href="/v4-course-wizard.html">🚀 Mở khóa mới bằng Wizard</a><a class="btn muted" href="#healthPanel">♥ Xem health dashboard</a></div>'
);

replaceOnce(
  'v4-admin.html',
  '<div class="sectionTitle"><span>＋</span><div><h2>Tạo khóa V4 mới</h2><p class="sub">Khóa mới luôn được tạo ở trạng thái Tạm ẩn để kiểm tra trước khi mở cho học viên.</p></div></div>',
  '<div class="sectionTitle"><span>＋</span><div><h2>Tạo nhanh (nâng cao)</h2><p class="sub">Fallback cho Admin kỹ thuật. Luồng vận hành chuẩn là dùng Wizard để tạo Draft, cấp quyền test, chạy Preflight rồi mới Publish.</p></div></div>'
);

replaceOnce(
  'v4-course-wizard.html',
  '<div class="top"><div class="brand">🍳 YeuNauAn · V4 Launch Wizard</div><a class="back" href="/v4-admin.html">V4 Admin đầy đủ →</a></div>',
  '<div class="top"><div class="brand">🍳 YeuNauAn · V4 Launch Wizard</div><a class="back" href="/v4-admin.html?advanced=1">V4 Admin nâng cao →</a></div>'
);

replaceOnce(
  'v4-course-wizard.html',
  '<div class="actions"><a class="btn muted" href="https://telegram-channel-cloner.vercel.app/?mode=v4-source" target="_blank" rel="noopener">＋ Đăng ký nguồn mới</a><button id="reloadSources" class="btn muted" type="button">↻ Tải lại nguồn</button></div>',
  '<div class="actions"><a id="registerSourceLink" class="btn muted" href="https://telegram-channel-cloner.vercel.app/?mode=v4-source" rel="noopener">＋ Đăng ký / import nguồn</a><button id="reloadSources" class="btn muted" type="button">↻ Tải lại nguồn</button></div>\n    <div class="notice info">Nếu chưa có nguồn: mở Cloner bằng nút trên, đăng ký kênh và import bài cũ nếu cần. Cloner sẽ có nút <b>Quay lại LMS Wizard</b>; khi quay lại, danh sách nguồn được tải mới tự động.</div>'
);

replaceOnce(
  'v4-course-wizard.html',
  "function toast(msg){const el=$('toast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add('hidden'),3300)}",
  "function toast(msg){const el=$('toast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add('hidden'),3300)}\nfunction configureClonerReturn(){const u=new URL('https://telegram-channel-cloner.vercel.app/');u.searchParams.set('mode','v4-source');u.searchParams.set('returnTo',location.origin+'/v4-course-wizard.html');$('registerSourceLink').href=u.toString()}"
);

replaceOnce(
  'v4-course-wizard.html',
  "(async()=>{try{await loadSources();const requested=new URLSearchParams(location.search).get('course');if(requested)await resumeCourse(requested);updateSteps()}catch(e){alert(e.message||String(e))}})();",
  "(async()=>{try{configureClonerReturn();await loadSources();const requested=new URLSearchParams(location.search).get('course');if(requested)await resumeCourse(requested);updateSteps()}catch(e){alert(e.message||String(e))}})();"
);

console.log('Patched V4 primary Wizard navigation successfully.');
