import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const r2 = fs.readFileSync(new URL("../utils/v5-r2.js", import.meta.url), "utf8");
const handler = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-test-cleanup.js", import.meta.url), "utf8");
const router = fs.readFileSync(new URL("../api/lms/admin.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../v5-test-cleanup.html", import.meta.url), "utf8");

test("R2 helper signs DELETE and accepts already-missing objects", () => {
  assert.match(r2, /export async function deleteR2Object/);
  assert.match(r2, /signedRequest\(\{ method: "DELETE", key \}\)/);
  assert.match(r2, /response\.status !== 404/);
});

test("V5 cleanup is admin-only and fails closed to registered clone factory course namespace", () => {
  assert.match(handler, /getAdminFromRequest/);
  assert.match(handler, /DELETE_CLONE_FACTORY_TEST_R2/);
  assert.match(handler, /TEST_PREFIX = "__clone_factory_test"/);
  assert.match(handler, /studentDisplayTitle/);
  assert.match(handler, /delivery_mode/);
  assert.match(handler, /key\.startsWith\(prefix\)/);
  assert.match(handler, /\.from\("v5_media_assets"\)/);
  assert.match(handler, /verifyRegisteredFixtureKeys/);
  assert.match(handler, /keys\.length > 10/);
  assert.match(handler, /if \(after\) throw new Error/);
  assert.doesNotMatch(handler, /filename\.startsWith\("__clone_factory_test"\)/);
});

test("admin router and cleanup page use the guarded endpoint", () => {
  assert.match(router, /endpoint === "v5-test-cleanup"/);
  assert.match(page, /endpoint=v5-test-cleanup/);
  assert.match(page, /confirm\(`/);
});
