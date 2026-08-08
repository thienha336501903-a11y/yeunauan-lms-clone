# Repeat restore audit — supabase-before-multistore-20260725-154808

**Requested:** 06/08/2026  
**Current result:** `PARTIAL — DATABASE VALUES MATCH; SCHEMA ACCESS REQUIRED`  
**Production mutation in this request:** none

## Snapshot integrity

- Snapshot: `supabase-before-multistore-20260725-154808`.
- Checksum entries: 16/16 MATCH.
- `checksums.sha256` SHA-256:
  `04180c3315b0136cf9c57445b6aefe3e56f56a3772d712a9e3742f265b4d7e6a`.

## Current data comparison

Read-only semantic comparison against snapshot:

| Table | Snapshot/current rows | Common-column result |
|---|---:|---|
| courses | 7 / 7 | MATCH |
| orders | 28 / 28 | MATCH |
| site_config | 73 / 73 | MATCH |
| course_slug_mappings | 6 / 6 | MATCH |
| portal_post_course_mappings | 0 / 0 | MATCH |
| lessons | 39 / 39 | MATCH |
| student_enrollments | 20 / 20 | MATCH |

No added, removed or changed business row was found in snapshot-covered columns.

## Remaining schema drift

Two nullable columns were added after the earlier restore:

- `courses.lms_tenant` — 0 non-NULL rows;
- `orders.lms_tenant` — 0 non-NULL rows.

Removing these columns is required for exact snapshot schema equality, but no
current credential has DDL access to Supabase ref `aqozjkfwzmyfunqvcyjv`:

- current Supabase Management login sees Portal ref `crph...` and isolated
  Portal Learning ref `mkx...`, not `aqoz...`;
- local AQOZ service-role permits read-only REST verification/backup but cannot
  execute `ALTER TABLE`;
- no valid historical AQOZ Management token or DB password was found.

No attempt was made to bypass the missing database authority.

## Fresh safety backup

Path:

`C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_private_backups\pre-multistore-repeat-20260806-232017`

- Project ref: `aqozjkfwzmyfunqvcyjv`.
- 27 tables exported through server-side REST.
- AES-256-GCM; key protected by Windows DPAPI CurrentUser.
- Decrypt/readback: PASS.
- Plaintext retained: false.
- Encrypted payload SHA-256:
  `a78dfc6b8cdd2f70c753300fe38f325d0def4a596621bbad09ef95316e7910f2`.
- Protected key SHA-256:
  `82c34b02e8ebac52c9615629b16a0f5cdc3972b8bc9609703e930cc806f0842f`.
- Sanitized manifest SHA-256:
  `f4d87ddedd3de13dc1a619033096909d6a7c1f94853ff6c72ffc22ec21d81956`.

## Vercel/control-plane state

- `shop.yeunauan.live` and `yeubep.shop` both serve exact Commerce deployment
  `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2` on project
  `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D`.
- Commerce Production env-name inventory remains exactly 12 names from the
  checkpoint contract.
- `www.daubepnho.store` serves exact LMS deployment
  `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`.
- All three public roots returned HTTP 200.
- No deployment, alias, domain or env mutation was required or performed.

## Required owner action

Log Supabase CLI/Management access into the account or organization containing
project `aqozjkfwzmyfunqvcyjv`, or provide DB-owner access through a secure local
credential store. Do not send the token/password through chat.

After access is available, execute one reviewed transaction:

```sql
begin;
alter table public.courses drop column if exists lms_tenant;
alter table public.orders drop column if exists lms_tenant;
commit;
```

Before execution, query dependencies and reverify both columns remain entirely
NULL. After execution, rerun semantic comparison, schema verification and HTTP
smoke.

## Preserved outside snapshot scope

- Portal/Admin/Student systems were not changed.
- LMS Yeubep and isolated Portal Learning assets were not deleted.
- LMS data, Google Drive and Cloudinary were not overwritten or moved.
- No raw secret or PII was printed or written into this report.
