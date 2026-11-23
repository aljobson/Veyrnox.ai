import test from 'node:test';
import assert from 'node:assert/strict';
import { sunoModelFor, sunoSimpleQuoteRequest, sunoCustomQuoteRequest } from '../app/veyrnox/_components/music/musicSunoForm.js';

const premium = (list) => ({ id: 'ace-step-1.5', provider_contract: 'crun-suno-v1', controls: { suno_model: list } });

test('the Suno model sent follows the projection when a model breaker removed v6', () => {
  assert.equal(sunoModelFor(premium(['v6', 'v6_mini', 'v6_wild'])), 'v6');
  assert.equal(sunoModelFor(premium(['v6_mini', 'v6_wild'])), 'v6_mini');
  assert.equal(sunoModelFor(premium(['v6_mini', 'v6_wild']), 'v6_wild'), 'v6_wild');
  assert.equal(sunoModelFor({ id: 'ace-step', controls: {} }), 'v6', 'no projected list keeps the default');
});

test('simple and custom quote requests never send a model the projection removed', () => {
  const model = premium(['v6_mini']);
  assert.equal(sunoSimpleQuoteRequest({ model, prompt: 'x', instrumental: true }).suno_model, 'v6_mini');
  const controls = { sunoModel: 'v6', instrumental: true, rightsConfirmed: false, durationSeconds: 60, vocalGender: 'auto', styleWeight: 0.5, weirdness: 0.5, variety: 1 };
  assert.equal(sunoCustomQuoteRequest({ model, draft: { id: 'd', revision: 1 }, controls }).suno_model, 'v6_mini');
});
