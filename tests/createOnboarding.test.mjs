import { resolveI18nSource } from '../scripts/lib/vey-knowledge-i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptModelAvailable } from '../app/veyrnox/_lib/templateDraft.js';
import { fromApi } from '../app/veyrnox/_lib/useCatalog.js';
import { readFileSync } from 'node:fs';
import {
  affordableStarterModel,
  affordableVideoModel,
  CREATE_GOALS,
  defaultLengthCredits,
  freeCreditLine,
  modelsForGoal,
  starterModel,
} from '../app/veyrnox/_lib/starterModels.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

const read = (path) => resolveI18nSource(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

const models = [
  { id: 'video-cheap', name: 'Video cheap', kind: 'video', credits: 3, media: {}, takesPrompt: true },
  { id: 'image-expensive', name: 'Image expensive', kind: 'image', credits: 8, media: {}, takesPrompt: true },
  { id: 'image-cheap', name: 'Image cheap', kind: 'image', credits: 1, media: {}, takesPrompt: true },
  { id: 'image-upload', name: 'Image upload', kind: 'image', credits: 0, media: { image: { required: true } }, takesPrompt: true },
  { id: 'image-no-prompt', name: 'Image no prompt', kind: 'image', credits: 0, media: {}, takesPrompt: false },
  { id: 'audio-gated', name: 'Audio gated', kind: 'audio', credits: 0, media: {}, takesPrompt: true, gated: true },
  { id: 'audio-open', name: 'Audio open', kind: 'audio', credits: 2, media: {}, takesPrompt: true },
];

test('Create goals cover image, video, audio and the complete catalog', () => {
  assert.deepEqual(CREATE_GOALS.map(({ id }) => id), ['image', 'video', 'audio', 'all']);
  assert.deepEqual(modelsForGoal(models, 'video').map(({ id }) => id), ['video-cheap']);
  assert.equal(modelsForGoal(models, 'all'), models, 'all keeps the original catalog order and identity');
});

test('starter selection chooses the cheapest open prompt-only model without mutating the catalog', () => {
  const before = models.map(({ id }) => id);
  assert.equal(starterModel(models, 'image')?.id, 'image-cheap');
  assert.equal(starterModel(models, 'audio')?.id, 'audio-open');
  assert.equal(starterModel(models, 'all')?.id, 'image-cheap');
  assert.deepEqual(models.map(({ id }) => id), before);
});

test('starter selection refuses gated, upload-dependent and non-prompt models', () => {
  assert.equal(starterModel(models.filter((model) => model.id !== 'image-cheap'), 'image')?.id, 'image-expensive');
  assert.equal(starterModel(models.filter((model) => model.kind === 'audio' && model.gated), 'audio'), null);
});

test('affordable starter keeps a preferred live model only while it fits the welcome balance', () => {
  assert.equal(affordableStarterModel(models, 'image-expensive', 10)?.id, 'image-expensive');
  assert.equal(affordableStarterModel(models, 'image-expensive', 5)?.id, 'image-cheap');
  assert.equal(affordableStarterModel(models.filter((model) => model.kind === 'audio'), 'audio-gated', 10)?.id, 'audio-open');
});

test('the affordable video chip is the cheapest open prompt video the grant pays for at its default length', () => {
  const videos = [
    { id: 'video-cheap', name: 'Video cheap', kind: 'video', credits: 3, media: {}, takesPrompt: true },
    { id: 'video-ten-only', name: 'Video ten only', kind: 'video', credits: 2, durations: [10], media: {}, takesPrompt: true },
    { id: 'video-gated', name: 'Video gated', kind: 'video', credits: 1, media: {}, takesPrompt: true, gated: true },
    { id: 'video-upload', name: 'Video upload', kind: 'video', credits: 1, media: { image: { required: true } }, takesPrompt: true },
    { id: 'video-dear', name: 'Video dear', kind: 'video', credits: 17, durations: [5, 10], media: {}, takesPrompt: true },
    { id: 'image-free', name: 'Image free', kind: 'image', credits: 0, media: {}, takesPrompt: true },
  ];
  assert.equal(defaultLengthCredits(videos[1]), 4, 'a 10 s-only model is priced at 10 s');
  assert.equal(affordableVideoModel(videos, 10)?.id, 'video-cheap');
  assert.equal(affordableVideoModel(videos, 3)?.id, 'video-cheap');
  assert.equal(affordableVideoModel(videos, 2), null, 'no fallback past the grant');
  assert.equal(affordableVideoModel(videos.filter((m) => m.id === 'video-dear'), 10), null);
});

test('the free-credit slip line shows what is left, or how much of the price the grant covers', () => {
  assert.deepEqual(freeCreditLine(3, 10), { fits: true, left: 7 });
  assert.deepEqual(freeCreditLine(10, 10), { fits: true, left: 0 });
  assert.deepEqual(freeCreditLine(17, 10), { fits: false, covered: 10, cost: 17 });
});

test('the shipped fallback gives a new creator an image within the 10-credit signup balance', () => {
  const starter = starterModel(MODELS, 'image');
  assert.equal(starter?.kind, 'image');
  assert.ok(starter.credits <= 10, `expected at most 10 credits, received ${starter.credits}`);
});

test('bare Create starts from the cheapest image model while deep links remain authoritative', () => {
  const page = read('app/veyrnox/app/create/page.js');
  assert.match(page, /useState\(\(\) => starterModel\(catalogModels, 'image'\)\?\.id \|\| ''\)/);
  // A2: a template's route is its effective model (templateModelId), not the legacy catalog label.
  assert.match(page, /const requested = params\.get\('model'\) \|\| \(preset && templateModelId\(preset\)\);/);
  assert.match(page, /const arrival = preset \? templateArrival\(preset, arrivalModels \|\| \[\], params, storedDraft\) : null;/);
  assert.match(page, /const wanted = arrival \? arrival\.modelId : requested;/);
  assert.match(page, /const models = catalogModels\.filter\(\(m\) => createPromptModelAvailable\(m, autoShortOn\)\);/);
  assert.match(page, /if \(wanted\) \{[\s\S]*setModelId\(wanted\);[\s\S]*setGoal\(catalogModels\.find\(\(m\) => m\.id === wanted\)\?\.kind \|\| 'all'\);[\s\S]*\}/);
  assert.doesNotMatch(page, /DEFAULT_MODEL = 'wan-2\.5-kie'/);
  // Exercise the API capability mapping as well as the shared picker rule.
  for (const input of ['clips', 'plan_id', 'topic']) {
      const [model] = fromApi([{ id: input, capabilities: { inputs: { [input]: {} } } }]);
      assert.equal(createPromptModelAvailable(model), false, `${input} is hidden by default`);
      assert.equal(createPromptModelAvailable(model, false), false, `${input} is hidden with the flag off`);
      assert.equal(createPromptModelAvailable(model, true), input === 'topic', 'only topic models can opt in');
  }
  const [ordinary] = fromApi([{ id: 'ordinary', capabilities: { inputs: { prompt: {} } } }]);
  assert.equal(createPromptModelAvailable(ordinary, false), true);
  assert.equal(createPromptModelAvailable(ordinary, true), true);
});

test('goal picker is free, filters the shortlist and selects its cheapest starter', () => {
  const page = read('app/veyrnox/app/create/page.js');
  const picker = read('app/veyrnox/_components/CreateGoalPicker.js');
  assert.match(page, /<CreateGoalPicker goal=\{goal\} onChange=\{pickGoal\} \/>/);
  assert.match(page, /const goalModels = modelsForGoal\(models, goal\);/);
  assert.match(page, /const next = starterModel\(models, nextGoal\);/);
  assert.match(picker, /Free to use/);
  assert.doesNotMatch(page, /chat\?skill=model-picker/);
});

test('catalog quote state is tri-state and stale prices cannot submit', () => {
  const page = read('app/veyrnox/app/create/page.js');
  const submit = page.slice(page.indexOf('async function onSubmit()'), page.indexOf('function cancel()'));
  assert.match(page, /const catalogStatus = catalogLoading \? 'loading' : catalogLive \? 'live' : 'unavailable';/);
  assert.match(submit, /catalogStatus !== 'live'/);
  assert.match(page, /disabled=\{draftRecovery.restoring \|\| draftRecovery.blocked \|\| sending \|\| attachConverting \|\| sourcesConverting \|\| \(!hasJobs && \(catalogStatus !== 'live' \|\|/);
  assert.match(page, /Live prices are unavailable[\s\S]*generation is paused/);
});

test('Create explains commercial-rights uncertainty and links the Terms', () => {
  const page = read('app/veyrnox/app/create/page.js');
  assert.match(page, /Commercial use depends on the selected model and provider terms/);
  assert.match(readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8'), /terms:<LegalLink element="Link" href="\/legal\/terms"/);
  assert.match(page, /Check the Terms before publishing/);
});
