import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const access = readFileSync(new URL("../utils/v4-telegram-access.js", import.meta.url), "utf8");
const feed = readFileSync(new URL("../utils/lms-handlers/v4-telegram-feed.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../v4.html", import.meta.url), "utf8");

test("V4 access resolves the student-facing course title from the course record", () => {
  assert.match(access, /select\("title,raw_data,is_published"\)/);
  assert.match(access, /rawData\.studentDisplayTitle \|\| course\.title \|\| slug/);
  assert.match(access, /courseTitle/);
});

test("V4 feed returns course identity separately from Telegram source identity", () => {
  assert.match(feed, /courseInfo:\s*\{/);
  assert.match(feed, /title:\s*access\.courseTitle \|\| courseSlug/);
  assert.match(feed, /source:\s*\{/);
});

test("V4 header uses the course title while lesson sender keeps the Telegram source title", () => {
  assert.match(page, /courseTitle=String\(d\.courseInfo\?\.title\|\|source\)/);
  assert.match(page, /document\.title=courseTitle/);
  assert.match(page, /\$\('sideTitle'\)\.textContent=courseTitle/);
  assert.match(page, /\$\('mobileTitle'\)\.textContent=courseTitle/);
  assert.match(page, /class="sender".*data\.source\?\.title/);
});
