import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/migrations/20261002140000_agency_factory_v1_foundation.sql", import.meta.url), "utf8");
const members = fs.readFileSync(new URL("../utils/agency-members.js", import.meta.url), "utf8");

test("Agency member status mutation is a service-only transactional RPC", () => {
  assert.match(sql, /create or replace function public\.set_agency_member_status_atomic/);
  assert.match(sql, /from public\.agencies[\s\S]*for update/);
  assert.match(sql, /v_active_owner_count <= 1/);
  assert.match(sql, /agency_last_owner_protected/);
  assert.match(sql, /revoke all on function public\.set_agency_member_status_atomic[\s\S]*anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.set_agency_member_status_atomic[\s\S]*service_role/i);
});

test("Agency member API delegates the safety decision atomically instead of SELECT then UPDATE", () => {
  assert.match(members, /client\.rpc\("set_agency_member_status_atomic"/);
  const fn = members.slice(members.indexOf("export async function setAgencyMemberStatus"));
  assert.doesNotMatch(fn, /\.from\("agency_memberships"\)[\s\S]*\.update\(/);
  assert.doesNotMatch(fn, /otherOwners/);
});
