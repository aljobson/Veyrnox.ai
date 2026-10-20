import test from 'node:test';
import assert from 'node:assert/strict';
import { modelListText, generationListText, closestModelIds } from '../lib/mcpListings.js';

const models = [
  { id: 'kling-3-pro-i2v', name: 'Kling 3.0 Pro I2V', modality: 'image-to-video', credits: 40, durations: [5, 10],
    capabilities: { inputs: { aspect_ratio: { type: 'enum', values: ['16:9', '9:16'] } }, media: { image: { required: true }, endImage: { required: false }, image_url: {} } } },
  { id: 'flux-pro', name: 'Flux Pro', modality: 'text-to-image', credits: 4, durations: [], capabilities: { inputs: {}, media: {} } },
];

test('list_models text carries every model as JSON after the summary line', () => {
  const [summary, json] = modelListText(models.slice(0, 1), 'image-to-video').split('\n');
  assert.match(summary, /1 Veyrnox models are available for image-to-video/);
  assert.deepEqual(JSON.parse(json), [{
    model_id: 'kling-3-pro-i2v', name: 'Kling 3.0 Pro I2V', modality: 'image-to-video', price_credits: 40,
    price_unit: 'per 5 seconds', aspect_ratios: ['16:9', '9:16'], durations: [5, 10], source_slots: ['image', 'endImage'],
  }]);
});

test('list_generations text carries job rows without minting links', () => {
  const data = { jobs: [{ job_id: 'j1', model_id: 'flux-pro', state: 'succeeded', created_at: '2026-10-19T10:00:00Z', has_asset: true }], next: null };
  const parsed = JSON.parse(generationListText(data, models).split('\n')[1]);
  assert.deepEqual(parsed.generations[0], { job_id: 'j1', model_id: 'flux-pro', status: 'succeeded', created_at: '2026-10-19T10:00:00Z', output_type: 'image', output_url: null, has_output: true });
});

test('a mistyped model id gets the closest valid ids', () => {
  assert.equal(closestModelIds('kling-3.0-pro-i2v', models)[0], 'kling-3-pro-i2v');
});
