#!/usr/bin/env bash
set -euo pipefail

required=(
  SYSTEM_B_BACKUP_DATABASE_URL
  SYSTEM_B_BACKUP_GPG_PUBLIC_KEY_B64
  R2_BACKUP_ACCOUNT_ID
  R2_BACKUP_ACCESS_KEY_ID
  R2_BACKUP_SECRET_ACCESS_KEY
  R2_BACKUP_BUCKET
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required backup configuration: ${name}" >&2
    exit 1
  fi
done

if [[ "${SYSTEM_ID:-system-b}" != "system-b" ]]; then
  echo "Refusing to back up a non-System-B environment." >&2
  exit 1
fi
if [[ "${SYSTEM_B_BACKUP_DATABASE_URL}" != *"yyiavtiwtekkocqpephr"* ]]; then
  echo "Refusing to back up a database outside Supabase System B." >&2
  exit 1
fi
if [[ "${R2_BACKUP_BUCKET}" == "yeubep-v5-media-prod" ]]; then
  echo "Backup bucket must be separate from the private V5 media bucket." >&2
  exit 1
fi

export AWS_ACCESS_KEY_ID="${R2_BACKUP_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_BACKUP_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION="auto"
export AWS_PAGER=""
export PGSSLMODE="require"
endpoint="https://${R2_BACKUP_ACCOUNT_ID}.r2.cloudflarestorage.com"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
day="$(date -u +%F)"
year="$(date -u +%Y)"
week="$(date -u +%G-W%V)"
work_dir="$(mktemp -d)"
gpg_home="$(mktemp -d)"
trap 'rm -rf "${work_dir}" "${gpg_home}"' EXIT
chmod 700 "${gpg_home}"
export GNUPGHOME="${gpg_home}"

encrypted_path="${work_dir}/system-b-lms-${stamp}.dump.gpg"
public_key_path="${work_dir}/backup-public-key.asc"

printf '%s' "${SYSTEM_B_BACKUP_GPG_PUBLIC_KEY_B64}" | base64 --decode > "${public_key_path}"
gpg --batch --quiet --import "${public_key_path}"
recipient="$(gpg --batch --with-colons --list-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
if [[ -z "${recipient}" ]]; then
  echo "Backup encryption public key has no usable fingerprint." >&2
  exit 1
fi

pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  "${SYSTEM_B_BACKUP_DATABASE_URL}" \
| gpg --batch --yes --quiet --trust-model always \
    --recipient "${recipient}" \
    --output "${encrypted_path}" \
    --encrypt
(cd "${work_dir}" && sha256sum "$(basename "${encrypted_path}")" > "$(basename "${encrypted_path}").sha256")

daily_key="system-b/daily/${year}/${day}/$(basename "${encrypted_path}")"
aws --endpoint-url "${endpoint}" s3 cp "${encrypted_path}" "s3://${R2_BACKUP_BUCKET}/${daily_key}" --only-show-errors
aws --endpoint-url "${endpoint}" s3 cp "${encrypted_path}.sha256" "s3://${R2_BACKUP_BUCKET}/${daily_key}.sha256" --only-show-errors

if [[ "$(date -u +%u)" == "7" ]]; then
  weekly_key="system-b/weekly/${year}/${week}/$(basename "${encrypted_path}")"
  aws --endpoint-url "${endpoint}" s3 cp "${encrypted_path}" "s3://${R2_BACKUP_BUCKET}/${weekly_key}" --only-show-errors
  aws --endpoint-url "${endpoint}" s3 cp "${encrypted_path}.sha256" "s3://${R2_BACKUP_BUCKET}/${weekly_key}.sha256" --only-show-errors
fi

prune_prefix() {
  local prefix="$1"
  local retain="$2"
  local index=0
  local key
  mapfile -t keys < <(
    aws --endpoint-url "${endpoint}" s3api list-objects-v2 \
      --bucket "${R2_BACKUP_BUCKET}" \
      --prefix "${prefix}" \
      --output json \
    | jq -r '[.Contents[]? | select(.Key | endswith(".dump.gpg"))] | sort_by(.LastModified) | reverse | .[].Key'
  )
  for key in "${keys[@]}"; do
    index=$((index + 1))
    if (( index > retain )); then
      aws --endpoint-url "${endpoint}" s3 rm "s3://${R2_BACKUP_BUCKET}/${key}" --only-show-errors
      aws --endpoint-url "${endpoint}" s3 rm "s3://${R2_BACKUP_BUCKET}/${key}.sha256" --only-show-errors
    fi
  done
}

prune_prefix "system-b/daily/" 14
prune_prefix "system-b/weekly/" 8

echo "Encrypted System B backup uploaded and retention enforced."
