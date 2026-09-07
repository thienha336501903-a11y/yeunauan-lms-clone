#!/usr/bin/env bash
set -euo pipefail

required=(
  SYSTEM_B_BACKUP_GPG_PRIVATE_KEY_B64
  SYSTEM_B_TEMP_RESTORE_DATABASE_URL
  SYSTEM_B_TEMP_RESTORE_CONFIRMATION
  R2_BACKUP_ACCOUNT_ID
  R2_BACKUP_ACCESS_KEY_ID
  R2_BACKUP_SECRET_ACCESS_KEY
  R2_BACKUP_BUCKET
  SYSTEM_B_BACKUP_KEY
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required restore-drill configuration: ${name}" >&2
    exit 1
  fi
done

if [[ "${SYSTEM_B_TEMP_RESTORE_CONFIRMATION}" != "TEMPORARY_SYSTEM_B_RESTORE_ONLY" ]]; then
  echo "Restore confirmation marker is invalid." >&2
  exit 1
fi
if [[ ! "${SYSTEM_B_BACKUP_KEY}" =~ ^system-b/(daily|weekly)/[A-Za-z0-9._/-]+\.dump\.gpg$ ]]; then
  echo "Backup key is outside the allowed System B prefixes." >&2
  exit 1
fi

target_identity="$(node -e '
  const url = new URL(process.env.SYSTEM_B_TEMP_RESTORE_DATABASE_URL);
  process.stdout.write(`${url.hostname}|${decodeURIComponent(url.username)}|${url.pathname.slice(1)}`);
')"
IFS='|' read -r target_host target_user target_database <<< "${target_identity}"
if [[ "${target_identity}" == *"yyiavtiwtekkocqpephr"* ]]; then
  echo "Refusing to restore into the System B Production Supabase project." >&2
  exit 1
fi
if [[ ! "${target_database}" =~ ^system_b_restore_[a-z0-9_]+$ ]]; then
  echo "Temporary restore database name must start with system_b_restore_." >&2
  exit 1
fi
if [[ "${SYSTEM_B_BACKUP_DATABASE_URL:-}" != "" && "${SYSTEM_B_TEMP_RESTORE_DATABASE_URL}" == "${SYSTEM_B_BACKUP_DATABASE_URL}" ]]; then
  echo "Restore target matches the Production backup source." >&2
  exit 1
fi

export AWS_ACCESS_KEY_ID="${R2_BACKUP_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_BACKUP_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION="auto"
export AWS_PAGER=""
export PGSSLMODE="require"
endpoint="https://${R2_BACKUP_ACCOUNT_ID}.r2.cloudflarestorage.com"
work_dir="$(mktemp -d)"
gpg_home="$(mktemp -d)"
trap 'rm -rf "${work_dir}" "${gpg_home}"' EXIT
chmod 700 "${gpg_home}"
export GNUPGHOME="${gpg_home}"

encrypted_path="${work_dir}/backup.dump.gpg"
checksum_path="${encrypted_path}.sha256"
private_key_path="${work_dir}/backup-private-key.asc"

aws --endpoint-url "${endpoint}" s3 cp "s3://${R2_BACKUP_BUCKET}/${SYSTEM_B_BACKUP_KEY}" "${encrypted_path}" --only-show-errors
aws --endpoint-url "${endpoint}" s3 cp "s3://${R2_BACKUP_BUCKET}/${SYSTEM_B_BACKUP_KEY}.sha256" "${checksum_path}" --only-show-errors
sed -i "s#  .*#  $(basename "${encrypted_path}")#" "${checksum_path}"
(cd "${work_dir}" && sha256sum --check "$(basename "${checksum_path}")")

printf '%s' "${SYSTEM_B_BACKUP_GPG_PRIVATE_KEY_B64}" | base64 --decode > "${private_key_path}"
gpg --batch --quiet --import "${private_key_path}"
gpg --batch --yes --quiet --decrypt "${encrypted_path}" \
| pg_restore \
    --clean \
    --if-exists \
    --exit-on-error \
    --no-owner \
    --no-privileges \
    --dbname="${SYSTEM_B_TEMP_RESTORE_DATABASE_URL}"

psql "${SYSTEM_B_TEMP_RESTORE_DATABASE_URL}" -v ON_ERROR_STOP=1 -Atqc \
  "select 'restore_ok|' || current_database() || '|' || count(*) from information_schema.tables where table_schema = 'public';"
