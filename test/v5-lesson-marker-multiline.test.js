import test from "node:test";
import assert from "node:assert/strict";
import { parseLessonMarker, planImport } from "../utils/v5-telegram-planner.js";

test("1. parseLessonMarker matches multiline captions starting with Bài <N> variants", () => {
  // Case: Bài 1: with newline and body text
  const m1 = parseLessonMarker("Bài 1:\nThành phẩm khoai mỡ chiên giòn.\nLàm theo các bước sau...");
  assert.equal(m1.isMarker, true);
  assert.equal(m1.number, 1);
  assert.equal(m1.title, "Bài 1");

  // Case: Bài 2 with newline and emoji body
  const m2 = parseLessonMarker("Bài 2\n🌟Bước 3: Nhồi bột và nghỉ...");
  assert.equal(m2.isMarker, true);
  assert.equal(m2.number, 2);
  assert.equal(m2.title, "Bài 2");

  // Case: Bài 3: Tạo hình with newline and body
  const m3 = parseLessonMarker("Bài 3: Tạo hình\nKhoai kén tạo hình dài 5cm...");
  assert.equal(m3.isMarker, true);
  assert.equal(m3.number, 3);
  assert.equal(m3.suffix, "Tạo hình");
  assert.equal(m3.title, "Bài 3: Tạo hình");

  // Case: Bài 4 with newline and body
  const m4 = parseLessonMarker("Bài 4\nCách chiên dầu nhiệt 160 độ...");
  assert.equal(m4.isMarker, true);
  assert.equal(m4.number, 4);
  assert.equal(m4.title, "Bài 4");

  // Case: Bài 5:. Thành phẩm... with compound separator :.
  const m5 = parseLessonMarker("Bài 5:. Thành phẩm giòn rụm\nBảo quản và thưởng thức...");
  assert.equal(m5.isMarker, true);
  assert.equal(m5.number, 5);
  assert.equal(m5.suffix, "Thành phẩm giòn rụm");
  assert.equal(m5.title, "Bài 5: Thành phẩm giòn rụm");
});

test("2. parseLessonMarker rejects markers embedded mid-sentence (false-positive protection)", () => {
  const mNon = parseLessonMarker("Hôm nay chúng ta học bài 1 về nguyên liệu...");
  assert.equal(mNon.isMarker, false);

  const mNon2 = parseLessonMarker("Xem lại bài 2 trước khi thực hiện bước này.");
  assert.equal(mNon2.isMarker, false);
});

test("3. Single line markers continue to parse correctly", () => {
  assert.deepEqual(parseLessonMarker("Bài 1"), { isMarker: true, number: 1, suffix: "", title: "Bài 1" });
  assert.deepEqual(parseLessonMarker("Bài 1:"), { isMarker: true, number: 1, suffix: "", title: "Bài 1" });
  assert.deepEqual(parseLessonMarker("Bài 1."), { isMarker: true, number: 1, suffix: "", title: "Bài 1" });
  assert.deepEqual(parseLessonMarker("Bài 1-"), { isMarker: true, number: 1, suffix: "", title: "Bài 1" });
  assert.deepEqual(parseLessonMarker("Bài 1 – Nhào bột"), { isMarker: true, number: 1, suffix: "Nhào bột", title: "Bài 1: Nhào bột" });
  assert.deepEqual(parseLessonMarker("Bài 1 — Nướng bánh"), { isMarker: true, number: 1, suffix: "Nướng bánh", title: "Bài 1: Nướng bánh" });
});

