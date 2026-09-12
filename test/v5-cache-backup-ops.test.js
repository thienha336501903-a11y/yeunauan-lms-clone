import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const vercel = fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
const backup = fs.readFileSync(new URL('../scripts/system-b-backup.sh', import.meta.url), 'utf8');
const restore = fs.readFileSync(new URL('../scripts/system-b-restore-drill.sh', import.meta.url), 'utf8');
const backupWorkflow = fs.readFileSync(new URL('../.github/workflows/system-b-backup.yml', import.meta.url), 'utf8');
const restoreWorkflow = fs.readFileSync(new URL('../.github/workflows/system-b-restore-drill.yml', import.meta.url), 'utf8');

test('public shells revalidate while APIs and service workers remain no-store', () => {
  assert.match(vercel, /"source": "\/\(\.\*\)\.html"[\s\S]*public, max-age=0, must-revalidate/);
  assert.match(vercel, /"source": "\/api\/\(\.\*\)"[\s\S]*private, no-store/);
  assert.match(vercel, /"source": "\/v4-media-sw\.js"[\s\S]*no-cache, no-store/);
  assert.match(vercel, /"source": "\/v5\/media-sw\.js"[\s\S]*no-cache, no-store/);
  assert.doesNotMatch(vercel, /private-video|Cache API/);
});

test('weekly backup encrypts before isolated R2 upload and retains weekly/manual snapshots', () => {
  assert.match(backup, /pg_dump[\s\S]*--format=custom/);
  assert.match(backup, /gpg[\s\S]*--encrypt/);
  assert.match(backup, /pg_dump[\s\S]*\| gpg[\s\S]*--encrypt/);
  assert.doesNotMatch(backup, /--file=/);
  assert.ok(backup.indexOf('--encrypt') < backup.indexOf('s3 cp "${encrypted_path}"'));
  assert.match(backup, /system-b\/manual/);
  assert.match(backup, /system-b\/weekly/);
  assert.match(backup, /retention_count=8/);
  assert.match(backup, /prune_prefix "\$\{retention_prefix\}" "\$\{retention_count\}"/);
  assert.match(backup, /yeubep-v5-media-prod/);
  assert.match(backup, /yyiavtiwtekkocqpephr/);
  assert.match(backupWorkflow, /schedule:[\s\S]*cron: '17 18 \* \* 0'/);
  assert.match(backupWorkflow, /SYSTEM_B_BACKUP_CLASS:[\s\S]*weekly[\s\S]*manual/);
  assert.match(backupWorkflow, /permissions:\s*\n\s*contents: read/);
});

test('restore drill is manual and fails closed for Production System B', () => {
  assert.match(restoreWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(restoreWorkflow, /schedule:/);
  assert.match(restoreWorkflow, /inputs\.confirmation == 'RESTORE_TO_TEMP_ONLY'/);
  assert.match(restore, /TEMPORARY_SYSTEM_B_RESTORE_ONLY/);
  assert.match(restore, /yyiavtiwtekkocqpephr/);
  assert.match(restore, /\^system_b_restore_/);
  assert.match(restore, /\(manual\|weekly\)/);
  assert.match(restore, /sha256sum --check/);
  assert.match(restore, /gpg[\s\S]*--decrypt[\s\S]*\| pg_restore[\s\S]*--clean[\s\S]*--exit-on-error/);
});
