import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_SOUNDS, validateSound, soundDuration } from '../app/veyrnox/_lib/music/beat/beatSounds.mjs';
import { audioDoc, audioRegion, soundAsset } from './musicBeatAudioFixtures.mjs';
import { setTempo } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { audioSegments } from '../app/veyrnox/_lib/music/beat/beatAudioSegments.mjs';
test('at least twelve valid sounds use known presets, bounded notes and A minor', () => {
  assert.ok(BEAT_SOUNDS.length >= 12); assert.equal(new Set(BEAT_SOUNDS.map((s) => s.id)).size, BEAT_SOUNDS.length);
  for (const sound of BEAT_SOUNDS) { assert.equal(validateSound(sound), true, sound.id); assert.ok(sound.notes.every((n) => [0, 2, 4, 5, 7, 9, 11].includes(n[2] % 12))); }
});
test('sound at bar five remains exact across eight whole loops at three tempos', () => {
  for (const bpm of [60, 123, 240]) {
    const doc = setTempo(audioDoc(soundAsset()), bpm), r = audioRegion(doc); r.start = 4 * 3840; r.length = 8 * 3840;
    const duration = soundDuration('sub-one', bpm), start = 4 * duration;
    const pieces = audioSegments(doc, start, start + 8 * duration);
    assert.equal(pieces.length, 8);
    pieces.forEach((p, i) => { assert.ok(Math.abs(p.songTimeSec - start - i * duration) < 1e-8); assert.ok(Math.abs(p.durationSec - duration) < 1e-8); assert.equal(p.offsetSec, 0); });
  }
});
