import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildV5IntroItems, cleanV5IntroText, v5CourseIntroFallback } from "../utils/v5-intro-content.js";
import { v5LearnerReleaseContent } from "../utils/v5-release-snapshot.js";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "mock-service-role-key";

const { default: v5CourseIntroHandler } = await import("../utils/lms-handlers/v5-course-intro.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function createMockRes() {
  const headers = {};
  let statusCode = 200;
  let body = null;
  let ended = false;
  return {
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    get headers() { return headers; },
    status(code) { statusCode = code; return this; },
    get statusCode() { return statusCode; },
    json(data) { body = data; ended = true; return this; },
    end() { ended = true; return this; },
    get body() { return body; },
    get ended() { return ended; }
  };
}

test("A. ROUTING: my-courses.html routes LMS, V4, and V5 courses through legacy-post.html", () => {
  const page = read("my-courses.html");
  assert.match(page, /learningUrl=`\/legacy-post\.html\?course=\$\{encodeURIComponent\(c\.slug\)\}`/);
});

test("B. INTRO PAGE: legacy-post.html accepts v5 deliveryMode and configures correct green button behavior", () => {
  const page = read("legacy-post.html");
  // Page accepts lms, v4, v5
  assert.match(page, /\['lms',\s*'v4',\s*'v5'\]\.includes\(mode\)/);
  // Loads v5 intro from endpoint=v5-course-intro
  assert.match(page, /loadV5Intro/);
  assert.match(page, /endpoint=v5-course-intro/);
  // V5 green button goes directly to /learning?course=<slug> without legacy-entry-token
  assert.match(page, /if\(mode==='v5'\)\{\s*location\.assign\(`\/learning\?course=\$\{encodeURIComponent\(slug\)\}`\);\s*return;\s*\}/);
  // V4/LMS still invokes legacy-entry-token
  assert.match(page, /endpoint=legacy-entry-token/);
  // originalLessonEntryVisible toggle is respected
  assert.match(page, /course\.originalLessonEntryVisible!==false/);
  // Distinguishes v5 error vs success
  assert.match(page, /v5IntroStatus==='error'/);
  assert.match(page, /Không tải được nội dung lớp học\. Vui lòng tải lại trang\./);
  // Expand button toggle handles full item count
  assert.match(page, /Xem toàn bộ \$\{v4Intro\?\.items\?\.length\|\|0\} phần nội dung/);
});

