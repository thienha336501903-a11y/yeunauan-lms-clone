import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql=fs.readFileSync(new URL("../supabase/migrations/20261002140000_agency_factory_v1_foundation.sql",import.meta.url),"utf8");

test("Factory migration is additive and keeps existing untyped domains compatible",()=>{
  assert.match(sql,/add column if not exists surface text/i);
  assert.match(sql,/surface is null or surface in \('lms','commerce'\)/i);
});

test("Factory run journal is service-role only",()=>{
  assert.match(sql,/revoke all on table public\.agency_provisioning_runs from public, anon, authenticated/i);
  assert.match(sql,/grant select, insert, update on table public\.agency_provisioning_runs to service_role/i);
});

test("Factory atomic apply forces suspended tenant and unpublished offerings",()=>{
  assert.match(sql,/jsonb_build_object\('status','suspended'\)/i);
  assert.match(sql,/jsonb_build_object\('is_published', false\)/i);
});

test("Factory activate requires READY and suspension never promotes PREPARING to READY",()=>{
  assert.match(sql,/if v_run\.phase <> 'READY' then raise exception 'factory_run_not_ready'/i);
  assert.match(sql,/when v_run\.phase = 'ACTIVE' then 'READY'/i);
  assert.match(sql,/else v_run\.phase/i);
});

test("Factory privileged RPCs are executable only by service role",()=>{
  assert.match(sql,/revoke all on function public\.provision_agency_factory_v1_atomic[\s\S]*from public, anon, authenticated/i);
  assert.match(sql,/grant execute on function public\.provision_agency_factory_v1_atomic[\s\S]*to service_role/i);
  assert.match(sql,/revoke all on function public\.set_agency_factory_runtime_state[\s\S]*from public, anon, authenticated/i);
});
