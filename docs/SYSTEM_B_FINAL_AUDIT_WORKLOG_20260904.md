# SYSTEM B FINAL AUDIT WORKLOG — 2026-09-04

## Canonical status

- Updated: 2026-09-04 17:12 ICT
- Status: READY FOR REVIEW — PR #130 pending squash-merge
- Current owner window: ChatGPT Work
- Scope: System B only
- Forbidden: System A / Legacy Production, including Supabase `aqozjkfwzmyfunqvcyjv`
- Test-data prefix: `__clone_factory_test_handover_*`
- Secrets: values must never be recorded here

## Starting checkpoint

| Component | Main SHA | State |
|---|---|---|
| LMS | `f7b0a34260677441969380248e02a1d279edf817` | Production previously READY; final hardening merged |
| Commerce | `88611bc977e3a850e3f8ecca30f203afef267110` | PR #45 squash-merged; production CORS smoke PASS |
| Telegram Cloner | `8f4d82c0d448f4fd14182e9ed6c002bc9ff766f3` | Final hardening merged |

- LMS Vercel project: `yeunauan-lms-v4-test`
- LMS domain: `v4.daubepnho.store`
- System B Supabase: `yyiavtiwtekkocqpephr`
- Open PRs at preceding closeout: none
- System A untouched: YES

## Previously verified — do not repeat without new evidence

- LMS, Commerce and Telegram main CI/CodeQL passed at the security closeout.
- Commerce PR #45: 94 tests, CI, CodeQL, Preview and post-merge production CORS smoke passed.
- LMS V4 physical playback, service worker and Range regressions passed on real devices.
- Telegram import/reconcile/publish and large-media paths passed previously.
- V5 Telegram-to-R2 and HTTP Range `206` physical fixture passed and was cleaned up.
- No test data was created during the 2026-09-04 security closeout.

## Accepted/deferred risks to revalidate, not expand speculatively

- Legacy JS-readable session migration.
- Distributed rate limiting.
- Stricter script/style CSP rollout.
- Broad legacy Supabase public SELECT policies.
- Selected LMS wildcard CORS required by legacy paths.
- Node `DEP0169` warning.
- Full isolated backup restore drill.

## Work plan and live results

| ID | Work item | Status | Evidence / next action |
|---|---|---|---|
| A1 | Fresh-read all three mains and GitHub state | PASS | Heads match checkpoint; zero open PRs; Vercel commit statuses success |
| A2 | Static/config/dependency audit | PASS WITH NOTES | No secret/backup/temp/key files; client media diagnostics fixed. Historical branch-only V4 workflow and many diverged technical branches retained as optional history cleanup; npm registry audit timed out |
| A3 | Vercel/runtime/security-header audit | PASS WITH LIMITATION | Production READY at LMS main SHA; no 4xx/5xx in 24h; current DEP0169 warning remains accepted; custom-domain access from Work timed out |
| A4 | Supabase B read-only audit | PASS | 54/54 public tables RLS; zero core sync errors/open jobs/current-run fixtures; security advisors 0 WARN/ERROR |
| B1 | Full regression suites | PASS | LMS 246/246 after fix; Commerce 94/94; Telegram 109/109; syntax, Python, clone and secret isolation PASS |
| C1 | Safe runtime/E2E verification | PASS WITH LIMITATION | Public config 200; unauthenticated student dashboard, V4 feed and admin fail closed with 401; wrong method 405. Work network cannot load custom domain/browser and no test identities were available for a fresh authenticated flow |
| D1 | Capacity/load assessment 10 → 30 → 100 → 300 | PARTIAL PASS | 10/10, 30/30, 100/100; 300 batch: 158 reached app and all passed, remainder blocked/timed out at Work proxy; no Vercel 5xx/429 |
| E1 | Fix verified defects through PR gates | PASS — AWAITING MERGE | PR #130 removes raw LMS media URL/item console logs and adds a regression test; local 246/246, LMS CI and both Vercel status checks PASS; Preview READY |
| F1 | Cleanup and final user test checklist | PASS | Final read-only query confirms 0 prefixed test courses/orders/enrollments; no audit data was created or deleted |

## Active branch / PR

- Worklog branch: `audit/system-b-final-handover-20260904`
- PR: LMS #130 (Ready for review)
- Code-fix branch is consolidated into the audit branch to avoid a fragmented LMS PR.
- Dirty worktrees: LMS has the audited fix/test/worklog pending commit; Commerce and Telegram clean.

## Test data ledger

No test data created by this audit. Load tests used only the read-only System B LMS health endpoint.

Final cleanup query: 0 courses, 0 orders and 0 enrollments matching `__clone_factory_test_handover_*`.

## Evidence checkpoint — 2026-09-04 16:48 ICT

