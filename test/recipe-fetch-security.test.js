import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchAllowedRecipeUrl,
  isAllowedRecipeFetchUrl
} from '../utils/lms-recipe-fetch.js';

test('recipe fallback only permits HTTPS Google content hosts', () => {
  assert.equal(isAllowedRecipeFetchUrl('https://docs.google.com/document/d/abc'), true);
  assert.equal(isAllowedRecipeFetchUrl('https://drive.usercontent.google.com/download?id=abc'), true);
  assert.equal(isAllowedRecipeFetchUrl('https://docs.googleusercontent.com/file'), true);
  assert.equal(isAllowedRecipeFetchUrl('http://drive.google.com/file'), false);
  assert.equal(isAllowedRecipeFetchUrl('https://drive.google.com.evil.example/file'), false);
  assert.equal(isAllowedRecipeFetchUrl('https://127.0.0.1/internal'), false);
  assert.equal(isAllowedRecipeFetchUrl('https://user:pass@drive.google.com/file'), false);
});

test('recipe fallback validates every redirect before following it', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' }
    });
  };

  await assert.rejects(
    fetchAllowedRecipeUrl('https://drive.google.com/uc?id=abc', { fetchImpl }),
    /redirect host is not allowed/
  );
  assert.equal(calls, 1);
});

test('recipe fallback enforces a bounded response body', async () => {
  const fetchImpl = async () => new Response('x'.repeat(65), {
    status: 200,
    headers: { 'content-type': 'text/plain' }
  });

  await assert.rejects(
    fetchAllowedRecipeUrl('https://docs.google.com/document/d/abc', { fetchImpl, maxBytes: 64 }),
    /too large/
  );
});
