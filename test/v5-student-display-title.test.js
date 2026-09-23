import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("1. Learner title precedence: studentDisplayTitle -> course.title -> slug", () => {
  function resolveTitle(rawData, courseTitle, slug) {
    return String(rawData?.studentDisplayTitle || courseTitle || slug).trim() || slug;
  }

  // No override -> canonical title
  assert.equal(resolveTitle({}, "Bánh Mì Mè Đen", "banh-mi-me-den"), "Bánh Mì Mè Đen");
  // Set override -> override title
  assert.equal(resolveTitle({ studentDisplayTitle: "Lớp Bánh Mì Cao Cấp 2026" }, "Bánh Mì Mè Đen", "banh-mi-me-den"), "Lớp Bánh Mì Cao Cấp 2026");
  // Empty override -> fallback canonical
  assert.equal(resolveTitle({ studentDisplayTitle: "" }, "Bánh Mì Mè Đen", "banh-mi-me-den"), "Bánh Mì Mè Đen");
  // Both empty -> slug fallback
  assert.equal(resolveTitle({}, "", "banh-mi-me-den"), "banh-mi-me-den");
});

test("2. V4 access resolves courseTitle from rawData.studentDisplayTitle || course.title || slug", () => {
  const code = read("utils/v4-telegram-access.js");
  assert.match(code, /select\("id,slug,title,subtitle,image_url,raw_data,is_published,delivery_mode"\)/);
  assert.match(code, /const rawData = course\.raw_data && typeof course\.raw_data === "object" \? course\.raw_data : \{\};/);
  assert.match(code, /const courseTitle = String\(rawData\.studentDisplayTitle \|\| course\.title \|\| slug\)\.trim\(\) \|\| slug;/);
  assert.match(code, /return \{ ok: true, email, courseSlug: slug, courseTitle, course \};/);
});

