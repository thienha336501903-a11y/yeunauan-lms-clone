# LMS Admin Multi-Site Isolation — Implementation Report

Date: 2026-07-29 (Asia/Saigon)  
Status: **protected LMS/Commerce Preview Gate completed on synthetic Preview data; awaiting owner review; no Production action performed**

## Safety outcome

- No Production deployment, promotion, alias, migration, backfill, course write, order write, enrollment write, lesson write, Drive grant/revoke, merge, or domain change was performed.
- Production was used only for documented read-only metadata and non-PII mapping/count audit.
- Neither forward migration was applied to Production.
- No legacy row was moved, cloned, or rewritten.
- `courses.slug` remains globally unique and enrollment identity remains `(email, course_slug)`.

## Exact sources and isolated worktrees

| Component | Exact base | Branch | Implementation commit | Worktree |
|---|---|---|---|---|
| LMS | `fc12c3b21329158e13a4a027833afd2dec61e973` (`backup/B05-2026-07-25`) | `feature/lms-admin-multisite-isolation-20260729` | `94e956f` | `_worktrees/lms-admin-multisite-isolation-20260729` |
| Commerce | `74c70268f0619d9a9be5e564ea60200038100c` (`launch/storefront-domain-swap-2026-07-26`) | `feature/commerce-lms-site-isolation-20260729` | `fa84d3a` | `_worktrees/commerce-lms-site-isolation-20260729` |

Both branches were pushed. Neither was merged.

LMS Production baseline remains deployment `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`.

## Current domain mapping

This mapping was verified from current deployment metadata and sanitized cutover evidence; it is not inferred from domain or project names.

| Domain | Vercel project | Current `SALES_SITE` / logical site |
|---|---|---|
| `yeubep.shop` | `web-ban-hang-chinh-thuc` | `yeunauan` |
| `shop.yeunauan.live` | `web-ban-hang-yeubep-shop` | `yeubep` |
| `www.daubepnho.store` | `web-lms-chinh-thuc` | one LMS containing both logical sites |

Therefore the LMS selector intentionally displays:

- `shop.yeunauan.live` → logical site `yeubep`
- `yeubep.shop` → logical site `yeunauan`

## Architecture decision

`learning_site` is a nullable constrained field on canonical LMS courses. Allowed values are `yeunauan` and `yeubep`. URLs are UI labels, not database tenant values.

The effective resolver is server-side:

1. use explicit `courses.learning_site`;
2. for a legacy self-target course, use the audited deterministic fallback (`sales_site`, otherwise legacy `yeunauan`);
3. for an alias, resolve exactly one canonical target and use its owner;
4. fail closed for missing, chained, circular, inactive, empty, or otherwise unresolved targets.

Aliases are excluded from the LMS course list. A legacy alias pointing to a visible canonical course produces a read-only `LIÊN KẾT DÙNG CHUNG CŨ` warning.

## Data model and migration

Forward and rollback migrations exist in both feature branches:

- `migrations/20260729_lms_learning_site.sql`
- `migrations/20260729_lms_learning_site_rollback.sql`

The forward migration adds:

- nullable `courses.learning_site`;
- allowlist check constraint;
- indexes covering `learning_site`, active/published site filtering, and learning target lookup.

It does not change global slug uniqueness, order snapshots, enrollment uniqueness, lessons, progress, or canonical identity. It performs no blanket backfill.

The LMS dry-run script `scripts/dry-run-learning-site-mapping.mjs` exports row ID, slug, sales site, current target, proposed site, and reason. It is dry-run only and uses exclusive file creation to avoid overwriting evidence.

Rollback order:

1. turn both flags off;
2. export every non-NULL `learning_site` delta;
3. verify no application still queries the new field;
4. remove only new indexes/constraint/column;
5. never restore the whole database and never delete business rows.

## LMS implementation

When `LMS_ADMIN_MULTI_SITE_ENABLED=true`:

- `/lms-admin.html` shows one fixed selector, stores the last choice, supports `?site=` and `?course=`, clears an invalid selected course after switching, and shows an empty state.
- Query/header/body site values are allowlist-validated but never treated as ownership proof.
- The backend loads the course/canonical target and compares the effective site.
- Course, config, lesson, enrollment, bulk enrollment, media upload/verify, and Drive course operations are site-scoped.
- Course/site mismatches and aliases used as canonical IDs fail closed.
- Course-dependent writes perform post-write ownership verification; lesson/enrollment writes also verify persisted rows.
- Lesson, enrollment, and direct Drive-permission mutations write audit metadata with selected and effective site.
- Students, risk/account sharing, Drive health, trace/diagnostics, auth, credentials, and runtime flags remain global and carry `TOÀN HỆ THỐNG` badges.

Explicit error contracts include:

`INVALID_LEARNING_SITE`, `COURSE_SITE_MISMATCH`,
`CROSS_SITE_LMS_TARGET_FORBIDDEN`, `UNRESOLVED_LEARNING_SITE`,
`LEGACY_SHARED_MAPPING_READ_ONLY`, and `COURSE_NOT_FOUND_IN_SITE`.

When the flag is absent/false, existing behavior remains active.

## Commerce implementation

When `COMMERCE_LMS_SITE_ISOLATION_ENABLED=true`:

- the existing website selector determines the logical sales/learning site;
- “Dùng chính khóa học này” persists an explicit same-site owner;
- LMS target options contain only same-site canonical courses;
- backend validation rejects a forged cross-site target;
- an unchanged legacy shared target is readable but cannot be recreated or changed incidentally;
- unrelated edits and quick toggles preserve `sales_site`, `learning_site`, and the canonical target;
- duplicate global slugs return `COURSE_SLUG_CONFLICT` with a site suffix suggestion;
- successful creation shows a persistent `Mở trong LMS Admin` deep link;
- Preview fixture rows cover two canonical owners and a legacy shared alias.