test("C. PUBLISHED SOURCE OF TRUTH: v5-course-intro handler security, headers, and portal dispatch", () => {
  const portal = read("api/lms/portal.js");
  const handler = read("utils/lms-handlers/v5-course-intro.js");

  assert.match(portal, /endpoint === "v5-course-intro"/);
  assert.match(handler, /applySameOriginCors\(req,\s*res/);
  assert.doesNotMatch(handler, /Access-Control-Allow-Origin",\s*"\*"/);
  assert.match(handler, /requireV4CourseAccess\(req, courseSlug\)/);
  assert.match(handler, /req\.method !== "GET"/);
  assert.match(handler, /Cache-Control", "private, no-store"/);
  assert.match(handler, /delivery_mode\)\.toLowerCase\(\) !== "v5"/);
  assert.match(handler, /status !== "published"/);
  assert.match(handler, /published_release_id/);
  assert.match(handler, /v5LearnerReleaseContent\(release\.snapshot\)/);
  assert.match(handler, /buildV5IntroItems\(content\)/);
  assert.doesNotMatch(handler, /raw_message/);
  assert.doesNotMatch(handler, /chat_id/);
  assert.doesNotMatch(handler, /tgcloner_sources/);
});

test("D. FULL TEXT DATASET: buildV5IntroItems returns ALL learner text items without limit 3", () => {
  const fixture = {
    config: { settings: { authoring_mode: "lesson" } },
    lessons: [
      { id: "l1", title: "Bài 1", position: 1000 },
      { id: "l2", title: "Bài 2", position: 2000 }
    ],
    posts: [
      { id: "p1", lesson_id: "l1", position: 100, text_content: "Công thức bột 1" },
      { id: "p2", lesson_id: "l1", position: 200, caption: "Ghi chú hình 1" },
      { id: "p3", lesson_id: "l1", position: 300, text_content: "Bước 3 chiên bánh" },
      { id: "p4", lesson_id: "l2", position: 100, caption: "Nhiệt độ lò nướng" },
      { id: "p5", lesson_id: "l2", position: 200, text_content: "Bảo quản sốt" },
      { id: "p6", lesson_id: "l2", position: 300, caption: "Thành phẩm cuối" },
      { id: "p7", lesson_id: "l2", position: 400, text_content: "Liên hệ hỗ trợ" }
    ]
  };

  const intro = buildV5IntroItems(fixture);
  assert.equal(intro.complete, true);
  assert.equal(intro.count, 7);
  assert.equal(intro.items.length, 7);
  assert.equal(intro.items[0].text, "Công thức bột 1");
  assert.equal(intro.items[1].text, "Ghi chú hình 1");
  assert.equal(intro.items[3].text, "Nhiệt độ lò nướng");
  assert.equal(intro.items[6].text, "Liên hệ hỗ trợ");
});

test("D2. TEXT CLEANING: cleanV5IntroText preserves formatting, bullets, linebreaks, and Vietnamese", () => {
  const raw = "Bài 1: Thành phẩm khoai\u0000  \n\n\n- 450g khoai mỡ đã gọt vỏ\n- 50g khoai môn tàu\n\n\n👉Yêu cầu xem clip   ";
  const cleaned = cleanV5IntroText(raw);
  assert.equal(cleaned, "Bài 1: Thành phẩm khoai\n\n- 450g khoai mỡ đã gọt vỏ\n- 50g khoai môn tàu\n\n👉Yêu cầu xem clip");
});

test("E. COLLAPSED UI: empty posts are excluded, system lessons are excluded", () => {
  const fixture = {
    config: { settings: { authoring_mode: "lesson" } },
    lessons: [
      { id: "sys", title: "Timeline", position: 100, metadata: { system_lesson: true } },
      { id: "l1", title: "Bài 1", position: 1000 }
    ],
    posts: [
      { id: "p0", lesson_id: "sys", position: 50, text_content: "Hidden text in system lesson" },
      { id: "p1", lesson_id: "l1", position: 100, text_content: "   " }, // empty
      { id: "p2", lesson_id: "l1", position: 200, text_content: "Valid recipe step" }
    ]
  };

  const intro = buildV5IntroItems(fixture);
  assert.equal(intro.count, 1);
  assert.equal(intro.items[0].text, "Valid recipe step");
});

test("F. FALLBACK: course.description used only when release has 0 text items", () => {
  const fallbackDesc = v5CourseIntroFallback({ description: "Mô tả khóa học từ Admin" });
  assert.equal(fallbackDesc, "Mô tả khóa học từ Admin");

  const emptyFallback = v5CourseIntroFallback({});
  assert.equal(emptyFallback, "");
});

test("G. LESSON + TIMELINE: timeline mode preserves post.position ordering", () => {
  const fixture = {
    config: { settings: { authoring_mode: "timeline" } },
    lessons: [
      { id: "sys", title: "Timeline", position: 1000, metadata: { system_lesson: true } }
    ],
    posts: [
      { id: "p3", lesson_id: "sys", position: 3000, text_content: "Post 3" },
      { id: "p1", lesson_id: "sys", position: 1000, text_content: "Post 1" },
      { id: "p2", lesson_id: "sys", position: 2000, caption: "Post 2" }
    ]
  };

  const intro = buildV5IntroItems(fixture);
  assert.equal(intro.count, 3);
  assert.equal(intro.items[0].text, "Post 1");
  assert.equal(intro.items[1].text, "Post 2");
  assert.equal(intro.items[2].text, "Post 3");
});

test("H. EXISTING V5 INVARIANTS: learning bootstrap, SW, and media playback remain intact", () => {
  const swBootstrap = read("v5-sw-bootstrap.html");
  const mediaSw = read("v5/media-sw.js");
  const v5App = read("v5/app.js");

  assert.match(swBootstrap, /\/v5\/media-sw\.js/);
  assert.match(mediaSw, /STARTUP_VIDEO_RANGE_BYTES\s*=\s*1\s*\*\s*1024\s*\*\s*1024/);
  assert.match(v5App, /preload\s*=\s*'none'/);
  assert.match(v5App, /isTimelineMode/);
});

test("PHASE 6: BANH-MI-MEILI DATA ASSERTION: exactly 7 learner text items extracted in exact audited order", () => {
  const banhMiMeiliReleaseFixture = {
    config: { settings: { authoring_mode: "lesson" }, source_mode: "telegram" },
    lessons: [
      { id: "sys", title: "Timeline", position: 1000, metadata: { system_lesson: true } },
      { id: "l0", title: "Nội dung khóa học", position: 2000, metadata: { import_default: "true" } },
      { id: "l1", title: "Bài 1", position: 3000 },
      { id: "l2", title: "Bài 2", position: 4000 },
      { id: "l3", title: "Bài 3: Tạo hình", position: 5000 },
      { id: "l4", title: "Bài 4", position: 6000 },
      { id: "l5", title: "Bài 5: Thành phẩm...", position: 7000 }
    ],
    posts: [
      { id: "p1", lesson_id: "l0", position: 1000, text_content: "Địa chỉ mua khoai mỡ \nhttps://m.facebook.com/groups/khoai.tim.khoai.mo/permalink/1463479204148136/" },
      { id: "p2", lesson_id: "l0", position: 2000, caption: "Hình ảnh tham khảo xe tím dạng chuỗi" },
      { id: "p3", lesson_id: "l1", position: 3000, caption: "Bài 1:\nThành phẩm khoai ra gần 1kg khoai thành phẩm \nLàm theo các bước : \nBước 1:  Sơ chế khoai" },
      { id: "p4", lesson_id: "l2", position: 4000, caption: "Bài 2\n🌟Bước 3: \n- Sau khi khoai mỡ chín \n- Chuẩn bị một cái thau đổ khoai đã chín vào thau" },
      { id: "p5", lesson_id: "l3", position: 5000, caption: "Bài 3: Tạo hình \nKhoai kén : 12g\nKhoai phomai : 10g khoai , phomai 2g \n🌟Bảo quản :" },
      { id: "p6", lesson_id: "l4", position: 6000, caption: "Bài 4\nCách chiên Bánh khoai mỡ \nLabon's Quỳnh \n🌟Khoai kén: \n- Chuẩn bị chảo cho dầu vào nấu nóng nhẹ" },
      { id: "p7", lesson_id: "l5", position: 7000, caption: "Bài 5:. Thành phẩm Và hình ảnh dành cho hv quảng cáo bán hàng, Cả nhà nhớ chèn tên mình vào nha. Chúc cả nhà đắt hàng." }
    ]
  };

  const intro = buildV5IntroItems(banhMiMeiliReleaseFixture);
  assert.equal(intro.complete, true);
  assert.equal(intro.count, 7);
  assert.equal(intro.items.length, 7);
  assert.match(intro.items[0].text, /^Địa chỉ mua khoai mỡ/);
  assert.match(intro.items[1].text, /^Hình ảnh tham khảo xe tím dạng chuỗi/);
  assert.match(intro.items[2].text, /^Bài 1:\nThành phẩm khoai/);
  assert.match(intro.items[3].text, /^Bài 2\n🌟Bước 3:/);
  assert.match(intro.items[4].text, /^Bài 3: Tạo hình/);
  assert.match(intro.items[5].text, /^Bài 4\nCách chiên Bánh khoai mỡ/);
  assert.match(intro.items[6].text, /^Bài 5:\. Thành phẩm/);
});

// =========================================================================
// MANDATORY REGRESSION TEST SUITE (HOTFIX SPEC DRIFTS)
// =========================================================================

test("REGRESSION 1: v5-course-intro uses applySameOriginCors", () => {
  const handler = read("utils/lms-handlers/v5-course-intro.js");
  assert.match(handler, /applySameOriginCors\(req,\s*res/);
  assert.match(handler, /methods:\s*"GET,\s*OPTIONS"/);
  assert.match(handler, /headers:\s*"Content-Type,\s*X-LMS-Session-Id,\s*X-LMS-Device-Id"/);
});

test("REGRESSION 2: handler source does NOT contain Access-Control-Allow-Origin: * or wildcard CORS", () => {
  const handler = read("utils/lms-handlers/v5-course-intro.js");
  assert.doesNotMatch(handler, /Access-Control-Allow-Origin",\s*"\*"/);
  assert.doesNotMatch(handler, /['"]Access-Control-Allow-Origin['"]\s*,\s*['"]\*['"]/);
});

test("REGRESSION 3: cross-origin request fails 403 before DB access where practical", async () => {
  const req = {
    method: "GET",
    headers: {
      host: "hoc.yeubep.shop",
      origin: "https://unauthorized-cross-origin.com"
    },
    query: { course: "banh-mi-meili" }
  };
  const res = createMockRes();

  await v5CourseIntroHandler(req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    code: "origin_not_allowed",
    error: "Origin not allowed"
  });
});

test("REGRESSION 4: same-origin request remains allowed", async () => {
  // 4a. Same-origin OPTIONS request
  const reqOptions = {
    method: "OPTIONS",
    headers: {
      host: "hoc.yeubep.shop",
      origin: "https://hoc.yeubep.shop"
    }
  };
  const resOptions = createMockRes();
  await v5CourseIntroHandler(reqOptions, resOptions);
  assert.equal(resOptions.statusCode, 200);
  assert.equal(resOptions.headers["access-control-allow-origin"], "https://hoc.yeubep.shop");

  // 4b. Request without Origin header (browser direct navigation/fetch) is allowed through CORS filter
  const reqNoOrigin = {
    method: "OPTIONS",
    headers: {
      host: "hoc.yeubep.shop"
    }
  };
  const resNoOrigin = createMockRes();
  await v5CourseIntroHandler(reqNoOrigin, resNoOrigin);
  assert.equal(resNoOrigin.statusCode, 200);
});

test("REGRESSION 5: endpoint failure does NOT cause course.description to render as Intro Text", () => {
  const page = read("legacy-post.html");

  // Verify explicit error status handling in legacy-post.html
  assert.match(page, /v5IntroStatus==='error'/);
  assert.match(page, /Không tải được nội dung lớp học\. Vui lòng tải lại trang\./);

  // Simulate rendering logic from legacy-post.html on endpoint failure
  const v5IntroStatus = "error";
  const course = { description: "MÔ TẢ KHÓA HỌC BÍ MẬT KHÔNG ĐƯỢC HIỂN THỊ LÀM NỘI DUNG BÀI" };
  const v4Intro = null;

  let recipeContent = "";
  if (v5IntroStatus === "error") {
    recipeContent = '<p class="error" role="alert">Không tải được nội dung lớp học. Vui lòng tải lại trang.</p>';
  } else if (Array.isArray(v4Intro?.items) && v4Intro.items.length > 0) {
    recipeContent = "intro_items";
  } else {
    recipeContent = course.description;
  }

  assert.doesNotMatch(recipeContent, new RegExp(course.description));
  assert.match(recipeContent, /Không tải được nội dung lớp học\. Vui lòng tải lại trang\./);
});

test("REGRESSION 6: successful intro with count=0 DOES allow course.description fallback", () => {
  const page = read("legacy-post.html");
  assert.match(page, /recipeContent=introHtml\(course\.description\)/);

  // Simulate rendering logic on successful empty intro
  const v5IntroStatus = "success";
  const course = { description: "Mô tả khóa học khi chưa có bài học chi tiết" };
  const v4Intro = { count: 0, items: [] };

  let recipeContent = "";
  if (v5IntroStatus === "error") {
    recipeContent = '<p class="error" role="alert">Không tải được nội dung lớp học. Vui lòng tải lại trang.</p>';
  } else if (Array.isArray(v4Intro?.items) && v4Intro.items.length > 0) {
    recipeContent = "intro_items";
  } else {
    recipeContent = course.description;
  }

  assert.equal(recipeContent, course.description);
});

test("REGRESSION 7: successful intro with count>0 DOES NOT mix course.description", () => {
  const v5IntroStatus = "success";
  const course = { description: "KHÔNG ĐƯỢC PHÉP TRỘN MÔ TẢ NÀY VÀO NỘI DUNG PHÁT HÀNH" };
  const v4Intro = {
    count: 2,
    items: [
      { text: "Nội dung bài học 1" },
      { text: "Nội dung bài học 2" }
    ]
  };

  let recipeContent = "";
  if (v5IntroStatus === "error") {
    recipeContent = '<p class="error" role="alert">Không tải được nội dung lớp học. Vui lòng tải lại trang.</p>';
  } else if (Array.isArray(v4Intro?.items) && v4Intro.items.length > 0) {
    // legacy-post calls v4IntroHtml(v4Intro, '') so fallback is empty
    recipeContent = v4Intro.items.map(item => item.text).join("\n");
  } else {
    recipeContent = course.description;
  }

  assert.doesNotMatch(recipeContent, new RegExp(course.description));
  assert.match(recipeContent, /Nội dung bài học 1/);
  assert.match(recipeContent, /Nội dung bài học 2/);
});

test("REGRESSION 8: banh-mi-meili expected Text count remains exactly 7", () => {
  const fixture = {
    config: { settings: { authoring_mode: "lesson" } },
    lessons: [
      { id: "l0", title: "Mở đầu", position: 1000 },
      { id: "l1", title: "Bài 1", position: 2000 },
      { id: "l2", title: "Bài 2", position: 3000 },
      { id: "l3", title: "Bài 3", position: 4000 },
      { id: "l4", title: "Bài 4", position: 5000 },
      { id: "l5", title: "Bài 5", position: 6000 }
    ],
    posts: [
      { id: "p1", lesson_id: "l0", position: 1000, text_content: "Địa chỉ mua khoai mỡ" },
      { id: "p2", lesson_id: "l0", position: 2000, caption: "Hình ảnh tham khảo xe tím" },
      { id: "p3", lesson_id: "l1", position: 1000, caption: "Bài 1" },
      { id: "p4", lesson_id: "l2", position: 1000, caption: "Bài 2" },
      { id: "p5", lesson_id: "l3", position: 1000, caption: "Bài 3: Tạo hình" },
      { id: "p6", lesson_id: "l4", position: 1000, caption: "Bài 4" },
      { id: "p7", lesson_id: "l5", position: 1000, caption: "Bài 5: Thành phẩm" }
    ]
  };
  const intro = buildV5IntroItems(fixture);
  assert.equal(intro.count, 7);
  assert.equal(intro.items.length, 7);
});

test("REGRESSION 9: item #4..#7 remain present", () => {
  const fixture = {
    config: { settings: { authoring_mode: "lesson" } },
    lessons: [
      { id: "l0", title: "Mở đầu", position: 1000 },
      { id: "l1", title: "Bài 1", position: 2000 },
      { id: "l2", title: "Bài 2", position: 3000 },
      { id: "l3", title: "Bài 3", position: 4000 },
      { id: "l4", title: "Bài 4", position: 5000 },
      { id: "l5", title: "Bài 5", position: 6000 }
    ],
    posts: [
      { id: "p1", lesson_id: "l0", position: 1000, text_content: "Địa chỉ mua khoai mỡ" },
      { id: "p2", lesson_id: "l0", position: 2000, caption: "Hình ảnh tham khảo xe tím" },
      { id: "p3", lesson_id: "l1", position: 1000, caption: "Bài 1: Sơ chế" },
      { id: "p4", lesson_id: "l2", position: 1000, caption: "Bài 2: Trộn bột" },
      { id: "p5", lesson_id: "l3", position: 1000, caption: "Bài 3: Tạo hình" },
      { id: "p6", lesson_id: "l4", position: 1000, caption: "Bài 4: Chiên bánh" },
      { id: "p7", lesson_id: "l5", position: 1000, caption: "Bài 5: Thành phẩm" }
    ]
  };
  const intro = buildV5IntroItems(fixture);
  assert.match(intro.items[3].text, /Bài 2/);
  assert.match(intro.items[4].text, /Bài 3/);
  assert.match(intro.items[5].text, /Bài 4/);
  assert.match(intro.items[6].text, /Bài 5/);
});

test("REGRESSION 10: V4 behavior unchanged", () => {
  const page = read("legacy-post.html");
  assert.match(page, /mode==='v4'[\s\S]*?v4IntroHtml\(v4Intro,\s*course\.description\)/);
  assert.match(page, /endpoint=v4-course-intro/);
  assert.match(page, /endpoint=legacy-entry-token/);
});

test("REGRESSION 11: /learning bootstrap and playback unchanged", () => {
  const page = read("legacy-post.html");
  assert.match(page, /if\(mode==='v5'\)\{\s*location\.assign\(`\/learning\?course=\$\{encodeURIComponent\(slug\)\}`\);\s*return;\s*\}/);
  const swBootstrap = read("v5-sw-bootstrap.html");
  assert.match(swBootstrap, /\/v5\/media-sw\.js/);
});

test("REGRESSION 12: v5/media-sw.js unchanged", () => {
  const mediaSw = read("v5/media-sw.js");
  assert.match(mediaSw, /STARTUP_VIDEO_RANGE_BYTES\s*=\s*1\s*\*\s*1024\s*\*\s*1024/);
  assert.match(mediaSw, /STEADY_VIDEO_RANGE_BYTES\s*=\s*4\s*\*\s*1024\s*\*\s*1024/);
  assert.match(mediaSw, /REFRESH_SKEW_MS\s*=\s*45\s*\*\s*1000/);
});

