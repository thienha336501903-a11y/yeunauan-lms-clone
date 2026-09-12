# System B encrypted PostgreSQL backup runbook

This runbook is only for `thienha336501903-a11y/yeunauan-lms-clone` and Supabase System B. It must never be pointed at System A.

## Architecture and retention

- GitHub Actions runs weekly at 18:17 UTC every Sunday (01:17 Monday Asia/Ho_Chi_Minh) and streams a PostgreSQL custom-format dump directly into OpenPGP encryption.
- Weekly scheduled backups run automatically from the workflow schedule. Manual `workflow_dispatch` remains available before significant database changes or on demand.
- No plaintext dump is written to runner storage. Only encrypted `.dump.gpg` data and its SHA-256 checksum enter R2.
- Use a separate private bucket, for example `yeubep-system-b-backups`. Do not reuse `yeubep-v5-media-prod`.
- R2 credentials must be scoped to Object Read & Write for that one backup bucket. They must not have account-wide administration access.
- Retention is enforced after every successful upload: newest 8 weekly scheduled backups and newest 8 manual snapshots.
- The private decryption key must be stored offline. Add it to GitHub only when a controlled temporary restore drill is required, then remove/rotate it after the drill.

## Required GitHub Actions secrets

Backup workflow:

- `SYSTEM_B_BACKUP_DATABASE_URL`: PostgreSQL Session Pooler connection for Supabase System B project `yyiavtiwtekkocqpephr`. TLS is forced.
- `SYSTEM_B_BACKUP_GPG_PUBLIC_KEY_B64`: base64 of the armored backup public key.
- `R2_BACKUP_ACCOUNT_ID`
- `R2_BACKUP_ACCESS_KEY_ID`
- `R2_BACKUP_SECRET_ACCESS_KEY`
- `R2_BACKUP_BUCKET`

Temporary restore drill only:

- `SYSTEM_B_BACKUP_GPG_PRIVATE_KEY_B64`
- `SYSTEM_B_TEMP_RESTORE_DATABASE_URL`: disposable PostgreSQL database, never Production.
- `SYSTEM_B_TEMP_RESTORE_CONFIRMATION=TEMPORARY_SYSTEM_B_RESTORE_ONLY`

## Activation and operations

1. Create the dedicated private R2 backup bucket and bucket-scoped API token.
2. Generate a dedicated OpenPGP key pair offline. Store the private key and revocation certificate offline.
3. Add the six backup workflow secrets to the LMS repository.
4. Run **System B encrypted database backup** manually once and confirm the workflow is green.
5. Confirm R2 contains one encrypted `.dump.gpg` object and matching `.sha256`, with no plaintext dump.
6. Leave the weekly workflow enabled. It will run every Sunday at 18:17 UTC (01:17 Monday in Vietnam).
7. Before a significant DB migration/change, run the same workflow manually to create an extra manual snapshot.
8. A temporary restore drill is recommended periodically or before a high-risk migration, but is not required for normal weekly backup operation. Never restore over Production.

The backup script rejects any source outside Supabase System B and rejects the live V5 media bucket name. Scheduled runs write under `system-b/weekly/`; manual runs write under `system-b/manual/`. The restore script must only be used against a disposable target and never Production.
