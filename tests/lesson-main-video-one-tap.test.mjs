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

test("main Drive video opens the dedicated player during the first Play handler", () => {
  const playMainVideo = extractFunction("playMainVideo");
  const driveBranch = playMainVideo.indexOf('videoUrl.includes("drive.google.com")');
  const directOpen = playMainVideo.indexOf("openGoogleDrivePlayer(playerUrl, returnUrl)");
  const iframeFallback = playMainVideo.indexOf("videoWrapper.innerHTML = getIframePlayerHtml(videoUrl)");

  assert.ok(driveBranch >= 0);
  assert.ok(directOpen > driveBranch);
  assert.ok(iframeFallback > directOpen);
  assert.match(playMainVideo.slice(directOpen, iframeFallback), /return;/);
});

test("hard-load and SPA renderers use the same one-tap handler", () => {
  const callSites = source.match(
    /\.onclick = \(\) => playMainVideo\(videoWrapper, currentLesson, studentEmail\);/g
  ) || [];

  assert.equal(callSites.length, 2);
});

test("main Drive first tap never replaces the thumbnail with a second Play placeholder", () => {
  const playMainVideo = extractFunction("playMainVideo");
  const driveBranch = playMainVideo.indexOf('videoUrl.includes("drive.google.com")');
  const directOpen = playMainVideo.indexOf("openGoogleDrivePlayer(playerUrl, returnUrl)");

  assert.doesNotMatch(
    playMainVideo.slice(driveBranch, directOpen),
    /getIframePlayerHtml|getGoogleDrivePlayButtonHtml/
  );
});
