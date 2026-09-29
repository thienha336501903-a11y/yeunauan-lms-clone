import test from "node:test";
import assert from "node:assert/strict";

import agencyAdminHandler from "../api/lms/agency-admin.js";
import { _clearTenantCache } from "../utils/tenant-resolver.js";

const AGENCY_ID = "7beaa964-aed4-4309-8889-0485c26aaaf3";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function responseCapture() {
  const state = { status: 200, body: null, headers: {} };
  return {
    state,
    setHeader(name, value) {
      state.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      state.status = code;
      return this;
    },
    json(body) {
      state.body = body;
      return body;
    }
  };
}

function makeMembershipBuilder(role) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    async maybeSingle() {
      return {
        data: {
          id: "22222222-2222-4222-8222-222222222222",
          agency_id: AGENCY_ID,
          user_id: USER_ID,
          role,
          display_name: "M0D Admin",
          phone: null,
          status: "active",
          created_at: "2026-09-29T00:00:00.000Z"
        },
        error: null
      };
    }
  };
  return builder;
}

function makeDb({ role = "agency_owner", tenantFound = true } = {}) {
  const calls = [];

  return {
    calls,
    auth: {
      async getUser(token) {
        calls.push({ type: "getUser", token });
        return {
          data: {
            user: {
              id: USER_ID,
              email: "m0d-admin@example.com"
            }
          },
          error: null
        };
      }
    },
    async rpc(name, args) {
      calls.push({ type: "rpc", name, args });

      if (name === "resolve_agency_domain") {
        if (!tenantFound) return { data: { found: false }, error: null };
        return {
          data: {
            found: true,
            agency_id: AGENCY_ID,
            agency_slug: "agency-a",
            agency_name: "Agency A Test Academy",
            domain_id: "33333333-3333-4333-8333-333333333333",
            domain_status: "active",
            ssl_status: "active",
            is_primary: false
          },
          error: null
        };
      }

      if (name === "approve_agency_order") {
        return {
          data: {
            ok: true,
            order_id: args.p_order_id,
            status: "completed",
            grants_created: 1,
            idempotent: false
          },
          error: null
        };
      }

      if (name === "refund_agency_order") {
        return {
          data: {
            ok: true,
            order_id: args.p_order_id,
            status: "refunded",
            grants_revoked: 1,
            idempotent: false
          },
          error: null
        };
      }

      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      calls.push({ type: "from", table });
      if (table === "agency_memberships") return makeMembershipBuilder(role);
      throw new Error(`Unexpected table: ${table}`);
    }
  };
}

function makeReq({ host, endpoint, method = "GET", body = {}, db }) {
  return {
    method,
    query: { endpoint },
    body,
    headers: {
      host,
      authorization: "Bearer m0d-test-jwt"
    },
    __options: { supabaseClient: db }
  };
}

test("M0D Agency admin profile requires Agency owner/staff and returns safe tenant identity", async () => {
  _clearTenantCache();
  const db = makeDb({ role: "agency_owner" });
  const req = makeReq({
    host: "m0d-owner.example.test",
    endpoint: "profile",
    db
  });
  const res = responseCapture();

  await agencyAdminHandler(req, res);

  assert.equal(res.state.status, 200);
  assert.equal(res.state.body.success, true);
  assert.equal(res.state.body.agency.id, AGENCY_ID);
  assert.equal(res.state.body.member.role, "agency_owner");
  assert.equal(res.state.headers["cache-control"], "private, no-store");
});

test("M0D Agency admin rejects student role", async () => {
  _clearTenantCache();
  const db = makeDb({ role: "student" });
  const req = makeReq({
    host: "m0d-student.example.test",
    endpoint: "profile",
    db
  });
  const res = responseCapture();

  await agencyAdminHandler(req, res);

  assert.equal(res.state.status, 403);
  assert.equal(res.state.body.success, false);
  assert.equal(res.state.body.code, "forbidden_role");
});

test("M0D Agency admin never falls through to Legacy admin on explicit Legacy host", async () => {
  _clearTenantCache();
  const previous = process.env.LEGACY_HOST_ALLOWLIST;
  process.env.LEGACY_HOST_ALLOWLIST = "m0d-legacy.example.test";

  try {
    const db = makeDb({ tenantFound: false });
    const req = makeReq({
      host: "m0d-legacy.example.test",
      endpoint: "profile",
      db
    });
    const res = responseCapture();

    await agencyAdminHandler(req, res);

    assert.equal(res.state.status, 404);
    assert.equal(res.state.body.success, false);
    assert.equal(res.state.body.code, "agency_admin_not_available");
  } finally {
    if (previous === undefined) delete process.env.LEGACY_HOST_ALLOWLIST;
    else process.env.LEGACY_HOST_ALLOWLIST = previous;
  }
});

test("M0D Agency admin approve delegates to tenant-bound Agency approval RPC", async () => {
  _clearTenantCache();
  const db = makeDb({ role: "agency_staff" });
  const orderId = "44444444-4444-4444-8444-444444444444";
  const req = makeReq({
    host: "m0d-approve.example.test",
    endpoint: "order-approve",
    method: "POST",
    body: { orderId },
    db
  });
  const res = responseCapture();

  await agencyAdminHandler(req, res);

  assert.equal(res.state.status, 200);
  assert.equal(res.state.body.success, true);
  assert.equal(res.state.body.orderId, orderId);

  const rpc = db.calls.find((call) => call.type === "rpc" && call.name === "approve_agency_order");
  assert.ok(rpc);
  assert.equal(rpc.args.p_agency_id, AGENCY_ID);
  assert.equal(rpc.args.p_order_id, orderId);
});

test("M0D Agency admin refund delegates to tenant-bound Agency refund RPC", async () => {
  _clearTenantCache();
  const db = makeDb({ role: "agency_owner" });
  const orderId = "55555555-5555-4555-8555-555555555555";
  const req = makeReq({
    host: "m0d-refund.example.test",
    endpoint: "order-refund",
    method: "POST",
    body: { orderId, reason: "M0D test refund" },
    db
  });
  const res = responseCapture();

  await agencyAdminHandler(req, res);

  assert.equal(res.state.status, 200);
  assert.equal(res.state.body.success, true);
  assert.equal(res.state.body.orderId, orderId);

  const rpc = db.calls.find((call) => call.type === "rpc" && call.name === "refund_agency_order");
  assert.ok(rpc);
  assert.equal(rpc.args.p_agency_id, AGENCY_ID);
  assert.equal(rpc.args.p_order_id, orderId);
  assert.equal(rpc.args.p_reason, "M0D test refund");
});
