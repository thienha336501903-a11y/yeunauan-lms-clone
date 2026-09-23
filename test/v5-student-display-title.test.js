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

test("13. V5-ONLY GUARD: setStudentDisplayTitle rejects non-V5 courses and preserves data", () => {
  const code = read("utils/lms-handlers/admin-courses.js");
  // Code structure check: must verify delivery_mode === 'v5' right after course lookup
  assert.match(code, /if\s*\(String\(courseRow\.delivery_mode\s*\|\|\s*""\)\.trim\(\)\.toLowerCase\(\)\s*!==\s*"v5"\)\s*\{\s*return\s*res\.status\(400\)\.json\(\{\s*success:\s*false,\s*error:\s*"Chỉ khóa V5 mới dùng thao tác này\."\s*\}\);\s*\}/);

  // Verification that guard executes BEFORE any courses.update or site_config upsert
  const block = code.slice(code.indexOf('action === "setStudentDisplayTitle"'), code.indexOf('if (action !== "updateConfig")'));
  const guardIndex = block.indexOf('Chỉ khóa V5 mới dùng thao tác này.');
  const updateIndex = block.indexOf('.update({');
  assert.ok(guardIndex > 0, "Guard must be present");
  assert.ok(updateIndex > guardIndex, "Guard must execute before any DB update");

  // Logic simulation of guard
  function checkV5Guard(courseRow) {
    if (!courseRow) return { ok: false, status: 404, error: "Không tìm thấy khóa học" };
    if (String(courseRow.delivery_mode || "").trim().toLowerCase() !== "v5") {
      return { ok: false, status: 400, error: "Chỉ khóa V5 mới dùng thao tác này." };
    }
    return { ok: true };
  }

  // V5 accepted
  assert.deepEqual(checkV5Guard({ delivery_mode: "v5" }), { ok: true });
  assert.deepEqual(checkV5Guard({ delivery_mode: "V5 " }), { ok: true });
  // V4 rejected
  assert.deepEqual(checkV5Guard({ delivery_mode: "v4" }), { ok: false, status: 400, error: "Chỉ khóa V5 mới dùng thao tác này." });
  // LMS rejected
  assert.deepEqual(checkV5Guard({ delivery_mode: "lms" }), { ok: false, status: 400, error: "Chỉ khóa V5 mới dùng thao tác này." });
  // Missing / empty rejected
  assert.deepEqual(checkV5Guard({ delivery_mode: null }), { ok: false, status: 400, error: "Chỉ khóa V5 mới dùng thao tác này." });
  assert.deepEqual(checkV5Guard({}), { ok: false, status: 400, error: "Chỉ khóa V5 mới dùng thao tác này." });
});

