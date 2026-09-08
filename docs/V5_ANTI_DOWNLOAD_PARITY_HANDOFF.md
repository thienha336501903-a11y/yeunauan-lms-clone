# V5 Anti-Download Parity — System B Handoff

Last updated: 2026-09-08 UTC

## Scope and safety

- System B LMS only: `thienha336501903-a11y/yeunauan-lms-clone`.
- Branch: `security/v5-antidownload-parity-20260908`.
- Base/current main at branch creation: `4af614c` (PR #157).
- Production Cloudflare mutation: **AUTHORIZED AND PERFORMED** for dual-route Worker + nonce Durable Object only.
- Production LMS switch: **NOT PERFORMED**.
- Merge: **NOT AUTHORIZED / NOT PERFORMED**.
- Architecture retained: Browser → Service Worker → Vercel lease → Cloudflare Worker → private R2.

## Current checkpoint

- PR: Draft #158 — `https://github.com/thienha336501903-a11y/yeunauan-lms-clone/pull/158`.
- Current remote SHA before this checkpoint update: `4903b78ee4542b02276e804406aca1f047a2e962`.
- CI: LMS CI run #409 PASS; both Vercel checks PASS; local PASS (`349/349` Node tests; domain isolation; secret scan; syntax and diff checks).
- Preview: READY — deployment `dpl_8dWnqFRaHusJ7FbRSHSxr4jcfzgQ`, URL `https://yeunauan-lms-clone-mta1lousj.vercel.app`.
- Cloudflare Worker: `yeubep-v5-media`, version `9f35c741-5aa5-4a51-90eb-1936d34b1830`.
- PASS:
  - `/v1/media` and `/v2/media` dual-route Worker code deployed.
  - Durable Object class `V5PlaybackNonceGuard` migrated and binding `V5_PLAYBACK_NONCES` deployed.
  - Existing R2 binding `V5_MEDIA` retained.
  - Existing rate limiter `V5_MEDIA_RATE_LIMITER` retained at 600 requests/60s.
  - Vercel Production remains READY on main `4af614c` / deployment `dpl_9x4YBkM23AtWAaURgTPEQjLXqcbG`.
  - Security tests were written first and produced the expected RED baseline (24 failures before implementation).
  - V2 security/range suite and all existing regressions pass; every tested security rejection asserts zero R2 `get`/`head` calls.
- FAIL / blocked:
  - Live signed V2 E2E and browser QA are not yet completed.
  - The exact current Preview alias must be present in `V5_ALLOWED_ORIGINS` before Preview browser QA.
- Next step:
  - Verify Worker health and V1 compatibility.
  - Add/preserve the exact current Preview alias in `V5_ALLOWED_ORIGINS`.
  - Run signed V2 probes, browser QA and the 50 → 100 → 300 authenticated benchmark.
- Manual action needed from Admin:
  - None currently. Any future Production LMS switch or merge still requires separate confirmation.

## V2 design

- `/v1/media` remains available unchanged for zero-downtime compatibility.
- The lease endpoint returns legacy V1 only to an old Service Worker that sends no proof-key header; the new Preview Service Worker always sends a proof key and receives V2.
- `/v2/media` accepts the lease only via `Authorization: Bearer`.
- The V5 Service Worker owns an in-memory P-256 proof key and sends only its public JWK when requesting a lease.
- Every media request signs `METHOD + RANGE + TIMESTAMP + NONCE + LEASE + ORIGIN`.
- Exact Origin, SW marker, UA hash, lease signature/TTL, request timestamp, nonce syntax/replay, request proof, downloader UA and rate limit are checked before R2.
- Nonce replay prevention uses a Cloudflare Durable Object binding and fails closed if unavailable.
- Video GET requires Range; the Service Worker synthesizes `bytes=0-` for browser video requests without Range. Images may use a full GET.
- Do not remove the V1 route or legacy lease fallback until at least 35 minutes after a separately authorized Production LMS rollout.
