import test from 'node:test';
import assert from 'node:assert/strict';
import { make, legacy, v2, v3 } from './musicBeatFixtures.mjs';
import { validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { DEFAULT_MASTER, DEFAULT_FX_PARAMS } from '../app/veyrnox/_lib/music/beat/beatMixRules.mjs';
import { parseCloudBeat } from '../app/veyrnox/_lib/music/beat/beatCloudRules.mjs';
function mixed() {
  const doc = make(); doc.master = structuredClone(DEFAULT_MASTER);
  doc.tracks[0].fx = ['eq', 'compressor', 'distortion', 'delay'].map((type, i) => ({ id: `f${i}`, type, bypass: false, params: { ...DEFAULT_FX_PARAMS[type] } }));
  doc.tracks[0].sends = { reverb: 0.2, delay: 0 };
  doc.tracks[0].automation = { gain: [[0, 0, 0], [15360, 1, -0.6]], pan: [[0, -0.5, 0]] }; return doc;
}
test('additive v4 fields survive validation and the actual cloud-load parser; legacy versions retain exact schemas', () => {
  const doc = mixed(); assert.equal(validateBeat(doc).ok, true); assert.deepEqual(parseCloudBeat(JSON.stringify(doc), doc.id), doc);
  for (const factory of [legacy, v2, v3, make]) assert.equal(validateBeat(factory()).ok, true);
  for (const factory of [legacy, v2, v3]) { const old = factory(); old.master = DEFAULT_MASTER; assert.equal(validateBeat(old).ok, false); }
  const old = v3(); old.tracks[0].fx = []; assert.equal(validateBeat(old).ok, false);
  assert.throws(() => parseCloudBeat(JSON.stringify(doc), 'wrong'), /Invalid account/);
});
test('exact effect/send/master/automation keys, finite bounds, point order and presets are validated through validateBeat', () => {
  const changes = [d => d.extra = true, d => d.master.extra = 1, d => d.master.gain = NaN, d => d.master.limiter = 1,
    d => d.master.reverb.size = 1, d => d.master.delay.feedback = 0.81, d => d.master.delay.time = 0.01,
    d => d.tracks[0].fx[0].params.extra = 0, d => delete d.tracks[0].fx[0].params.low, d => d.tracks[0].fx[0].params.low = 13,
    d => d.tracks[0].fx[1].id = 'f0', d => d.tracks[0].fx[0].id = 'bad', d => d.tracks[0].fx[0].bypass = 1, d => d.tracks[0].fx[0].type = ['eq'],
    d => d.tracks[0].sends.extra = 0, d => d.tracks[0].sends.delay = Infinity, d => delete d.tracks[0].sends.reverb,
    d => d.tracks[0].automation.gain = [], d => d.tracks[0].automation.gain[1][0] = 0,
    d => d.tracks[0].automation.gain[0][0] = -60, d => d.tracks[0].automation.pan[0][0] = 1,
    d => d.tracks[0].automation.pan[0][1] = -1.1, d => d.tracks[0].automation.gain[0][2] = 1.1,
    d => d.tracks[0].automation.drive = [[0, 1, 0]], d => d.tracks[0].automation.gain = Array.from({ length: 65 }, (_, i) => [i * 60, 1, 0])];
  for (const change of changes) { const doc = mixed(); change(doc); assert.equal(validateBeat(doc).ok, false, change.toString()); assert.throws(() => parseCloudBeat(JSON.stringify(doc), doc.id)); }
  const doc = mixed(); doc.tracks[0].fx[3] = { id: 'fr', type: 'reverb', bypass: false, params: { size: 4, mix: 1 } }; assert.equal(validateBeat(doc).ok, true);
});
test('maximum mixer document (16 x 4 inserts and 2 x 64 points) fits 256 KiB', () => {
  const doc = mixed();
  doc.tracks = Array.from({ length: 16 }, (_, i) => ({ ...structuredClone(doc.tracks[0]), id: `t${i}`, regions: [], automation:
    Object.fromEntries(['gain', 'pan'].map(lane => [lane, Array.from({ length: 64 }, (_, j) => [j * 30000, 0.1234567890123456, -0.1234567890123456])])) }));
  assert.equal(validateBeat(doc).ok, true); assert.ok(new TextEncoder().encode(JSON.stringify(doc)).length < 256 * 1024);
});

test('empty effect lists and automation objects are rejected; zero sends remain readable but are not a mixer', async () => {
  const { trackHasMix, hasMixer } = await import('../app/veyrnox/_lib/music/beat/beatMixRules.mjs');
  for (const patch of [{ fx: [] }, { automation: {} }]) {
    const doc = make(); Object.assign(doc.tracks[0], patch);
    assert.equal(validateBeat(doc).ok, false);
    assert.equal(trackHasMix(doc.tracks[0]), false); assert.equal(hasMixer(doc), false);
  }
  const doc = make(); doc.tracks[0].sends = { reverb: 0, delay: 0 };
  assert.equal(validateBeat(doc).ok, true); assert.equal(hasMixer(doc), false);
});
