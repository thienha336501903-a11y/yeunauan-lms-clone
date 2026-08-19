import fs from 'node:fs';

const file = 'my-courses.html';
let text = fs.readFileSync(file, 'utf8');

function replaceOnce(from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  text = text.replace(from, to);
}

replaceOnce(
  '<title>Khóa học của tôi</title>',
  '<title>Khóa học V4 của tôi</title>',
  'document title'
);
replaceOnce(
  '<h1>Khóa học của tôi</h1>\n    <p>Theo dõi trạng thái đăng ký, duyệt học và vào lớp tại một nơi.</p>',
  '<h1>Khóa học V4 của tôi</h1>\n    <p>Theo dõi trạng thái đăng ký, duyệt học và vào lớp V4 tại một nơi.</p>',
  'hero copy'
);
replaceOnce(
  '<div><h2>Danh sách khóa học</h2><p class="sub">Trạng thái được cập nhật trực tiếp từ hệ thống.</p></div>',
  '<div><h2>Danh sách khóa học V4</h2><p class="sub">Trạng thái được cập nhật trực tiếp từ hệ thống V4.</p></div>',
  'panel copy'
);
replaceOnce(
  "const courses=Array.isArray(data.courses)?data.courses:[];if(!courses.length){content.innerHTML='<div class=\"empty\"><b>Chưa có khóa học nào</b>Không tìm thấy đơn đăng ký hoặc quyền học cho Gmail này.</div>';return}",
  "const courses=(Array.isArray(data.courses)?data.courses:[]).filter(c=>String(c.deliveryMode||'').trim().toLowerCase()==='v4');if(!courses.length){content.innerHTML='<div class=\"empty\"><b>Chưa có khóa học V4 nào</b>Không tìm thấy đơn đăng ký hoặc quyền học V4 cho Gmail này.</div>';return}",
  'V4-only course filter'
);

fs.writeFileSync(file, text);
console.log('V4 course manager patch applied');
