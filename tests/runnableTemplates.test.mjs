import test from 'node:test';
import assert from 'node:assert/strict';
import { runnableTemplates } from '../app/veyrnox/_lib/runnableTemplates.js';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { templateModelId } from '../app/veyrnox/_lib/tokens.js';

const sample = PRESETS.filter((p) => templateModelId(p)).slice(0, 40);
const ids = [...new Set(sample.map((p) => templateModelId(p)))];

test('only templates whose model the studio offers are listed', () => {
  const offered = [{ id: ids[0], kind: 'image' }];
  const rows = runnableTemplates(sample, offered, 'all');
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => templateModelId(row.preset) === ids[0]));
  assert.deepEqual(runnableTemplates(sample, [], 'all'), []);
});

test('only templates of the current goal kind are listed', () => {
  const models = ids.map((id, i) => ({ id, kind: i % 2 ? 'video' : 'image' }));
  const all = runnableTemplates(sample, models, 'all');
  for (const kind of ['image', 'video']) {
    const rows = runnableTemplates(sample, models, kind);
    assert.ok(rows.every((row) => row.model.kind === kind));
    assert.equal(rows.length, all.filter((row) => row.model.kind === kind).length);
  }
  assert.deepEqual(runnableTemplates(sample, models, 'audio'), []);
});

test('switching to a template keeps files only where the new model has room for them', async () => {
  const { sourcesForModel } = await import('../lib/generationSourceSlots.mjs');
  const a = { file: 'a' }, b = { file: 'b' }, c = { file: 'c' }, v = { file: 'v' };
  const { sources, dropped } = sourcesForModel({ image: [a, b, c], video: v }, { image: { maxFiles: 1 } });
  assert.deepEqual(sources, { image: a });
  assert.deepEqual(dropped, [b, c, v]);
  assert.deepEqual(sourcesForModel({ image: [a, b] }, { image: { maxFiles: 3 } }).sources, { image: [a, b] });
  assert.deepEqual(sourcesForModel({}, { image: {} }), { sources: {}, dropped: [] });
});
