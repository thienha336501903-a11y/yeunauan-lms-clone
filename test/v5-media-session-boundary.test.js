import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sw = fs.readFileSync(new URL("../v5/media-sw.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../v5/app.js", import.meta.url), "utf8");
const dashboard = fs.readFileSync(new URL("../my-courses.html", import.meta.url), "utf8");

test("V5 worker namespaces leases by opaque media session context", () => {
  assert.match(sw,/sessionContext/);
  assert.match(sw,/sessionGeneration/);
  assert.match(sw,/cacheKey\(course, lessonId, assetId, context = sessionContext\)/);
  assert.match(sw,/media_session_not_initialized/);
});

test("V5 worker clears cache, in-flight registry and proof key on session reset", () => {
  assert.match(sw,/leases\.clear\(\)/);
  assert.match(sw,/leaseRequests\.clear\(\)/);
  assert.match(sw,/proofIdentityPromise = null/);
  assert.match(sw,/v5-clear-session/);
  assert.match(sw,/v5-set-session-context/);
});

test("Late lease response is rejected after session generation changes", () => {
  assert.match(sw,/expectedGeneration !== sessionGeneration/);
  assert.match(sw,/expectedContext !== sessionContext/);
  assert.match(sw,/media_session_stale/);
});

test("V5 app installs server media context before rendering protected media", () => {
  assert.match(app,/setProtectedMediaSessionContext\(payload\.mediaSessionContext\)/);
  assert.match(app,/BroadcastChannel\(MEDIA_SESSION_CHANNEL\)/);
});

test("Account switch calls logout endpoint and clears V5 session", () => {
  assert.match(dashboard,/endpoint=learner-logout/);
  assert.match(dashboard,/v5-clear-session/);
  assert.match(dashboard,/system-b-v5-media-session-v1/);
});
