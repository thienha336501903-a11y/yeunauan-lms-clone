import assert from "node:assert/strict";
import test from "node:test";
import adminHandler from "../api/lms/admin.js";
import learningHandler from "../api/learning.js";

const mockDb = {
  rpc: async (_name, args) => ({ data: args.p_hostname === "agency-m0d.example"
    ? { found: true, agency_id: "m0d-agency", agency_slug: "m0d", hostname: args.p_hostname }
    : null })
};

function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    redirect(code, url) { this.statusCode = code; this.location = url; return this; }
  };
}

test("Agency host cannot enter Legacy admin handlers", async () => {
  const req = { headers: { host: "agency-m0d.example" }, query: { endpoint: "auth" }, __options: { supabaseClient: mockDb } };
  const res = response();
  await adminHandler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "agency_legacy_admin_prohibited");
});

test("Agency learning route opens Agency-protected course intro without Legacy DB lookup", async () => {
  const req = { headers: { host: "agency-m0d.example" }, query: { course: "F-CC-670091" }, __options: { supabaseClient: mockDb } };
  const res = response();
  await learningHandler(req, res);
  assert.equal(res.statusCode, 307);
  assert.equal(res.location, "/legacy-post.html?course=F-CC-670091");
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("Unknown host cannot reach Legacy admin or learning path", async () => {
  for (const handler of [adminHandler, learningHandler]) {
    const req = { headers: { host: "unknown-m0d.example" }, query: { course: "F-CC-670091", endpoint: "auth" }, __options: { supabaseClient: mockDb } };
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, "tenant_not_found");
  }
});
