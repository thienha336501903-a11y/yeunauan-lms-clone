import test from "node:test";
import assert from "node:assert/strict";

import { verifyGoogleAccessToken } from "../utils/agency-google-auth-bridge.js";

const CLIENT_ID = "client-123.apps.googleusercontent.com";

function response(body, ok = true) {
  return {
    ok,
    async json() {
      return body;
    }
  };
}

function sequenceFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (!responses.length) throw new Error("Unexpected fetch");
    return responses.shift();
  };
  return { fetchImpl, calls };
}

test("Agency Google bridge rejects an access token issued to another OAuth client", async () => {
  const { fetchImpl, calls } = sequenceFetch([
    response({
      audience: "other-client.apps.googleusercontent.com",
      expires_in: 1800,
      email: "student@example.com",
      verified_email: true,
      user_id: "google-user-1"
    })
  ]);

  const result = await verifyGoogleAccessToken("token-a", {
    fetchImpl,
    googleClientId: CLIENT_ID
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.code, "google_token_audience_mismatch");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?access_token=/);
});

test("Agency Google bridge rejects expired Google access tokens before userinfo", async () => {
  const { fetchImpl, calls } = sequenceFetch([
    response({
      audience: CLIENT_ID,
      expires_in: 0,
      email: "student@example.com",
      verified_email: true,
      user_id: "google-user-1"
    })
  ]);

  const result = await verifyGoogleAccessToken("token-b", {
    fetchImpl,
    googleClientId: CLIENT_ID
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_google_access_token");
  assert.equal(calls.length, 1);
});

test("Agency Google bridge rejects tokeninfo without verified email", async () => {
  const { fetchImpl, calls } = sequenceFetch([
    response({
      audience: CLIENT_ID,
      expires_in: 1800,
      email: "student@example.com",
      user_id: "google-user-1"
    })
  ]);

  const result = await verifyGoogleAccessToken("token-c", {
    fetchImpl,
    googleClientId: CLIENT_ID
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "google_email_unverified");
  assert.equal(calls.length, 1);
});

test("Agency Google bridge rejects userinfo when email_verified is missing", async () => {
  const { fetchImpl, calls } = sequenceFetch([
    response({
      audience: CLIENT_ID,
      expires_in: 1800,
      email: "student@example.com",
      verified_email: true,
      user_id: "google-user-1"
    }),
    response({
      sub: "google-user-1",
      email: "student@example.com"
    })
  ]);

  const result = await verifyGoogleAccessToken("token-d", {
    fetchImpl,
    googleClientId: CLIENT_ID
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.code, "google_email_unverified");
  assert.equal(calls.length, 2);
});

test("Agency Google bridge rejects tokeninfo/userinfo identity mismatch", async () => {
  const { fetchImpl } = sequenceFetch([
    response({
      audience: CLIENT_ID,
      expires_in: 1800,
      email: "student@example.com",
      verified_email: true,
      user_id: "google-user-1"
    }),
    response({
      sub: "google-user-2",
      email: "student@example.com",
      email_verified: true
    })
  ]);

  const result = await verifyGoogleAccessToken("token-e", {
    fetchImpl,
    googleClientId: CLIENT_ID
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "google_identity_mismatch");
});

test("Agency Google bridge accepts only matching, unexpired, verified identity", async () => {
  const { fetchImpl, calls } = sequenceFetch([
    response({
      audience: CLIENT_ID,
      expires_in: 1800,
      email: "Student@Example.com",
      verified_email: true,
      user_id: "google-user-1"
    }),
    response({
      sub: "google-user-1",
      email: "student@example.com",
      email_verified: true
    })
  ]);

  const result = await verifyGoogleAccessToken("token-f", {
    fetchImpl,
    googleClientId: CLIENT_ID
  });

  assert.deepEqual(result, { ok: true, email: "student@example.com" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://openidconnect.googleapis.com/v1/userinfo");
  assert.equal(calls[1].options.headers.Authorization, "Bearer token-f");
});
