import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_TEMPLATES, createBeatFromTemplate } from '../app/veyrnox/_lib/music/beat/beatTemplates.mjs';
import { BEAT_LIMITS, createBeat, validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
const options = { id: '12345678-1234-4123-8123-123456789012', now: 1, title: 'Template' };
for (const { id: template } of BEAT_TEMPLATES) test(`${template} template is valid, deterministic, within limits and uses only synthesis`, () => {
  const doc = createBeatFromTemplate({ ...options, template });
  assert.equal(validateBeat(doc).ok, true); assert.equal(doc.version, 4);
  assert.deepEqual(doc, createBeatFromTemplate({ ...options, template }));
  assert.equal(doc.createdAt, 1); assert.equal(doc.updatedAt, 1);
  assert.deepEqual(doc.assets, {}); assert.ok(doc.tracks.length <= BEAT_LIMITS.tracks);
  assert.ok(doc.tracks.every(t => ['drums', 'midi'].includes(t.kind)));
  if (template === 'blank') {
    assert.equal(doc.view, 'pattern'); assert.equal(doc.steps, 16); assert.equal(doc.tracks.length, 1);
    assert.equal(doc.tracks[0].regions[0].length, 3840);
    assert.ok(Object.values(doc.patterns).every(p => Object.values(p.rows).every(hits => hits.length === 0)));
    assert.deepEqual(doc.clips, {});
    assert.ok(createBeat(options).patterns.A.rows.kick.length > 0, 'existing factory keeps its groove');
  } else {
    assert.equal(doc.tempo.bpm, { hiphop: 90, lofi: 80, house: 124 }[template]);
    assert.equal(doc.swing, { hiphop: 0.16, lofi: 0.3, house: 0 }[template]);
    if (template === 'house') assert.deepEqual(doc.patterns.A.rows.kick.map(hit => hit[0]), [0, 4, 8, 12]);
    else assert.ok(Object.values(doc.clips).some(clip => clip.notes.length > 0));
  }
});
test('unknown templates refuse without a default substitution', () => assert.throws(() => createBeatFromTemplate({ ...options, template: 'unknown' }), /Unknown/));
