# V5 Anti-Download Parity — System B Handoff

Last updated: 2026-09-10 +07

## Scope and safety

- System B LMS only: `thienha336501903-a11y/yeunauan-lms-clone`.
- Branch: `security/v5-antidownload-parity-20260908`.
- Base/current main at branch creation: `4af614c` (PR #157).
- Production Cloudflare mutation: **AUTHORIZED AND PERFORMED** for the dual-route Worker, nonce Durable Object, Preview public key, and CORS preflight cache only.
- Production LMS switch: **NOT PERFORMED**.
- Merge: **NOT AUTHORIZED / NOT PERFORMED**.
- Architecture retained: Browser → Service Worker → Vercel lease → Cloudflare Worker → private R2.

## Current checkpoint

- PR: Draft #158 — `https://github.com/thienha336501903-a11y/yeunauan-lms-clone/pull/158`.
- Current tested code SHA before this handoff update: `4e369a994b3f6e873d06c1fe430aea7981682b4d`.
- CI: LMS CI run #416 PASS on SHA `4e369a994b3f6e873d06c1fe430aea7981682b4d`.
- Preview alias: `https://yeunauan-lms-git-37badb-thienha100022653824678-stacks-projects.vercel.app`.
- Preview deployment for SHA `4e369...`: `dpl_5nBsCE1z6AWhCefn4WYMf7TqdFso` READY.
- Cloudflare Worker: `yeubep-v5-media`.
- Vercel Production remains READY on main `4af614cb4ae8c3bbdc5dc6258bf3cd1aeeb4655e` / deployment `dpl_9x4YBkM23AtWAaURgTPEQjLXqcbG`; unchanged.

### PASS

- `/v1/media` and `/v2/media` dual-route Worker deployed.
- Durable Object class `V5PlaybackNonceGuard` and binding `V5_PLAYBACK_NONCES` deployed.
- Existing R2 binding `V5_MEDIA` retained.
- Existing limiter `V5_MEDIA_RATE_LIMITER` retained at 600 requests/60s.
- Exact Preview origin accepted by Worker.
- Preview branch has branch-scoped `V5_PLAYBACK_PRIVATE_JWK` and `V5_MEDIA_PUBLIC_URL`; Production LMS env was not changed.
- Worker accepts both `V5_PLAYBACK_PUBLIC_JWK` and Preview `V5_PLAYBACK_PUBLIC_JWK_PREVIEW`.
- Original live browser blocker `403 invalid_signature` resolved after Preview-specific key pair configuration.
- Windows clock/NTP issue that produced `403 request_timestamp_invalid` resolved; browser V2 GET now succeeds.
- Live browser V2 playback PASS: video plays, pause/resume works, images load, poster/thumbnail loads, and seek works.
- CORS preflight optimization deployed: browser response shows `Access-Control-Max-Age: 3600` while media remains `Cache-Control: private, no-store`.
- Initial browser open-ended video range is clamped to 4 MiB: live response shows `206`, `Content-Length: 4194304`, `Content-Range: bytes 0-4194303/57491726`.
- Seek/open-ended browser range is also clamped to 4 MiB: live response after seeking shows `206`, `Content-Length: 4194304`, `Content-Range: bytes 26438016-30632319/57491726`.
- No full video payload is intentionally preloaded by warm-up; only playback lease/proof identity are warmed.
- Security/range regression suite remains green; rejection cases are designed to fail before R2.

### Known QA edge case

- After manually unregistering the Service Worker and immediately using Chrome `Ctrl+Shift+R`, the first render can show protected images/video placeholders until a normal F5 reload. This was observed only during forced Service Worker reset QA, not normal steady-state playback.
- `ensureMediaWorker()` waits for registration/ready/controller, but `hydrateProtectedImages().catch(() => {})` currently swallows a first-start failure instead of retrying. Treat as a small Preview robustness issue to fix before final handoff; do not ask learners to use hard reload as a normal workflow.

### Next step

1. Add a bounded automatic retry for first-start Service Worker/media hydration so a forced first install does not require a second reload.
2. Re-run CI and one clean browser first-install check.
3. Run signed V2 E2E/security probes and confirm failures do not reach R2.
4. Run authenticated staged benchmark 50 → 100 → 300 learners using `v5-feed` + `v5-play` V2 and only a small media Range probe; never full-video load in the harness.
5. Review Vercel/Supabase/Cloudflare behavior, remove temporary benchmark/probe code, update this handoff, and only then consider moving PR #158 from Draft to Ready for review.
6. Any Production LMS V2 rollout or PR #158 merge still requires separate Admin confirmation.

## V2 design

- `/v1/media` remains available unchanged for zero-downtime compatibility.
- The lease endpoint returns legacy V1 only to an old Service Worker that sends no proof-key header; the new Preview Service Worker sends a proof key and receives V2.
- `/v2/media` accepts the lease only via `Authorization: Bearer`.
- The V5 Service Worker owns an in-memory P-256 proof key and sends only its public JWK when requesting a lease.
- Every media request signs `METHOD + RANGE + TIMESTAMP + NONCE + LEASE + ORIGIN`.
- Exact Origin, SW marker, UA hash, lease signature/TTL, request timestamp, nonce syntax/replay, request proof, downloader UA and rate limit are checked before R2.
- Nonce replay prevention uses a Cloudflare Durable Object binding and fails closed if unavailable.
- Video GET requires Range. Browser open-ended video ranges are clamped to 4 MiB chunks before signing and forwarding. Images may use a full GET.
- CORS preflight responses advertise `Access-Control-Max-Age: 3600`; media responses remain `private, no-store`.
- Do not remove the V1 route or legacy lease fallback until at least 35 minutes after a separately authorized Production LMS rollout.
