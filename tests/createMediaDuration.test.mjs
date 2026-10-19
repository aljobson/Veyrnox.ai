import { resolveI18nSource } from '../scripts/lib/vey-knowledge-i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  capabilityFor,
  checkInputs,
  lengthsFor,
  publicCapabilities,
  shapePayload,
} from '../lib/modelCapabilities.js';
import { settingsInputs } from '../app/veyrnox/_lib/generationSettings.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';
import { buildRequest, parseEndpoint } from '../packages/adapters/kie.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Veo 3.1 Lite keeps one priced unit while exposing its actual fixed 8-second output', () => {
  const record = capabilityFor('veo:veo3_lite');
  assert.deepEqual(lengthsFor(record), [5]);
  assert.deepEqual(publicCapabilities(record).presentation, {
    resolutionLabel: '720p',
    fixedDurationLabel: '8s',
  });
  assert.deepEqual(checkInputs(record, { prompt: 'a product shot', duration_seconds: 5 }), { ok: true });
  assert.equal(checkInputs(record, { prompt: 'a product shot', duration_seconds: 8 }).error, 'duration_not_supported');

  const request = buildRequest(parseEndpoint('veo:veo3_lite'), {
    prompt: 'a product shot',
    duration_seconds: 5,
  });
  assert.equal(request.ok, true);
  assert.equal(request.body.duration, 8);
  assert.equal(buildRequest(parseEndpoint('veo:veo3_lite'), {
    prompt: 'a product shot',
    duration_seconds: 8,
  }).error, 'duration_not_supported');

  for (const id of ['veo-3.1-kie', 'veo-3.1-fast-kie', 'veo-3.1-lite-kie']) {
    const fallback = MODELS.find((model) => model.id === id);
    assert.deepEqual(fallback.durations, [5], `${id} retains its single internal billing unit`);
    assert.equal(fallback.presentation.fixedDurationLabel, '8s', `${id} cannot flicker a 5s label before the live catalog loads`);
  }
});

test('ACE-Step v1 accepts a bounded duration and defaults safely to its priced 60-second ceiling', () => {
  const record = capabilityFor('fal-ai/ace-step');
  const duration = publicCapabilities(record).inputs.duration;
  assert.deepEqual(duration, { type: 'int', min: 5, max: 60, default: 60 });

  for (const seconds of [5, 8, 60]) {
    assert.deepEqual(checkInputs(record, { prompt: 'instrumental', duration: seconds }), { ok: true });
    assert.equal(shapePayload(record, { prompt: 'instrumental', duration: seconds }).duration, seconds);
  }
  for (const value of [4, 61, 5.5, '8']) {
    assert.equal(checkInputs(record, { prompt: 'instrumental', duration: value }).error, 'inputs_invalid:duration');
  }
  assert.equal(shapePayload(record, { prompt: 'instrumental' }).duration, 60);
});

test('Create sends the selected ACE-Step duration but keeps ACE-Step 1.5 visibly fixed at 60 seconds', () => {
  const adjustable = { durationInput: { type: 'int', min: 5, max: 60, default: 60 } };
  assert.deepEqual(settingsInputs(adjustable, { seed: '', negative: '', duration: '8' }), { duration: 8 });
  assert.deepEqual(settingsInputs(adjustable, { seed: '', negative: '', duration: '' }), { duration: 60 });
  assert.deepEqual(settingsInputs(adjustable, { seed: '', negative: '', duration: '61' }), {});

  const fixed = publicCapabilities(capabilityFor('fal-ai/ace-step-1.5'));
  assert.deepEqual(fixed.presentation, { fixedDurationLabel: '60s' });

  const page = resolveI18nSource(read('app/veyrnox/app/create/page.js'));
  const catalog = read('app/veyrnox/_lib/useCatalog.js');
  const gateway = read('app/api/v1/generations/route.js');
  assert.match(catalog, /durationInput: m\.capabilities\?\.inputs\?\.duration \|\| null/);
  assert.match(page, /id="audio-duration"/);
  assert.match(page, /settingsInputs\(model, \{ seed, negative, voice, duration: audioDuration \}\)/);
  assert.match(page, /fixedDurationLabel/);
  assert.match(gateway, /duration: \{ kind: 'int', min: 5, max: 60 \}/);
});

test('Create and compact Chat label fixed video output duration without multiplying the priced unit', () => {
  const page = resolveI18nSource(read('app/veyrnox/app/create/page.js'));
  const composer = read('app/veyrnox/_components/chat/MediaComposer.js');
  assert.match(page, /model\?\.presentation\?\.fixedDurationLabel/);
  assert.match(page, /FIXED OUTPUT/);
  assert.match(composer, /label=\{actualLength\}/);
  assert.match(composer, /outputDurationLabel\(model, seconds\)/);
});

test('compact Chat offers the same bounded ACE-Step duration and submits it', () => {
  const hook = read('app/veyrnox/_components/chat/useChatMediaGeneration.js');
  const composer = read('app/veyrnox/_components/chat/MediaComposer.js');
  assert.match(hook, /settingsInputs\(model, \{ seed: '', negative: '', voice, duration: audioDuration \}\)/);
  assert.match(hook, /invalidAudioDuration/);
  assert.match(composer, /data-testid="chat-media-audio-duration"/);
  assert.match(composer, /audioDurationControl\.min/);
  assert.match(composer, /audioDurationControl\.max/);
});

test('landing price slip and model facts label provider output durations, not billing-unit placeholders', () => {
  const slip = read('app/veyrnox/_components/PriceSlip.js');
  const pages = read('app/veyrnox/_lib/modelPages.js');
  assert.match(slip, /outputDurationLabel\(model, seconds\)/);
  assert.match(slip, /outputDurationLabel\(model, s\)/);
  assert.match(pages, /outputDurationLabel\(model, s\)/);
});
