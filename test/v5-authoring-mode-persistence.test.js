import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { planImport } from "../utils/v5-telegram-planner.js";

const adminHtml = fs.readFileSync(new URL("../v5-admin.html", import.meta.url), "utf8");
const contentHandler = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-content.js", import.meta.url), "utf8");
const importHandler = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-telegram-import.js", import.meta.url), "utf8");

test("1. config settings = {} → effective mode = timeline in both content and import handlers", () => {
  // admin-v5-content.js must fallback to timeline when authoring_mode is absent
  assert.match(contentHandler, /authoringMode\s*=\s*config\.settings\?\.authoring_mode\s*===\s*"lesson"\s*\?\s*"lesson"\s*:\s*"timeline"/);

  // admin-v5-telegram-import.js must fallback to timeline when authoring_mode is absent
  assert.match(importHandler, /authoringMode\s*=\s*config\?\.settings\?\.authoring_mode\s*===\s*"lesson"\s*\?\s*"lesson"\s*:\s*"timeline"/);
});

test("2. UI load course với {} → hiển thị Timeline (not Lesson)", () => {
  // state initialization must default to timeline
  assert.match(adminHtml, /authoringMode:\s*.timeline./);

  // chooseCourse must set authoringMode to timeline
  assert.match(adminHtml, /state\.authoringMode=.timeline./);

  // refresh must check for explicit "lesson" else default to "timeline"
  assert.match(adminHtml, /state\.authoringMode=\(data\.authoringMode===.lesson.\|\|data\.config\?\.settings\?\.authoring_mode===.lesson.\)\?.lesson.:.timeline./);
});

test("3. switch Timeline → Lesson → backend persists settings.authoring_mode = \"lesson\"", () => {
  assert.match(adminHtml, /contentAction\(.updateConfig.,\{authoringMode:next\}\)/);
  assert.match(contentHandler, /if\s*\(body\.authoringMode\s*!==\s*undefined\)/);
  assert.match(contentHandler, /updatedSettings\.authoring_mode\s*=\s*mode/);
});

test("4. switch Lesson → Timeline → persisted \"timeline\"", () => {
  assert.match(contentHandler, /if\s*\(!\["timeline",\s*"lesson"\]\.includes\(mode\)\)/);
});

test("5. update mode không xóa các key khác trong settings (preserves existing settings keys)", () => {
  assert.match(contentHandler, /const currentSettings = \(currentConfig\?\.settings && typeof currentConfig\.settings === "object"\) \? currentConfig\.settings : \{\};/);
  assert.match(contentHandler, /const updatedSettings = \{ \.\.\.currentSettings \};/);
  assert.match(contentHandler, /patch\.settings = updatedSettings;/);
});

test("6. Telegram Preview dùng đúng persisted mode", () => {
  assert.match(importHandler, /const authoringMode = config\?\.settings\?\.authoring_mode === "lesson" \? "lesson" : "timeline";/);
  assert.match(importHandler, /authoringMode,/);
});

test("7. Lesson Preview với caption Bài 1 trong media group detect Lesson marker", () => {
  const rows = [
    {
      id: "row-1",
      source_message_id: 101,
      media_group_id: "mg-1",
      message_type: "video",
      caption: "Bài 1: Hướng dẫn kỹ thuật nhồi bột bánh bao nở xốp",
      raw_message: { video: { file_id: "v-1" } }
    },
    {
      id: "row-2",
      source_message_id: 102,
      media_group_id: "mg-1",
      message_type: "photo",
      raw_message: { photo: [{ file_id: "p-1" }] }
    }
  ];

  const plan = planImport({
    rows,
    existingMappings: new Map(),
    existingLessons: [],
    authoringMode: "lesson",
    sourceId: "src-1"
  });

  assert.equal(plan.predictedLessons, 1);
  assert.equal(plan.predictedPosts, 1);
  assert.equal(plan.detectedMarkers.length, 1);
  assert.equal(plan.detectedMarkers[0].title, "Bài 1: Hướng dẫn kỹ thuật nhồi bột bánh bao nở xốp");
  assert.equal(plan.detectedMarkers[0].number, 1);
});

test("8. Timeline Preview với cùng caption Bài 1 không tạo lesson", () => {
  const rows = [
    {
      id: "row-1",
      source_message_id: 101,
      media_group_id: "mg-1",
      message_type: "video",
      caption: "Bài 1: Hướng dẫn kỹ thuật nhồi bột bánh bao nở xốp",
      raw_message: { video: { file_id: "v-1" } }
    },
    {
      id: "row-2",
      source_message_id: 102,
      media_group_id: "mg-1",
      message_type: "photo",
      raw_message: { photo: [{ file_id: "p-1" }] }
    }
  ];

  const plan = planImport({
    rows,
    existingMappings: new Map(),
    existingLessons: [],
    authoringMode: "timeline",
    sourceId: "src-1",
    hiddenLessonId: "hidden-1"
  });

  assert.equal(plan.predictedLessons, 0);
  assert.equal(plan.predictedPosts, 1);
  assert.equal(plan.plannedUnits[0].targetLesson.id, "hidden-1");
});

test("9. Wizard mode label == backend preview mode (consistency guard in runTelegramPreview)", () => {
  assert.match(adminHtml, /if\(res\.authoringMode\)\{state\.authoringMode=res\.authoringMode;/);
  assert.match(adminHtml, /Chế độ áp dụng:/);
});
