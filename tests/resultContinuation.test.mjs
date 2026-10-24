import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_FACELESS_REEL_SOUND_PROMPT,
  normalizeVideoSoundContinuation,
  takeVideoSoundContinuation,
  writeVideoSoundContinuation,
} from '../app/veyrnox/_lib/resultContinuation.js';

const NOW = 1_800_000_000_000;
const value = { jobId: '123e4567-e89b-12d3-a456-426614174000', assetUrl: 'https://assets.example/reel.mp4', duration: 5 };

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, next) => values.set(key, String(next)), removeItem: (key) => values.delete(key) };
}

test('video-sound handoffs accept only fresh owned-result descriptors up to eight seconds', () => {
  assert.deepEqual(normalizeVideoSoundContinuation({ ...value, at: NOW }, NOW), { ...value, prompt: DEFAULT_FACELESS_REEL_SOUND_PROMPT, label: 'Faceless reel result' });
  assert.equal(normalizeVideoSoundContinuation({ ...value, duration: 10, at: NOW }, NOW), null);
  assert.equal(normalizeVideoSoundContinuation({ ...value, assetUrl: 'http://assets.example/reel.mp4', at: NOW }, NOW), null);
  assert.equal(normalizeVideoSoundContinuation({ ...value, jobId: '../secret', at: NOW }, NOW), null);
  assert.equal(normalizeVideoSoundContinuation({ ...value, at: NOW - (11 * 60 * 1000) }, NOW), null);
});

test('the generated-sound continuation is consumed once', () => {
  const s = storage();
  assert.equal(writeVideoSoundContinuation(s, value, NOW), true);
  assert.deepEqual(takeVideoSoundContinuation(s, NOW), { ...value, prompt: DEFAULT_FACELESS_REEL_SOUND_PROMPT, label: 'Faceless reel result' });
  assert.equal(takeVideoSoundContinuation(s, NOW), null);
});

test('Create verifies the recipe, result model, duration and renewed consent path', () => {
  const create = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  assert.match(create, /recipeId === 'faceless-reel'/);
  assert.match(create, /job\?\.model_id === 'wan-2\.5-kie'/);
  assert.match(create, /Number\(job\.duration_seconds\) <= 8/);
  assert.match(create, /writeVideoSoundContinuation\(window\.sessionStorage/);
  assert.match(create, /model=mmaudio-v2-video&continue=faceless-sound/);
  assert.match(create, /takeVideoSoundContinuation\(window\.sessionStorage\)/);
  assert.match(create, /assetId: videoSoundDraft\.jobId/);
  assert.match(create, /setConsent\(false\)/);
  assert.match(DEFAULT_FACELESS_REEL_SOUND_PROMPT, /No speech, narration, music/);
});
