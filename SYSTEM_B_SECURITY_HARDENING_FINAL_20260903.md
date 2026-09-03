# SYSTEM B SECURITY HARDENING — FINAL HANDOVER

**Ngày chốt:** 2026-09-03  
**Phạm vi:** System B / Clone 3 Mode בלבד — LMS cũ, LMS qua Telegram, LMS V4, LMS V5/Commerce flow và Telegram Cloner liên quan.  
**Không thuộc phạm vi:** System A / Legacy Production.

## 1. Kết luận điều hành

Đợt hardening hiện tại đã hoàn tất các thay đổi có thể triển khai an toàn mà không đòi hỏi tái kiến trúc lớn. GitHub repository controls, supply-chain/CI, Dependabot, CodeQL, secret scanning/push protection, HTTP security headers, CSP baseline, lesson/content authorization, enrollment-expiry consistency, SSRF protection cho recipe fetch, upload validation, response minimization, Commerce/Telegram cookie/header/CORS hardening và các regression tests liên quan đã được triển khai qua PR/Preview/CI trước khi merge.

Sau các merge cuối, required CI và CodeQL đều PASS trên cả ba repository; deployment status trên Vercel đều success. LMS System B Production trả health HTTP 200, app/database đều `ok`, và các smoke test không có session tiếp tục bị từ chối đúng bằng HTTP 401.

Không có thay đổi nào được thực hiện lên System A.

## 2. Final source checkpoints

| Thành phần | Repository | Final `main` SHA tại thời điểm báo cáo |
|---|---|---|
| LMS System B | `thienha336501903-a11y/yeunauan-lms-clone` | `68d77109c3fef8d9c79ef43a38b3e0395163b3d8` |
| Commerce System B | `thienha336501903-a11y/yeunauan-commerce-clone` | `881b5e2d5e03a4e83640c20987971e3bb24e1840` |
| Telegram Cloner | `thienha336501903-a11y/telegram-channel-cloner` | `8f4d82c0d448f4fd14182e9ed6c002bc9ff766f3` |

Các merge cuối của gói hardening:

- LMS PR #128 — `security: harden System B lesson access and content delivery`
- Commerce PR #44 — security/header/session/CORS hardening
- Telegram PR #54 — security/header/session/CORS hardening

## 3. Vercel / Production checkpoint

### LMS System B

- Team: `thienha336501903-a11y's projects`
- Team ID: `team_2aqAJnXFulo5zqeZNrZCQRxq`
- Project: `yeunauan-lms-v4-test`
- Project ID: `prj_BLJXA70fYLbJcByHiflt6lejCvT4`
- Node runtime: `24.x`
- Production domain: `https://v4.daubepnho.store`
- Final deployment ID observed: `dpl_CYKmHi2HZakMqDmTfppx6Et93uRK`
- Deployment state: `READY`
- Git source: `thienha336501903-a11y/yeunauan-lms-clone`
- Unresolved Vercel toolbar threads: none

Production health after the final security merge:

- HTTP: `200`
- `status=ok`
- `app=ok`
- `database=ok`
- observed DB latency during final smoke: approximately `161 ms`

Production aliases observed:

- `v4.daubepnho.store`
- `yeunauan-lms-v4-test.vercel.app`
- `yeunauan-lms-v4-test-thienha336501903-a11ys-projects.vercel.app`
- `yeunauan-lms-v4-test-git-main-thienha336501903-a11ys-projects.vercel.app`

Within the System B Vercel team, only one project was found linked to `yeunauan-lms-clone`: `yeunauan-lms-v4-test`.

### Commerce / Telegram

Post-merge GitHub deployment statuses were `success`:

- Commerce deployment reference: `https://vercel.com/thienha100022653824678-stacks-projects/yeunauan-commerce-clone/JAACQp1hQ6d9mbrVGMfWyY2mnkqw`
- Telegram deployment reference: `https://vercel.com/thienha100022653824678-stacks-projects/telegram-channel-cloner/UUF3juVYNHZyw7Cqc6U6A3fFm9Q2`

