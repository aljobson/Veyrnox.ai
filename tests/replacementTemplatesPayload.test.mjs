import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pageHarness, providerPayload, PHOTO, PHOTO_KEY, PHOTO_URL } from './helpers/replacementPayloadHarness.mjs';
import { HF_REPLACEMENTS_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplateExpansion17.js';
import { SYNTX_REPLACEMENTS_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplateExpansion18.js';
import { SOURCE_PROMPT_RECORDS, exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { templateById } from '../app/veyrnox/_lib/templates.js';
import { templateDetail } from '../lib/clientTemplates.js';
import { templateStartId } from '../lib/templateStart.js';
import { inlineBlockReason } from '../app/veyrnox/_lib/templateGenerate.js';
import { templateContract } from '../lib/templateContract.js';
import { checkTemplateRequest } from '../lib/templateFidelity.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

const json = file => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const hashes = { ...json('./fixtures/higgsfieldReplacementPromptHashes.json'), ...json('./fixtures/syntxReplacementPromptHashes.json') };
const sha = text => createHash('sha256').update(text).digest('hex');
// Independent owner-reviewed table. Do not infer image requirements from prompt tokens.
const photoIds = ['on-the-wave', 'window-explode', 'red-crystal-amulet', 'community-martial-arts-suit', 'community-pet-affection-reveal'];
const textIds = ['community-spin-kick-puppy', 'community-neon-paint-splash', 'community-neon-animal-dance', 'community-island-life-performance', 'community-cinematic-persona-swap', 'community-roadside-service-pitch', 'community-martial-arts-feline', 'community-cosmic-sands-encounter', 'community-luxe-timepiece-reveal'];
const fixtureReferences = [{ slot: 'image', origin: 'upload', key: PHOTO_KEY }];
const photoResults = new Map();
const isBound = id => templateContract(id)?.class === 'bound';
function boundPrompt(id) {
  const c = templateContract(id);
  const source = lockedPrompt(id);
  if (!isBound(id)) return source;
  assert.equal(c.sourceHash, hashes[id]);
  assert.equal(sha(c.prompt), c.boundHash);
  let cursor = 0, text = '';
  for (const m of c.tokenMap) {
    assert.equal(source.slice(m.offset, m.offset + m.token.length), m.token);
    text += source.slice(cursor, m.offset) + m.target;
    cursor = m.offset + m.token.length;
  }
  exactBytes(c.prompt, text + source.slice(cursor));
  return c.prompt;
}
const referenceCost = seconds => MODELS.find(m => m.id === 'seedance-2.0-reference').credits * Math.ceil(seconds / 5);

before(() => mock.method(globalThis, 'fetch', () => { throw new Error('G1 forbids network'); }));
after(() => mock.restoreAll());

function exactBytes(actual, expected) {
  // Compare UTF-8 bytes, including surrounding whitespace and captured CRLF.
  assert.equal(Buffer.compare(Buffer.from(actual), Buffer.from(expected)), 0, 'payload must preserve the locked exact prompt bytes');
}
function lockedPrompt(id) {
  const raw = SOURCE_PROMPT_RECORDS[id].prompt;
  assert.equal(sha(raw), hashes[id]);
  const exact = exactSourcePromptRecord(id).prompt;
  exactBytes(exact, raw); // No replacement prompt needs platform-word stripping.
  return exact;
}
async function runPhoto(id) {
  const page = pageHarness(id, { photo: PHOTO });
  assert.equal(page.hook.canGenerate, true);
  await page.hook.generate();
  assert.equal(page.requests.length, 1);
  const request = page.requests[0];
  const result = await providerPayload(request.model_id, request.inputs, request.references);
  return { page, request, result };
}

test('G1 covers exactly the fourteen imported IDs and their reviewed route tuples', () => {
  const imported = [...HF_REPLACEMENTS_TEMPLATES, ...SYNTX_REPLACEMENTS_TEMPLATES];
  assert.deepEqual(imported.map(t => t.id).sort(), [...photoIds, ...textIds].sort());
  assert.deepEqual(Object.keys(hashes).sort(), imported.map(t => t.id).sort());
  for (const t of imported) {
    const photo = photoIds.includes(t.id);
    assert.deepEqual([t.model, t.credits, t.durationSeconds, t.needsKey], photo
      ? ['Kling 3.0 · I2V', 32, 10, 'community.cinematic'] : ['Seedance 2.0 Fast', 19, 5, null], t.id);
  }
});

for (const id of [...photoIds, ...textIds]) {
  const takesPhoto = photoIds.includes(id);
  test(`G1 withPhoto=false exact provider preparation and UI slot contract: ${id}`, async () => {
    const page = pageHarness(id), prompt = lockedPrompt(id);
    const modelId = isBound(id) ? 'seedance-2.0-reference' : takesPhoto ? 'kling-3.0-i2v' : 'seedance-2.0-fast';
    assert.equal(page.model.id, modelId);
    assert.equal(page.props.model.id, modelId);
    assert.equal(page.props.durationSeconds, takesPhoto ? 10 : 5);
    assert.equal(page.props.unitCost, isBound(id) ? referenceCost(10) : takesPhoto ? 64 : 19);
    assert.equal(page.props.needsPhoto, takesPhoto);
    assert.equal((page.html.match(/type="file"/g) || []).length, takesPhoto ? 1 : 0);
    assert.equal(page.props.photo, null);
    const inputs = page.prepare(false);
    exactBytes(inputs.prompt, prompt);
    // Diagnostic withPhoto=false control uses a resolved fixture image for Kling
    // so its real provider builder can validate. It is NOT an achievable no-photo
    // Kling submission: the real UI and server refusal are asserted below.
    const result = await providerPayload(modelId, inputs, takesPhoto ? fixtureReferences : []);
    assert.deepEqual(result.checked, { ok: true });
    exactBytes(result.payload.prompt, prompt);
    assert.equal(sha(result.payload.prompt), hashes[id]);
    if (takesPhoto) {
      if (isBound(id)) assert.deepEqual(result.payload.image_urls, [PHOTO_URL]);
      else assert.equal(result.payload.start_image_url, PHOTO_URL);
      assert.equal(page.hook.canGenerate, false);
      await page.hook.generate();
      assert.equal(page.requests.length, 0);
      const missing = await providerPayload(modelId, inputs, []);
      assert.deepEqual(missing.checked, { ok: false, error: 'inputs_invalid:image_url' });
      assert.equal(missing.body, undefined);
    } else {
      assert.equal(page.hook.canGenerate, true);
      await page.hook.generate();
      assert.equal(page.requests.length, 1);
      const request = page.requests[0];
      assert.equal(request.model_id, modelId);
      assert.equal(request.preset, id);
      assert.equal(request.max_charge_credits, 19);
      assert.deepEqual(request.references, []);
      assert.equal(request.consent, undefined);
      assert.deepEqual(page.uploads, []);
      const actual = await providerPayload(modelId, request.inputs, request.references);
      assert.deepEqual(actual.body, { model: 'bytedance/seedance2-0-fast-t2v', input: {
        prompt, duration: 5, resolution: '720p', aspect_ratio: page.props.aspect, audio: true,
      } });
      assert.deepEqual(actual.resolved.inputs, {});
      assert.deepEqual(actual.lookedUp, []);
      exactBytes(actual.payload.prompt, prompt);
      // Even stale photo state cannot offer a photo or pass one to Generate.
      const stale = pageHarness(id, { photo: PHOTO });
      assert.doesNotMatch(stale.html, /type="file"/);
      assert.equal(stale.props.photo, null);
      await stale.hook.generate();
      exactBytes(stale.requests[0].inputs.prompt, prompt);
      assert.deepEqual(stale.requests[0].references, []);
      assert.deepEqual(stale.uploads, []);
      const refused = await providerPayload(modelId, inputs, fixtureReferences);
      assert.deepEqual(refused.resolved, { ok: false, error: 'source_slot_invalid' });
      assert.deepEqual(refused.lookedUp, []);
    }
  });
}

for (const id of photoIds) {
  test(`G1 real withPhoto=true: single start-image transport and unchanged exact prompt: ${id}`, async () => {
    const { page, request, result } = await runPhoto(id);
    photoResults.set(id, result);
    const prompt = lockedPrompt(id);
    assert.equal(page.props.photo, PHOTO);
    assert.deepEqual(page.uploads, [PHOTO]);
    assert.equal(page.jobs.length, 1);
    assert.equal(request.model_id, isBound(id) ? 'seedance-2.0-reference' : 'kling-3.0-i2v');
    assert.equal(request.preset, id);
    assert.equal(request.max_charge_credits, isBound(id) ? referenceCost(10) : 64);
    assert.equal(request.consent, true);
    assert.deepEqual(request.references, fixtureReferences);
    exactBytes(request.inputs.prompt, boundPrompt(id));
    assert.deepEqual(result.checked, { ok: true });
    assert.deepEqual(result.lookedUp, [PHOTO_KEY]);
    assert.deepEqual(result.resolved.inputs, { image_url: PHOTO_URL });
    if (isBound(id)) {
      assert.deepEqual(result.body, { prompt: boundPrompt(id), image_urls: [PHOTO_URL], duration: '10', aspect_ratio: page.props.aspect, resolution: '720p', generate_audio: true });
      assert.equal(request.template_id, id);
      assert.equal(checkTemplateRequest(request).ok, true);
    } else {
      assert.deepEqual(result.body, { prompt: prompt, start_image_url: PHOTO_URL, duration: '10', generate_audio: false });
      assert.equal(typeof result.payload.start_image_url, 'string');
    }
    // Exact object equality above prohibits end frames, reference arrays, video,
    // audio sources and all other media fields. No identity/visual claim is made.
    if (isBound(id)) assert.equal(checkTemplateRequest({ ...request, references: [...fixtureReferences, ...fixtureReferences] }).error, 'template_references_invalid');
    const tooMany = await providerPayload(request.model_id, request.inputs, [...fixtureReferences, ...fixtureReferences]);
    assert.deepEqual(tooMany.resolved, { ok: false, error: 'source_count_exceeded' });
    assert.deepEqual(tooMany.lookedUp, []);
  });

  test(`R4 fixed: withPhoto=true preserves exact prompt bytes: ${id}`, async () => {
    const result = photoResults.get(id) || (await runPhoto(id)).result;
    exactBytes(result.payload.prompt, boundPrompt(id));
    assert.equal(sha(result.payload.prompt), isBound(id) ? templateContract(id).boundHash : hashes[id]);
    assert.equal(result.payload.prompt.includes('main character'), false);
  });
}

for (const id of ['community-cyberpunk-rooftop-encounter', 'the-push-2']) {
  test(`G1 deferred template has no public recipe or template-generation entry: ${id}`, () => {
    assert.equal(templateById(id), null);
    assert.equal(templateDetail(id), null);
    assert.equal(SOURCE_PROMPT_RECORDS[id], undefined);
    for (const model of MODELS) {
      assert.equal(templateStartId(id, model.id), null);
      assert.equal(inlineBlockReason(templateById(id), model, { photo: true }), 'unavailable');
    }
    assert.throws(() => pageHarness(id, { photo: PHOTO }), /no public template/);
  });
}
