import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("public LMS health reuses the existing portal function", () => {
  const config = JSON.parse(read("vercel.json"));
  assert.ok(config.rewrites.some(route =>
    route.source === "/api/health" &&
    route.destination === "/api/lms/portal?endpoint=health"
  ));

  const portal = read("api/lms/portal.js");
  assert.match(portal, /endpoint === "health"/);
  assert.match(portal, /healthHandler/);
});

test("health reports database state without exposing database errors", () => {
  const health = read("utils/lms-handlers/health.js");
  assert.match(health, /\.select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(health, /status: "degraded"/);
  assert.match(health, /database: "error"/);
  assert.doesNotMatch(health, /error\.message/);
  assert.doesNotMatch(health, /SUPABASE_SERVICE_ROLE_KEY/);
});
