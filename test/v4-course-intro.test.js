import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildV4IntroItems, cleanV4IntroText } from "../utils/v4-intro-content.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("V4 intro keeps Telegram order and removes repeated album captions only", () => {
  const items = buildV4IntroItems([
    { id: "1", source_message_id: 10, media_group_id: "album-a", caption: "Bài 1\n- Công thức" },
    { id: "2", source_message_id: 11, media_group_id: "album-a", caption: "Bài 1\n- Công thức" },
    { id: "3", source_message_id: 12, text: "Bài 2" },
    { id: "4", source_message_id: 13, text: "Bài 2" },
    { id: "5", source_message_id: 14, text: "", caption: "" }
  ]);

  assert.deepEqual(items.map((item) => item.telegramMessageId), [10, 12, 13]);
  assert.equal(items[0].text, "Bài 1\n- Công thức");
});

test("V4 intro cleans unsafe nulls and excessive blank lines without flattening formatting", () => {
  assert.equal(cleanV4IntroText("A\u0000  \n\n\n\n- B"), "A\n\n- B");
});

test("protected V4 intro endpoint exposes text-only content through the existing portal dispatcher", () => {
  const portal = read("api/lms/portal.js");
  const handler = read("utils/lms-handlers/v4-course-intro.js");
  const loader = read("utils/v4-intro-loader.js");

  assert.match(portal, /endpoint === "v4-course-intro"/);
  assert.match(handler, /requireV4CourseAccess\(req, courseSlug\)/);
  assert.match(handler, /req\.method !== "GET"/);
  assert.match(handler, /Cache-Control", "no-store"/);
  assert.match(loader, /text,caption/);
  assert.doesNotMatch(handler + loader, /raw_message/);
  assert.doesNotMatch(handler, /chat_id|email: access\.email/);
});

test("legacy-style course page loads V4 text and keeps a safe non-empty fallback", () => {
  const page = read("legacy-post.html");
  assert.match(page, /endpoint=v4-course-intro/);
  assert.match(page, /v4IntroHtml\(v4Intro,course\.description\)/);
  assert.match(page, /Xem toàn bộ \$\{items\.length\} phần nội dung/);
  assert.match(page, /Nội dung chi tiết của khóa học hiện có/);
});

test("V4 prepublish validates automatic Công thức & Hướng dẫn content", () => {
  const prepublish = read("utils/lms-handlers/admin-v4-prepublish.js");
  assert.match(prepublish, /"intro-text", "Công thức & Hướng dẫn"/);
  assert.match(prepublish, /introContent\.items\.length/);
  assert.match(prepublish, /Nguồn Telegram không có text\/caption/);
  assert.match(prepublish, /MAX_V4_INTRO_ROWS/);
});
