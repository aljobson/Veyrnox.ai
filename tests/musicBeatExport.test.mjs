import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planExport, assembleExport, chunkPlan, CHUNKED_EXPORT, exportFilename } from '../app/veyrnox/_lib/music/beat/beatExport.mjs';
import { createWavWriter } from '../app/veyrnox/_lib/music/beat/beatWav.mjs';
import { exportSize } from '../app/veyrnox/_lib/music/beat/beatSequence.mjs';
import { seededRandom, exportSeed } from '../app/veyrnox/_lib/music/beat/beatSeed.mjs';
import { makeNoise } from '../app/veyrnox/_lib/music/instrumentEngine.js';
import { make } from './musicBeatFixtures.mjs';
import { audioDoc, takeAsset } from './musicBeatAudioFixtures.mjs';
import { midiDoc } from './musicBeatMidiFixtures.mjs';
test('explicit ranges, 48 kHz frames, bit depths and stable distinct stem filenames', () => {
  const doc = make(); doc.tempo.bpm = 120; doc.cycle = { on: true, start: 3840, end: 7680 };
  const all = planExport(doc), cycle = planExport(doc, { range: 'cycle', bitDepth: 24 });
  assert.equal(all.seconds, 8); assert.equal(cycle.seconds, 2); assert.equal(cycle.frames, 168000); assert.equal(cycle.bitDepth, 24);
  doc.tracks.push({ ...structuredClone(doc.tracks[0]), id: 't2', mute: true, regions: [] });
  const stems = planExport(doc, { output: 'stems' }); assert.equal(stems.tracks.length, 2); assert.equal(stems.filenames.length, 1);
  assert.equal(stems.tracks[1].audible, false); assert.equal(exportFilename('☃ / ..', 'Hi?'), 'Beat - Hi.wav');
  doc.cycle.on = false; assert.throws(() => planExport(doc, { range: 'cycle' }), /Turn Cycle on/);
});
test('600 seconds at 48 kHz is allowed; 600.25 is refused', () => {
  const doc = make(); doc.tempo.bpm = 60; doc.tracks[0].regions[0].length = 600 * 960;
  assert.equal(exportSize(doc, 48000, 'song').frames, 601.5 * 48000);
  assert.equal(planExport(doc).frames, 601.5 * 48000);
  doc.tracks[0].regions[0].length += 240;
  assert.throws(() => exportSize(doc, 48000, 'song'), RangeError); assert.throws(() => planExport(doc), RangeError);
});
test('linear fake assembler is byte-identical for repeated, whole and chunked 16/24-bit renders', async () => {
  const doc = make(); doc.tempo.bpm = 120; doc.tracks[0].regions[0].length = 125 * 1920;
  for (const bitDepth of [16, 24]) {
    const plan = planExport(doc, { bitDepth }), chunked = { ...plan, chunks: chunkPlan(doc) };
    const renderer = ({ startSec, endSec }) => {
      const start = Math.round(startSec * 48000), end = Math.round(endSec * 48000);
      return [1, -1].map(sign => Float32Array.from({ length: end - start }, (_, i) => sign * ((start + i) % 48000) / 48000));
    };
    const whole = await assembleExport(plan, renderer, createWavWriter(plan));
    assert.deepEqual(whole, await assembleExport(plan, renderer, createWavWriter(plan)));
    assert.deepEqual(whole, await assembleExport(chunked, renderer, createWavWriter(plan)));
  }
});
test('project noise has a stable seed, different projects differ', () => {
  const doc = make(), mock = { sampleRate: 32, createBuffer: () => { const data = new Float32Array(32); return { getChannelData: () => data }; } };
  const noise = id => makeNoise(mock, 1, seededRandom(exportSeed({ id }))).getChannelData(0);
  assert.deepEqual(noise(doc.id), noise(doc.id)); assert.notDeepEqual(noise(doc.id), noise('other'));
});
test('audio onset never adds preroll; contexts bounded and sample-aligned; long MIDI falls back', () => {
  const audio = audioDoc(takeAsset(300)), chunks = chunkPlan(audio);
  assert.ok(chunks.length >= 5); assert.ok(chunks.every(c => c.contextFrames <= 92 * 48000));
  assert.ok(chunks.every(c => Math.abs(c.originSec * 48000 - Math.round(c.originSec * 48000)) < 1e-8));
  const doc = midiDoc(); doc.clips.c1.lengthTicks = 64 * 3840; doc.clips.c1.notes = [[0, 40 * 1920, 48, 100]];
  doc.tracks[1].regions[0].length = 128 * 1920;
  assert.equal(chunkPlan(doc), null);
  assert.equal(CHUNKED_EXPORT, false, 'the unqualified chunk renderer cannot ship');
});
test('sounding MIDI reconstruction includes release and pool admission at a boundary', () => {
  const doc = midiDoc(); doc.clips.c1.lengthTicks = 64 * 3840; doc.tracks[1].regions[0].length = 120 * 1920;
  doc.clips.c1.notes = [[55 * 1920, 8 * 1920, 48, 100]];
  const chunks = chunkPlan(doc); assert.equal(chunks[1].originSec, 55);
  // 33 voices steal the oldest; it must no longer extend the next context back to 35 s.
  doc.clips.c1.notes = [[35 * 1920, 28 * 1920, 21, 100], ...Array.from({ length: 32 }, (_, i) => [59 * 1920, 3 * 1920, 30 + i, 100])];
  assert.equal(chunkPlan(doc)[1].originSec, 58);
});
test('phone whole-render fallback guards memory before allocating output', () => {
  const doc = audioDoc(takeAsset(600));
  assert.throws(() => planExport(doc, { phone: true }), /too long to export on this phone/);
});
test('export modules do not use nondeterministic clocks or noise; Save shares render assembly', async () => {
  for (const file of ['app/veyrnox/_lib/music/beat/beatMixdown.js', 'app/veyrnox/_lib/music/beat/beatExport.mjs', 'app/veyrnox/_components/music/beat/BeatExportDialog.jsx']) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /Math\.random|Date\.now/);
  }
  const dialog = await readFile('app/veyrnox/_components/music/beat/BeatExportDialog.jsx', 'utf8');
  assert.match(dialog, /const bytes = await render\(16\)/); assert.match(dialog, /plan\.assembleExport/);
  assert.match(dialog, /wavBytes: bytes/);
});