The current Vercel connector session only exposes the System B LMS team above, so this audit does **not** claim direct post-merge HTTP fetch verification of the Commerce/Telegram custom domains. Their merge-SHA CI, CodeQL and Vercel deployment statuses were verified through GitHub.

## 4. GitHub repository hardening

Verified/implemented across the three repositories:

- protected default branch through repository rulesets
- pull request required
- strict required status check / up-to-date branch requirement
- conversation resolution required
- deletion restricted
- force push blocked
- no user bypass configured
- squash merge only
- merge commits disabled
- rebase merge disabled
- auto-merge disabled
- update branch enabled
- delete branch on merge enabled

Required checks:

- LMS: `test`
- Commerce: `test`
- Telegram: `validate`

Each repository also has:

- `.github/SECURITY.md`
- `.github/CODEOWNERS`

## 5. GitHub Advanced Security / supply chain

Verified enabled:

- Dependency graph
- Dependabot alerts
- Dependabot security updates
- grouped security updates
- Secret Protection
- Push Protection
- CodeQL default setup

Dependabot schedules:

- npm: Monday 09:00 Asia/Ho_Chi_Minh
- GitHub Actions: Monday 09:15 Asia/Ho_Chi_Minh

GitHub Actions were hardened with immutable SHA pinning and later upgraded to current audited major versions, including checkout/setup-node v7 and the applicable Telegram setup-python/upload-artifact v7 actions. Checkout credentials persistence is disabled where hardened; workflow permissions were reduced to required scopes.

Final post-merge checks:

- LMS: `test` PASS; CodeQL actions PASS; CodeQL javascript-typescript PASS
- Commerce: `test` PASS; CodeQL actions PASS; CodeQL javascript-typescript PASS
- Telegram: `validate` PASS; CodeQL actions PASS; CodeQL javascript-typescript PASS; CodeQL python PASS

## 6. LMS HTTP security baseline

Production LMS currently returns the following baseline security controls:

