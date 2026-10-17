import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  affordableStarterModel,
  CREATE_GOALS,
  modelsForGoal,
  starterModel,
} from '../app/veyrnox/_lib/starterModels.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

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

test('the shipped fallback gives a new creator an image within the 10-credit signup balance', () => {
  const starter = starterModel(MODELS, 'image');
  assert.equal(starter?.kind, 'image');
  assert.ok(starter.credits <= 10, `expected at most 10 credits, received ${starter.credits}`);
});

test('bare Create starts from the cheapest image model while deep links remain authoritative', () => {
  const page = read('app/veyrnox/app/create/page.js');
  assert.match(page, /useState\(\(\) => starterModel\(catalogModels, 'image'\)\?\.id \|\| ''\)/);
  assert.match(page, /const wanted = params\.get\('model'\) \|\| \(preset && modelIdForName\(preset\.model\)\);/);
  assert.match(page, /if \(wanted\) \{[\s\S]*setModelId\(wanted\);[\s\S]*setGoal\('all'\);[\s\S]*\}/);
  assert.doesNotMatch(page, /DEFAULT_MODEL = 'wan-2\.5-kie'/);
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
  assert.match(page, /disabled=\{sending \|\| \(!hasJobs && \(catalogStatus !== 'live' \|\|/);
  assert.match(page, /Live prices are unavailable[\s\S]*generation is paused/);
});

test('Create explains commercial-rights uncertainty and links the Terms', () => {
  const page = read('app/veyrnox/app/create/page.js');
  assert.match(page, /Commercial use depends on the selected model and provider terms/);
  assert.match(page, /<Link href="\/legal\/terms"[\s\S]*>Terms<\/Link>/);
});
