import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(import.meta.dirname, "..", "lesson.html"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated ${name}`);
}

function renderItems(items) {
  const section = {
    innerHTML: "",
    classList: { add() {}, remove() {} },
    querySelectorAll() { return []; }
  };
  const context = {
    section,
    items,
    escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
  };

  const body = [
    "const document = { getElementById: () => context.section };",
    "const parseMediaUrls = () => context.items;",
    "const clearWatermarkFrom = () => {};",
    "const extractIframeSrc = value => value;",
    "const normalizeGoogleDriveImageUrl = value => value;",
    "const getSupplementalVideoLabelHtml = () => '<div>Video</div>';",
    "const getSupplementalVideoCoverImgHtml = () => '<img alt=\"cover\">';",
    "const getSupplementalPlayButtonHtml = () => '<button>Play</button>';",
    "const getGoogleDrivePlayButtonHtml = () => '<button>Play</button>';",
    "const getYouTubeVideoId = value => value.includes('youtu') ? 'abcdefghijk' : '';",
    "const getGoogleDriveFileId = value => value.includes('drive.google.com') ? 'drive-id' : '';",
    "const window = { location: { href: 'https://example.com/lesson.html' } };",
    "const escapeHtml = context.escapeHtml;",
    extractFunction("renderMediaCaption"),
    extractFunction("renderMediaItems"),
    "renderMediaItems({ mediaUrls: 'fixture' });"
  ].join("\n");
  Function("context", body)(context);
  return section.innerHTML;
}

test("lesson supplemental images render the caption belonging to each item", () => {
  const html = renderItems([
    { type: "image", title: "Ảnh 2", url: "https://example.com/2.jpg", caption: "Thịt được hút chân không" },
    { type: "image", title: "Ảnh 3", url: "https://example.com/3.jpg", caption: "Chú thích ảnh 3" }
  ]);

  assert.match(html, /2\.jpg[\s\S]*Thịt được hút chân không/);
  assert.match(html, /3\.jpg[\s\S]*Chú thích ảnh 3/);
  assert.ok(
    html.indexOf("Thịt được hút chân không") < html.indexOf("3.jpg"),
    "caption of image 2 must stay inside image 2 card"
  );
});

test("lesson supplemental media without a caption emits no caption element", () => {
  const html = renderItems([
    { type: "image", title: "Ảnh trống", url: "https://example.com/empty.jpg", caption: "   " }
  ]);

  assert.doesNotMatch(html, /data-media-caption/);
});

test("caption HTML is escaped before rendering", () => {
  const html = renderItems([
    { type: "image", title: "Ảnh", url: "https://example.com/x.jpg", caption: "<script>alert(1)</script>" }
  ]);

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("supplemental video providers also retain their own captions", () => {
  const html = renderItems([
    { type: "video", title: "Drive", url: "https://drive.google.com/file/d/drive-id/view", caption: "Chú thích Drive" },
    { type: "youtube", title: "YouTube", url: "https://youtu.be/abcdefghijk", caption: "Chú thích YouTube" },
    { type: "video", title: "Bunny", url: "https://player.mediadelivery.net/embed/1/2", caption: "Chú thích Bunny" }
  ]);

  assert.match(html, /Chú thích Drive/);
  assert.match(html, /Chú thích YouTube/);
  assert.match(html, /Chú thích Bunny/);
});
