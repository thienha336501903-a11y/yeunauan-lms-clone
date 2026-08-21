# V4 Stable checkpoint — 2026-08-21

## Mục đích

Checkpoint này ghi lại trạng thái Production đã audit của luồng Telegram → Cloner → LMS V4 sau khi full E2E PASS. Đây là tài liệu handover/rollback và **không chứa giá trị secret, token, mật khẩu hoặc thông tin đăng nhập**.

## Trạng thái tổng thể

- Production audit: **PASS**.
- Không có Pull Request đang mở ở LMS hoặc Telegram Cloner tại thời điểm audit.
- Luồng đã xác nhận E2E: đăng ký nguồn Telegram mới → historical import → live webhook + edited webhook → tạo khóa V4 Draft → cấp quyền → Draft gate → Publish → text/ảnh/video → revoke → cleanup.
- Wizard mở khóa mới và pre-publish health check đã ở Production.
- Historical import Windows đã rút gọn thành helper một lệnh và hỗ trợ cả nguồn private qua Chat ID / `t.me/c/...`.

## Source-code rollback checkpoints

### LMS

- Repository: `thienha336501903-a11y/yeunauan-lms-clone`
- Stable code SHA: `2b65d8081d58bab44596cfc2ed89cb8300ffaf7e`
- Stable branch: `stable/v4-20260821`
- Production deployment audited: `dpl_Byq5W13zzbvgDHKshoifagrh7wKn`
- Canonical: `https://yeunauan-lms-clone.vercel.app`
- Vercel project: `prj_0mFDJL5lV9q0NBjgBphs0Y6j1Xtc`

### Telegram Cloner

- Repository: `thienha336501903-a11y/telegram-channel-cloner`
- Stable code SHA: `21af2826ff5ba33ec8ad25444b25fd3bc0cc0bcb`
- Stable branch: `stable/v4-20260821`
- Production deployment audited: `dpl_8MapEpfePHpRXeDTBPECNDZQjfLt`
- Canonical: `https://telegram-channel-cloner.vercel.app`
- Vercel project: `prj_5cwOs0JpEUgC5PfpOdn0ffX4Ly0j`

### Shared infrastructure

- Vercel team: `team_cAthcmyw4079BDgelX0YjG9i`
- Supabase project: `yyiavtiwtekkocqpephr`

## Production verification

### LMS

- Latest Production deployment matched audited `main` SHA and was `READY`.
- `/v4-course-wizard.html` returned HTTP 200 on canonical Production.
- Anonymous access to `v4-prepublish` returned HTTP 401 as expected; admin data is not exposed without an admin session.
- Current-deployment warning/error logs contained only the known Node dependency warning `[DEP0169] url.parse()` plus the deliberate HTTP 401 requests used during the audit.

### Telegram Cloner

- Latest Production deployment matched audited `main` SHA and was `READY`.
- `/api/health` returned HTTP 200 with database healthy and Supabase, Telegram bot, Telegram webhook, reader ingest, admin auth and cron reported configured.
- No warning/error/fatal log was found on the current Production deployment during the one-hour audit window.
- Older `chat not found` and Supabase REST 401 events belong to superseded deployments and were addressed before this checkpoint.

## Supabase snapshot

Current high-level counts after audit cleanup:

| Area | Count |
|---|---:|
| Courses total | 8 |
| Legacy LMS courses | 7 |
| V4 courses | 1 |
| Legacy lessons | 45 |
| Students | 9 |
| Enrollments total | 22 |
| Legacy LMS enrollments | 20 |
| V4 active enrollments using legacy metadata label | 2 |
| V4 Telegram course mappings | 1 |
| Telegram sources | 1 |
| Telegram source messages | 14 |
| Telegram destinations | 0 |
| Clone jobs | 0 |
| Clone job items | 0 |
| Internal-link rows | 0 |
| Message mappings | 0 |
| Sync events | 2 |
| V4 media tickets after cleanup | 523 |

Relevant public tables at this checkpoint:

- `courses`
- `lessons`
- `students`
- `student_enrollments`
- `lms_v4_telegram_course_sources`
- `lms_v4_media_tickets`
- `tgcloner_sources`
- `tgcloner_source_messages`
- `tgcloner_destinations`
- `tgcloner_clone_jobs`
- `tgcloner_clone_job_items`
- `tgcloner_internal_links`
- `tgcloner_message_mappings`
- `tgcloner_scheduler_nonces`
- `tgcloner_settings`
- `tgcloner_sync_events`

### Stable V4 production course

The production V4 course `cagiatay` was verified as:

- active and published;
- delivery mode `v4`;
- Telegram mapping enabled;
- media mode `telegram_bot_poc`;
- source remains MASTER;
- indexed count `14`, actual source-message count `14`;
- 13 media messages and **0 media missing `file_id`**;
- 2 active enrollments.

Do not mutate this course/source during automated or exploratory tests.

## Audit cleanup performed

