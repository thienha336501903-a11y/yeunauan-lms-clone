const MEDIA_TICKET_RETENTION_MS = 24 * 60 * 60 * 1000;
const MEDIA_TICKET_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

let lastCleanupAt = 0;

export function expiredV4MediaTicketCutoff(now = Date.now()) {
  const current = Number(now);
  if (!Number.isFinite(current)) return null;
  return new Date(current - MEDIA_TICKET_RETENTION_MS).toISOString();
}

export async function maybeCleanupExpiredV4MediaTickets(client, now = Date.now()) {
  const current = Number(now);
  if (!Number.isFinite(current)) {
    return { skipped: true, reason: "invalid_now", cutoff: null, error: null };
  }
  if (!client || typeof client.from !== "function") {
    return { skipped: true, reason: "missing_client", cutoff: null, error: null };
  }
  if (lastCleanupAt && current - lastCleanupAt < MEDIA_TICKET_CLEANUP_INTERVAL_MS) {
    return { skipped: true, reason: "interval", cutoff: null, error: null };
  }

  // Mark the attempt before touching Postgres so repeated requests cannot hammer cleanup
  // when the database is temporarily unavailable. Cleanup is maintenance only and must
  // never become part of the media authorization contract.
  lastCleanupAt = current;
  const cutoff = expiredV4MediaTicketCutoff(current);

  try {
    const { error } = await client
      .from("lms_v4_media_tickets")
      .delete()
      .lt("expires_at", cutoff);

    return { skipped: false, reason: null, cutoff, error: error || null };
  } catch (error) {
    return { skipped: false, reason: null, cutoff, error };
  }
}

export function resetV4MediaTicketCleanupForTest() {
  lastCleanupAt = 0;
}
