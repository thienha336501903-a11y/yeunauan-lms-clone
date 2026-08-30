# LMS V5 hardening rollout order — 2026-08-28

This checkpoint is for System B only. It does not authorize touching Legacy Production / System A.

## Already live — do not blindly re-apply

The canonical V5 foundation and Telegram mirror queue were applied before this hardening chain:

- `sql/migration_lms_v5_canonical_foundation_20260826.sql`
- `sql/migration_lms_v5_telegram_mirror_queue_20260827.sql`

Treat the files above as source-of-truth records for already-existing objects. Verify live definitions before any repair instead of replaying them wholesale.

## Forward hardening migrations

Apply the new migrations in this order after the corresponding application code has passed CI/Preview and immediately before the isolated V5 E2E gate:

1. `sql/migration_lms_v5_pin_search_path_20260828.sql`
   - pins the existing `enforce_v5_course_mode` trigger function search path.
2. `sql/migration_lms_v5_course_lifecycle_guard_20260828.sql`
   - installs the first fail-closed V5 course lifecycle boundary.
3. `sql/migration_lms_v5_sale_activation_mirror_20260828.sql`
   - intentionally redefines `enforce_v5_course_lifecycle`; must come after step 2.
   - preserves LMS-owned content Publish while Commerce owns only the `active` sale switch.
4. `sql/migration_lms_v5_atomic_release_20260828.sql`
   - installs atomic Publish/release-pointer switching and canonical snapshot validation.
5. `sql/migration_lms_v5_media_integrity_guard_20260828.sql`
   - READY requires R2; released media identity/locator/status becomes immutable.
6. `sql/migration_lms_v5_release_immutability_20260828.sql`
   - makes release history append-only and snapshots immutable.
7. `sql/migration_lms_v5_order_entitlement_ownership_20260828.sql`
   - one Commerce V5 order may own at most one enrollment row.
8. `sql/migration_lms_v5_mirror_rpc_search_path_20260828.sql`
   - forward-only pin for the already-live Telegram mirror SECURITY DEFINER RPCs.

## Rollout gates after migrations

Before any real V5 sale:

- create an isolated `__clone_factory_test...` V5 course fixture;
- verify Draft cannot sell/register/grant;
- Publish once and verify learner feed/play render the selected immutable release;
- mutate authoring rows and confirm learner stays on the old release until republish;
- verify Direct Upload READY media plays with Range through signed lease;
- verify one Telegram-origin mirror reaches private R2, becomes READY, then plays through the same lease path;
- approve one Commerce V5 order, verify exact order-owned enrollment, revoke, restore/resync, and race/fail-closed behavior;
- turn `active=false` and verify existing learner access remains while new registration is blocked;
- rollback release and verify learner feed/play switch together;
- clean all test rows/media/jobs and confirm no `__clone_factory_test` residue.

Only after those gates pass should V5 be considered ready for a first real sale. Tightening `/api/v5-sync` to `V5_SYNC_SECRET` only is a final post-rollout cleanup step after the real-secret smoke passes.
