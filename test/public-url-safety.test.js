import test from 'node:test';
import assert from 'node:assert/strict';
import { safePublicContentUrl, signBunnyEmbedUrl, signMediaUrls } from '../utils/lms.js';

test('learner media URLs are HTTPS-only', () => {
  assert.equal(safePublicContentUrl('https://drive.google.com/file/d/abc/view'), 'https://drive.google.com/file/d/abc/view');
  assert.equal(safePublicContentUrl('javascript:alert(1)'), '');
  assert.equal(safePublicContentUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(safePublicContentUrl('http://example.com/file'), '');
  assert.equal(safePublicContentUrl('https://user:pass@example.com/file'), '');
});

test('unsigned lesson and gallery helpers fail closed on unsafe schemes', () => {
  assert.equal(signBunnyEmbedUrl('javascript:alert(1)').secureVideoUrl, '');
  assert.match(signMediaUrls('image|unsafe|javascript:alert(1)'), /error:unsafe_media_url/);
  assert.equal(signMediaUrls('image|safe|https://drive.google.com/file/d/abc/view'), 'image|safe|https://drive.google.com/file/d/abc/view');
});
