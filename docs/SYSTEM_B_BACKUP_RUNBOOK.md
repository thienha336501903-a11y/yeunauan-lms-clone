# System B encrypted PostgreSQL backup runbook

This runbook is only for `thienha336501903-a11y/yeunauan-lms-clone` and Supabase System B. It must never be pointed at System A.

## Architecture and retention

- GitHub Actions runs at 18:17 UTC (01:17 Asia/Ho_Chi_Minh) and streams a PostgreSQL custom-format dump directly into OpenPGP encryption.
- Scheduled backups are gated by repository variable `SYSTEM_B_BACKUP_ENABLED=true`; until that variable is enabled, scheduled runs are skipped while manual `workflow_dispatch` remains available for activation testing.
- No plaintext dump is written to runner storage. Only encrypted `.dump.gpg` data and its SHA-256 checksum enter R2.
- Use a separate private bucket, for example `yeubep-system-b-db-backup`. Do not reuse `yeubep-v5-media-prod`.
- R2 credentials must be scoped to Object Read & Write for that one backup bucket. They must not have account-wide administration access.
- Retention is enforced after every successful upload: newest 14 daily backups and newest 8 Sunday weekly backups.
- The private decryption key must be stored offline. Add it to GitHub only when a controlled temporary restore drill is required, then remove/rotate it after the drill.

## Required GitHub Actions secrets

Backup workflow:

- `SYSTEM_B_BACKUP_DATABASE_URL`: direct PostgreSQL connection for Supabase System B project `yyiavtiwtekkocqpephr`; use a dedicated backup login with only the database read/metadata access required by `pg_dump`. TLS is forced.
- `SYSTEM_B_BACKUP_GPG_PUBLIC_KEY_B64`: base64 of the armored backup public key.
- `R2_BACKUP_ACCOUNT_ID`
- `R2_BACKUP_ACCESS_KEY_ID`
- `R2_BACKUP_SECRET_ACCESS_KEY`
- `R2_BACKUP_BUCKET`

Repository variable for scheduled activation:

- `SYSTEM_B_BACKUP_ENABLED=true` only after the first manual backup and temporary restore drill both PASS.

Temporary restore drill only:

- `SYSTEM_B_BACKUP_GPG_PRIVATE_KEY_B64`
- `SYSTEM_B_TEMP_RESTORE_DATABASE_URL`: disposable PostgreSQL database, never Production.
- `SYSTEM_B_TEMP_RESTORE_CONFIRMATION=TEMPORARY_SYSTEM_B_RESTORE_ONLY`

## First activation

1. Create the dedicated private R2 backup bucket and bucket-scoped API token.
2. Generate a dedicated OpenPGP key pair offline. Store the private key and revocation certificate offline.
3. Add the backup workflow secrets to the LMS repository. Leave `SYSTEM_B_BACKUP_ENABLED` unset or not equal to `true`.
4. Run **System B encrypted database backup** manually once.
5. Confirm R2 contains one `.dump.gpg` object and matching `.sha256`, with no plaintext dump.
6. Create an empty disposable PostgreSQL database named `system_b_restore_<unique>` whose identity does not contain Production project ref `yyiavtiwtekkocqpephr`.
7. Add the temporary restore secrets and run **System B temporary restore drill** with an exact R2 key and confirmation `RESTORE_TO_TEMP_ONLY`.
8. Confirm `restore_ok` is reported, destroy the disposable database, and remove the private-key/temporary-target secrets.
9. Set repository variable `SYSTEM_B_BACKUP_ENABLED=true` to activate the daily schedule.

The backup script rejects any source outside Supabase System B and rejects the live V5 media bucket name. The restore script rejects keys outside `system-b/daily/` and `system-b/weekly/`, rejects the System B Production project reference, requires a target database name beginning with `system_b_restore_`, rejects an exact match with the backup source URL, verifies the encrypted checksum before streaming decryption into `pg_restore --exit-on-error`.
