import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildV5IntroItems, cleanV5IntroText, v5CourseIntroFallback } from "../utils/v5-intro-content.js";
import { v5LearnerReleaseContent } from "../utils/v5-release-snapshot.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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
  // Renders recipe content using v4IntroHtml for v4 and v5
  assert.match(page, /\['v4',\s*'v5'\]\.includes\(mode\)\?v4IntroHtml\(v4Intro,course\.description\):introHtml\(course\.description\)/);
  // Expand button toggle handles full item count
  assert.match(page, /Xem toàn bộ \$\{v4Intro\?\.items\?\.length\|\|0\} phần nội dung/);
});

test("C. PUBLISHED SOURCE OF TRUTH: v5-course-intro handler security, headers, and portal dispatch", () => {
  const portal = read("api/lms/portal.js");
  const handler = read("utils/lms-handlers/v5-course-intro.js");

  assert.match(portal, /endpoint === "v5-course-intro"/);
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

