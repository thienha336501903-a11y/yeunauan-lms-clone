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

- PR: Draft #158 — `https://github.com/thienha336501903-a11y/yeunauan-lms-clone/pull/158`.
- Current remote SHA: `0815b88c049ac43461e21bc9afbe2b6ee8b49f55`.
- CI: LMS CI run #408 PASS; local PASS (`349/349` Node tests; domain isolation; secret scan; syntax and diff checks).
- Preview: READY — deployment `dpl_CbiCbsVm9UZm2Duj2GuMw2GxickG`, URL `https://yeunauan-lms-clone-r7yjx7zra.vercel.app`.
- PASS:
  - `origin/main` matched local `main` before branch creation.
  - GitHub confirms PR #156 and PR #157 are merged.
  - Vercel project `prj_0mFDJL5lV9q0NBjgBphs0Y6j1Xtc` reports latest Production deployment `dpl_9x4YBkM23AtWAaURgTPEQjLXqcbG` READY on main SHA `4af614c`.
  - Security tests were written first and produced the expected RED baseline (24 failures before implementation).
  - V2 security/range suite and all existing regressions now pass; every tested security rejection asserts zero R2 `get`/`head` calls.
- FAIL / blocked:
  - Read-only HTTP probe to `https://v4.daubepnho.store` timed out from the current runner; it was interrupted with no mutation.
  - Authenticated V2 media E2E cannot pass until `/v2/media` and `V5_PLAYBACK_NONCES` are deployed to the Cloudflare Worker. That is a Production mutation and has not been performed.
- Next step:
  - After explicit Admin authorization: deploy the dual `/v1` + `/v2` Worker with the Durable Object binding, then run signed V2 probes, browser QA and the 50 → 100 → 300 benchmark.
- Manual action needed from Admin:
  - Explicitly authorize the Production mutation to Cloudflare Worker `yeubep-v5-media`. No merge authorization is requested.

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
