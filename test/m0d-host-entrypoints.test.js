import assert from "node:assert/strict";
import test from "node:test";

import learningHandler from "../api/learning.js";
import legacyPostRedirectHandler from "../api/legacy-post-redirect.js";
import syncHandler from "../api/sync.js";

const tenantDb = {
  rpc: async (_name, args) => ({
    data: args.p_hostname === "agency-m0d.example"
      ? { found: true, agency_id: "m0d-agency", agency_slug: "m0d", hostname: args.p_hostname }
      : null
  })
};

function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(code, location) { this.statusCode = code; this.location = location; return this; }
  };
}

test("Agency /learning routes to its protected intro without reading Legacy courses", async () => {
  const req = {
    headers: { host: "agency-m0d.example" },
    query: { course: "F-CC-670091" },
    __options: { supabaseClient: tenantDb }
  };
  const res = response();
  await learningHandler(req, res);
  assert.equal(res.statusCode, 307);
  assert.equal(res.location, "/legacy-post.html?course=F-CC-670091");
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("Agency /post redirect cannot hand off to a Legacy host", async () => {
  const req = {
    headers: { host: "agency-m0d.example" },
    query: { id: "post-123" },
    __options: { supabaseClient: tenantDb }
  };
  const res = response();
  await legacyPostRedirectHandler(req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, "agency_legacy_post_redirect_prohibited");
  assert.equal(res.location, undefined);
});

test("Agency and unknown hosts cannot enter the Legacy sync endpoint", async () => {
  for (const [host, status, code] of [
    ["agency-m0d.example", 403, "agency_legacy_sync_blocked"],
    ["unmapped-m0d.example", 404, "tenant_not_found"]
  ]) {
    const req = {
      method: "POST", headers: { host }, query: {},
      __options: { supabaseClient: tenantDb }
    };
    const res = response();
    await syncHandler(req, res);
    assert.equal(res.statusCode, status);
    assert.equal(res.body.code, code);
  }
});

test("Unmapped hosts fail closed on both learning and post redirects", async () => {
  for (const handler of [learningHandler, legacyPostRedirectHandler]) {
    const req = {
      headers: { host: "unmapped-m0d.example" },
      query: { course: "F-CC-670091", id: "post-123" },
      __options: { supabaseClient: tenantDb }
    };
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, "tenant_not_found");
    assert.equal(res.location, undefined);
  }
});
