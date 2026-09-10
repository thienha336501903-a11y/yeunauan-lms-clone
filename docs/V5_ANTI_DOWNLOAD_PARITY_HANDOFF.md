# V5 Anti-Download Parity — System B Handoff

Last updated: 2026-09-10 +07

## Absolute scope and safety

- System B LMS only: `thienha336501903-a11y/yeunauan-lms-clone`.
- Do not touch System A.
- Architecture remains: Browser → Service Worker → Vercel lease → Cloudflare Worker → private R2.
- No media bytes pass through Vercel.
- No IP binding.
- No direct commits to `main`.
- Any PR merge still requires separate Admin confirmation.
- Any new Production Cloudflare Worker deployment/mutation still requires separate Admin confirmation.

## Current production state

- PR #158 `security(v5): add proof-bound playback V2` was squash-merged.
- Main after #158: `19d42ac70bf7d4e2ef96f4509a213912e7b8e616`.
- Production deployment after #158: `dpl_h5AAUaDTkyxYPUuv99akccPAa4aA` READY at about 2026-09-10 11:40:52 +07.
- Admin live QA: `Production V5 PASS` — protected image, video Play and seek all passed.
- Initial compatibility window ended at about 12:15:52 +07.

- PR #159 `security(v5): stop issuing legacy V1 playback leases` was squash-merged.
- Current main: `1cd9cf3af6117c870075e5de8e4d42897fa2c3e4`.
- LMS CI #427 PASS on current main.
- Production deployment after #159: `dpl_BENNNK63vCQwUDBBdCk6wsSnymUu` READY at about 2026-09-10 13:10:02 +07.
- Production `v5-play` without `X-V5-Playback-Key` returns HTTP 426 / `v5_playback_v2_required`.
- Therefore Production LMS no longer issues new V1 leases.
- Second 35-minute drain window ended at about 13:45:02 +07.
- No Production Cloudflare Worker cleanup has been deployed yet; live `/v1/media` remains available until the separately authorized Worker deployment.

## Current phase — retire Worker `/v1/media`

Branch: `security/v5-remove-v1-media-20260910`

Prepared after the second drain window elapsed:

- Commit `f84e66b99a1975e042ae50420479cc8e528b9b48` — remove legacy `mediaV1` handler and `/v1/media` route from Worker source.
- Worker lease verification is now V2-only (`payload.v === 2`); no generic V1 verifier remains.
- `/v2/media`, proof signature, exact Origin, SW marker, UA binding, nonce replay guard, downloader-UA block, rate limit, Range behavior, CORS preflight cache and private R2 behavior remain unchanged.
- Commit `8748ed328e5e1b23accdddce9509879a1bd6524c` — add retirement regression tests:
  - `/v1/media` returns 404 and does not touch R2.
  - a V1 lease presented to `/v2/media` fails with `invalid_claims` before R2.
  - Worker source contains no `/v1/media` route or `mediaV1` handler.

### Gate sequence

1. Run LMS CI on the retirement branch/PR.
2. Review diff and mark PR Ready only if CI is green.
3. Do not merge without separate Admin confirmation.
4. Merging the LMS repo does **not** itself authorize a Production Cloudflare Worker deployment.
5. After merge, obtain separate Admin confirmation before deploying `yeubep-v5-media` with the V2-only Worker.
6. After deployment, verify `/health`, positive signed V2 playback, and negative `/v1/media` = 404; then inspect Production errors.

## V2 security design retained

- `/v2/media` accepts leases only in `Authorization: Bearer`; query token transport is forbidden.
- V5 Service Worker owns an in-memory P-256 proof key and sends only the public JWK when requesting a lease.
- Every media request signs `METHOD + RANGE + TIMESTAMP + NONCE + LEASE + ORIGIN`.
- Exact allowed Origin, `sw-v2` marker, UA hash, lease signature/TTL, request timestamp, nonce syntax/replay, request proof, downloader UA and rate limit are checked before R2.
- Nonce replay protection uses Durable Object `V5PlaybackNonceGuard` / binding `V5_PLAYBACK_NONCES` and fails closed.
- Existing limiter `V5_MEDIA_RATE_LIMITER` remains 600 requests/60s per learner/video identity.
- Video GET requires Range; browser open-ended ranges are clamped to 4 MiB before signing/forwarding.
- Images may use a full GET.
- CORS preflight uses `Access-Control-Max-Age: 3600`; media stays `Cache-Control: private, no-store`.

## Completed QA / benchmark checkpoint

- First-install recovery PASS: after manually unregistering Service Worker, one normal F5 restored protected image/video; no second F5 required.
- Live initial range PASS: `206`, `Content-Length: 4194304`, `Content-Range: bytes 0-4194303/57491726`.
- Live seek range PASS: `206`, `Content-Length: 4194304`, `Content-Range: bytes 26438016-30632319/57491726`.
- Signed V2 benchmark PASS:
  - 50 learners: 50/50 PASS; wall 6975 ms; total p95 6893.6 ms.
  - 100 learners: 100/100 PASS; wall 5250 ms; 19.05 learners/s; total p95 5046.2 ms.
  - 300 learners: 300/300 PASS; wall 7866 ms; 38.14 learners/s; total p95 7469.4 ms; Cloudflare media p95 908.4 ms.
- Temporary benchmark harness was removed after the staged run.

## Do not redo

Do not repeat the already-passed 50→100→300 load benchmark, normal Play/Seek checks, 4 MiB Range validation, or first-install F5 recovery unless retirement changes unexpectedly affect V2 behavior. For the Worker retirement phase, only run focused regression/negative route checks plus one post-deploy positive V2 smoke test.