import assert from 'node:assert/strict';
import fs from 'node:fs';

const handler = fs.readFileSync(new URL('../utils/lms-handlers/student-dashboard.js', import.meta.url), 'utf8');
const portal = fs.readFileSync(new URL('../api/lms/portal.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../my-courses.html', import.meta.url), 'utf8');

assert.match(handler, /\.from\("orders"\)/);
assert.match(handler, /\.from\("student_enrollments"\)/);
assert.match(handler, /state = "ready"/);
assert.match(handler, /state = "approved_waiting_content"/);
assert.match(handler, /state = "pending_approval"/);
assert.match(portal, /endpoint === "student-dashboard"/);
assert.match(page, /Đã nhận đăng ký và bill chuyển khoản/);
assert.match(page, /Đã duyệt – Chờ lên bài/);
assert.match(page, /href="\/learning\?course=/);
assert.match(page, /endpoint=public-config/);

console.log('student dashboard regression checks passed');