- `Strict-Transport-Security: max-age=31536000`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: SAMEORIGIN`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

Final Content-Security-Policy observed:

```text
object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'; manifest-src 'self'; worker-src 'self'; upgrade-insecure-requests
```

This is intentionally a **safe structural CSP baseline**, not a maximum-restriction CSP. `default-src`, `script-src`, `style-src`, `img-src`, `media-src`, `connect-src`, `font-src` and `frame-src` were not forced into a restrictive policy because the current application still depends on combinations of inline JavaScript/CSS, Google Identity, Google Fonts, Tailwind CDN, Google Drive, YouTube/Bunny embeds, `data:` SVG/media patterns and V4/V5 service workers.

A stricter CSP must only be attempted after reducing inline execution and mapping all required origins, ideally with Report-Only telemetry before enforcement.

## 7. LMS authorization/content-delivery hardening — PR #128

PR #128 closed several concrete content-access risks:

- learner lesson/public-lesson access now requires a valid LMS session and entitlement where applicable
- enrollment expiry is enforced consistently across lesson reads, entry-code exchange and entry-token flows
- student-facing responses strip raw provider URLs/material fields and privacy-sensitive internal fields where not required
- unsafe non-HTTPS public media/content URLs are rejected
- diagnostics were changed to safe-copy behavior to avoid dumping course/content data
- recipe external fetch was hardened against SSRF
- admin image/material uploads received MIME/base64/signature validation
- regression tests were added and included in LMS CI

Final targeted Production smoke after #128:

- `/api/health` → HTTP 200
- `/my-courses.html` → HTTP 200
- unauthenticated V4 feed request → HTTP 401 `missing_login_session`
- unauthenticated V5 feed request → HTTP 401 `missing_login_session`
- `public-config` returns only intended public configuration, including the non-secret Google client ID

No full V4/V5 E2E suite was rerun because previously passed functional gates remain accepted; only targeted security smoke was performed for the surfaces changed by #128.

## 8. SSRF / external URL hardening

The recipe/content fetch path now applies a narrow external-fetch policy, including:

- HTTPS requirement
- intended Google Drive/Docs host allowlisting for recipe fetch
- unsafe port rejection
- embedded-credential rejection
- redirect-by-redirect validation
- timeout/body-size limits

This prevents the generic recipe fetch path from becoming an arbitrary server-side URL fetcher.

No broad domain block was added to playback/media systems because existing Google Drive, Bunny, Telegram gateway and other provider flows require their own scoped handling.

## 9. Upload/media hardening

LMS admin image/material uploads now validate more than a filename/declared type:

- canonical MIME handling
- data/base64 integrity
- signature/magic-byte checks for supported formats
- unsafe public URL rejection on learner-facing paths

No existing published asset was modified or deleted as part of this hardening pass.

## 10. Cookie/session findings

### Fixed where behavior-safe

Commerce/Telegram final hardening includes stronger admin cookie behavior, including HttpOnly/Secure/SameSite controls appropriate to those applications, and Telegram logout is restricted to POST.

Sensitive LMS/V4/V5 API/media responses use no-store/private no-store where appropriate.

### Deferred architecture item

Legacy LMS still contains a `course_session_token` model that is intentionally JavaScript-readable in parts of the old architecture. Converting that session model wholesale to HttpOnly cannot safely be treated as a header-only change because current client-side flows read/write the token.

**Status:** DEFER — staged session refactor required.

Recommended future sequence:

1. introduce a server-owned HttpOnly session in parallel
2. remove browser JavaScript dependency on the legacy token
3. add compatibility telemetry
4. migrate old LMS pages one surface at a time
5. remove the JS-readable token only after targeted regression passes

## 11. CORS findings

Commerce and Telegram CORS were tightened in their final hardening PRs to explicit expected origins/headers for sensitive flows.

On LMS, some public/legacy routes and health/public-config responses still return `Access-Control-Allow-Origin: *`. Final checks did not show `Access-Control-Allow-Credentials` on those wildcard responses, and protected V4/V5 content continues to enforce session/entitlement independently.

The wildcard header was therefore **not removed globally**. A global removal would be unsafe without proving all media/gateway/legacy clients are same-origin.

**Status:** accepted/deferred defense-in-depth item for route-by-route cleanup; not an active authorization bypass based on the final smoke evidence.

## 12. Cache-control findings

Sensitive response paths audited in the final smoke use non-cacheable policies:

- health: `no-store`
- protected V4 unauthorized response: `no-store`
- protected V5 unauthorized response: `private, no-store`
- service-worker proxied protected media: `private, no-store`

Static learner pages retain explicit no-cache/no-store behavior where configured.

No cache of playback leases/tokens was introduced.

## 13. V4 service-worker security

`v4-media-sw.js` was audited read-only after the final merges.

Observed controls:

- playback leases stored only in an in-memory `Map`
- same-origin interception limited to `/v4-media/`
- lease expiry enforced
- ECDSA P-256 request signing
- per-request timestamp and random nonce
- bearer token sent only to the configured gateway request
- upstream request uses `credentials: omit`
- fetch uses `cache: no-store`
- 401/403/410 revokes the in-memory lease
- downstream protected media forced to `Cache-Control: private, no-store`
- `X-Content-Type-Options: nosniff`
- no persistent Cache API storage of lease/token material

No new actionable vulnerability was identified in this pass.

## 14. V5 service-worker security

`v5/media-sw.js` was audited read-only.

Observed controls:

- lease cache is in-memory only and keyed by `course:asset`
- lease acquisition goes back through `/api/lms/portal?endpoint=v5-play...`
- lease request includes the browser session and uses `cache: no-store`
- upstream playback URL request uses `credentials: omit`
- 401/403/410 forces lease invalidation and reauthorization
- media response is forced `private, no-store` + `nosniff`
- only GET/HEAD are handled for the protected media path
- no persistent Cache API storage of protected leases

No new actionable vulnerability was identified in this pass.

## 15. Supabase System B security audit

**Audited project only:** `yyiavtiwtekkocqpephr`.

**Explicitly not touched:** `aqozjkfwzmyfunqvcyjv`.

### RLS

All 54 public tables inspected had Row Level Security enabled.

Most sensitive/internal tables have no anon/authenticated policy and therefore fail closed for those roles; server-side service-role access remains the application path.

Tables with explicit policies observed:

- `course_slug_mappings`
- `courses`
- `handover_registrations`
- `lessons`
- `orders`

`orders` allows anon/authenticated INSERT with a minimum email check but has no public SELECT policy. `handover_registrations` has intentional public read/insert policies with input validation.

### Legacy public catalog policies — accepted/deferred risk

`courses`, `lessons` and `course_slug_mappings` still have broad anon/authenticated SELECT policies. A count-only inspection showed the legacy `lessons` table contains non-empty provider/content URL fields in some rows.

The current repo environment examples expose only server-side Supabase configuration (`SUPABASE_SERVICE_ROLE_KEY`), with no frontend anon key documented. Therefore this pass did not prove an active application-level bypass through the current client, but the broad policies remain unnecessary exposure if direct PostgREST credentials are ever made available to clients.

**Status:** DEFER — do not remove blindly because old/public catalog consumers may depend on them.

Recommended safe future migration:

1. inventory every direct Supabase client/REST consumer
2. create safe-column public views or explicit server endpoints
3. move public catalog consumers to the narrowed interface
4. verify old LMS/Commerce behavior
5. only then remove broad table-level SELECT policies

### Functions / search_path

Security-definer functions inspected had explicit `search_path` configuration. `anon`, `authenticated` and `service_role` do not have CREATE privilege on the `public` schema. The only routines seen with PUBLIC EXECUTE in the inspected metadata were ordinary trigger functions, not SECURITY DEFINER RPC surfaces.

No immediate function-privilege escalation issue was identified.

## 16. Environment-variable hygiene

`.env.example` files contain placeholders only and document server-only Supabase/service credentials. No real secret value is recorded in this report.

Previously completed controls remain authoritative:

- `V5_SYNC_SECRET` isolated for V5 sync
- Google OAuth Production secret corrected and validated
- account-event HMAC secret active
- Telegram/Reader secrets treated server-side

No secret was rotated during this pass. Secret rotation is a separate operational change and must not be done without coordinated deployment/testing.

## 17. Rate-limit / abuse-surface finding

A repository-wide search did not identify an implemented shared/distributed rate limiter or 429 path that could serve as the canonical abuse-control layer.

A per-instance in-memory limiter was **not** added because serverless instances do not provide a durable global counter and such a patch could create inconsistent behavior or falsely block legitimate students.

**Status:** DEFER — design shared/durable rate limiting for costly anonymous/authentication/playback/warmup/upload surfaces before rollout.

Recommended properties:

- durable/shared backing store
- endpoint-specific conservative limits
- key by a privacy-safe combination of IP/session/account as appropriate
- explicit bypass/operational recovery path for administrators
- metrics before aggressive enforcement

## 18. XSS / content rendering

The hardening pass focused on learner response minimization, URL validation and existing escaping behavior in content renderers. CSP remains structural rather than a full script allowlist, so application-layer escaping/sanitization continues to be the primary XSS control.

No new confirmed exploitable DOM/server XSS was left as an actionable finding in this pass. Future refactors should reduce inline script/event-handler usage before adopting strict `script-src`/nonce policies.

## 19. CSRF

Sensitive internal/admin flows use combinations of explicit secrets, auth/session checks, strict admin cookies where applicable, JSON requests and method restrictions. No blanket CSRF-token retrofit was applied because the three applications use different auth models and a global patch could break valid flows.

No confirmed outstanding CSRF bypass was identified in the completed hardening set. Any future cookie-authenticated write endpoint should be reviewed for Origin/Referer or equivalent CSRF protection before release.

## 20. Logging / PII / runtime observations

Final LMS runtime observation did not show a new application error cluster after the security merge. The only recurring group was the previously known Node `[DEP0169] url.parse()` deprecation warning on `/api/lms/portal`.

No direct application caller was identified in the prior diagnostic, so no speculative rewrite was made.

**Status:** accepted dependency/platform warning until a concrete caller or functional failure is identified.

Final 30-minute Production status grouping observed only 200/401 traffic in the returned leading groups and no shown 5xx spike.

## 21. Recovery / rollback posture

Source history and Vercel deployment history provide application rollback points. The LMS repo also contains tracked SQL/schema/migration artifacts, including `sql/`, `supabase/`, `supabase_schema.sql` and multiple migration files for account-sharing, session guard, Drive, V4/V5 and post-audit changes.

This audit did **not** perform a destructive restore drill and does not certify a one-command full database rebuild to the exact current state. Database recovery should therefore be treated as **partially documented/staged**, not fully proven.

Recommended future disaster-recovery exercise:

1. create an isolated non-production database/project
2. replay tracked schema/migrations in documented order
3. compare schema/functions/RLS/triggers against System B
4. restore representative non-sensitive fixture data
5. run health + targeted authorization/playback tests
6. document the tested restore order and rollback procedure

Do not store raw Production user dumps or secrets in GitHub.

## 22. Explicitly deferred / accepted risks

| Item | Status | Reason |
|---|---|---|
| Full HttpOnly migration of legacy `course_session_token` | DEFER | requires client/session architecture refactor |
| Distributed rate limiting | DEFER | requires durable shared limiter; per-instance serverless limiter is unreliable |
| Strict `script-src` / `style-src` CSP | DEFER | inline code + Google/Tailwind/media compatibility needs refactor/report-only rollout |
| Broad legacy Supabase SELECT on `courses`/`lessons`/slug mappings | DEFER | remove only after direct-client/public-catalog dependency inventory and safe-view migration |
| LMS wildcard CORS on selected public/legacy routes | ACCEPT/DEFER | no credential wildcard observed; protected content remains auth-gated; route-by-route cleanup required |
| Node `DEP0169 url.parse()` warning | ACCEPT | no concrete application caller/failure identified |
| Full disaster-recovery restore drill | DEFER | must be performed in an isolated environment |

## 23. Explicitly not changed

This hardening pass did not:

- touch System A / Legacy Production code, DNS, Vercel or Supabase
- mutate Supabase project `aqozjkfwzmyfunqvcyjv`
- rotate secrets automatically
- remove broad RLS policies without a compatibility migration
- re-run already-passed full V4/V5 functional E2E without a relevant need
- delete V4 benchmark courses
- alter V5 Release #3 as part of security cleanup
- revisit accepted Cloudinary orphan cleanup
- mass-delete branches
- dump Production user data into GitHub or this report
- change Reader C/System C architecture

## 24. Maintenance schedule

### Weekly

- review Dependabot npm PRs after Monday 09:00 Asia/Ho_Chi_Minh
- review Dependabot GitHub Actions PRs after Monday 09:15
- verify required CI/CodeQL before merge
- review new Dependabot/secret-scanning/CodeQL alerts

### Monthly

- inspect Production runtime error clusters and 4xx/5xx trends
- review new external origins/providers before expanding CSP/CORS allowlists
- verify Vercel domain/project linkage and unexpected deployments
- review Supabase policy/function/grant drift read-only

### Quarterly or before a major release

- perform a staged recovery/rollback drill in non-production
- review high-impact secret rotation readiness
- revisit distributed rate limiting design
- revisit legacy session-to-HttpOnly migration plan
- reassess strict CSP feasibility after inline-code reduction

### On every security-sensitive PR

Continue the mandatory System B workflow:

`branch → Draft PR → CI/CodeQL/Preview → Ready confirmation → squash merge confirmation → post-merge verification`

## 25. Final state

At the time this report was prepared:

- all three final hardening PRs (#128, #44, #54) were already merged
- all three repositories had green required CI and CodeQL on their final merge SHAs
- all three Vercel deployment statuses were success
- LMS System B Production health was HTTP 200 with app/database `ok`
- targeted unauthenticated V4/V5 requests were correctly rejected
- no open hardening PR remained before creation of this documentation PR
- no System A resource was touched

The remaining items in Section 22 are intentionally documented architecture/defense-in-depth work, not hidden unfinished hotfixes. They should be handled as separate staged projects with their own regression gates.