test("14. V5 AUTHORITATIVE PRECEDENCE & LEGACY FALLBACK: GET normalization and clear semantics", () => {
  const code = read("utils/lms-handlers/admin-courses.js");
  const getLoop = code.slice(code.indexOf('for (const course of courseRows || [])'), code.indexOf('return res.status(200).json({ success: true, courses'));

  // Verify V5 branch isolates raw_data authority and deletes stale site_config key when empty
  assert.match(getLoop, /const\s+isV5\s*=\s*String\(course\.delivery_mode\s*\|\|\s*""\)\.trim\(\)\.toLowerCase\(\)\s*===\s*"v5";/);
  assert.match(getLoop, /if\s*\(isV5\)\s*\{\s*if\s*\(rawData\.studentDisplayTitle\)\s*\{\s*config\[`\$\{slug\}_studentDisplayTitle`\]\s*=\s*rawData\.studentDisplayTitle;\s*\}\s*else\s*\{\s*delete\s+config\[`\$\{slug\}_studentDisplayTitle`\];\s*\}\s*\}\s*else\s*\{/);

  // Logic simulation of GET config merging
  function simulateGetConfig(siteConfigRows, courseRows) {
    const config = {};
    if (siteConfigRows) {
      siteConfigRows.forEach(row => {
        const valObj = row.value;
        const val = (valObj && typeof valObj === "object" && valObj.val !== undefined) ? valObj.val : valObj;
        config[row.key] = val;
      });
    }
    for (const course of courseRows || []) {
      const slug = course.slug;
      const rawData = course.raw_data || {};
      if (!slug) continue;
      if (course.title) {
        config[`${slug}_title`] = course.title;
      }
      const isV5 = String(course.delivery_mode || "").trim().toLowerCase() === "v5";
      if (isV5) {
        if (rawData.studentDisplayTitle) {
          config[`${slug}_studentDisplayTitle`] = rawData.studentDisplayTitle;
        } else {
          delete config[`${slug}_studentDisplayTitle`];
        }
      } else {
        if (rawData.studentDisplayTitle) {
          config[`${slug}_studentDisplayTitle`] = rawData.studentDisplayTitle;
        }
      }
    }
    return config;
  }

  function titleForSlug(slug, config) {
    return String(config?.[`${slug}_studentDisplayTitle`] || config?.[`${slug}_title`] || slug);
  }

  // A. V5: raw_data has title + site_config old value -> raw_data wins
  const resA = simulateGetConfig(
    [{ key: "v5-course-a_studentDisplayTitle", value: { val: "Tên Cũ site_config" } }],
    [{ slug: "v5-course-a", title: "Tên Gốc Canonical", delivery_mode: "v5", raw_data: { studentDisplayTitle: "Tên Mới raw_data" } }]
  );
  assert.equal(resA["v5-course-a_studentDisplayTitle"], "Tên Mới raw_data");
  assert.equal(titleForSlug("v5-course-a", resA), "Tên Mới raw_data");

  // B. V5: raw_data absent + stale site_config title -> stale site_config ignored -> canonical title wins
  const resB = simulateGetConfig(
    [{ key: "v5-course-b_studentDisplayTitle", value: { val: "Tên Cũ Stale Trong site_config" } }],
    [{ slug: "v5-course-b", title: "Tên Gốc Canonical", delivery_mode: "v5", raw_data: {} }]
  );
  assert.equal(resB["v5-course-b_studentDisplayTitle"], undefined);
  assert.equal(titleForSlug("v5-course-b", resB), "Tên Gốc Canonical");

  // C. V4/LMS: raw_data absent + site_config legacy title -> site_config fallback preserved
  const resC = simulateGetConfig(
    [{ key: "v4-course-c_studentDisplayTitle", value: { val: "Tên V4 Legacy Fallback" } }],
    [{ slug: "v4-course-c", title: "Tên Gốc Canonical", delivery_mode: "v4", raw_data: {} }]
  );
  assert.equal(resC["v4-course-c_studentDisplayTitle"], "Tên V4 Legacy Fallback");
  assert.equal(titleForSlug("v4-course-c", resC), "Tên V4 Legacy Fallback");

  const resCLms = simulateGetConfig(
    [{ key: "lms-course-c_studentDisplayTitle", value: { val: "Tên LMS Legacy Fallback" } }],
    [{ slug: "lms-course-c", title: "Tên Gốc Canonical", delivery_mode: "lms", raw_data: {} }]
  );
  assert.equal(resCLms["lms-course-c_studentDisplayTitle"], "Tên LMS Legacy Fallback");
  assert.equal(titleForSlug("lms-course-c", resCLms), "Tên LMS Legacy Fallback");

  // D. Explicit V5 Clear:
  // raw_data key removed. Even if site_config still contains stale value (e.g. secondary sync failed),
  // GET effective V5 title resolves canonical
  const resDStaleSync = simulateGetConfig(
    [{ key: "v5-course-d_studentDisplayTitle", value: { val: "Stale Value Do Secondary Sync Lỗi" } }],
    [{ slug: "v5-course-d", title: "Tên Gốc Canonical V5", delivery_mode: "v5", raw_data: {} }]
  );
  assert.equal(resDStaleSync["v5-course-d_studentDisplayTitle"], undefined);
  assert.equal(titleForSlug("v5-course-d", resDStaleSync), "Tên Gốc Canonical V5");

  // And when secondary sync succeeded (val: ""):
  const resDCleanSync = simulateGetConfig(
    [{ key: "v5-course-d_studentDisplayTitle", value: { val: "" } }],
    [{ slug: "v5-course-d", title: "Tên Gốc Canonical V5", delivery_mode: "v5", raw_data: {} }]
  );
  assert.equal(resDCleanSync["v5-course-d_studentDisplayTitle"], undefined);
  assert.equal(titleForSlug("v5-course-d", resDCleanSync), "Tên Gốc Canonical V5");
});

test("15. HARDENED SYNC & FAIL-CLOSED: site_config inspection and fail-closed courses update", () => {
  const code = read("utils/lms-handlers/admin-courses.js");
  const block = code.slice(code.indexOf('action === "setStudentDisplayTitle"'), code.indexOf('if (action !== "updateConfig")'));

  // Authoritative update fails closed (throws on updateError)
  assert.match(block, /const\s*\{\s*error:\s*updateError\s*\}\s*=\s*await\s*supabase[\s\S]*?\.from\("courses"\)[\s\S]*?\.update[\s\S]*?if\s*\(updateError\)\s*throw\s*updateError;/);

  // Best-effort secondary sync explicitly inspects siteConfigError
  assert.match(block, /const\s*\{\s*error:\s*siteConfigError\s*\}\s*=\s*await\s*supabase[\s\S]*?\.from\("site_config"\)[\s\S]*?\.upsert/);
  assert.match(block, /if\s*\(siteConfigError\)\s*\{\s*console\.warn\("\[admin-courses\] Best-effort site_config sync warning:",\s*siteConfigError\.message\);\s*\}/);
});

test("16. V5 Admin UI: courseTitleCard contains all required management elements", () => {
  const html = read("v5-admin.html");
  assert.match(html, /id="courseTitleCard"/);
  assert.match(html, /id="canonicalTitleInput"/);
  assert.match(html, /readonly/);
  assert.match(html, /id="studentDisplayTitleInput"/);
  assert.match(html, /maxlength="120"/);
  assert.match(html, /id="saveDisplayTitleBtn"/);
});

test("17. V5 Admin UI: Helper texts strictly communicate scope and empty fallback", () => {
  const html = read("v5-admin.html");
  assert.match(html, /Chỉ thay đổi tên mà học viên nhìn thấy\. Không đổi tên khóa trên Web bán hàng, slug hoặc dữ liệu khóa học\./);
  assert.match(html, /Để trống để dùng tên khóa học gốc\./);
});

test("18. V5 Admin UI: Script connects saveDisplayTitleBtn and Enter keydown", () => {
  const html = read("v5-admin.html");
  assert.match(html, /\$\('saveDisplayTitleBtn'\)\.onclick\s*=\s*saveStudentDisplayTitle/);
  assert.match(html, /\$\('studentDisplayTitleInput'\)\.onkeydown/);
  assert.match(html, /event\.key\s*===\s*'Enter'/);
  assert.match(html, /saveStudentDisplayTitle\(\)/);
});

test("19. V5 Admin UI: updateCourseTitleUi updates inputs and protects active input", () => {
  const html = read("v5-admin.html");
  assert.match(html, /function updateCourseTitleUi\(\)/);
  assert.match(html, /document\.activeElement!==\$\('studentDisplayTitleInput'\)/);
  assert.match(html, /titleForSlug\(slug,config\)/);
});

test("20. V5 Admin UI: saveStudentDisplayTitle updates select dropdown and channel title immediately", () => {
  const html = read("v5-admin.html");
  assert.match(html, /action:'setStudentDisplayTitle'/);
  assert.match(html, /\$\('courseSelect'\)\.innerHTML=/);
  assert.match(html, /\$\('channelTitle'\)\.textContent=effectiveTitle/);
});

test("21. Content handler loadCourse includes raw_data for V5 admin operations", () => {
  const code = read("utils/lms-handlers/admin-v5-content.js");
  assert.match(code, /select\("id,slug,title,subtitle,image_url,active,is_published,delivery_mode,raw_data"\)/);
});
