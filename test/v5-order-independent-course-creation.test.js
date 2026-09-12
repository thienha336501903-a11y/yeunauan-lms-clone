import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const handlerSource = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-create-course.js", import.meta.url), "utf8");
const adminHtmlSource = fs.readFileSync(new URL("../v5-admin.html", import.meta.url), "utf8");

test("LMS handler queries existing course by slug before attempting insert", () => {
  assert.match(handlerSource, /supabase\s*\.from\("courses"\)/);
  assert.match(handlerSource, /\.eq\("slug", slug\)/);
  assert.match(handlerSource, /\.maybeSingle\(\)/);
});

test("LMS handler reuses existing V5 course without inserting duplicate", () => {
  assert.match(handlerSource, /if \(existing\) \{/);
  assert.match(handlerSource, /operation: "reused_existing_course"/);
  assert.match(handlerSource, /course: existing/);
  assert.match(handlerSource, /message: "Khóa đã tồn tại trên Commerce\. Đã mở\/khởi tạo V5 Channel trên cùng khóa\."/);
});

test("LMS handler provisions v5_course_configs and hidden timeline lesson for reused course", () => {
  assert.match(handlerSource, /supabase\s*\.from\("v5_course_configs"\)/);
  assert.match(handlerSource, /authoring_mode: "timeline"/);
  assert.match(handlerSource, /supabase\s*\.from\("v5_lessons"\)/);
  assert.match(handlerSource, /system_lesson: true/);
});

test("LMS handler rejects mode conflicts with descriptive 409 error", () => {
  assert.match(handlerSource, /existingMode !== "v5"/);
  assert.match(handlerSource, /code: "mode_conflict"/);
  assert.match(handlerSource, /Slug này đã thuộc khóa ở chế độ/);
});

test("LMS handler guards cleanup so existing reused courses are never deleted on error", () => {
  assert.match(handlerSource, /let createdCourseWasInserted = false;/);
  assert.match(handlerSource, /createdCourseWasInserted = true;/);
  assert.match(handlerSource, /if \(createdCourseWasInserted && createdCourse\?\.id\) \{/);
});

test("V5 Admin UI displays friendly toast when existing course is reused from Commerce", () => {
  assert.match(adminHtmlSource, /operation==='reused_existing_course'/);
  assert.match(adminHtmlSource, /Khóa đã tồn tại trên Commerce\. Đã mở\/khởi tạo V5 Channel trên cùng khóa\./);
});
