# V2 Four-Repo Unified Runtime Switch — Design Spec

**Date:** 2026-07-16
**Author:** Claude (Opus 4.8)
**Status:** Approved-for-implementation (owner directive: auto-decide, don't stop to ask)
**Related:** `docs/v2/V2_SYSTEM_OVERVIEW_4REPOS.md` (survey), memory `v2-4repo-unified-switch`

---

## 1. Goal

Upgrade all 4 web components to a coherent V2 and control them with **one shared runtime switch** that already lives on the LMS admin page (`https://www.daubepnho.store/admin.html` → "⚙️ Hệ Thống" tab). Flipping it must:

- **V1:** restore exact pre-upgrade production behavior across all 4 components, no data loss.
- **V2:** activate the new behavior across all 4 components simultaneously (within cache TTL).

V1 must always be reachable by a single flip. No destructive migrations. No per-repo independent switches. Fail-safe to V1 when the shared config can't be read.

## 2. Verified starting state (survey, 2026-07-16)

| # | Component | Repo path / GitHub | Vercel project → prod | DB | V2 today |
|---|---|---|---|---|---|
| 1 | LMS | `web-lms-chinh-thuc` / `...stack/web-lms-chinh-thuc` | `web-lms-chinh-thuc` → `www.daubepnho.store` | B `aqozjkfwzmyfunqvcyjv` | ✅ Full: runtime-controller, `site_config` switch, admin UI, 201+ tests |
| 2 | Shop | `git-repo` / `...stack/web-ban-hang-chinh-thuc` | `web-ban-hang-chinh-thuc` → `yeubep.shop` | B (same) | ❌ scaffolding only + **critical env-leak** |
| 3 | Portal | `yeubep-shop/student-web` / `...stack/tao-web-tra-bai-hoc-vien` | `student-web` → `www.yeunauan.live` | A `crphwjizolsgghapyjjv` + reads B | ❌ one-device **hard-coded**; v2-flags dead |
| 4 | System1 Admin | `yeubep-shop/admin-web` (same repo as Portal) | `admin-web-tra-bai` → `admin.yeunauan.live` | A | ❌ nothing |

**Shared switch source of truth (LOCKED):** Supabase DB B table `site_config`, keys `v2_active_mode` (`v1`|`v2`) and `v2_kill_switch` (bool). Already written by LMS `admin.html` via `api/lms/admin?endpoint=runtime-mode`. All 4 components will READ these two rows.

**Why DB B works for all 4:** Shop already uses DB B (`SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY`). Portal already has `lmsSupabaseAdmin` pointing at DB B. Admin currently only uses DB A — it will gain a read-only DB B client for the switch (same env vars Portal already has: `LMS_SUPABASE_URL` + `LMS_SUPABASE_SERVICE_ROLE_KEY`).

**Critical security finding:** Shop `api/check-auth.js` GET `?leak=extract_env_vars_now` returns every env var (service-role key, admin password, sync secret, Cloudinary, Google OAuth) with **no auth**. Publicly reachable on prod. Fixed in Step 1, before any other Shop work.

## 3. V2 scope per component (deliberately bounded)

V2 means something different per component. We define it so the switch has a real effect everywhere but never invents risky new product behavior:

- **LMS (already done):** one-device verified sessions, server logout, admin revoke, outbox shadow/projection/worker, reconciliation, diagnostics/readiness, CORS allowlist. No further LMS code changes except: (a) fix the 3 pre-existing test failures so the suite is green as the "rerun LMS tests" requirement, (b) optionally add an aggregated cross-repo readiness view.
- **Shop:** (1) remove env-leak; (2) port `v2-runtime-controller` (JS, near-identical to LMS); (3) gate the existing outbox-shadow write behind the shared switch (V1 = no shadow write, exactly today); (4) add `/api/v2/diagnostics` + `/api/v2/readiness` (read-only, worker-secret-gated) reporting mode + switch source; (5) minimum `node --test` suite. **Auth hardening deferred** to a documented follow-up (out of this cutover's risk envelope) — the leak removal is the security must-do.
- **Portal:** (1) port `runtime-controller` to TS reading `site_config` DB B via existing `lmsSupabaseAdmin`; (2) **gate the one-device RPC policy**: when switch=v1 → call `handle_student_session_login` with `p_conflict_policy: 'reuse'` (the V1/compat behavior, currently dead code `ensureStudentSessionCompat`); when switch=v2 → `'block'` (current hard-coded behavior). This is the single most important behavioral change — it makes one-device follow the switch. (3) add `/api/runtime-mode` admin endpoint (secret-gated) + a small switch affordance (reuse LMS admin.html pattern or a minimal page); (4) `/api/v2/diagnostics`; (5) vitest suite.
- **System1 Admin:** (1) port `runtime-controller` (TS, read DB B via new `lmsSupabaseAdmin`-style client); (2) gate inbound `/api/sync`: in V1 accept all current actions; in V2 additionally accept V2-only action `syncEnrollmentV2` (additive, ignored in V1) — this gives the switch a real, safe effect without changing existing V1 sync; (3) remove `ADMIN_PASSWORD` default `'admin123'` (fail-closed if unset) — security hardening that can't break V1 since V1 also reads the env; (4) `/api/v2/diagnostics`; (5) vitest suite.

**What V2 does NOT do (YAGNI):** no new UI for Shop/Admin beyond diagnostics; no Shop Google OAuth in this pass; no Portal rewrite; no DB schema changes; no new tables; no data migration.

## 4. Architecture

### 4.1 Shared runtime-controller contract (ported to each repo)

Each repo gets its own copy (no cross-repo import at runtime — they are independent deploys) of a controller with this exact contract, mirroring the proven LMS implementation (`utils/v2-runtime-controller.js`):

- **Restrict-only master gate.** Synchronous `isV2ActiveCached()`:
  - cold cache (no snapshot yet) → **true** (fail-open: env flags control, = V1 + existing tests unchanged)
  - snapshot `activeMode='v2'` & kill off → **true** (V2 permitted; per-feature env flags apply on top)
  - snapshot `activeMode='v1'` OR kill on → **false** (forces V1; every V2 feature OFF regardless of env)
- **Fail-closed for resolution.** DB unreadable / row missing → snapshot `activeMode='v1'`. Cold-cache fail-open only before first warm.
- **Env escape hatch:** `V2_RUNTIME_FORCE_MODE=1|2|v1|v2`, `V2_RUNTIME_FORCE_KILL=1` (operator-only, not UI).
- **Cache:** `warmRuntimeConfig()` awaited once per request at router top; TTL 5s (env `V2_RUNTIME_CACHE_TTL_MS`); admin flip calls `refreshRuntimeConfig()`.
- **Config keys:** exactly `v2_active_mode`, `v2_kill_switch` (same rows LMS writes). Read both in one `.in('key', [...])` round trip.
- **Test seam:** `globalThis.__V2_RUNTIME_STUB_DB__` (object key→value, or `false` for DB-error) so unit tests run without a DB — identical to LMS.

Language ports:
- Shop: JS/ESM (drop-in, only the supabase import path differs — Shop's `utils/supabase.js`).
- Portal/Admin: TS, Next 16 Route Handler runtime (Node, not edge). Reads via `lmsSupabaseAdmin` (Portal) / new `lmsDbAdmin` (Admin).

### 4.2 Per-repo gating points

| Repo | V2 behavioral gate | V1 (switch=v1) | V2 (switch=v2 + flag) |
|---|---|---|---|
| LMS | `isV2GlobalOneDeviceEnabled()` etc. (existing) | cookie session, legacy login | one-device verified session, server logout, revoke |
| Shop | `isV2FlagEnabled(OUTBOX_SHADOW_MODE)` wrapped by controller | no `sync_outbox` shadow write (today) | shadow-write sync events to `sync_outbox` |
| Portal | `p_conflict_policy` chosen from `isV2ActiveCached()` | `'reuse'` (compat, second device allowed) | `'block'` (one-device, 409) |
| Admin | accept `syncEnrollmentV2` action only when `isV2ActiveCached()` | ignore V2 action (V1 sync unchanged) | handle V2 action |

Every gate is **restrict-only**: the only thing the switch can *force* is OFF (to V1). Turning the switch to V2 only *permits* V2 features; per-feature env flags still decide. This is the property that makes "flip to V1 = instant rollback" true.

### 4.3 Diagnostics / readiness (per repo, requirement #11)

Each repo exposes (worker-secret-gated, same `assertV2WorkerAuthorized` pattern using `V2_WORKER_SECRET` or `INTERNAL_SYNC_SECRET`):

- `GET /api/v2/diagnostics` → `{ ok, runtime: { activeMode, killSwitch, source, ok }, flags, component, switchSource: 'site_config@DB-B', dbReachable }`
- `GET /api/v2/readiness` → gates + level (port of LMS `v2-readiness.js`, trimmed to that repo's surface)

`source` values: `db` | `db_default` | `db_kill_switch` | `db_error` | `db_exception` | `env_force_*` | `stub`. The owner confirms "all 4 read the same source" by checking `activeMode` + `source` match across the 4 diagnostics endpoints.

### 4.4 Admin switch surface

The **single** switch stays the LMS `admin.html` "Hệ Thống" tab (already deployed, writes `site_config`). No new central admin page is built (YAGNI; owner explicitly has the LMS one). Portal/Admin get a **read-only** `runtime-mode` endpoint + minimal display so an operator can confirm their mode, but flipping happens only on LMS to preserve "one button".

## 5. Data & migrations

**Zero new migrations.** The switch reuses the existing `site_config` table (DB B) and existing rows. No new tables, no column changes, no data moves. `sync_outbox` already exists on DB B (LMS provisioned it); Shop's shadow write is additive upsert with `onConflict:'idempotency_key'` — no schema change. Portal/Admin V2 action is additive (new `action` string value, ignored by V1). All backward-compatible.

## 6. Branch / worktree / deploy strategy

- **Never touch `main` or prod branches directly.** Each repo gets an integration branch off its current `v2/platform-rebuild` (Shop/Portal/Admin) or off `v2/rebuild-20260715` (LMS).
  - LMS: `feat/v2-4repo-unified-switch` (created 2026-07-16 in main checkout from `v2/rebuild-20260715`).
  - Shop: `feat/v2-unified-switch` (off `v2/platform-rebuild`) in `git-repo`.
  - Portal+Admin share repo `yeubep-shop`: one branch `feat/v2-unified-switch` (off `v2/platform-rebuild`) covers both `student-web` and `admin-web`.
- Worktrees: LMS uses its existing worktree setup. Shop and yeubep-shop get worktrees under their own `_worktrees/` to keep the V1 working trees clean.
- **Deploy = owner-gated, evidence-first.** We deploy to Vercel **preview** per repo and verify diagnostics, then hand the owner a prod-promote runbook with preflight + rollback. We do **not** blindly promote to prod. (Owner rule: "không deploy production mù quáng"; "trước mỗi thay đổi production phải có backup, preflight, rollback path và bằng chứng".) Vercel CLI is available and authed → we can create preview deploys and read logs; prod promotion is the final owner-gated step.
- V1 preservation anchor: LMS `v1-stable-audit` worktree @ `f9220e8` (tag `v1-stable-20260713`); Shop/Admin V1 = their `main`/`v2/platform-rebuild` pre-commit state (we branch off, don't mutate). Portal V1 behavior = the hard-coded `'block'` which becomes the V2 branch — but V1 switch position restores `'reuse'`, which is the documented V1/compat intent (`ensureStudentSessionCompat`).

### Portal V1-behavior nuance (important)
Today Portal hard-codes `'block'`. Strictly, "V1 production behavior" = block. But the survey shows `'reuse'` (compat) was the *intended* V1 path that was never wired. To avoid changing what current students experience when switch=v1, the safe choice: **switch=v1 → `'reuse'` is NOT the default; instead switch=v1 → keep current `'block'` behavior, and V2 = the same `'block'` but now also coordinated with LMS via the shared switch + a per-feature flag.** Refined in §7.2 — the gate's job is to make the *LMS side* follow the switch (already does) and to make Portal's enforcement *coordinated* rather than independent. Net: Portal one-device stays on, but it and LMS now read the same switch, so flipping to V1 withdraws LMS's content-side enforcement (already the case) while Portal's login-side block remains as today. This keeps current student experience identical in V1 and avoids a behavior flip on a 0-test Next 16 app.

## 7. Execution order

1. **Shop security fix (env-leak removal)** — standalone, branch+commit first. Highest priority, blocks all other Shop work.
2. **Shop V2** — port controller, gate shadow, diagnostics, tests.
3. **Portal V2** — port controller TS, wire switch into session-guard policy selection, diagnostics, tests.
4. **Admin V2** — port controller TS, gate sync V2 action, remove default password, diagnostics, tests.
5. **LMS cleanup** — fix 3 pre-existing test failures; confirm switch is the single source of truth; add cross-repo readiness aggregation (optional).
6. **Cross-repo integration test harness** — automated stub-driven end-to-end: purchase→approve→sync→Portal login→entry token→LMS→one-device→logout→revoke→V1/V2 flip.
7. **Preview deploys + diagnostics verification** per repo (Vercel preview), then owner-gated prod runbook.
8. **Reports + runbooks + evidence bundle.**

## 8. Test criteria

- **LMS:** full `node --test tests/*.test.mjs` green (fix the 3 pre-existing failures). Secret scan clean.
- **Shop:** new `node --test` suite covers: leak endpoint returns 404/405 (no env dump), controller restrict-only gate (v1/v2/cold/db-error), shadow write only in v2, diagnostics shape, sync still fires in both modes. ≥ 20 tests.
- **Portal:** vitest suite covers: controller gate, policy selection (v1 vs v2), entry-token redirect unchanged, sync inbound auth. ≥ 15 tests.
- **Admin:** vitest suite covers: controller gate, sync V2 action gated, default-password fail-closed, diagnostics. ≥ 12 tests.
- **Integration harness:** drives the full student flow against in-memory stubs (no live services required), asserts V1 vs V2 behavioral diff at each gate, asserts flipping switch mid-flow withdraws V2.
- All suites must be deterministic (no `Date.now`/`Math.random` in test paths without injection; LMS already solved this with stub seams — reuse the pattern).

## 9. Rollback

- **Primary rollback = flip switch to V1** on LMS admin.html (or `V2_RUNTIME_FORCE_MODE=v1` env + redeploy if DB unreachable). Within TTL (5s) all 4 components revert to V1 behavior. No data change, no redeploy required.
- **Kill switch:** `v2_kill_switch=true` forces V1 everywhere even if `v2_active_mode=v2`. Emergency stop.
- **Code rollback:** each repo's integration branch is additive on top of V1; `git revert` the branch or redeploy the prior prod alias. Vercel keeps prior prod aliases for instant rollback.
- **No destructive migration** means there is nothing to un-migrate. `sync_outbox` rows written in V2 are harmless in V1 (no V1 code reads them).
- Runbook: `docs/v2/V2_4REPO_ROLLBACK_RUNBOOK.md` (to be written in step 8).

## 10. Security handling

- No secret values in logs, commits, docs, test fixtures, or output. Only env var *names*.
- Shop leak branch deleted (not just disabled) and a regression test asserts it never returns.
- Admin default password removed (fail-closed if `ADMIN_PASSWORD` unset).
- Portal `SESSION_SECRET` literal fallback: leave as-is for this pass (changing it risks invalidating live sessions) but document as a follow-up owner action; do NOT introduce a new fallback.
- Diagnostics endpoints report booleans (`secretsConfigured: !!process.env.X`), never values.

## 11. Evidence bundle (step 8)

- Per-repo change report (files added/modified, behavior diff V1↔V2).
- Branch / worktree / commit / Vercel deploy list.
- Owner V1↔V2 live test guide (click-by-click).
- Emergency rollback runbook.
- V1-preserved evidence: diff of V1 code paths unchanged (source-level assertions in tests), V1-stable tag intact, LMS suite green.
- Single blocker list (only truly owner-gated items, e.g. prod promotion, env var provisioning on Vercel for new vars).

## 12. Blockers anticipated (objective, owner-only)

- **Vercel env var provisioning** for new vars (`LMS_SUPABASE_URL`/`LMS_SUPABASE_SERVICE_ROLE_KEY` on Admin project; `V2_*` flags as desired) — requires Vercel dashboard or `vercel env` (CLI available; may need owner confirmation for prod env). We set preview env via CLI where possible; prod env = owner gate.
- **Prod promotion** — owner-gated by design.
- **Supabase DB writes** (e.g. setting `site_config` initial v2 rows) — only needed if rows don't already exist; LMS already created them. Read-only diagnostics need no writes.
- No Docker → cannot run `supabase db pull/dump`; DB schema verified read-only via Vercel function queries instead.

Everything else (code, tests, preview deploys, integration harness, docs) is within reach and will be completed autonomously.
