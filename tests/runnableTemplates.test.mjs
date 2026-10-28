import test from 'node:test';
import assert from 'node:assert/strict';
import { runnableTemplates } from '../app/veyrnox/_lib/runnableTemplates.js';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { modelIdForName } from '../app/veyrnox/_lib/tokens.js';

const sample = PRESETS.filter((p) => modelIdForName(p.model)).slice(0, 40);
const ids = [...new Set(sample.map((p) => modelIdForName(p.model)))];

test('only templates whose model the studio offers are listed', () => {
  const offered = [{ id: ids[0], kind: 'image' }];
  const rows = runnableTemplates(sample, offered, 'all');
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => modelIdForName(row.preset.model) === ids[0]));
  assert.deepEqual(runnableTemplates(sample, [], 'all'), []);
});

test('the current goal kind comes first, nothing is dropped', () => {
  const models = ids.map((id, i) => ({ id, kind: i % 2 ? 'video' : 'image' }));
  const all = runnableTemplates(sample, models, 'all');
  const video = runnableTemplates(sample, models, 'video');
  assert.equal(video.length, all.length);
  const firstImage = video.findIndex((row) => row.model.kind === 'image');
  assert.ok(firstImage === -1 || video.slice(firstImage).every((row) => row.model.kind === 'image'));
});
