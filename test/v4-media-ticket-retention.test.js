import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  expiredV4MediaTicketCutoff,
  maybeCleanupExpiredV4MediaTickets,
  resetV4MediaTicketCleanupForTest
} from '../utils/v4-media-ticket-retention.js';

function fakeClient(onDelete) {
  return {
    from(table) {
      assert.equal(table, 'lms_v4_media_tickets');
      return {
        delete() {
          return {
            async lt(column, value) {
              assert.equal(column, 'expires_at');
              return onDelete(value);
            }
          };
        }
      };
    }
  };
}

test('V4 media ticket retention keeps the most recent 24 hours', async () => {
  resetV4MediaTicketCleanupForTest();
  const now = Date.UTC(2026, 7, 21, 9, 0, 0);
  const expectedCutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  let seenCutoff = '';

  const result = await maybeCleanupExpiredV4MediaTickets(fakeClient(async (cutoff) => {
    seenCutoff = cutoff;
    return { error: null };
  }), now);

  assert.equal(expiredV4MediaTicketCutoff(now), expectedCutoff);
  assert.equal(seenCutoff, expectedCutoff);
  assert.equal(result.skipped, false);
  assert.equal(result.error, null);
});

test('V4 media ticket cleanup is throttled for 15 minutes per warm instance', async () => {
  resetV4MediaTicketCleanupForTest();
  const now = Date.UTC(2026, 7, 21, 9, 0, 0);
  let deletes = 0;
  const client = fakeClient(async () => {
    deletes += 1;
    return { error: null };
  });

  const first = await maybeCleanupExpiredV4MediaTickets(client, now);
  const second = await maybeCleanupExpiredV4MediaTickets(client, now + 14 * 60 * 1000);
  const third = await maybeCleanupExpiredV4MediaTickets(client, now + 15 * 60 * 1000);

  assert.equal(first.skipped, false);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'interval');
  assert.equal(third.skipped, false);
  assert.equal(deletes, 2);
});

test('V4 media ticket cleanup reports database errors without throwing', async () => {
  resetV4MediaTicketCleanupForTest();
  const expected = new Error('temporary cleanup failure');

  const result = await maybeCleanupExpiredV4MediaTickets(fakeClient(async () => ({ error: expected })), Date.UTC(2026, 7, 21, 9, 0, 0));

  assert.equal(result.skipped, false);
  assert.equal(result.error, expected);
});

test('V4 media and playback handlers schedule retention off the response path', () => {
  const media = fs.readFileSync(new URL('../utils/lms-handlers/v4-telegram-media.js', import.meta.url), 'utf8');
  const play = fs.readFileSync(new URL('../utils/lms-handlers/v4-telegram-play.js', import.meta.url), 'utf8');

  for (const source of [media, play]) {
    assert.match(source, /maybeCleanupExpiredV4MediaTickets/);
    assert.match(source, /void maybeCleanupExpiredV4MediaTickets\(supabase\)\.then/);
    assert.match(source, /if \(result\.error\) console\.warn/);
    assert.doesNotMatch(source, /await maybeCleanupExpiredV4MediaTickets/);
  }
});
