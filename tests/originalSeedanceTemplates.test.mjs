import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { ORIGINAL_SEEDANCE_ORIGIN, ORIGINAL_SEEDANCE_TEMPLATES } from '../app/veyrnox/_lib/originalSeedanceTemplates.js';
import { PRESETS, templateById } from '../app/veyrnox/_lib/templates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { SOURCE_PROMPT_RECORDS, exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { sourcePromptAuditRecord } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { MODELS, presetCredits, templateModelId } from '../app/veyrnox/_lib/tokens.js';
import { templateInputs } from '../app/veyrnox/_lib/templateGenerate.js';
import { templateContract } from '../lib/templateContract.js';
import { checkTemplateRequest } from '../lib/templateFidelity.js';
import { clientContractFor } from '../lib/templateClientContractRuntime.js';
import { templateRouteContract } from '../lib/templateRoute.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { toPublicPresets } from '../lib/publicPresets.js';
import { templateDetail } from '../lib/clientTemplates.js';

const OFFER = 'seedance-2.0-photo-kie';
const offer = MODELS.find(model => model.id === OFFER);
const catalog = [{ ...offer, modality: 'image-to-video' }];
const reference = [{ slot: 'image', origin: 'upload', key: 'photo' }];

test('the eight originals have an exact prompt, their own preview, the offer and its 58-credit price', () => {
  assert.equal(ORIGINAL_SEEDANCE_TEMPLATES.length, 8);
  assert.equal(new Set(ORIGINAL_SEEDANCE_TEMPLATES.map(t => t.clipKey)).size, 8);
  for (const source of ORIGINAL_SEEDANCE_TEMPLATES) {
    const preset = templateById(source.id);
    assert.ok(PRESETS.includes(preset), source.id);
    assert.equal(preset.prompt, source.sourcePrompt, source.id);
    assert.equal(preset.clipKey, source.id);
    for (const path of [SHOWCASE_CLIPS[source.id].video, SHOWCASE_CLIPS[source.id].poster]) {
      assert.ok(path.includes(source.id) && existsSync(new URL(`../public${path}`, import.meta.url)), path);
    }
    assert.equal(templateModelId(preset), OFFER, source.id);
    assert.equal(presetCredits(preset, catalog), 58, source.id);
    const contract = templateContract(preset.id);
    assert.equal(contract.class, 'bound', source.id);
    assert.deepEqual(contract.allowedModels, [OFFER]);
    assert.equal(contract.slotCount, 1);
    assert.equal(contract.sourcePrompt, preset.prompt);
    assert.deepEqual([contract.aspect, contract.duration], ['9:16', 5]);
  }
});

test('originals never claim a community source record', () => {
  for (const { id } of ORIGINAL_SEEDANCE_TEMPLATES) {
    assert.equal(Object.hasOwn(SOURCE_PROMPT_RECORDS, id), false, id);
    assert.equal(exactSourcePromptRecord(id), null, id);
    const audit = sourcePromptAuditRecord(id);
    assert.deepEqual([audit.status, audit.runnable, audit.referenceImageCount, audit.referenceVideoCount], ['exact', true, 1, 0], id);
  }
  for (const row of toPublicPresets(catalog, ORIGINAL_SEEDANCE_TEMPLATES)) {
    assert.equal(row.sourcePromptOrigin, ORIGINAL_SEEDANCE_ORIGIN, row.id);
    assert.equal(row.promptOrigin, ORIGINAL_SEEDANCE_ORIGIN, row.id);
  }
});

test('an unedited web run sends the bound prompt and passes the server contract', () => {
  const model = { ...offer, media: fallbackCapabilitiesFor(OFFER).media };
  for (const source of ORIGINAL_SEEDANCE_TEMPLATES) {
    const preset = templateById(source.id), contract = templateContract(source.id);
    const inputs = templateInputs(preset, model, { prompt: preset.prompt, aspect: '9:16', aspectOptions: ['9:16'], durationSeconds: 5, withPhoto: true });
    assert.equal(inputs.prompt, preset.prompt, 'no extra line is added to the exact prompt');
    const body = { template_id: source.id, model_id: OFFER, references: reference, inputs: { ...inputs, prompt: contract.prompt } };
    assert.equal(checkTemplateRequest(body).ok, true, source.id);
    assert.equal(checkTemplateRequest({ ...body, inputs: { ...body.inputs, prompt: `${contract.prompt} edited` } }).error, 'template_mismatch');
    assert.equal(checkTemplateRequest({ ...body, references: [] }).error, 'template_references_invalid');
  }
});

test('the public feed and detail give a client the same bound contract', () => {
  for (const row of toPublicPresets(catalog, ORIGINAL_SEEDANCE_TEMPLATES)) {
    const full = templateContract(row.id);
    const fromFeed = clientContractFor(row, templateRouteContract(row.id));
    assert.equal(fromFeed.prompt, full.prompt, row.id);
    assert.equal(fromFeed.modelId, OFFER, row.id);
    assert.equal(templateDetail(row.id).fidelity.prompt, full.prompt, row.id);
    assert.equal(templateDetail(row.id).sourcePromptRunnable, true, row.id);
  }
});