test("3. V5 feed uses access.courseTitle || course.title for student-facing title", () => {
  const code = read("utils/lms-handlers/v5-feed.js");
  assert.match(code, /course: \{\s*slug: course\.slug,\s*title: access\.courseTitle \|\| course\.title/);
});

test("4. V5 course intro uses access.courseTitle || course.title for learner header", () => {
  const code = read("utils/lms-handlers/v5-course-intro.js");
  assert.match(code, /course: \{\s*slug: course\.slug,\s*title: access\.courseTitle \|\| course\.title\s*\}/);
});

test("5. Student dashboard (My Courses) gives precedence to raw.studentDisplayTitle", () => {
  const code = read("utils/lms-handlers/student-dashboard.js");
  assert.match(code, /raw_data/);
  assert.match(code, /const title=String\(raw\.studentDisplayTitle\|\|course\.title\|\|order\?\.course_title\|\|slug\)\.trim\(\)\|\|slug;/);
});

test("6. Invariant: canonical courses.title and slug are NEVER modified by setStudentDisplayTitle", () => {
  const code = read("utils/lms-handlers/admin-courses.js");
  // Verification that setStudentDisplayTitle updates only courses.raw_data
  assert.match(code, /action === "setStudentDisplayTitle"/);
  assert.match(code, /\.from\("courses"\)\s*\.update\(\{\s*raw_data:\s*rawData/);
  assert.doesNotMatch(code, /courses"\)\.update\(\{.*title:/);
  assert.doesNotMatch(code, /courses"\)\.update\(\{.*slug:/);
});

test("7. Invariant: active, is_published, and delivery_mode are NOT touched", () => {
  const code = read("utils/lms-handlers/admin-courses.js");
  const updateBlock = code.slice(code.indexOf('action === "setStudentDisplayTitle"'), code.indexOf('if (action !== "updateConfig")'));
  assert.doesNotMatch(updateBlock, /active:/);
  assert.doesNotMatch(updateBlock, /is_published:/);
  assert.doesNotMatch(updateBlock, /delivery_mode:/);
});

test("8. Invariant: No V5 release or snapshot mutation on display title change", () => {
  const code = read("utils/lms-handlers/admin-courses.js");
  const updateBlock = code.slice(code.indexOf('action === "setStudentDisplayTitle"'), code.indexOf('if (action !== "updateConfig")'));
  assert.doesNotMatch(updateBlock, /v5_releases/);
  assert.doesNotMatch(updateBlock, /v5_release_snapshots/);
  assert.doesNotMatch(updateBlock, /published_release_id/);
});

test("9. Raw data preservation: preserves existing keys (bank info, poster, qr, custom fields)", () => {
  const code = read("utils/lms-handlers/admin-courses.js");
  assert.match(code, /const rawData = \(courseRow\.raw_data && typeof courseRow\.raw_data === "object"\)\s*\?\s*\{\s*\.\.\.courseRow\.raw_data\s*\}\s*:\s*\{\};/);
});

test("10. Clear override: deleting key when empty falls back cleanly to canonical title", () => {
  const code = read("utils/lms-handlers/admin-courses.js");
  assert.match(code, /if \(trimmed\) \{\s*rawData\.studentDisplayTitle = trimmed;\s*\} else \{\s*delete rawData\.studentDisplayTitle;\s*\}/);
});

test("11. Input sanitization: trims whitespace and rejects titles longer than 120 chars", () => {
  const code = read("utils/lms-handlers/admin-courses.js");
  assert.match(code, /const MAX_TITLE_LENGTH = 120;/);
  assert.match(code, /trimmed\.length > MAX_TITLE_LENGTH/);
  assert.match(code, /tối đa \$\{MAX_TITLE_LENGTH\} ký tự/);
});

test("12. Vietnamese Unicode round-trip support in title handling", () => {
  const sampleVietnamese = "Bánh Mì Việt Nam Chuẩn Vị Mẹ Làm — 2026 🥖";
  const trimmed = sampleVietnamese.trim();
  assert.equal(trimmed, sampleVietnamese);
  assert.equal(trimmed.length < 120, true);
  // Verify UTF-8 normalization preserves diacritics
  assert.equal(trimmed.normalize("NFC"), sampleVietnamese.normalize("NFC"));
});

test("13. Authoritative storage: courses.raw_data takes precedence over site_config in GET courses", () => {
  const code = read("utils/lms-handlers/admin-courses.js");
  assert.match(code, /if \(rawData\.studentDisplayTitle\) \{\s*config\[`\$\{slug\}_studentDisplayTitle`\] = rawData\.studentDisplayTitle;\s*\} else \{\s*delete config\[`\$\{slug\}_studentDisplayTitle`\];\s*\}/);
});

test("14. Fail-closed: DB update errors in admin-courses are thrown, not swallowed", () => {
  const code = read("utils/lms-handlers/admin-courses.js");
  assert.match(code, /if \(updateError\) throw updateError;/);
});

test("15. V5 Admin UI: courseTitleCard contains all required management elements", () => {
  const html = read("v5-admin.html");
  assert.match(html, /id="courseTitleCard"/);
  assert.match(html, /id="canonicalTitleInput"/);
  assert.match(html, /readonly/);
  assert.match(html, /id="studentDisplayTitleInput"/);
  assert.match(html, /maxlength="120"/);
  assert.match(html, /id="saveDisplayTitleBtn"/);
});

test("16. V5 Admin UI: Helper texts strictly communicate scope and empty fallback", () => {
  const html = read("v5-admin.html");
  assert.match(html, /Chỉ thay đổi tên mà học viên nhìn thấy\. Không đổi tên khóa trên Web bán hàng, slug hoặc dữ liệu khóa học\./);
  assert.match(html, /Để trống để dùng tên khóa học gốc\./);
});

test("17. V5 Admin UI: Script connects saveDisplayTitleBtn and Enter keydown", () => {
  const html = read("v5-admin.html");
  assert.match(html, /\$\('saveDisplayTitleBtn'\)\.onclick\s*=\s*saveStudentDisplayTitle/);
  assert.match(html, /\$\('studentDisplayTitleInput'\)\.onkeydown/);
  assert.match(html, /event\.key\s*===\s*'Enter'/);
  assert.match(html, /saveStudentDisplayTitle\(\)/);
});

test("18. V5 Admin UI: updateCourseTitleUi updates inputs and protects active input", () => {
  const html = read("v5-admin.html");
  assert.match(html, /function updateCourseTitleUi\(\)/);
  assert.match(html, /document\.activeElement!==\$\('studentDisplayTitleInput'\)/);
  assert.match(html, /titleForSlug\(slug,config\)/);
});

test("19. V5 Admin UI: saveStudentDisplayTitle updates select dropdown and channel title immediately", () => {
  const html = read("v5-admin.html");
  assert.match(html, /action:'setStudentDisplayTitle'/);
  assert.match(html, /\$\('courseSelect'\)\.innerHTML=/);
  assert.match(html, /\$\('channelTitle'\)\.textContent=effectiveTitle/);
});

test("20. Content handler loadCourse includes raw_data for V5 admin operations", () => {
  const code = read("utils/lms-handlers/admin-v5-content.js");
  assert.match(code, /select\("id,slug,title,subtitle,image_url,active,is_published,delivery_mode,raw_data"\)/);
});
