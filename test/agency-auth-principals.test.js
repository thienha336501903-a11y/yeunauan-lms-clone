import test from "node:test";
import assert from "node:assert/strict";
import { findAuthUserByEmail, prepareAuthPrincipal } from "../utils/agency-auth-principals.js";

test("Auth lookup pages past first 1000 users instead of silently truncating", async () => {
  const calls = [];
  const client = {
    auth: { admin: {
      listUsers: async ({ page, perPage }) => {
        calls.push({ page, perPage });
        if (page === 1) return { data: { users: Array.from({length: 200}, (_,i)=>({id:`a-${i}`,email:`a${i}@example.com`})) } };
        return { data: { users: [{ id: "target", email: "Owner@Example.com" }] } };
      }
    }}
  };
  const result = await findAuthUserByEmail(client, "owner@example.com", { perPage: 200 });
  assert.equal(result.ok, true);
  assert.equal(result.user.id, "target");
  assert.equal(calls.length, 2);
});

test("Auth lookup fails closed if same email resolves to multiple IDs", async () => {
  const client = {
    auth: { admin: {
      listUsers: async () => ({ data: { users: [
        {id:"u1",email:"same@example.com"},
        {id:"u2",email:"SAME@example.com"}
      ] } })
    }}
  };
  const result = await findAuthUserByEmail(client, "same@example.com");
  assert.equal(result.ok, false);
  assert.equal(result.code, "auth_user_email_ambiguous");
});

test("Principal reuse validates supplied user id and email", async () => {
  const client = {
    auth: { admin: {
      getUserById: async () => ({ data: { user: { id:"u1", email:"owner@example.com" } } })
    }}
  };
  const result = await prepareAuthPrincipal(client, { user_id:"u1", email:"owner@example.com" });
  assert.equal(result.ok, true);
  assert.equal(result.reused, true);
  assert.equal(result.created, false);
});

test("Principal reuse denies user-id/email mismatch", async () => {
  const client = {
    auth: { admin: {
      getUserById: async () => ({ data: { user: { id:"u1", email:"other@example.com" } } })
    }}
  };
  const result = await prepareAuthPrincipal(client, { user_id:"u1", email:"owner@example.com" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "principal_identity_mismatch");
});
