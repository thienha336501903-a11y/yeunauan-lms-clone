import test from "node:test";
import assert from "node:assert/strict";
import { _clearTenantCache, resolveTenant } from "../utils/tenant-resolver.js";

function db(surface) {
  return {
    rpc: async () => ({
      data: {
        found: true,
        agency_id: "11111111-1111-4111-8111-111111111111",
        agency_slug: "agency-b",
        agency_name: "Agency B",
        domain_id: "22222222-2222-4222-8222-222222222222",
        hostname: "b.example.com",
        surface,
        domain_status: "active",
        ssl_status: "active",
        is_primary: true
      },
      error: null
    })
  };
}

test("Typed LMS host resolves on LMS surface", async () => {
  _clearTenantCache();
  const out = await resolveTenant({headers:{host:"b.example.com"}}, {surface:"lms",supabaseClient:db("lms")});
  assert.equal(out.ok, true);
  assert.equal(out.tenant.domainSurface, "lms");
});

test("Typed LMS host fails closed on Commerce surface", async () => {
  _clearTenantCache();
  const out = await resolveTenant({headers:{host:"b.example.com"}}, {surface:"commerce",supabaseClient:db("lms")});
  assert.equal(out.ok, false);
  assert.equal(out.code, "tenant_surface_mismatch");
  assert.equal(out.status, 404);
});

test("Historical untyped Agency host stays backward compatible", async () => {
  _clearTenantCache();
  const out = await resolveTenant({headers:{host:"a.example.com"}}, {surface:"lms",supabaseClient:db(null)});
  assert.equal(out.ok, true);
  assert.equal(out.tenant.domainSurface, null);
});

test("Tenant cache key is surface-aware", async () => {
  _clearTenantCache();
  let calls = 0;
  const client = {
    rpc: async (_fn, args) => {
      calls++;
      return {data:{
        found:true,
        agency_id:"11111111-1111-4111-8111-111111111111",
        agency_slug:"agency-b",
        agency_name:"Agency B",
        domain_id:"22222222-2222-4222-8222-222222222222",
        hostname:args.p_hostname,
        surface:"lms",
        domain_status:"active",
        ssl_status:"active",
        is_primary:true
      },error:null};
    }
  };
  const a = await resolveTenant({headers:{host:"b.example.com"}},{surface:"lms",supabaseClient:client,ttlMs:5000});
  const b = await resolveTenant({headers:{host:"b.example.com"}},{surface:"commerce",supabaseClient:client,ttlMs:5000});
  assert.equal(a.ok,true);
  assert.equal(b.ok,false);
  assert.equal(b.code,"tenant_surface_mismatch");
  assert.equal(calls,2);
});
