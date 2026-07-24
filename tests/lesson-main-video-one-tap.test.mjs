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

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name)
  };
}

function createIframeHarness() {
  const thumbnail = { classList: createClassList() };
  const playButton = {
    classList: createClassList(),
    disabled: false,
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); }
  };
  const timers = new Map();
  let nextTimer = 1;
  const wrapper = {
    dataset: {},
    children: [],
    querySelector(selector) {
      if (selector === "#videoThumb") return thumbnail;
      if (selector === "#playBtn") return playButton;
      return null;
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
    }
  };
  const document = {
    createElement() {
      const listeners = new Map();
      return {
        classList: createClassList(["opacity-0", "pointer-events-none"]),
        attributes: new Map(),
        parentNode: null,
        addEventListener(name, handler) { listeners.set(name, handler); },
        setAttribute(name, value) { this.attributes.set(name, value); },
        remove() {
          if (!this.parentNode) return;
          this.parentNode.children = this.parentNode.children.filter(child => child !== this);
          this.parentNode = null;
        },
        dispatch(name) { listeners.get(name)?.(); }
      };
    }
  };
  const factory = new Function(
    "document", "setTimeout", "clearTimeout", "createWatermark", "clearWatermarkFrom",
    `${extractFunction("resetMainVideoPlayer")}
     ${extractFunction("mountMainVideoIframe")}
     return { resetMainVideoPlayer, mountMainVideoIframe };`
  );
  const api = factory(
    document,
    callback => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    id => timers.delete(id),
    () => {},
    () => {}
  );
  return { ...api, wrapper, thumbnail, playButton, timers };
}

test("main Drive video opens the dedicated player during the first Play handler", () => {
  const playMainVideo = extractFunction("playMainVideo");
  const driveBranch = playMainVideo.indexOf('videoUrl.includes("drive.google.com")');
  const directOpen = playMainVideo.indexOf("openGoogleDrivePlayer(playerUrl, returnUrl)");
  const iframeFallback = playMainVideo.indexOf("mountMainVideoIframe(videoWrapper, videoUrl, lesson, email)");

  assert.ok(driveBranch >= 0);
  assert.ok(directOpen > driveBranch);
  assert.ok(iframeFallback > directOpen);
  assert.match(playMainVideo.slice(directOpen, iframeFallback), /return;/);
});

test("hard-load and SPA renderers use the same one-tap handler", () => {
  assert.match(source, /playBtn\.onclick = \(\) => playMainVideo\(videoWrapper, currentLesson, studentEmail\)/);
  assert.match(source, /pb\.onclick = \(\) => playMainVideo\(videoWrapper, lesson, studentEmail\)/);
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

test("iframe player stays behind the thumbnail until load and supports inline autoplay", () => {
  const mountMainVideoIframe = extractFunction("mountMainVideoIframe");
  const append = mountMainVideoIframe.indexOf("videoWrapper.appendChild(iframe)");
  const assignSource = mountMainVideoIframe.indexOf("iframe.src = videoUrl");
  const hideThumbnail = mountMainVideoIframe.indexOf('thumbnail.classList.add("hidden")');

  assert.ok(append >= 0);
  assert.ok(assignSource > append);
  assert.ok(hideThumbnail >= 0 && hideThumbnail < append,
    "thumbnail hiding must exist only inside the earlier load callback");
  assert.match(mountMainVideoIframe, /addEventListener\("load", finishLoading, \{ once: true \}\)/);
  assert.match(mountMainVideoIframe, /allow = "autoplay; encrypted-media; picture-in-picture"/);
  assert.match(mountMainVideoIframe, /setAttribute\("playsinline", ""\)/);
  assert.match(mountMainVideoIframe, /setAttribute\("webkit-playsinline", ""\)/);
});

test("loading/ready guards prevent duplicate main players and listeners", () => {
  const playMainVideo = extractFunction("playMainVideo");
  const mountMainVideoIframe = extractFunction("mountMainVideoIframe");

  assert.match(playMainVideo, /mainVideoState === "loading"/);
  assert.match(playMainVideo, /mainVideoState === "ready"/);
  assert.match(mountMainVideoIframe, /mainVideoState === "loading"/);
  assert.match(mountMainVideoIframe, /mainVideoState === "ready"/);
  assert.match(mountMainVideoIframe, /addEventListener\("error".*\{ once: true \}/s);
});

test("iframe failure or timeout restores thumbnail and Play retry state", () => {
  const resetMainVideoPlayer = extractFunction("resetMainVideoPlayer");
  const mountMainVideoIframe = extractFunction("mountMainVideoIframe");

  assert.match(resetMainVideoPlayer, /thumbnail\.classList\.remove\("hidden"\)/);
  assert.match(resetMainVideoPlayer, /playButton\.classList\.remove\("hidden"\)/);
  assert.match(resetMainVideoPlayer, /playButton\.disabled = false/);
  assert.match(resetMainVideoPlayer, /mainVideoState = "idle"/);
  assert.match(mountMainVideoIframe, /setTimeout\(/);
  assert.match(mountMainVideoIframe, /resetMainVideoPlayer\(videoWrapper, iframe\)/);
});

test("main image and supplemental one-click implementations remain untouched", () => {
  assert.match(source, /videoWrapper\.innerHTML = getMainImageHtml\(currentLesson\)/);
  assert.match(source, /videoWrapper\.innerHTML = getMainImageHtml\(lesson\)/);
  assert.match(source, /onclick="openGoogleDrivePlayer\(this\.dataset\.playerUrl, this\.dataset\.returnUrl\)"/);
  assert.match(source, /function playSupplementalYouTube\(containerId\)/);
  assert.match(source, /function playSupplementalBunny\(containerId\)/);
});

test("double click mounts one iframe and keeps the cover until player load", () => {
  const harness = createIframeHarness();
  const lesson = { videoProvider: "bunny_embed" };

  harness.mountMainVideoIframe(harness.wrapper, "https://video.example/embed", lesson, "student@example.com");
  harness.mountMainVideoIframe(harness.wrapper, "https://video.example/embed", lesson, "student@example.com");

  assert.equal(harness.wrapper.children.length, 1);
  assert.equal(harness.wrapper.dataset.mainVideoState, "loading");
  assert.equal(harness.thumbnail.classList.contains("hidden"), false);
  assert.equal(harness.playButton.classList.contains("hidden"), false);
  assert.equal(harness.playButton.disabled, true);

  harness.wrapper.children[0].dispatch("load");
  assert.equal(harness.wrapper.dataset.mainVideoState, "ready");
  assert.equal(harness.thumbnail.classList.contains("hidden"), true);
  assert.equal(harness.playButton.classList.contains("hidden"), true);
});

test("iframe error removes the failed player and restores retry UI", () => {
  const harness = createIframeHarness();
  harness.mountMainVideoIframe(harness.wrapper, "https://video.example/embed", {}, "student@example.com");
  harness.wrapper.children[0].dispatch("error");

  assert.equal(harness.wrapper.children.length, 0);
  assert.equal(harness.wrapper.dataset.mainVideoState, "idle");
  assert.equal(harness.thumbnail.classList.contains("hidden"), false);
  assert.equal(harness.playButton.classList.contains("hidden"), false);
  assert.equal(harness.playButton.disabled, false);
});
