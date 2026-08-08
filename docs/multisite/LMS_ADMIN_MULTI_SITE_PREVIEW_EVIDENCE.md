# LMS Admin Multi-Site Isolation — Protected Preview Evidence

Date: 2026-07-29 (Asia/Saigon)  
Decision: **Preview Gate passed; stop for owner review. Production remains unchanged.**

## Exact protected resources

- Supabase Preview: `lms-v5-preview-20260728`, ref `plgrmaktvudjetfkwmyg`.
- Forbidden Production ref guard: `aqozjkfwzmyfunqvcyjv`.
- LMS branch/commit: `feature/lms-admin-multisite-isolation-20260729` / `94e956f`.
- LMS protected Preview: `dpl_BWuhKjmBpbSbATbZTfSKZrRrHjX6`,
  `https://web-lms-chinh-thuc-c2kpdmspq.vercel.app`; no Production alias and no
  promotion.
- Commerce branch/commit: `feature/commerce-lms-site-isolation-20260729` / `fa84d3a`.
- Commerce protected Preview: `dpl_GaoKXoWrZBN8Lrr9MKXEKA5YMujb`,
  `https://web-ban-hang-chinh-thuc-1sltsu4zu.vercel.app`.
- Production LMS deployment remained `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`.

No secret, token, Production row, real student email, Google credential, order,
payment or bank record was copied into the fixture.

## Substrate and rollback rehearsal

Preview-only files:

- `migrations/preview/20260729_lms_b05_preview_substrate.sql`
- `migrations/preview/20260729_lms_b05_preview_substrate_rollback.sql`
- `migrations/preview/20260729_lms_b05_preview_seed.sql`
- `scripts/preview/lms-b05-preview-gate.mjs`

The exact-ref guard rejects Production and `VERCEL_ENV=production`. The
substrate is outside the Production migration chain, service-role-only under
RLS, and does not alter or drop any `lms_v5_*` object.

Final apply → multisite migration → seed → rollback multisite → rollback
substrate → catalog verification → reapply → reseed result:

- V5 checksum before/after:
  `27030333fee663b3129b8c83b4624743b07c32ea7ba58f85449e2e47e90ffb80`.
- deterministic LMS seed checksum:
  `c636aba9715faad3e1fd5fe4185fd38160468ab70d5670c1acd5235a62f7734c`.
- final/initial substrate catalog checksum:
  `50cddb1d764770f169b3e3ecde1a13d9fb62269865f8e8b5ac74ca27253b4ec2`.
- rollback catalog checksum:
  `f0759dcde8464f1ba1637c21d73070db59c765e8fae9aab7b3eb483b4c9da797`.

Final deterministic counts:

| Object | Count |
|---|---:|
| courses | 6 |
| lessons | 5 |
| site_config | 5 |
| students | 5 |
| student_enrollments | 8 (5 LMS fixtures + 3 preserved V5 fixtures) |
| lesson_progress | 2 |
| admin_audit_logs | 0 after deterministic reseed |
| drive_permission_logs / queue | 0 / 0 after deterministic reseed |
| drive_admin_accounts | 1 synthetic dry-run account |

The seed resets only the six exact LMS fixture slugs and fixed `.example.test`
identities. Hosted write evidence exposed this requirement; the seed was
hardened and the complete rehearsal then reproduced the original checksum.

## Functional evidence

The real protected LMS Preview returned three canonical courses for logical
site `yeunauan` and two for `yeubep`. The legacy shared alias resolved to its
canonical owner, displayed `LIÊN KẾT DÙNG CHUNG CŨ`, remained read-only, and
was not listed as an empty LMS course.

Hosted API/IDOR tests verified:

- cross-site course, lesson, enrollment, progress, media and Drive reads/writes
  are rejected server-side;
- missing/invalid/forged `learning_site`, query/body override, alias-as-canonical
  and mixed-site batch requests fail closed;
- own-site lesson create/update/delete and progress write persist correctly;
- revoking the Site A entitlement leaves the independent Site B entitlement;
- all nine Drive operations use the dry-run adapter and reject mismatch without
  calling Google Drive.

Observed error contracts:

`INVALID_LEARNING_SITE`, `COURSE_SITE_MISMATCH`,
`CROSS_SITE_LMS_TARGET_FORBIDDEN`, `UNRESOLVED_LEARNING_SITE`,
`LEGACY_SHARED_MAPPING_READ_ONLY`, and `COURSE_NOT_FOUND_IN_SITE`.

Commerce protected Preview evidence:

| Flow | Result |
|---|---|
| `yeubep.shop` → logical `yeunauan` self-target | HTTP 201, explicit `learning_site=yeunauan` |
| `shop.yeunauan.live` → logical `yeubep` self-target | HTTP 201, explicit `learning_site=yeubep` |
| forged cross-site target | HTTP 409, `CROSS_SITE_LMS_TARGET_FORBIDDEN` |
| duplicate slug | HTTP 409, `COURSE_SLUG_CONFLICT` |
| quick toggle | retained sales site, learning site and self-target |

All created rows were in-memory Commerce fixture rows. External sync stayed
dry-run and no Production LMS/Portal boundary was called.

## Browser and visual evidence

`scripts/preview/browser-evidence.mjs` passed 12/12:

| Browser | Desktop | iPhone | Android | Tablet |
|---|---|---|---|---|
| Chromium | Pass | Pass | Pass | Pass |
| Firefox | Pass | Pass | Pass | Pass |
| WebKit | Pass | Pass | Pass | Pass |

It verified selector labels, deep link, site switching, invalid selected-course
clearing, localStorage, keyboard focus, legacy warning, global badge and the
UI-only empty state. Screenshots are retained outside Git under
`_local_artifacts/lms-admin-multisite-preview/screenshots/` to avoid committing
session/protection artifacts.

## Regression and security

- LMS: **317/317**, including feature-flag-off B05 compatibility.
- Commerce: **73/73**, including feature-flag-off, tenant, Learning Course
  Boundary and shared-entitlement contracts.
- CSS build, syntax/source checks and `git diff --check`: pass.
- LMS audit: 0 high/critical; 4 moderate transitive `uuid` advisories through
  Google APIs. The available fix is breaking and was not applied in this Gate.
- Commerce audit baseline remained clean.
- No secret was printed or committed.

## Gate table

| Gate | Kết quả | Bằng chứng | Production Ready |
|---|---|---|---|
| Exact Preview identity / Production deny | Pass | exact-ref and env guards | Review required |
| Substrate apply/rollback/reapply | Pass | identical V5 and seed checksums | Review required |
| LMS selector / deep link / responsive | Pass | protected 12-case browser matrix | Review required |
| API/IDOR isolation | Pass | hosted negative and persisted positive writes | Review required |
| Enrollment/progress independence | Pass | cross-site denial and independent revoke | Review required |
| Drive | Pass dry-run | nine actions, no Google credential | Review required |
| Commerce→LMS isolation | Pass fixture | two self-target sites + forged rejection | Review required |
| Feature flag off | Pass contract suite | LMS 317/317, Commerce 73/73 | Review required |
| Production safety | Pass | no Production deploy/migration/write/alias | No rollout approval yet |

## Rollback and stop point

1. Disable both feature flags.
2. Export any non-NULL Preview delta.
3. Run the multisite rollback, then the guarded substrate rollback.
4. Verify the V5 checksum and absence of substrate-owned objects.
5. Do not restore a whole database and do not delete business data.

The protected Preview Gate is complete. No merge, canary, Production
migration, Production deployment, domain change or promotion was performed.
Work stops here for owner review.
