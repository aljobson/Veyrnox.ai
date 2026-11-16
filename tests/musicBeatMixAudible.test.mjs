import test from 'node:test';
import assert from 'node:assert/strict';
import { trackContributes } from '../app/veyrnox/_lib/music/beat/beatEvents.mjs';
import { planExport } from '../app/veyrnox/_lib/music/beat/beatExport.mjs';
import { mixdownSources } from '../app/veyrnox/_lib/music/beat/beatMixdownSources.mjs';
import { exportAssetDocument, confirmAssetAvailability, HELD_EXPORT } from '../app/veyrnox/_lib/music/beat/beatAssetAvailability.mjs';
import { audioDoc, takeAsset } from './musicBeatAudioFixtures.mjs';
import { renderSong } from '../app/veyrnox/_lib/music/beat/beatMixdown.js';
import { FakeContext } from './musicBeatMixFixtures.mjs';
test('manual zero plus gain lane contributes to rendering, stems, revalidation and imported-take rights', async t => {
  const doc = audioDoc(takeAsset()); const track = doc.tracks[1]; track.gain = 0; track.automation = { gain: [[0, 0, 0], [960, 0.8, 0]] };
  assert.equal(trackContributes(doc, track.id, 'song'), true); assert.equal(trackContributes(doc, track.id, 'pattern'), false);
  assert.equal(planExport(doc, { output: 'stems' }).tracks[1].audible, true);
  assert.equal(mixdownSources(doc).hasTakes, true); assert.equal(exportAssetDocument(doc).tracks.some(t => t.id === track.id), true);
  const previous = globalThis.window; globalThis.window = { OfflineAudioContext: FakeContext }; t.after(() => { globalThis.window = previous; });
  const assetId = track.regions[0].assetId;
  await renderSong(doc, { buffers: new Map([[assetId, { buffer: {} }]]) });
  const context = FakeContext.instances.at(-1);
  assert.ok(context.nodes.some(n => n.gain.events.some(e => e.type === 'linear' && e.value === 0.8)));
  assert.ok(context.nodes.some(n => n.type === 'source' && n.buffer && n.started));
  await assert.rejects(() => confirmAssetAvailability(exportAssetDocument(doc), { state: () => ({ status: 'held' }) }), { message: HELD_EXPORT });
  track.mute = true; assert.equal(trackContributes(doc, track.id, 'song'), false); assert.equal(mixdownSources(doc).hasTakes, false);
  track.mute = false; doc.tracks[0].solo = true; assert.equal(trackContributes(doc, track.id, 'song'), false);
});
test('audible automated cloud source is freshly signed and a held transition refuses delivery', async () => {
  const asset = { source: 'song', name: 'Song', durationSec: 2, bpm: null, sourceChannels: 2, encodedBytes: 100,
    ref: { songId: 'e40439d1-646a-4c11-9c12-69fa3a851234', versionId: 'e40439d1-646a-4c11-9c12-69fa3a851235', jobId: 'e40439d1-646a-4c11-9c12-69fa3a851236' } };
  const doc = audioDoc(asset); doc.tracks[1].gain = 0; doc.tracks[1].automation = { gain: [[0, 1, 0]] };
  let signed = 0, held = false;
  const options = { state: () => ({ status: held ? 'held' : 'ready' }), markHeld: () => { held = true; },
    request: async () => { signed++; throw Object.assign(new Error('held'), { status: 404, code: 'held' }); } };
  await assert.rejects(() => confirmAssetAvailability(exportAssetDocument(doc), options), { message: HELD_EXPORT });
  assert.equal(signed, 1); assert.equal(held, true); assert.equal(mixdownSources(doc).songs.length, 1);
});
