import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_TEMPLATES } from '../app/veyrnox/_lib/imageTemplates.js';
import { templateById, PRESETS } from '../app/veyrnox/_lib/templates.js';
import { templateModelId } from '../app/veyrnox/_lib/tokens.js';
import { templateStartIdFor, templateSelectionMatches } from '../lib/templateStartCheck.js';
import { templateStartId } from '../lib/templateStart.js';
import { checkTemplateRequest } from '../lib/templateFidelity.js';

async function withFlag(value, fn) {
  const previous = process.env.IMAGE_TEMPLATES_ENABLED;
  if (value === undefined) delete process.env.IMAGE_TEMPLATES_ENABLED;
  else process.env.IMAGE_TEMPLATES_ENABLED = value;
  try { await fn(); } finally {
    if (previous === undefined) delete process.env.IMAGE_TEMPLATES_ENABLED;
    else process.env.IMAGE_TEMPLATES_ENABLED = previous;
  }
}

test('image selection keeps matching modality but neither matching nor mismatched runs get attribution', async () => {
  for (const flag of [undefined, 'true']) await withFlag(flag, () => {
    for (const image of IMAGE_TEMPLATES) {
      assert.equal(templateSelectionMatches(image.id, image, image.model), true);
      assert.equal(templateSelectionMatches(image.id, image, 'video-model'), false);
      assert.equal(templateStartIdFor(image.id, image, image.model), null);
      assert.equal(templateStartIdFor(image.id, image, 'video-model'), null);
      assert.equal(templateStartId(image.id, image.model), null);
    }
  });
});

test('stale image template_id has a distinct pre-admission error with the gate off', async () => {
  const image = IMAGE_TEMPLATES[0];
  const request = { template_id: image.id, model_id: image.model, inputs: { prompt: image.prompt, aspect_ratio: image.aspect } };
  await withFlag(undefined, () => {
    assert.equal(templateById(image.id), null);
    assert.equal(templateStartIdFor(image.id, templateById(image.id), image.model), null);
    assert.deepEqual(checkTemplateRequest(request), { ok: false, error: 'image_templates_disabled' });
  });
  await withFlag('true', () => {
    assert.deepEqual(checkTemplateRequest(request), { ok: false, error: 'image_template_unattributed' });
    assert.deepEqual(checkTemplateRequest({ model_id: image.model, inputs: request.inputs }), { ok: true });
  });
});

test('video ranking attribution is unchanged', () => {
  const video = PRESETS.find(template => templateModelId(template));
  assert.equal(templateStartIdFor(video.id, video, templateModelId(video)), video.id);
  assert.equal(templateStartIdFor(video.id, video, 'unrelated-model'), null);
});
