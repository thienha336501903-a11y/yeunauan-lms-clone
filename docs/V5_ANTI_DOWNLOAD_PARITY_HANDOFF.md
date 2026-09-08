# V5 Anti-Download Parity — System B Handoff

Last updated: 2026-09-08 UTC

## Scope and safety

- System B LMS only: `thienha336501903-a11y/yeunauan-lms-clone`.
- Branch: `security/v5-antidownload-parity-20260908`.
- Base/current main at branch creation: `4af614c` (PR #157).
- Production mutation: **NONE**.
- Merge: **NOT AUTHORIZED / NOT PERFORMED**.
- Architecture retained: Browser → Service Worker → Vercel lease → Cloudflare Worker → private R2.

## Current checkpoint

- PR: pending Draft creation.
- Current SHA: `cc7a5d031bd77b0b59079542f256c5c166a13dfa` (initial implementation commit; see later checkpoint entries for amended/pushed head).
- CI: local PASS (`349/349` Node tests; domain isolation; secret scan; syntax and diff checks).
- Preview: pending.
- PASS:
  - `origin/main` matched local `main` before branch creation.
  - GitHub confirms PR #156 and PR #157 are merged.
  - Vercel project `prj_0mFDJL5lV9q0NBjgBphs0Y6j1Xtc` reports latest Production deployment `dpl_9x4YBkM23AtWAaURgTPEQjLXqcbG` READY on main SHA `4af614c`.
  - Security tests were written first and produced the expected RED baseline (24 failures before implementation).
  - V2 security/range suite and all existing regressions now pass; every tested security rejection asserts zero R2 `get`/`head` calls.
- FAIL / blocked:
  - Read-only HTTP probe to `https://v4.daubepnho.store` timed out from the current runner; it was interrupted with no mutation.
- Next step:
  - Commit/push, open Draft PR, inspect remote CI and Vercel Preview.
- Manual action needed from Admin:
  - None at this checkpoint.

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
