import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelPriceUnit, creditLabel, generationCostLabel } from '../app/veyrnox/_lib/modelPricing.js';
import { findModel, modelFacts, shelfModels } from '../app/veyrnox/_lib/modelPages.js';
import { toPublicModels } from '../lib/publicCatalog.js';
import { REGISTRY } from '../lib/modelCapabilities.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

const catalogModel = (endpoint, modality) => shelfModels(toPublicModels([
  { id: 'test', name: 'Test', provider_endpoint: endpoint, modality, credits_5s: 1 },
]))[0];

test('video price units describe the output bought by the base credit price', () => {
  assert.equal(modelPriceUnit(catalogModel('veo:veo3_lite', 'text-to-video')), 'per 8 s clip.');
  assert.equal(modelPriceUnit({ kind: 'video', durations: [5], presentation: { durationByOption: { 5: '6' } } }), 'per 6 s clip.');
  assert.equal(modelPriceUnit({ kind: 'video', durations: [5, 10] }), 'per 5 s clip; 10 s costs double.');
  assert.equal(modelPriceUnit({ kind: 'image' }), 'per image.');
  const sourceDriven = catalogModel('fal-ai/latentsync', 'video-to-video');
  assert.equal(modelPriceUnit(sourceDriven), 'per generation (source up to 40 s).');
  assert.ok(modelFacts(sourceDriven).some((fact) => fact.label === 'Clip lengths' && fact.value === 'Follows source duration (up to 40 s)'));
});

test('public audio facts and price units include adjustable, fixed and text-dependent duration', () => {
  const adjustable = catalogModel('fal-ai/ace-step', 'text-to-audio');
  assert.equal(modelPriceUnit(adjustable), 'per 5–60 s track (60 s default).');
  assert.ok(modelFacts(adjustable).some((fact) => fact.label === 'Output duration' && fact.value === '5–60 s (60 s default)'));
  for (const [endpoint, duration] of [['fal-ai/ace-step-1.5', 60], ['fal-ai/elevenlabs/sound-effects/v2', 10], ['fal-ai/mmaudio-v2/text-to-audio', 8]]) {
    const model = catalogModel(endpoint, 'text-to-audio');
    assert.equal(modelPriceUnit(model), `per ${duration} s clip.`);
    assert.ok(modelFacts(model).some((fact) => fact.label === 'Output duration' && fact.value === `${duration} s`));
  }
  assert.equal(modelPriceUnit(catalogModel('fal-ai/elevenlabs/tts/turbo-v2.5', 'text-to-audio')), 'per generation (up to 1000 characters).');
});

test('audio separation quotes one flat separation for the catalog source limit', async () => {
  const previous = process.env.EDITOR_AUDIO_STEMS_ENABLED;
  try {
    process.env.EDITOR_AUDIO_STEMS_ENABLED = 'true';
    const model = await findModel('demucs-stems', { cfg: { supabaseUrl: 'https://example.test', serviceRoleKey: 'test' },
      selectRows: async () => [{ id: 'demucs-stems', name: 'Demucs', modality: 'audio-to-audio', provider_endpoint: 'fal-ai/demucs', credits_5s: 6 }] });
    assert.equal(modelPriceUnit(model), 'per separation (source up to 120 s).');
  } finally {
    if (previous === undefined) delete process.env.EDITOR_AUDIO_STEMS_ENABLED;
    else process.env.EDITOR_AUDIO_STEMS_ENABLED = previous;
  }
});

test('free generation labels and singular credits read correctly', () => {
  assert.equal(generationCostLabel(0), 'Free');
  assert.equal(generationCostLabel(1), '−1 cr');
  assert.equal(generationCostLabel(4), '−4 cr');
  assert.equal(creditLabel(1), '1 credit');
  assert.equal(creditLabel(2), '2 credits');
});

test('every public capability and bundled model has a usable price unit', () => {
  const publicModels = shelfModels(toPublicModels(Object.entries(REGISTRY).map(([endpoint, record], index) => ({
    id: `model-${index}`, name: `Model ${index}`, provider_endpoint: endpoint,
    modality: record.kind === 'speech' ? 'text-to-audio' : `text-to-${record.kind}`, credits_5s: 1,
  }))));
  assert.ok(publicModels.length > 31);
  for (const model of [...publicModels, ...MODELS.map((row) => ({ ...row, isSpeech: row.speech }))]) {
    assert.match(modelPriceUnit(model), /^per .+\.$/);
    assert.doesNotMatch(modelPriceUnit(model), /undefined|NaN/);
    if (model.kind === 'audio' && model.presentation?.fixedDurationLabel) {
      assert.ok(modelPriceUnit(model).includes(model.presentation.fixedDurationLabel.replace(/s$/, ' s')));
    }
  }
});

test('public prices render model-specific units on shelf, detail and pricing table', () => {
  for (const path of ['_sections/showcase.js', 'models/page.js', 'models/[id]/page.js', 'pricing/page.js']) {
    const source = readFileSync(new URL(`../app/veyrnox/${path}`, import.meta.url), 'utf8');
    assert.match(source, /modelPriceUnit\(/);
    assert.doesNotMatch(source, /per 5 s clip\./);
  }
  const slip = readFileSync(new URL('../app/veyrnox/_components/PriceSlip.js', import.meta.url), 'utf8');
  assert.match(slip, /creditLabel\(cost\)/);
});
