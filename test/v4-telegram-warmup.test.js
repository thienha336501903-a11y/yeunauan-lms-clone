import test from "node:test";
import assert from "node:assert/strict";
import { findMtprotoVideoMessage } from "../utils/v4-telegram-media-meta.js";

const MiB = 1024 * 1024;

function videoRow(size, overrides = {}) {
  return {
    id: overrides.id || `video-${size}`,
    message_type: overrides.message_type || "video",
    raw_message: {
      [overrides.message_type || "video"]: {
        file_id: overrides.file_id === undefined ? "telegram-file-id" : overrides.file_id,
        file_size: size
      }
    }
  };
}

test("does not warm Bot API videos at or below 20 MiB", () => {
  assert.equal(findMtprotoVideoMessage([videoRow(20 * MiB)]), null);
  assert.equal(findMtprotoVideoMessage([videoRow(8 * MiB)]), null);
});

test("selects one video above the Bot API limit", () => {
  const small = videoRow(3 * MiB, { id: "small" });
  const large = videoRow(20 * MiB + 1, { id: "large" });
  assert.equal(findMtprotoVideoMessage([small, large])?.id, "large");
});

test("ignores non-video documents even when they are large", () => {
  const document = {
    id: "document",
    message_type: "document",
    raw_message: { document: { file_id: "document-id", file_size: 50 * MiB } }
  };
  assert.equal(findMtprotoVideoMessage([document]), null);
});

test("supports Telegram video notes", () => {
  const note = videoRow(25 * MiB, { id: "note", message_type: "video_note" });
  assert.equal(findMtprotoVideoMessage([note])?.id, "note");
});
