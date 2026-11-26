import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCrunTemplateCatalog, readCrunTemplateCatalog } from '../lib/crunTemplateCatalog.js';

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
    id: 'critter_paste', name: 'Critter Paste', category: 'Pet', tag: 'NEW', coverUrl: null,
    previewUrl: 'https://s15-kling.klingai.com/demo.mp4', providerCredits: 200.7,
    requirements: [{ label: 'Resolution', value: '1080p' }, { label: 'Recommended Image Types', value: 'Single animal' }],
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
  assert.deepEqual(catalog.templates[0].supportedAspects, ['9:16', '1:1', '16:9']);
  assert.deepEqual(catalog.templates[0].prices, [
    { resolution: '480p', providerCredits: 166.5 },
    { resolution: '720p', providerCredits: 355.2 },
  ]);
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

test('catalog fails closed for an unknown provider, missing key or invalid pagination', async () => {
  assert.deepEqual(await readCrunTemplateCatalog({ provider: 'veo' }, { apiKey: 'x' }), { ok: false, error: 'provider_invalid', status: 400 });
  assert.deepEqual(await readCrunTemplateCatalog({ provider: 'kling' }, { apiKey: '' }), { ok: false, error: 'not_configured', status: 503 });
  assert.deepEqual(await readCrunTemplateCatalog({ provider: 'kling', page: 0 }, { apiKey: 'x' }), { ok: false, error: 'query_invalid', status: 400 });
});
