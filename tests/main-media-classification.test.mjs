import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const pages = ["lesson.html", "lms.html"];

function extractFunction(source, name) {
  const start = source.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);

  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function loadClassifiers(page) {
  const source = readFileSync(join(ROOT, page), "utf8");
  const body = [
    "const extractIframeSrc = (value) => value;",
    extractFunction(source, "inferMainMediaTypeFromText"),
    extractFunction(source, "getExplicitMainMediaType"),
    extractFunction(source, "getMainMediaType"),
    extractFunction(source, "isMainMediaImage"),
    extractFunction(source, "isMainMediaUnknown"),
    "return { getMainMediaType, isMainMediaImage, isMainMediaUnknown };"
  ].join("\n");
  return Function(body)();
}

for (const page of pages) {
  test(`${page}: unknown Drive media remains neutral and uses the unknown renderer`, () => {
    const { getMainMediaType, isMainMediaImage, isMainMediaUnknown } = loadClassifiers(page);
    const lesson = {
      mainMediaType: "unknown",
      mainMediaMimeType: "",
      videoUrl: "https://drive.google.com/file/d/image-file-id/view",
      thumbnailUrl: "https://drive.google.com/thumbnail?id=image-file-id"
    };

    assert.equal(getMainMediaType(lesson), "unknown");
    assert.equal(isMainMediaImage(lesson), false);
    assert.equal(isMainMediaUnknown(lesson), true);
  });

  test(`${page}: confirmed videos and empty lessons keep their existing branches`, () => {
    const { getMainMediaType, isMainMediaImage } = loadClassifiers(page);

    assert.equal(isMainMediaImage({
      mainMediaType: "video",
      videoUrl: "https://drive.google.com/file/d/video-file-id/view",
      thumbnailUrl: "https://drive.google.com/thumbnail?id=video-file-id"
    }), false);
    assert.equal(getMainMediaType({
      mainMediaType: "unknown",
      mainMediaName: "legacy-video.mp4",
      videoUrl: "https://drive.google.com/file/d/video-file-id/view"
    }), "video");
    assert.equal(getMainMediaType({
      mainMediaType: "unknown",
      videoUrl: "https://drive.google.com/file/d/image-file-id/view?lms_media_type=image"
    }), "image");
    assert.equal(isMainMediaImage({
      mainMediaType: "unknown",
      mainMediaMimeType: "video/mp4",
      videoUrl: "https://example.com/video"
    }), false);
    assert.equal(getMainMediaType({
      mainMediaType: "none",
      thumbnailUrl: "https://example.com/course-poster.jpg"
    }), "none");
    assert.equal(isMainMediaImage({
      mainMediaType: "none",
      thumbnailUrl: "https://example.com/course-poster.jpg"
    }), false);
  });
}

test("lesson.html renders unknown media before the confirmed-video branch and keeps it openable", () => {
  const source = readFileSync(join(ROOT, "lesson.html"), "utf8");
  assert.match(source, /function renderUnknownMainMedia\(/);
  assert.match(source, /openButton\.onclick = \(\) => playMainVideo\(/);
  assert.equal((source.match(/else if \(hasUnknownMainMedia\)/g) || []).length, 2);
  assert.ok(
    source.indexOf("else if (hasUnknownMainMedia)") < source.indexOf("else if (hasVideo)"),
    "unknown media must not fall into the confirmed-video Play renderer"
  );
});

test("lms.html uses a neutral mobile action for unknown media", () => {
  const source = readFileSync(join(ROOT, "lms.html"), "utf8");
  assert.match(source, /function getUnknownMainMediaHtml\(/);
  assert.match(source, /Mở nội dung/);
  assert.match(source, /else if \(isMainMediaUnknown\(l\)\)/);
});
