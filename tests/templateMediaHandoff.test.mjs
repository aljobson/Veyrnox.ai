import test from 'node:test';
import assert from 'node:assert/strict';
import {
  takeTemplateMediaHandoff,
  templateImageFileError,
  writeTemplateMediaHandoff,
} from '../app/veyrnox/_lib/templateMediaHandoff.js';

const NOW = 1_800_000_000_000;
const image = new Blob(['image'], { type: 'image/jpeg' });

test('template photo handoff is exact, fresh, memory-only and single-use', () => {
  const target = {};
  assert.equal(writeTemplateMediaHandoff(target, { templateId: 'slow-cinema-turn', modelId: 'kling-3.0-i2v', image }, NOW), true);
  assert.equal(takeTemplateMediaHandoff(target, 'other-template', 'kling-3.0-i2v', NOW), null);
  assert.equal(Object.keys(target).length, 0, 'a mismatched read still consumes the one-time handoff');

  writeTemplateMediaHandoff(target, { templateId: 'slow-cinema-turn', modelId: 'kling-3.0-i2v', image }, NOW);
  assert.deepEqual(takeTemplateMediaHandoff(target, 'slow-cinema-turn', 'kling-3.0-i2v', NOW), { image });
  assert.equal(takeTemplateMediaHandoff(target, 'slow-cinema-turn', 'kling-3.0-i2v', NOW), null);

  writeTemplateMediaHandoff(target, { templateId: 'slow-cinema-turn', modelId: 'kling-3.0-i2v', image }, NOW);
  assert.equal(takeTemplateMediaHandoff(target, 'slow-cinema-turn', 'kling-3.0-i2v', NOW + 11 * 60 * 1000), null);
});

test('template photo handoff enforces browser image formats and size limits', () => {
  assert.equal(templateImageFileError(image), '');
  assert.equal(templateImageFileError(new Blob(['x'], { type: 'image/svg+xml' })), 'format');
  assert.equal(templateImageFileError(new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/png' })), 'size');
  assert.equal(writeTemplateMediaHandoff({}, { templateId: '../bad', modelId: 'kling-3.0-i2v', image }, NOW), false);
});
