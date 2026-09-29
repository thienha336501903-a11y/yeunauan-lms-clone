import test from "node:test";
import assert from "node:assert/strict";

import syncHandler from "../api/sync.js";
import legacyPostRedirectHandler from "../api/legacy-post-redirect.js";
import { _clearTenantCache } from "../utils/tenant-resolver.js";

const AGENCY_ID = "7beaa964-aed4-4309-8889-0485c26aaaf3";

function resCapture() {
  const state = { status: 200, body: null, redirected: null, sent: null, headers: {} };
  return {
    state,
    setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; },
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; return body; },
    send(body) { state.sent = body; return body; },
    redirect(code, url) { state.status = code; state.redirected = url; return url; },
    end() { return undefined; }
  };
}

function tenantDb(found = true) {
  const calls = [];
  return {
    calls,
    async rpc(name) {
      calls.push({ type: "rpc", name });
      assert.equal(name, "resolve_agency_domain");
      return found
        ? {
            data: {
              found: true,
              agency_id: AGENCY_ID,
              agency_slug: "agency-a",
              agency_name: "Agency A Test Academy",
              domain_id: "11111111-1111-4111-8111-111111111111",
              domain_status: "active",
              ssl_status: "active",
              is_primary: false
            },
            error: null
          }
        : { data: { found: false }, error: null };
    },
    from(table) {
      calls.push({ type: "from", table });
      throw new Error(`Legacy/Main business table must not be touched before Agency route is blocked: ${table}`);
    }
  };
}

test("M0D direct /api/sync is blocked on Agency host before Legacy secret/body dispatch", async () => {
  _clearTenantCache();
  const db = tenantDb(true);
  const res = resCapture();

  await syncHandler({
    method: "POST",
    headers: {
      host: "agency-sync.example.test",
      "x-sync-secret": "even-if-caller-knows-secret"
    },
    body: {
      action: "syncEnrollment",
      deliveryMode: "lms",
      courseSlug: "legacy-course",
      email: "student@example.com"
    },
    __options: { supabaseClient: db }
  }, res);

  assert.equal(res.state.status, 404);
  assert.equal(res.state.body.code, "agency_legacy_sync_blocked");
  assert.equal(db.calls.some(call => call.type === "from"), false);
});

test("M0D old /post redirect is blocked on Agency host before Legacy URL construction", async () => {
  _clearTenantCache();
  const db = tenantDb(true);
  const res = resCapture();

  await legacyPostRedirectHandler({
    method: "GET",
    headers: { host: "agency-post.example.test" },
    query: { id: "old-post-id" },
    __options: { supabaseClient: db }
  }, res);

  assert.equal(res.state.status, 404);
  assert.equal(res.state.body.code, "agency_legacy_post_blocked");
  assert.equal(res.state.redirected, null);
});

test("M0D Agency route blocking does not convert an explicit Legacy host into Agency", async () => {
  _clearTenantCache();
  const previous = process.env.LEGACY_HOST_ALLOWLIST;
  process.env.LEGACY_HOST_ALLOWLIST = "legacy-m0d.example.test";

  try {
    const db = tenantDb(false);
    const res = resCapture();
    await syncHandler({
      method: "POST",
      headers: { host: "legacy-m0d.example.test" },
      body: {},
      __options: { supabaseClient: db }
    }, res);

    // It reaches the unchanged Legacy sync auth gate rather than the Agency block.
    assert.notEqual(res.state.body?.code, "agency_legacy_sync_blocked");
    assert.ok([401, 503].includes(res.state.status));
  } finally {
    if (previous === undefined) delete process.env.LEGACY_HOST_ALLOWLIST;
    else process.env.LEGACY_HOST_ALLOWLIST = previous;
  }
});
