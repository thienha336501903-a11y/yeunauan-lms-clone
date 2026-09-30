import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloneConfig } from "../utils/clone-config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("M0E LMS clone config ignores retired external Legacy post origins", () => {
  const config = cloneConfig({
    LEGACY_POST_PUBLIC_URL: "https://legacy.example.com"
  });
  assert.equal("legacyPostPublicUrl" in config, false);
});

test("M0E LMS runtime contains no retired external Legacy post endpoint references", () => {
  const runtimeFiles = [
    "utils/clone-config.js",
    "api/legacy-post-redirect.js",
    ".env.example"
  ];
  const forbidden = [
    /\bLEGACY_POST_PUBLIC_URL\b/,
    /legacyPostPublicUrl/,
    /https:\/\/yeunauan\.live/i
  ];
  for (const file of runtimeFiles) {
    const source = read(file);
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${file} must not reference retired Legacy post origin ${pattern}`);
    }
  }
});

test("M0E retired /post deep link fails closed without external redirect", () => {
  const source = read("api/legacy-post-redirect.js");
  assert.match(source, /status\(410\)/);
  assert.match(source, /legacy_post_retired_m0e/);
  assert.doesNotMatch(source, /res\.redirect\(/);
  assert.match(source, /retired legacy post deep-link requested/);
});

test("M0E keeps Main-backed compatibility routes separate from external Legacy dependency", () => {
  const portal = read("api/lms/portal.js");
  const sync = read("api/sync.js");
  assert.match(portal, /endpoint === "legacy-entry-token"/);
  assert.match(sync, /from "\.\.\/utils\/supabase\.js"/);
  assert.doesNotMatch(sync, /LEGACY_SUPABASE_URL|LEGACY_SUPABASE_SERVICE_ROLE_KEY|aqozjkfwzmyfunqvcyjv/);
});
