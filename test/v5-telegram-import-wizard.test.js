import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const adminHtml = fs.readFileSync(new URL('../v5-admin.html', import.meta.url), 'utf8');

test('1. v5-admin.html contains Telegram Wizard buttons in header and sidebar', () => {
  assert.match(adminHtml, /id="telegramWizardBtn"/);
  assert.match(adminHtml, /id="telegramWizardSideBtn"/);
  assert.match(adminHtml, /id="telegramActionBadge"/);
});

test('2. v5-admin.html contains telegramModal dialog with source selector and action buttons', () => {
  assert.match(adminHtml, /id="telegramModal"/);
  assert.match(adminHtml, /id="telegramSourceSelect"/);
  assert.match(adminHtml, /id="refreshTelegramSourcesBtn"/);
  assert.match(adminHtml, /id="telegramPreviewBtn"/);
  assert.match(adminHtml, /id="confirmTelegramImportBtn"/);
  assert.match(adminHtml, /id="telegramPreviewContainer"/);
  assert.match(adminHtml, /id="telegramResultContainer"/);
});

test('3. v5-admin.html includes Reader shortcut link to https://reader.yeubep.shop', () => {
  assert.match(adminHtml, /href="https:\/\/reader\.yeubep\.shop"/);
  assert.match(adminHtml, /Mở Telegram Reader ↗/);
});

test('4. v5-admin.html presents authoring mode in the wizard dialog', () => {
  assert.match(adminHtml, /id="wizardModeTitle"/);
  assert.match(adminHtml, /id="wizardModeDesc"/);
  assert.match(adminHtml, /const isTimeline\s*=\s*state\.authoringMode\s*===\s*'timeline'/);
});

test('5. runTelegramPreview calls preview action and renders planned stats', () => {
  assert.match(adminHtml, /action:\s*'preview'/);
  assert.match(adminHtml, /res\.totalRows/);
  assert.match(adminHtml, /res\.alreadySyncedUnits/);
  assert.match(adminHtml, /res\.newUnits/);
  assert.match(adminHtml, /res\.predictedLessons/);
  assert.match(adminHtml, /res\.predictedPosts/);
  assert.match(adminHtml, /res\.predictedMediaAssets/);
});

test('6. executeTelegramImport calls import action, renders results and triggers refresh', () => {
  assert.match(adminHtml, /action:\s*'import'/);
  assert.match(adminHtml, /res\.importedPosts/);
  assert.match(adminHtml, /res\.importedAssets/);
  assert.match(adminHtml, /res\.newLessonsCreated/);
  assert.match(adminHtml, /await refresh\(\)/);
});

test('7. Button label dynamically switches between Nhập and Đồng bộ based on telegram_source_id', () => {
  assert.match(adminHtml, /const hasTelegram\s*=\s*Boolean\(data\.config\?\.telegram_source_id\)/);
  assert.match(adminHtml, /hasTelegram\s*\?\s*'✈ Đồng bộ Telegram'\s*:\s*'✈ Nhập từ Telegram'/);
});

test('8. When newUnits === 0, confirmTelegramImportBtn is disabled to prevent unnecessary syncs', () => {
  assert.match(adminHtml, /if\s*\(res\.newUnits\s*===\s*0\)\s*\{\s*confirmBtn\.disabled\s*=\s*true/);
});
