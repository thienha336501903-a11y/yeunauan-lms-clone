import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../lms.html", import.meta.url), "utf8");

test("student media URLs are not written to the browser console", () => {
  assert.doesNotMatch(page, /console\.log\(["']MEDIA_URLS_RAW["']/);
  assert.doesNotMatch(page, /console\.log\(["']MEDIA_ITEMS["']/);
});