The feature-off path keeps the former query/write contract.

## Current audited course/mapping state

Read-only audit summary: 9 courses, 30 orders, 22 enrollments, 39 lessons, and 6 historical `course_slug_mappings`.

| Course | Sales site | Learning target | Learning site | Legacy/New | LMS Admin hiển thị ở đâu |
|---|---|---|---|---|---|
| Seven historical canonical courses | `NULL` | self/`NULL` | fallback `yeunauan` | Legacy | `yeubep.shop` / `yeunauan` |
| `thitxiennuongchaungoc-yeubep` | `yeubep` | `thitxiennuongchaungoc` | canonical owner `yeunauan` | Legacy shared alias | Alias hidden; canonical shown under `yeunauan`, warning shown |
| `thitkhomamtep` | `yeubep` | self/`NULL` | fallback `yeubep` | Current self-target | `shop.yeunauan.live` / `yeubep` |
| New Preview self-target A | `yeunauan` | self | explicit `yeunauan` | New | `yeubep.shop` / `yeunauan` |
| New Preview self-target B | `yeubep` | self | explicit `yeubep` | New | `shop.yeunauan.live` / `yeubep` |

No Production row above was changed.

## Verification

| Suite/gate | Result |
|---|---|
| LMS baseline + new tests | **317/317 passed** |
| Commerce baseline + new tests | **73/73 passed** |
| Protected browser matrix | **12/12 passed** |
| Hosted IDOR/enrollment/progress | passed |
| Nine Drive actions | passed in Preview dry-run |
| Migration idempotence/constraint/index/rollback/reapply | passed on guarded sanitized Preview substrate |
| JavaScript syntax | passed |
| LMS compiled CSS build | passed |
| Inline admin scripts syntax | passed |
| `git diff --check` | passed |
| Changed-diff secret scan | clean |
| `npm audit` Commerce | 0 vulnerabilities |
| `npm audit` LMS | 4 moderate, 0 high, 0 critical; existing dependency finding, no automatic breaking fix applied |

The protected run covers allowlist/missing/forged sites, deterministic legacy
fallback, alias/canonical distinction, server-side IDOR, selected/effective
audit metadata, selector/deep-link/empty/global states, responsive Chromium/
Firefox/WebKit, same-site Commerce validation and rollback preservation.

## Preview deployment

| Component | Deployment | URL | Source | Status |
|---|---|---|---|---|
| LMS | `dpl_BWuhKjmBpbSbATbZTfSKZrRrHjX6` | `https://web-lms-chinh-thuc-c2kpdmspq.vercel.app` | `94e956f46d879b4bddec66f474fef52eff9d0da7` | protected Preview / Ready |
| Commerce | `dpl_GaoKXoWrZBN8Lrr9MKXEKA5YMujb` | `https://web-ban-hang-chinh-thuc-1sltsu4zu.vercel.app` | `fa84d3a347b009c01c35c7746a958bf8d7c6f1d9` | protected Preview / Ready |

### Previous resolved blockers

The earlier missing-schema, hosted-browser and LMS E2E blockers were historical
Gate states. They were resolved by the guarded B05 Preview substrate, protected
deployments and complete Preview evidence. Earlier Commerce deployment IDs are
superseded by the deployment above.

## Feature flags

| Flag | Default | LMS Preview | Commerce Preview | Production |
|---|---|---|---|---|
| `LMS_ADMIN_MULTI_SITE_ENABLED` | false | true | n/a | absent/default false |
| `COMMERCE_LMS_SITE_ISOLATION_ENABLED` | false | n/a | true | absent/default false |

## Hạng mục

| Hạng mục | Trước | Sau Preview | Production Ready |
|---|---|---|---|
| LMS selector | Một danh sách chung | Protected hosted proof, 12 browser/viewport cases | Review required |
| Server-side LMS scope | Không có `learning_site` | Resolver + hosted IDOR guards verified | Review required |
| Commerce LMS targets | Có thể thấy target chung | Same-site filter + backend rejection | Code yes; rollout no |
| Legacy shared alias | Hoạt động nhưng khó nhận biết | Preserved, hidden as empty LMS course, warning badge verified | Review required |
| Migration | Không có field | Forward/rollback/reapply passed on Preview only | Review required |
| Production data | Existing | Unchanged | Yes, safety invariant maintained |

## Known limitations and required approval gate

1. The Preview Gate proves logical isolation on a deliberately minimal B05
   substrate, not on a copy of Production data.
2. Browser feature-off compatibility is covered by the full source/handler
   contract suites; the protected hosted deployment remains intentionally
   flag-on for owner review.
3. LMS dependency audit reports four moderate transitive `uuid` findings through
   Google APIs; there are no high/critical findings and the offered automatic fix
   is breaking.
4. Production still requires a separately approved additive migration,
   environment and rollout window. No such approval is implied here.

No Production action is authorized by this report.

## Proposed Production rollout (not executed)

1. Approve exact commits and resolve all Preview gates.
2. Export schema and non-NULL delta evidence.
3. Apply only the additive migration during an approved window.
4. Deploy both components with flags still off.
5. Run read-only smoke checks.
6. Enable LMS flag for an approved admin canary, then Commerce flag.
7. Monitor mismatch/error/audit counters.
8. On any regression, turn flags off first; do not delete business data.