test("4. Lesson mode with source fixture: pre-content + Bài 1..Bài 5 yields 5 markers, 6 lessons, 7 posts", () => {
  const rows = [
    { id: "r1", source_message_id: 1, message_type: "text", text: "Chào mừng các bạn đến với khóa học bánh khoai mỡ chiên giòn!" },
    { id: "r2", source_message_id: 2, media_group_id: "mg1", message_type: "video", caption: "Bài 1:\nThành phẩm khoai mỡ chiên giòn.\nLàm theo các bước sau...", raw_message: { video: { file_id: "v1" } } },
    { id: "r3", source_message_id: 3, media_group_id: "mg1", message_type: "photo", caption: "", raw_message: { photo: [{ file_id: "p1" }] } },
    { id: "r4", source_message_id: 4, media_group_id: "mg2", message_type: "video", caption: "Bài 2\n🌟Bước 3: Nhồi bột và nghỉ...", raw_message: { video: { file_id: "v2" } } },
    { id: "r5", source_message_id: 5, media_group_id: "mg3", message_type: "video", caption: "Bài 3: Tạo hình\nKhoai kén tạo hình dài 5cm...", raw_message: { video: { file_id: "v3" } } },
    { id: "r6", source_message_id: 6, media_group_id: "mg4", message_type: "video", caption: "Bài 4\nCách chiên dầu nhiệt 160 độ...", raw_message: { video: { file_id: "v4" } } },
    { id: "r7", source_message_id: 7, media_group_id: "mg5", message_type: "video", caption: "Bài 5:. Thành phẩm giòn rụm\nBảo quản và thưởng thức...", raw_message: { video: { file_id: "v5" } } },
    { id: "r8", source_message_id: 8, message_type: "text", text: "Lưu ý thêm khi chọn mua khoai mỡ chuẩn." }
  ];

  const plan = planImport({
    rows,
    existingMappings: new Map(),
    existingLessons: [],
    authoringMode: "lesson",
    sourceId: "src-banh-khoai-mo"
  });

  assert.equal(plan.detectedMarkers.length, 5);
  assert.equal(plan.detectedMarkers[0].number, 1);
  assert.equal(plan.detectedMarkers[1].number, 2);
  assert.equal(plan.detectedMarkers[2].number, 3);
  assert.equal(plan.detectedMarkers[3].number, 4);
  assert.equal(plan.detectedMarkers[4].number, 5);

  assert.equal(plan.predictedLessons, 6); // 1 default lesson + 5 marker lessons
  assert.equal(plan.predictedPosts, 7);
  assert.equal(plan.newUnits, 7);
});

test("5. Timeline mode with identical source fixture creates 0 lessons and 0 markers", () => {
  const rows = [
    { id: "r1", source_message_id: 1, message_type: "text", text: "Chào mừng các bạn đến với khóa học bánh khoai mỡ chiên giòn!" },
    { id: "r2", source_message_id: 2, media_group_id: "mg1", message_type: "video", caption: "Bài 1:\nThành phẩm khoai mỡ chiên giòn.\nLàm theo các bước sau...", raw_message: { video: { file_id: "v1" } } },
    { id: "r3", source_message_id: 3, media_group_id: "mg1", message_type: "photo", caption: "", raw_message: { photo: [{ file_id: "p1" }] } },
    { id: "r4", source_message_id: 4, media_group_id: "mg2", message_type: "video", caption: "Bài 2\n🌟Bước 3: Nhồi bột và nghỉ...", raw_message: { video: { file_id: "v2" } } },
    { id: "r5", source_message_id: 5, media_group_id: "mg3", message_type: "video", caption: "Bài 3: Tạo hình\nKhoai kén tạo hình dài 5cm...", raw_message: { video: { file_id: "v3" } } },
    { id: "r6", source_message_id: 6, media_group_id: "mg4", message_type: "video", caption: "Bài 4\nCách chiên dầu nhiệt 160 độ...", raw_message: { video: { file_id: "v4" } } },
    { id: "r7", source_message_id: 7, media_group_id: "mg5", message_type: "video", caption: "Bài 5:. Thành phẩm giòn rụm\nBảo quản và thưởng thức...", raw_message: { video: { file_id: "v5" } } },
    { id: "r8", source_message_id: 8, message_type: "text", text: "Lưu ý thêm khi chọn mua khoai mỡ chuẩn." }
  ];

  const plan = planImport({
    rows,
    existingMappings: new Map(),
    existingLessons: [],
    authoringMode: "timeline",
    sourceId: "src-banh-khoai-mo",
    hiddenLessonId: "hidden-1"
  });

  assert.equal(plan.detectedMarkers.length, 0);
  assert.equal(plan.predictedLessons, 0);
  assert.equal(plan.predictedPosts, 7);
});
