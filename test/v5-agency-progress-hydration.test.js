import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "v5/app.js"), "utf8");
const start = source.indexOf("async function hydrateAgencyProgress() {");
const end = source.indexOf("\nfunction unfinishedVideo(", start);
assert.ok(start >= 0 && end > start, "Agency hydration function must be present in V5 player");
const hydrationSource = source.slice(start, end);

async function hydrate({ timeline, lessons }) {
  const seen = new Set();
  let feedRenders = 0;
  let uiUpdates = 0;
  const context = {
    data: { agencyMode: true }, activeCourse: "F-CC-670091", lessons, seen, lastSeen: "",
    isTimelineMode: () => timeline,
    fetch: async (url) => {
      assert.match(url, /endpoint=agency-progress&course=F-CC-670091/);
      return { ok: true, json: async () => ({
        success: true,
        progress: [{ canonical_lesson_id: "canonical-1", is_completed: true, progress_percent: 100 }]
      }) };
    },
    saveProgress: () => {}, renderOutline: () => {},
    renderFeed: () => { feedRenders++; },
    updateProgressUI: () => { uiUpdates++; }, applyFilter: () => {}
  };
  const fn = vm.runInNewContext(`${hydrationSource}\nhydrateAgencyProgress`, context);
  await fn();
  return { seen, feedRenders, uiUpdates };
}

test("Agency timeline completion hydrates canonical lesson posts without replacing a playing video", async () => {
  const result = await hydrate({
    timeline: true,
    lessons: [{ id: "lesson-1", canonical_lesson_id: "canonical-1", posts: [{ id: "post-1" }, { id: "post-2" }] }]
  });
  assert.deepEqual([...result.seen], ["post-1", "post-2"]);
  assert.equal(result.feedRenders, 0);
  assert.equal(result.uiUpdates, 1);
});

test("Agency lesson completion updates existing DOM without recreating the player", async () => {
  const result = await hydrate({
    timeline: false,
    lessons: [{ id: "lesson-1", canonical_lesson_id: "canonical-1", posts: [{ id: "post-1" }] }]
  });
  assert.deepEqual([...result.seen], ["lesson-1"]);
  assert.equal(result.feedRenders, 0);
  assert.equal(result.uiUpdates, 1);
});
