import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as media from '../app/veyrnox/_lib/chatMedia.js';
import { readGenerationSources, resolveGenerationSources } from '../lib/generationSources.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const IMAGE = '11111111-1111-4111-8111-111111111111';
const AUDIO = '22222222-2222-4222-8222-222222222222';
const VIDEO = '33333333-3333-4333-8333-333333333333';

test('Chat requires a prompt only for models that accept one, including conservative fallback models', () => {
  for (const model of [{ takesPrompt: false, id: 'latentsync' }, { takesPrompt: false, id: 'demucs-stems' }]) {
    assert.equal(media.mediaPromptIsMissing(model, ''), false);
    assert.equal(media.mediaPromptIsMissing(model, '  '), false);
  }
  for (const model of [{ takesPrompt: true }, {}, null]) {
    assert.equal(media.mediaPromptIsMissing(model, '  '), true);
    assert.equal(media.mediaPromptIsMissing(model, 'a test scene'), false);
  }
});

test('Chat preserves explicit image/audio and video/audio Library source slots', async () => {
  for (const slots of [{ image: IMAGE, audio: AUDIO }, { video: VIDEO, audio: AUDIO }, { audio: AUDIO }]) {
    const model = { media: Object.fromEntries(Object.keys(slots).map((slot) => [slot, { required: true }])) };
    const sources = Object.freeze(Object.fromEntries(Object.entries(slots).map(([slot, assetId]) => [slot, Object.freeze({ assetId })])));
    const result = await media.mediaGenerationSources(model, sources, () => assert.fail('Library selections must not upload'));
    assert.deepEqual(result, { source_keys: [], source_assets: Object.entries(slots).map(([slot, asset_id]) => ({ asset_id, slot })) });
    const references = readGenerationSources(result);
    assert.equal(references.ok, true);
    const resolved = await resolveGenerationSources({ authId: IMAGE, ...references, record: model }, {
      asset: async (_auth, id, _r2, _db, { kind }) => ({ ok: true, field: `${kind}_url`, contentType: kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/wav', url: `https://fixture.invalid/${id}` }),
    });
    assert.equal(resolved.ok, true);
    assert.deepEqual(Object.keys(resolved.inputs), Object.keys(slots).map((slot) => `${slot}_url`));
  }
});

test('Chat preserves end-frame roles and mixed uploaded/Library selections, ignoring undeclared sources', async () => {
  const uploadCalls = [];
  const file = Object.freeze({ name: 'end.png' });
  const result = await media.mediaGenerationSources({ media: { image: {}, endImage: {} } }, {
    image: { assetId: IMAGE }, endImage: { file }, audio: { assetId: AUDIO },
  }, async (value) => { uploadCalls.push(value); return 'uploads/fixture/end.png'; });
  assert.deepEqual(uploadCalls, [file]);
  assert.deepEqual(result, { source_assets: [{ asset_id: IMAGE, slot: 'image' }], source_keys: [{ key: 'uploads/fixture/end.png', slot: 'endImage' }] });
  assert.equal(readGenerationSources(result).ok, true);
  assert.deepEqual(await media.mediaGenerationSources({}, {}, () => assert.fail('no source')), { source_keys: [], source_assets: [] });
});

test('Chat reuses source keys uploaded by a guided feature without uploading the file twice', async () => {
  const key = 'uploads/00000000-0000-4000-8000-000000000000/11111111-1111-4111-8111-111111111111.png';
  const result = await media.mediaGenerationSources({ media: { image: {} } }, {
    image: { sourceKey: key, label: 'portrait.png', mimeType: 'image/png' },
  }, () => assert.fail('a handed-off source key must not upload again'));
  assert.deepEqual(result, { source_assets: [], source_keys: [{ key, slot: 'image' }] });
});

test('Chat upload failure propagates before remaining files are uploaded or requests can be submitted', async () => {
  let uploads = 0;
  await assert.rejects(media.mediaGenerationSources({ media: { image: {}, endImage: {} } }, {
    image: { file: {} }, endImage: { file: {} },
  }, async () => { uploads += 1; throw new Error('fixture upload failure'); }), /fixture upload failure/);
  assert.equal(uploads, 1);
});

test('both Chat UI and submit guard use model-aware prompts and the hook emits typed source assignments', () => {
  const composer = read('app/veyrnox/_components/chat/MediaComposer.js');
  const hook = read('app/veyrnox/_components/chat/useChatMediaGeneration.js');
  assert.match(composer, /const missingPrompt = mediaPromptIsMissing\(model, prompt\)/);
  assert.match(hook, /mediaPromptIsMissing\(model, cleanPrompt\)/);
  assert.match(hook, /model\.takesPrompt !== false \? \{ prompt: cleanPrompt \} : \{\}/);
  assert.match(hook, /await mediaGenerationSources\(model, sources, uploadSource\)/);
  assert.doesNotMatch(hook, /sourceAssets\.push\(sources\[slot\]\.assetId\)/);
});
