import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanJourney, journeyStep, MOTION_DRAFT } from '../lib/veyJourney.js';
import { HELP_TARGETS } from '../lib/productHelp.js';

const task = (patch = {}) => ({ owner: 'a', phase: 'image', passportId: 'saved-max', reviewed: {}, ...patch });
const view = (patch = {}) => ({ route: '/app/create', handedOff: true, kind: 'image', characterOn: true,
  promptReady: true, promptStamp: 'p', settingsStamp: 's', costStamp: 'c', cost: 2, balance: 76, canGenerate: true, ...patch });
test('saved passport must be loaded explicitly, then handed off to Create', () => {
  assert.equal(journeyStep(task(), { route: '/app/oddlings' }).key, 'load');
  assert.equal(journeyStep(task(), { route: '/app/oddlings', loadedId: 'other' }).key, 'load');
  assert.equal(journeyStep(task(), { route: '/app/oddlings', loadedId: 'saved-max' }).key, 'handoff');
  assert.equal(journeyStep(task(), view({ handedOff: false })).key, 'passport');
  assert.equal(journeyStep(task({ handedOff: true }), view({ handedOff: false })).key, 'prompt');
});
test('image walkthrough follows actual prerequisites and invalidates reviews when inputs change', () => {
  assert.equal(journeyStep(task(), view({ kind: 'video' })).key, 'model');
  assert.equal(journeyStep(task(), view({ characterOn: false })).key, 'character');
  assert.equal(journeyStep(task(), view({ promptReady: false })).review, false);
  const reviewed = { prompt: 'p', settings: 's', cost: 'c' };
  assert.equal(journeyStep(task({ reviewed }), view()).key, 'generate');
  for (const [field, key] of [['promptStamp', 'prompt'], ['settingsStamp', 'settings'], ['costStamp', 'cost']]) {
    assert.equal(journeyStep(task({ reviewed }), view({ [field]: 'changed' })).key, key);
  }
  assert.equal(journeyStep(task({ reviewed }), view({ missingSource: true })).key, 'required');
  assert.equal(journeyStep(task({ reviewed }), view({ missingConsent: true })).key, 'consent');
  assert.equal(journeyStep(task({ reviewed }), view({ canGenerate: false })).key, 'generate');
});
test('exact image identity is required, never substituted by a cast portrait or a different Library image', () => {
  const video = task({ phase: 'video', imageId: 'my-generated-image' });
  assert.equal(journeyStep(video, view()).key, 'model');
  assert.equal(journeyStep(video, view({ kind: 'video', imageRequired: false })).key, 'model');
  assert.equal(journeyStep(video, view({ kind: 'video', imageRequired: true, sourceId: 'another' })).key, 'source');
  assert.equal(journeyStep(video, view({ kind: 'video', imageRequired: true, sourceId: 'my-generated-image' })).key, 'videoPrompt');
  const adopted = journeyStep(task({ phase: 'video' }), view({ kind: 'video', imageRequired: true, sourceId: 'chosen-by-user' }));
  assert.equal(adopted.adopt, true);
  assert.match(MOTION_DRAFT, /exact character/);
});
test('video duration, rights and cost are distinct user-owned steps', () => {
  const video = task({ phase: 'video', imageId: 'img', reviewed: { videoPrompt: 'p', duration: 's', videoCost: 'c' } });
  const ready = view({ kind: 'video', imageRequired: true, sourceId: 'img' });
  assert.equal(journeyStep(video, ready).key, 'generate');
  assert.equal(journeyStep(video, { ...ready, missingConsent: true }).key, 'consent');
  assert.equal(journeyStep(video, { ...ready, settingsStamp: '10seconds' }).key, 'duration');
  assert.equal(journeyStep(video, { ...ready, costStamp: 'newprice' }).key, 'videoCost');
});
test('only the tracked job advances the task; failures never imply retry or success', () => {
  const running = task({ imageJob: 'ours' });
  assert.equal(journeyStep(running, view({ jobs: [{ job_id: 'other', state: 'succeeded' }] })).key, 'recover');
  for (const state of ['queued', 'running']) assert.equal(journeyStep(running, view({ jobs: [{ job_id: 'ours', state }] })).key, 'waiting');
  assert.equal(journeyStep(running, view({ jobs: [{ job_id: 'ours', state: 'failed' }] })).key, 'failed');
  assert.equal(journeyStep(running, view({ jobs: [{ job_id: 'ours', state: 'succeeded' }] })).key, 'imageReady');
  assert.equal(journeyStep(task({ phase: 'video', videoJob: 'clip' }), view({ jobs: [{ job_id: 'clip', state: 'succeeded' }] })).key, 'complete');
});
test('session persistence strips private data, is account-scoped and expires', () => {
  const input = { ...task({ handedOff: true }), updatedAt: Date.now(), prompt: 'secret canon', signedUrl: 'private-url', reviewed: { prompt: '123', secret: 'no' } };
  const clean = cleanJourney(input, 'a');
  assert.equal(clean.handedOff, true);
  assert.equal(clean.prompt, undefined);
  assert.equal(clean.signedUrl, undefined);
  assert.deepEqual(clean.reviewed, { prompt: '123' });
  assert.equal(cleanJourney(input, 'another-account'), null);
  assert.equal(cleanJourney({ ...input, updatedAt: Date.now() - 86400001 }, 'a'), null);
  assert.equal(cleanJourney({ ...input, phase: 'execute' }, 'a'), null);
  assert.equal(cleanJourney({ ...input, imageId: 'https://untrusted' }, 'a').imageId, null);
});
test('all workflow targets are allowlisted and no step can activate spending or consent', () => {
  const scenarios = [journeyStep(task(), view()), journeyStep(task(), { route: '/app/oddlings' }), journeyStep(task({ imageJob: 'a' }), { jobs: [{ job_id: 'a', state: 'failed' }] }), journeyStep(task({ reviewed: { prompt: 'p', settings: 's', cost: 'c' } }), view())];
  for (const step of scenarios) { assert.ok(HELP_TARGETS[step.target]); assert.equal(step.activate, undefined); }
  assert.notEqual(HELP_TARGETS['create.generate'].canActivate, true);
  assert.notEqual(HELP_TARGETS['create.consent'].canActivate, true);
});
