import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseEndpoint } from '../packages/adapters/crun.js';
import { loadCrunTemplateGeneration } from '../lib/crunTemplateGeneration.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { effectiveMaxFiles } from '../lib/multiReference.mjs';

const response = payload => new Response(JSON.stringify(payload), { status: 200 });

test('server reloads the named catalogue row and derives the exact customer debit', async () => {
  const selected = await loadCrunTemplateGeneration({ model_id: 'catalog-template', catalog_template: { provider: 'seedance', catalog_id: 'seedance:1:1:42', resolution: '720p' } }, {
    apiKey: 'server-key', fetchImpl: async () => response({ code: 200, data: { total: 1, templates: [{ TemplateId: '42', Title_en: 'Effect', InputNum: 2, ConsumeItems: [{ Resolution: '720p', Credit: 355.2 }] }] } }),
  });
  assert.equal(selected.modelId, 'crun-catalog-seedance-template');
  assert.equal(selected.credits, 97);
  assert.equal(selected.costMicrousd, 1724272);
  assert.deepEqual([selected.minInputs, selected.maxInputs], [2, 2]);
  assert.equal(selected.billing.template_id, '42');
});

test('catalogue generation refuses a client price or stale row identity', async () => {
  const fetchImpl = async () => response({ code: 200, data: { total: 1, templates: [{ key: 'real', name: 'Real', credit: 10 }] } });
  const missing = await loadCrunTemplateGeneration({ model_id: 'catalog-template', catalog_template: { provider: 'kling', catalog_id: 'kling:1:1:other' } }, { apiKey: 'x', fetchImpl });
  assert.deepEqual(missing, { error: 'catalog_template_not_found', status: 404 });
});

test('CRUN adapter emits the three documented template request shapes', () => {
  const images = ['https://example.com/one.png', 'https://example.com/two.png'];
  assert.deepEqual(buildRequest(parseEndpoint('crun:kling/template'), { template_id: 'dance', image_url: images }).body,
    { model: 'kling/template', input: { template_id: 'dance', img_urls: images } });
  assert.deepEqual(buildRequest(parseEndpoint('crun:bytedance/template'), { template_id: '42', image_url: images, resolution: '720p' }).body,
    { model: 'bytedance/template', input: { template_id: '42', img_urls: images, resolution: '720p' } });
  assert.deepEqual(buildRequest(parseEndpoint('crun:vidu/template'), { template_id: 'hug', image_url: images, bgm: false }).body,
    { model: 'vidu/template', input: { template: 'hug', images, bgm: false } });
  assert.deepEqual(buildRequest(parseEndpoint('crun:vidu/template'), { template_id: 'text_only', image_url: [], bgm: false }).body,
    { model: 'vidu/template', input: { template: 'text_only', images: [], bgm: false } });
});

test('server-managed catalogue templates admit two owned images without the public multi-reference flag', () => {
  const capability = capabilityFor('crun:kling/template');
  assert.equal(effectiveMaxFiles(capability.media.image, { MULTI_REFERENCE_ENABLED: 'false' }), 5);
});
