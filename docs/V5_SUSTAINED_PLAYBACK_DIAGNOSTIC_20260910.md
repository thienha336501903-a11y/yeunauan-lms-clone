# V5 Sustained Playback Diagnostic — System B

Date: 2026-09-10

## Safety and scope

- System B LMS only.
- Production main remains `3679a2268ea2ab5109b744d03b0f12311c242f68`.
- PR #161 remains unmerged.
- No Cloudflare Worker, R2, Supabase, Vercel Production or System A mutation was made.
- The diagnostic Range override is locked to `*.vercel.app` plus `v5diag=1`; custom Production domains retain the existing 4 MiB behavior.
- V2 proof, request signature, nonce replay guard, rate limiter, private R2 and no-store policy remain unchanged.

## Evidence before real-browser measurement

1. PR #161 changes only open-ended continuation ranges from 4 MiB to 8 MiB. Its test proves the string transformation, not sustained playback or a Chrome request pattern.
2. V5 preserves finite browser ranges. Historical System B V4 device logs show Chrome mobile can request a very large finite range, including nearly the whole file. If V5 Chrome behaves the same way, #161 does not affect those requests.
3. For the 57,491,726-byte test file, strictly sequential full-file transfer would need about 14 requests at 4 MiB, 8 requests at 8 MiB, or 4 requests at 16 MiB. Each boundary runs client ECDSA signing, Worker lease verification, request-proof verification, Durable Object nonce consumption, rate limiting and an R2 ranged read.
4. A lease is cached in the Service Worker for its 10-minute TTL with a 45-second refresh skew. Therefore ordinary continuation requests should not call Vercel/Supabase unless playback crosses refresh time or a 401/403/410 forces one refresh-and-retry.
5. Worker response headers set `Content-Length`, `Content-Range` and `Accept-Ranges` consistently from the resolved signed object size. The body is passed as a stream through the Service Worker; there is no explicit full-body buffering in the normal path.
6. `preload='none'` intentionally avoids media transfer before Play, but it also gives the browser no media buffer head start. Its impact on later stalls remains unmeasured.
7. `Cache-Control: private, no-store` prevents reusable media caching but does not itself require the active response stream to pause. Its impact is mainly repeat/seek/reload traffic, not proven sustained-stream throughput.

## Diagnostic harness

Preview route: `/v5/playback-diagnostic.html`

It records locally in the browser:

- browser Range and effective Worker Range;
- HTTP status, `Content-Length`, `Content-Range`;
- lease wait, client ECDSA signing time, Worker/R2 header TTFB, body duration and effective MiB/s;
- 401/403/410 refresh retries;
- video `waiting`, `stalled`, `progress`, `canplay`, `playing`, `suspend`, `error` and `ended` events;
- `currentTime`, buffered ranges/ahead, `readyState` and `networkState`;
- sequential 4/8/16 MiB Range benchmarks over a configurable byte budget.

No lease token, Authorization header, signature, proof key, R2 object key or student identity is logged or uploaded.

## Decision gate

Do not merge #161 until the Preview run answers:

1. Does real Chrome use open-ended or finite ranges for this asset?
2. Do stalls align with a Range boundary and high boundary TTFB?
3. Is 8 MiB statistically better than 4 MiB on the same client/network, and is 16 MiB materially better than 8 MiB?
4. Are any 401/403/410 retries or 429/502/503/416 responses present?
5. Does throughput stay above encoded bitrate with enough buffered-ahead margin?

Until those measurements exist, #161 recommendation is **revise/hold**, not merge.
