import test from 'node:test';
import assert from 'node:assert/strict';
import { crunTemplateCostMicrousd, normalizeCrunTemplateCatalog, publicCrunTemplateCatalog, readCrunTemplateCatalog, readCrunTemplateSummary } from '../lib/crunTemplateCatalog.js';

test('normalizes the documented Kling template shape and drops unsafe media URLs', () => {
  const catalog = normalizeCrunTemplateCatalog('kling', {
    code: 200,
    data: { total: 226, templates: [{
      name: ' Critter Paste ', key: 'critter_paste', category: 'Pet', tag: 'NEW', credit: 200.7,
      cover_url: 'javascript:alert(1)', video_url: 'https://s15-kling.klingai.com/demo.mp4',
      info: [{ labels: ['Resolution', 'Recommended Image Types'], values: ['1080p', 'Single animal'] }],
    }] },
  }, 1, 50);
  assert.equal(catalog.total, 226);
  assert.deepEqual(catalog.templates[0], {
    catalogId: 'kling:1:1:critter_paste', providerTemplateId: 'critter_paste',
    id: 'critter_paste', name: 'Critter Paste', category: 'Pet', tag: 'NEW', coverUrl: null,
    previewUrl: 'https://s15-kling.klingai.com/demo.mp4', previewKind: 'video', providerCredits: 200.7, credits: 55,
    inputCount: 1, minInputCount: 1, maxInputCount: 1,
    requirements: [{ label: 'Resolution', value: '1080p' }, { label: 'Recommended Image Types', value: 'Single animal' }],
  });
});

test('normalizes Vidu templates, including image previews and bounded input instructions', () => {
  const catalog = normalizeCrunTemplateCatalog('vidu', {
    code: 200,
    data: { total: 120, templates: [{
      template: 'Vintage_Moment_of_Mom', name: 'Vintage Moment of Mom', category_name: 'Festival',
      category_id: 11, resolution: ['1080p'], duration: [0], aspect_ratio: ['9:16'], output_type: 'unspecified',
      cover: 'https://scene.cf.vidu.studio/cover.png', video: 'https://scene.cf.vidu.studio/preview.png',
      credits: 28.799999999999997, person_count: 'Only one person', is_hot: true, is_new: false,
      input_instruction: JSON.stringify({ image_count: 'Only one image', image_url: ['https://scene.cf.vidu.studio/example.png'], prompt_instruction: 'No prompt required' }),
    }] },
  }, 1, 50);
  assert.equal(catalog.total, 120);
  assert.deepEqual(catalog.templates[0], {
    catalogId: 'vidu:1:1:Vintage_Moment_of_Mom', providerTemplateId: 'Vintage_Moment_of_Mom',
    id: 'Vintage_Moment_of_Mom', name: 'Vintage Moment of Mom', category: 'Festival', tag: 'HOT',
    coverUrl: 'https://scene.cf.vidu.studio/cover.png', previewUrl: 'https://scene.cf.vidu.studio/preview.png', previewKind: 'image',
    providerCredits: 28.8, credits: 8, inputCount: 1, minInputCount: 1, maxInputCount: 1, inputRequirement: 'Only one person', requirements: [
      { label: 'Resolution', value: '1080p' },
      { label: 'Aspect ratio', value: '9:16' },
      { label: 'Output type', value: 'unspecified' },
      { label: 'image count', value: 'Only one image' },
      { label: 'image url', value: 'https://scene.cf.vidu.studio/example.png' },
      { label: 'prompt instruction', value: 'No prompt required' },
    ],
  });
});

test('normalizes ByteDance templates and identifies Seedance 2 entries', () => {
  const catalog = normalizeCrunTemplateCatalog('seedance', {
    code: 200,
    data: { total: 280, templates: [{
      TemplateId: '104909826', Title: '战斗游戏', Title_en: 'Battle Game', TemplateType: 'BEGIN_END_FRAME',
      InputRequirement: 'SINGLE_PERSON', InputNum: 1, Duration: 10123, Tags_en: ['🔥Seedance2.0 Model'],
      Cover: 'https://muse.console.volcengine.com/cover.jpeg', PreviewVideo: 'https://muse.console.volcengine.com/preview.mp4',
      ConsumeItems: [{ Resolution: '480p', Credit: 166.5 }, { Resolution: '720p', Credit: 355.2 }],
      CoverAspectRatio: '9:16', SupportAspectRatio: '9:16,1:1,16:9',
    }] },
  }, 2, 50);
  assert.equal(catalog.templates[0].seedance2, true);
  assert.equal(catalog.templates[0].inputCount, 1);
  assert.equal(catalog.templates[0].minInputCount, 1);
  assert.deepEqual(catalog.templates[0].supportedAspects, ['9:16', '1:1', '16:9']);
  assert.deepEqual(catalog.templates[0].prices, [
    { resolution: '480p', providerCredits: 166.5, credits: 46 },
    { resolution: '720p', providerCredits: 355.2, credits: 97 },
  ]);
});

test('customer prices round supplier cost up to the standing margin floor', () => {
  const kling = normalizeCrunTemplateCatalog('kling', { code: 200, data: { total: 1, templates: [{ key: 'x', name: 'X', credit: 376.32, info: [] }] } }, 1, 50);
  const vidu = normalizeCrunTemplateCatalog('vidu', { code: 200, data: { total: 1, templates: [{ template: 'free', name: 'Free upstream', credits: 0 }] } }, 1, 50);
  assert.equal(kling.templates[0].credits, 102);
  assert.equal(vidu.templates[0].credits, null, 'a zero price is treated as missing rather than guessed');
});

