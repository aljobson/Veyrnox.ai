import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTemplateRequest } from '../lib/templateFidelity.js';
import { SEEDANCE_REFERENCE_ACTIVE } from '../app/veyrnox/_lib/seedanceReference.js';

test('the guard follows the reference-model switch', () => {
  // The guard hard-codes the retired state; turning the model back on means removing the guard too.
  assert.equal(SEEDANCE_REFERENCE_ACTIVE, false);
});

// ADR-0309 amendment 2: builds from before 14 Nov still send a template on the reference model with a real-person photo.
const stale = { model_id: 'seedance-2.0-reference', template_id: 'car-blows-up', inputs: { prompt: 'x' } };

test('a template run on the retired reference model is refused before any debit', () => {
  assert.deepEqual(checkTemplateRequest(stale), { ok: false, error: 'template_model_retired' });
  assert.deepEqual(checkTemplateRequest({ model_id: 'seedance-2.0-reference', preset: 'car-blows-up', inputs: { prompt: 'x' } }),
    { ok: false, error: 'template_model_retired' });
});

test('the reference model without a template, and a template on its own model, are not refused here', () => {
  assert.equal(checkTemplateRequest({ model_id: 'seedance-2.0-reference', inputs: { prompt: 'x' } }).error, undefined);
  assert.notEqual(checkTemplateRequest({ ...stale, model_id: 'kling-3.0-i2v' }).error, 'template_model_retired');
});
