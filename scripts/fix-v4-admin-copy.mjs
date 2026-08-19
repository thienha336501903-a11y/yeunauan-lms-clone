import fs from 'node:fs';
const path='v4-admin.html';
let text=fs.readFileSync(path,'utf8');
const replacements=[
  ['Chỉ khi nguồn hoạt động và đã có bài index thì mới có thể bấm Sẵn sàng.','Chỉ khi nguồn đã đăng ký, mapping đang bật và có bài index thì mới có thể bấm Sẵn sàng.'],
  ['Khi bật <b>Sẵn sàng</b>, backend sẽ kiểm tra mapping đang bật, nguồn Telegram còn active và có ít nhất một bài được index.','Khi bật <b>Sẵn sàng</b>, backend sẽ kiểm tra mapping đang bật, nguồn Telegram đã đăng ký và có ít nhất một bài được index.']
];
for (const [from,to] of replacements){if(!text.includes(from))throw new Error('Missing copy anchor: '+from);text=text.replace(from,to)}
fs.writeFileSync(path,text);
console.log('V4 Admin copy aligned with multi-source contract.');