test('catalogue prices fail closed for blank, boolean, null and non-finite values', () => {
  for (const credit of ['', '   ', false, null, 0, '0', '0x10', '1e3', Number.POSITIVE_INFINITY]) {
    const catalog = normalizeCrunTemplateCatalog('kling', {
      code: 200, data: { total: 1, templates: [{ key: 'x', name: 'X', credit, info: [] }] },
    }, 1, 50);
    assert.equal(catalog.templates[0].providerCredits, null);
    assert.equal(catalog.templates[0].credits, null);
    assert.equal(crunTemplateCostMicrousd(credit), null);
  }
  assert.equal(crunTemplateCostMicrousd(256.47), 1_245_000);
});

test('the public catalogue exposes only Veyrnox prices', () => {
  const catalog = normalizeCrunTemplateCatalog('seedance', { code: 200, data: { total: 1, templates: [{ TemplateId: 'x', Title: 'X', ConsumeItems: [{ Resolution: '720p', Credit: 31.5 }] }] } }, 1, 50);
  const projected = publicCrunTemplateCatalog(catalog);
  assert.equal(projected.templates[0].providerCredits, undefined);
  assert.equal(projected.templates[0].prices[0].providerCredits, undefined);
  assert.equal(projected.templates[0].prices[0].credits, catalog.templates[0].prices[0].credits);
});

test('catalogue input metadata covers the full zero-to-five-image Vidu contract', () => {
  const kling = normalizeCrunTemplateCatalog('kling', { code: 200, data: { total: 1, templates: [{ key: 'pair', name: 'Pair', credit: 10, info: [{ labels: ['Recommended Image Types'], values: ['Two single-person photos'] }] }] } }, 1, 50);
  const vidu = instruction => normalizeCrunTemplateCatalog('vidu', { code: 200, data: { total: 1, templates: [{ template: 'effect', name: 'Effect', credits: 10, input_instruction: JSON.stringify({ image_count: instruction }) }] } }, 1, 50).templates[0];
  assert.deepEqual([kling.templates[0].minInputCount, kling.templates[0].maxInputCount], [2, 2]);
  for (const [instruction, expected] of [
    ['No need to upload pictures.', [0, 0]],
    ['Only 1 to 2 images can be uploaded', [1, 2]],
    ['Two character images and one scene image need to be uploaded', [3, 3]],
    ['Required, supports uploading 2-3 images', [2, 3]],
    ['Supports uploading 1 to 5 images', [1, 5]],
    ['A maximum of five images can be uploaded, among which the first two are mandatory.', [2, 5]],
  ]) assert.deepEqual([vidu(instruction).minInputCount, vidu(instruction).maxInputCount], expected, instruction);
});

test('Seedance catalogue metadata preserves an eight-image template contract', () => {
  const catalog = normalizeCrunTemplateCatalog('seedance', {
    code: 200, data: { total: 1, templates: [{
      TemplateId: 'eight', Title_en: 'Eight people', InputNum: 8,
      ConsumeItems: [{ Resolution: '720p', Credit: 256.47 }],
    }] },
  }, 1, 50);
  assert.deepEqual([catalog.templates[0].minInputCount, catalog.templates[0].maxInputCount], [8, 8]);
  assert.equal(catalog.templates[0].prices[0].credits, 70);
});

test('catalog requests keep the API key server-side and forward only bounded query fields', async () => {
  let request;
  const result = await readCrunTemplateCatalog({ provider: 'kling', page: 3, pageSize: 25, language: 'en' }, {
    apiKey: 'secret-key',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({ code: 200, data: { total: 0, templates: [] } }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.match(request.url, /page=3/);
  assert.match(request.url, /page_size=25/);
  assert.match(request.url, /language=en/);
  assert.equal(request.options.headers['x-api-key'], 'secret-key');
  assert.doesNotMatch(JSON.stringify(result), /secret-key/);
});

test('Vidu catalog requests use the official endpoint without an unsupported language query', async () => {
  let requestUrl = '';
  const result = await readCrunTemplateCatalog({ provider: 'vidu', page: 1, pageSize: 50, language: 'en' }, {
    apiKey: 'secret-key',
    fetchImpl: async url => {
      requestUrl = String(url);
      return new Response(JSON.stringify({ code: 200, data: { total: 0, templates: [] } }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.match(requestUrl, /\/api\/v1\/client\/job\/vidu-templates/);
  assert.doesNotMatch(requestUrl, /language=/);
});

test('catalog fails closed for an unknown provider, missing key or invalid pagination', async () => {
  assert.deepEqual(await readCrunTemplateCatalog({ provider: 'veo' }, { apiKey: 'x' }), { ok: false, error: 'provider_invalid', status: 400 });
  assert.deepEqual(await readCrunTemplateCatalog({ provider: 'kling' }, { apiKey: '' }), { ok: false, error: 'not_configured', status: 503 });
  assert.deepEqual(await readCrunTemplateCatalog({ provider: 'kling', page: 0 }, { apiKey: 'x' }), { ok: false, error: 'query_invalid', status: 400 });
});

test('summary totals every CRUN template provider without returning template payloads', async () => {
  const totals = { kling: 226, seedance: 341, vidu: 521 };
  const result = await readCrunTemplateSummary({
    apiKey: 'secret-key',
    fetchImpl: async url => {
      const provider = String(url).includes('kling-templates') ? 'kling' : String(url).includes('bytedance-templates') ? 'seedance' : 'vidu';
      return new Response(JSON.stringify({ code: 200, data: { total: totals[provider], templates: [] } }), { status: 200 });
    },
  });
  assert.deepEqual(result, { ok: true, summary: { total: 1088, providers: totals } });
});
