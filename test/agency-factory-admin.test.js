import test from "node:test";
import assert from "node:assert/strict";
import { createAdminSession } from "../utils/lms.js";
import { issueFactoryCsrf, requireFactoryAdmin } from "../utils/agency-factory-admin.js";

function res() {
  const headers = new Map();
  return {
    setHeader(k,v){headers.set(String(k).toLowerCase(),v)},
    getHeader(k){return headers.get(String(k).toLowerCase())},
    headers
  };
}

test("Factory control plane requires exact LMS host", () => {
  process.env.SESSION_SECRET = "factory-test-session-secret-1234567890";
  const session = createAdminSession("admin@example.com");
  const response = res();
  const out = requireFactoryAdmin({
    method:"GET",
    headers:{host:"evil.example.com",cookie:`admin_session_token=${encodeURIComponent(session.token)}`}
  },response,{allowedHost:"hoc.yeubep.shop"});
  assert.equal(out.ok,false);
  assert.equal(out.code,"factory_host_not_allowed");
});

test("Factory mutation requires same-origin and double-submit CSRF", () => {
  process.env.SESSION_SECRET = "factory-test-session-secret-1234567890";
  const session = createAdminSession("admin@example.com");
  const response = res();
  const request = {
    method:"POST",
    headers:{
      host:"hoc.yeubep.shop",
      origin:"https://hoc.yeubep.shop",
      "sec-fetch-site":"same-origin",
      cookie:`admin_session_token=${encodeURIComponent(session.token)}; factory_csrf=csrf_token_abcdefghijklmnopqrstuvwxyz123456`,
      "x-factory-csrf":"csrf_token_abcdefghijklmnopqrstuvwxyz123456"
    }
  };
  const out = requireFactoryAdmin(request,response,{allowedHost:"hoc.yeubep.shop"});
  assert.equal(out.ok,true);
  assert.match(out.actorRef,/^[A-Za-z0-9_-]{40,}$/);
});

test("Factory mutation rejects missing CSRF", () => {
  process.env.SESSION_SECRET = "factory-test-session-secret-1234567890";
  const session = createAdminSession("admin@example.com");
  const response = res();
  const out = requireFactoryAdmin({
    method:"POST",
    headers:{
      host:"hoc.yeubep.shop",
      origin:"https://hoc.yeubep.shop",
      "sec-fetch-site":"same-origin",
      cookie:`admin_session_token=${encodeURIComponent(session.token)}`
    }
  },response,{allowedHost:"hoc.yeubep.shop"});
  assert.equal(out.ok,false);
  assert.equal(out.code,"factory_csrf_denied");
});

test("Factory bootstrap issues strict CSRF cookie", () => {
  const response = res();
  const token = issueFactoryCsrf({headers:{}},response);
  assert.ok(token.length >= 32);
  const cookie = response.getHeader("set-cookie");
  assert.match(cookie,/SameSite=Strict/);
});
