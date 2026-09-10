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

- PR: Ready for review #158 — `https://github.com/thienha336501903-a11y/yeunauan-lms-clone/pull/158`; **not merged**.
- Functional code used for final browser/load QA: `ca72a9caf1f5e80494dd03c58833fbfed1f187d0`.
- CI: LMS CI run #421 PASS on functional QA SHA `ca72a9caf1f5e80494dd03c58833fbfed1f187d0`; cleanup/handoff CI run #423 PASS on SHA `0c96835bbd4d64e7a76893fc942371c1c8b9b721`.
- Temporary signed V2 benchmark harness was removed after the 50→100→300 run by cleanup commit `9fa889581c1581ed0320297c107cfe4b7892af63`.
- Preview alias: `https://yeunauan-lms-git-37badb-thienha100022653824678-stacks-projects.vercel.app`.
- Preview deployment used for final 50→100→300 benchmark: `dpl_4FtqgeBGZErEW6d4N6yinHpZh9uQ` READY.
- Cleanup/handoff Preview deployment on `0c96835...`: `dpl_GUtXmtZViFTSVahBw3YARFib8NVU` READY.
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
- First-play latency improved materially after lease/proof warm-up; user confirmed cold first Play became quick.
- Forced-first-install robustness fix is in branch: media bootstrap loads before learner app, waits for Service Worker control and can recover with one bounded automatic reload instead of requiring the learner to manually F5. CI coverage PASS on run #421.
- Final manual first-install browser recheck PASS on 2026-09-10: after `Unregister`, one normal F5 was sufficient; protected image and video recovered without a second reload.
- Security/range regression suite remains green; rejection cases are designed to fail before R2.
- Authenticated signed V2 benchmark PASS at all staged levels using `v5-feed` → `v5-play` V2 → Cloudflare signed `Range: bytes=0-0`; each virtual learner reads only 1 byte from R2:
  - 50 learners: 50/50 PASS, 150 intended requests, 50 intended R2 bytes, wall 6975 ms, feed p95 3714.1 ms, play p95 591 ms, media p95 2940.7 ms, total p95 6893.6 ms. Vercel runtime matched 100/100 function requests with HTTP 200.
  - 100 learners: 100/100 PASS, 300 intended requests, 100 intended R2 bytes, wall 5250 ms, 19.05 learners/s, feed p95 3924.1 ms, play p95 681.4 ms, media p95 904.3 ms, total p95 5046.2 ms. Vercel runtime matched 200/200 function requests with HTTP 200.
  - 300 learners: 300/300 PASS, 900 intended requests, 300 intended R2 bytes, wall 7866 ms, 38.14 learners/s, feed p95 6058.7 ms, play p95 2298.7 ms, media p95 908.4 ms, total p95 7469.4 ms. Vercel runtime matched 600/600 function requests with HTTP 200.
- Temporary benchmark page removed after successful staged run; it is not intended to remain in final branch output.
- PR #158 moved from Draft to Ready for review after final browser QA PASS; no merge was performed.

### Remaining gated actions

1. Review PR #158. Do not merge without separate Admin confirmation.
2. Any Production LMS V2 rollout requires separate Admin confirmation.
3. After any separately authorized Production LMS V2 rollout, keep `/v1/media` and legacy lease fallback for at least 35 minutes before considering removal.

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