- Supabase B core counts: 16 courses, 45 lessons, 48 orders, 10 students, 34 active enrollments.
- Supabase anomalies: zero expired-but-active enrollments, course/order sync errors, enabled V4 mappings without source, open V5 jobs or processing Reader jobs.
- Cron: only active every-minute `tgcloner_dispatch_tick()`; no six-hour reconciliation cron.
- Advisor summary: security 49 INFO, 0 WARN/ERROR; performance 110 INFO and 11 WARN already associated with low-scale legacy handover policies.
- Load health results:
  - 10 concurrent: 10/10; DB latency 128–219 ms.
  - 30 concurrent: 30/30; DB latency 102–264 ms.
  - 100 concurrent: 100/100; DB latency 92–315 ms.
  - 300 attempted: 158/158 requests that reached the app passed; DB latency 99–280 ms. Other connections were rejected/timed out at the Work proxy before Vercel.
- Vercel observed no 5xx or 429 during the load window.
- Safe production-alias smokes:
  - `public-config`: HTTP 200.
  - student dashboard POST without session: HTTP 401 `missing_login_session`.
  - V4 Telegram feed without session: HTTP 401 `missing_login_session`.
  - admin courses without admin session: HTTP 401.
  - student dashboard GET: HTTP 405.
- Verified audit fix: removed two client `console.log` calls that exposed parsed/raw LMS media values; added `client-media-log-hygiene.test.js`; LMS 246/246 plus clone/domain/secret isolation PASS.
- PR #130 gates before this final documentation update: LMS CI run 329 PASS; both Vercel checks SUCCESS; Preview deployment `dpl_8ojvQwxkS9ZrFXnAdZQF8JfwdfAc` READY at head `b25cea3390fdd79de598c7e1773a265999840994`; error-only build log contained no errors; review threads empty.
- Preview is protected by Vercel SSO, so unauthenticated content smoke from Work receives 302. Production-alias API boundaries were smoked instead. No production redeploy was triggered.

## Final classification

### MUST DO

- Squash-merge LMS PR #130 after the final head repeats CI/Preview gates. This is the only open phase PR.

### SHOULD DO

- User acceptance after merge with designated test accounts: Google account switch, Commerce registration/bill/admin approval to LMS entitlement, V4/V5 playback and revoke/expiry. These paths retain their prior physical PASS baseline; the audit change does not touch them.
- If “300 learners” must be a contractual capacity claim, run a controlled authenticated 300-user test from infrastructure without the Work proxy, with enough isolated test identities and realistic video/R2 traffic. Current evidence certifies 100/100 concurrent health requests and 158/158 requests that reached Vercel in the 300 batch, not 300 authenticated playback users.

### OPTIONAL / FUTURE

- Archive/delete old diverged `agent/*`, `fix/*` and `ops/*` branches only after an explicit retention decision. They do not affect deployments or open PR state.
- Remove the legacy branch-scoped `v4-protection-ci.yml` after deciding whether the historical branch should remain reproducible; main LMS CI already covers current V4 regressions.
- Accepted/deferred architecture work remains unchanged: legacy JS-readable session migration, distributed rate limiting, stricter CSP rollout, broad legacy Supabase SELECT policies, selected legacy wildcard CORS, Node DEP0169 cleanup and a full isolated backup-restore drill. No new evidence makes these phase blockers.

## TRANSFER CHECKPOINT

1. **ĐÃ HOÀN THÀNH:** A1–F1; one verified client-log defect fixed; read-only load passed through 100 concurrent and 158 reached-app requests in the 300 batch; cleanup zero.
2. **ĐANG LÀM DỞ:** No technical work; only user-authorized squash-merge of PR #130 remains.
3. **VIỆC TIẾP THEO:** Squash-merge PR #130 after the final documentation-only head repeats CI/Preview gates, then verify production SHA and smoke.
4. **BRANCH / PR / HEAD SHA:** LMS `audit/system-b-final-handover-20260904`; Ready PR #130; last fully gated head `1b4bd73cf3780a60ec584d4d515fffbb868f9a5c`.
5. **CI / PREVIEW / PRODUCTION:** Head `1b4bd73c…`: LMS CI run 330 PASS; both Vercel checks SUCCESS; Preview `dpl_3eMvkKJYNHv4wZbQGUJ2LXAiNyH7` READY with error-only build log clean. Production remains READY on main and was not redeployed.
6. **TEST DATA CHƯA CLEANUP:** None created by this audit.
7. **BLOCKER:** Work network cannot complete a true 300-concurrent batch or load the custom domain/browser reliably; authenticated multi-user playback load lacks 300 test identities. This limits certification but is not evidence of an application failure.
8. **CẢNH BÁO KHÔNG ĐƯỢC LÀM:** Do not touch System A; do not use real data destructively; do not bypass auth; do not commit main directly.
9. **SYSTEM A UNTOUCHED:** YES.