- Removed exactly 16 expired media-ticket rows identifiable as old `__clone_factory_test*` artifacts.
- No test course, test source, test source-message, test clone job, test mapping or test media ticket remains.
- Two active `cagiatay` enrollment rows still have `source_system = __clone_factory_test_v4_preview`. These are **not disposable test rows**: they are the two currently required V4 access rows. They were intentionally preserved to avoid breaking real access.
- Treat the `source_system` value above as a legacy metadata anomaly only. Do not delete those enrollments merely because the label contains the old test prefix.

## V4 Admin operating path

Preferred path for a new V4 course:

1. Register a Telegram V4 source in Cloner Admin.
2. Import old channel history when required using **Import 1 lệnh** on Windows.
3. Open `https://yeunauan-lms-clone.vercel.app/v4-course-wizard.html`.
4. Select source → create Draft → grant one test/student enrollment → verify Draft gate.
5. Run Preflight.
6. Publish only when blocker count is zero and warnings have been reviewed.
7. Verify student text/photo/video after first publication of a new source.

Full/fallback administration remains available in `v4-admin.html`.

## Pre-publish blocker policy

The V4 preflight is read-only and checks at least:

- Telegram mapping exists and is enabled;
- source exists and has a Telegram chat ID;
- exact source-message count is non-zero;
- bounded/paginated scan of media rows completes;
- every supported media row has usable Telegram `file_id` metadata;
- historical reader media has been hydrated;
- video thumbnail readiness;
- enrollment count;
- Cloner/database/bot/webhook health.

Mapping/source/content/media metadata failures are blockers. Transient gateway health, no enrollment, cached-count mismatch and thumbnail-only issues are warnings where applicable.

## Historical import — Windows

Current preferred helper lives in the Cloner repository:

- `reader-cli/import-history.cmd`
- `reader-cli/import_history_windows.ps1`
- `reader-cli/export_history.py`

Operational behavior:

- Admin copies one bootstrap command using **Import 1 lệnh**.
- Helper updates from clean `main` using fast-forward only; local code changes are not overwritten.
- Python dependencies are installed when missing.
- Telegram API credentials and reader ingest secret remain on the local Windows machine and may be stored with Windows DPAPI.
- Existing Telegram `.session` is reused.
- Public `@username`, Bot API `-100...` Chat ID and private `t.me/c/...` targets are supported through Telegram dialog resolution.
- Historical import is idempotent by source/message identity and must not change the MASTER role.

## Environment-variable names — values must stay outside Git

### LMS V4 critical names confirmed in current code

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SECRET`
- `SESSION_DAYS` (optional/defaulted)
- `ADMIN_EMAILS`
- `GOOGLE_CLIENT_ID`
- `BUNNY_STREAM_TOKEN_KEY` where legacy Bunny media is used
- `TELEGRAM_CLONER_HEALTH_URL` when overriding the default Cloner health endpoint

Vercel Production environment remains the source of truth. Do not copy environment values into this document.

### Telegram Cloner names

- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (legacy fallback where used)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `READER_INGEST_SECRET`
- `CRON_SECRET`
- `CLONE_MIN_DESTINATION_DELAY_MS`
- `CLONE_MAX_WRITES_PER_TICK`
- `CLONE_MAX_DESTINATIONS_PER_TICK`

### Local reader only

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `READER_INGEST_SECRET`

Never commit Telegram session files, local reader encrypted config or any secret value.

## Rollback procedure

### Code-only rollback

If a future change breaks LMS V4 without requiring a DB rollback:

1. Compare the failing change against `stable/v4-20260821`.
2. Restore/revert only the affected code back to LMS SHA `2b65d8081d58bab44596cfc2ed89cb8300ffaf7e` and/or Cloner SHA `21af2826ff5ba33ec8ad25444b25fd3bc0cc0bcb`.
3. Run CI and Preview before Production.
4. Verify `cagiatay` remains 14/14 with media ready and two active enrollments.

Vercel rollback candidates at checkpoint time were the audited Production deployments listed above.

### Database rollback caution

This checkpoint is a **code + configuration + schema/state manifest**, not a physical PostgreSQL dump. Recent Wizard/Windows-import work did not require a schema migration. Do not blindly roll back Supabase data when reverting code.

Before any future DB migration, create a database-native backup/snapshot appropriate to the Supabase plan and record the migration ID separately.

## Known non-blocking items

1. Node emits `[DEP0169] url.parse()` from a dependency path in LMS/Cloner. It is currently a warning, not an observed V4 functional failure. Do not upgrade unrelated dependencies solely to silence it without regression testing.
2. The two real V4 enrollment rows have the legacy `__clone_factory_test_v4_preview` source-system label. Access is valid; preserve the rows until a dedicated metadata migration is tested.
3. `lms_v4_media_tickets` is ephemeral runtime data and can grow with viewing activity. Do not interpret its row count as course/message count.

## Change discipline after this checkpoint

- Never commit directly to `main`.
- Use feature branch → PR → CI → Preview → merge → Production verification.
- Tests must use `__clone_factory_test*` and clean up after themselves.
- Never mutate `cagiatay` or its two active enrollments in automated tests.
- Keep V4 Wizard/preflight changes isolated from student/media runtime unless a runtime change is explicitly required and separately tested.
- Keep Telegram non-MASTER V4 source registration from changing the current MASTER.

This file is the reference checkpoint for the next V4 development phase.