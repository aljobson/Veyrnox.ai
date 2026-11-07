import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { swapSceneModel } from '../app/veyrnox/_lib/swapSceneForm.js';
import { generationSourceState } from '../lib/generationSourceSlots.mjs';
import { createBatch, sendInOrder } from '../app/veyrnox/_lib/imageBatch.js';
import { capabilityFor, publicCapabilities } from '../lib/modelCapabilities.js';
import { scenes, catalog } from './fixtures/swapScenes.mjs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function load(path, imports = {}) {
  const module = { exports: {} }, code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require','module','exports', code)(id => imports[id] ?? {}, module, module.exports);
  return module.exports;
}
const mobileSources = load('apps/mobile/src/lib/sources.ts', { './i18n': { t: k => k } });
const mobileScenes = load('apps/mobile/src/lib/swapScenes.ts');
// Execute the actual page initializer without adding names to its submit harness.
const initializer = read('app/veyrnox/app/create/page.js').match(/    const run = (.*);/)[1];
const continuationForScene = (previous, identity, count, makeKey, unit, swap) => new Function('continuation', 'formIdentity', 'n', 'makeIdempotencyKey', 'unitCost', 'model', 'createBatch', `return ${initializer}`)({ current: previous }, identity, count, makeKey, unit, { swap }, createBatch);

test('both clients expose photo-only slots, exact scene count, and one catalog unit', () => {
  for (const scene of scenes) {
    const row = catalog.find(r => r.id === scene.swapOffer), caps = publicCapabilities(capabilityFor(row.provider_endpoint));
    const web = swapSceneModel({ id: row.id, credits: 1, media: caps.media, durations: [5,10] }, scene);
    assert.deepEqual(Object.keys(web.media), ['image']); assert.equal(web.media.image.maxFiles, scene.people);
    assert.equal(web.credits, row.credits_5s); assert.deepEqual(web.durations, [5]);
    const sources = { image: Array.from({ length: scene.people }, () => ({ assetId: 'photo' })) };
    assert.equal(generationSourceState(web.media, sources).missingSource, false);
    assert.equal(generationSourceState(web.media, {}).missingSource, true);
    const phone = mobileScenes.swapSceneModel({ id: row.id, capabilities: caps, credits: 1 }, scene);
    const slots = mobileSources.slotsFor(phone, scene);
    assert.deepEqual(slots.map(s => s.slot), ['image']); assert.equal(slots[0].maxFiles, scene.people);
    assert.equal(phone.credits, row.credits_5s);
  }
});
test('web lost-response retry preserves scene request/key; changing scene cannot reuse either', async () => {
  let key = 0; const makeKey = () => `key-${++key}`, identity = {}, sent = [];
  let batch = continuationForScene(null, identity, 1, makeKey, 134, scenes[0].id);
  batch.inputs = { prompt: '' }; batch.sources = { references: [{ slot: 'image', origin: 'asset', asset_id: 'photo' }] };
  const send = async () => { sent.push({ key: batch.keys[0], swap: batch.swap, inputs: batch.inputs, sources: batch.sources }); throw { code: 'network_error' }; };
  await sendInOrder(1, send, batch, makeKey);
  const retry = continuationForScene(batch, identity, 1, makeKey, 134, scenes[0].id);
  assert.equal(retry, batch); await sendInOrder(1, send, retry, makeKey); assert.deepEqual(sent[0], sent[1]);
  const changed = continuationForScene(batch, {}, 1, makeKey, 134, scenes[1].id);
  assert.notEqual(changed.keys[0], batch.keys[0]); assert.equal(changed.swap, scenes[1].id);
  assert.equal(changed.sources, undefined);
});
test('mobile lost-response retry keeps key and snapshot; same model/photo in another scene is new work', async () => {
  const sent = []; let key = 0;
  const submit = load('apps/mobile/src/lib/generationSubmit.ts', {
    './appCache': { getCacheUser: () => 'owner' }, 'expo-crypto': { randomUUID: () => `key-${++key}` },
    './api': { ApiError: class extends Error {} }, './createOptions': { inputsForIndex: inputs => inputs },
    './media': { mediaApi: () => ({ createGeneration: async request => { sent.push(request); throw Error('lost response'); } }) },
  });
  const request = { modelId: 'swap-recast', swap: scenes[0].id, prompt: '', durationSeconds: null, references: [{ slot: 'image', origin: 'asset', asset_id: 'photo' }] };
  const run = submit.createGenerationSubmit();
  await assert.rejects(run.run({}, request)); await assert.rejects(run.run({}, { ...request }));
  assert.deepEqual(sent[0], sent[1]);
  await assert.rejects(run.run({}, { ...request, swap: scenes[1].id }));
  assert.notEqual(sent[2].idempotencyKey, sent[0].idempotencyKey); assert.equal(sent[2].swap, scenes[1].id);
});
test('mobile wire request carries swap and omits a duration for the scene handoff', async () => {
  let wire;
  const { mediaApi } = load('apps/mobile/src/lib/media.ts', {
    './network': { ensureOnline: async () => {} }, './aiConsentStore': { aiConsent: { ensure: async () => {}, hasAgreed: async () => true } },
    './celebrate': { noteLocalSubmission() {} }, './analytics/generations': { noteGenerationSubmitted: async () => {} },
  });
  await mediaApi({ request: async (_path, init) => { wire = JSON.parse(init.body); return { job_id: 'fixture' }; } }).createGeneration({ modelId: 'swap-recast', swap: scenes[0].id, prompt: '', durationSeconds: null, idempotencyKey: 'key', references: [{ slot: 'image', origin: 'asset', asset_id: 'photo' }], sourceRights: true });
  assert.equal(wire.swap, scenes[0].id); assert.equal(wire.inputs.duration_seconds, undefined);
});
test('Create wiring binds route changes, readiness and pending request identity to the scene', () => {
  const web = read('app/veyrnox/app/create/page.js'), phone = read('apps/mobile/src/app/(app)/create/[modelId].tsx');
  assert.match(web, /const formIdentity = useMemo\([^\n]+\[swapId,/);
  assert.match(web, /swap: run.swap/); assert.match(web, /templateImageCount !== swap.scene.people/);
  assert.match(web, /duration_seconds: !model.swap/); assert.match(web, /<SwapSceneEntry onChange=\{setSwap\} accountEpoch=\{accountEpoch\}/);
  assert.match(phone, /\}, \[swap, modelId, prompt, duration, opts, references/);
  assert.match(phone, /swap: swapScene\?\.id/); assert.match(phone, /references.length === swapScene.people/);
  assert.match(phone, /durationSeconds: !swapScene/); assert.match(phone, /signature, request, count: n, unit/);
});
