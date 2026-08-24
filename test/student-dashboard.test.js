import assert from 'node:assert/strict';
import fs from 'node:fs';

const handler = fs.readFileSync(new URL('../utils/lms-handlers/student-dashboard.js', import.meta.url), 'utf8');
const portal = fs.readFileSync(new URL('../api/lms/portal.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../my-courses.html', import.meta.url), 'utf8');

assert.match(handler, /\.from\("orders"\)/);
assert.match(handler, /\.from\("student_enrollments"\)/);
assert.match(handler, /state\s*=\s*"ready"/);
assert.match(handler, /state\s*=\s*"approved_waiting_content"/);
assert.match(handler, /state\s*=\s*"pending_approval"/);
assert.match(handler, /description,active,is_published/);
assert.match(handler, /studentDisplayDescription\|\|course\.description/);
assert.match(handler, /createdAt:course\.created_at/);
assert.match(portal, /endpoint === "student-dashboard"/);
assert.match(page, /Đã nhận đăng ký và bill chuyển khoản/);
assert.match(page, /Đã duyệt – Chờ lên bài/);
assert.match(page, /\['lms','v4'\]\.includes/);
assert.doesNotMatch(page, /deliveryMode\|\|''\).*===\s*'v4'/);
assert.match(page, /mode==='v4'\?'LMS V4':'LMS CŨ'/);
assert.match(page, /`\/legacy-post\.html\?course=/);
assert.doesNotMatch(page, /mode==='v4'\?`\/learning\?course=/);
assert.match(page, /data-mode=/);
assert.match(page, /endpoint=public-config/);

console.log('student dashboard regression checks passed');
