import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FEATURED_MODEL_IDS,
  featuredModels,
  modelBadges,
  modelSummary,
  modelTag,
} from '../app/veyrnox/_lib/modelSummaries.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

test('model summaries explain the job in plain language', () => {
  assert.match(modelSummary({ id: 'kling-avatar-v2', kind: 'video' }), /portrait.*audio/i);
  assert.match(modelSummary({ id: 'future-video', kind: 'video' }), /video/i);
  assert.match(modelSummary({ id: 'future-audio', kind: 'audio' }), /audio/i);
});

test('model metadata keeps useful new and input signals', () => {
  assert.equal(modelTag({ id: 'latentsync' }), 'NEW');
  assert.deepEqual(modelBadges({ id: 'latentsync', kind: 'video' }), ['VIDEO + AUDIO', 'LIP SYNC']);
  assert.deepEqual(modelBadges({ id: 'future-video', kind: 'video', durations: [5, 10] }), ['TEXT→VIDEO', '5 / 10S']);
});

test('every fallback model has a concise summary and at least one capability badge', () => {
  for (const model of MODELS) {
    assert.ok(modelSummary(model).length >= 20, model.id);
    assert.ok(modelBadges(model).length > 0, model.id);
  }
});

test('the navigation model menu has a unique, resolvable cross-medium shortlist', () => {
  const featured = featuredModels();
  assert.equal(featured.length, FEATURED_MODEL_IDS.length);
  assert.equal(new Set(featured.map((model) => model.id)).size, featured.length);
  assert.deepEqual(new Set(featured.map((model) => model.kind)), new Set(['video', 'image', 'audio']));
});
