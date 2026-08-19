import fs from 'node:fs';

const path = 'admin.html';
let page = fs.readFileSync(path, 'utf8');
const needle = `      <div class="flex items-center gap-3">\n        <span id="hdrEmail" class="text-xs text-slate-400 font-medium hidden md:inline">admin@gmail.com</span>`;
const replacement = `      <div class="flex items-center gap-3">\n        <a href="/v4-admin.html" class="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition whitespace-nowrap">🚀 V4 Admin</a>\n        <span id="hdrEmail" class="text-xs text-slate-400 font-medium hidden md:inline">admin@gmail.com</span>`;

const matches = page.split(needle).length - 1;
if (matches !== 1) {
  throw new Error(`Expected exactly one admin header insertion point, found ${matches}`);
}
page = page.replace(needle, replacement);
fs.writeFileSync(path, page);

for (const temp of [
  'scripts/patch-v4-admin-shortcut.mjs',
  'scripts/trigger-v4-admin-shortcut.txt',
  '.github/workflows/one-time-v4-admin-shortcut.yml'
]) {
  if (fs.existsSync(temp)) fs.rmSync(temp);
}
