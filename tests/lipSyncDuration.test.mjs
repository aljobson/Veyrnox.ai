import test from 'node:test';
import assert from 'node:assert/strict';
import { mp4Info } from '../lib/mediaLength.js';
import { capabilityFor, checkSource, shapePayload } from '../lib/modelCapabilities.js';
import { lipSyncMp4 } from './fixtures/lipSyncMp4.mjs';

const info = bytes => mp4Info(async (start, end) => new Uint8Array(bytes.subarray(start, end + 1)), bytes.length);
const latent = capabilityFor('fal-ai/latentsync');
const sources = (videoSeconds, seconds) => ({ video_url: { seconds: 20, videoSeconds }, audio_url: { seconds } });

test('visual coverage is independent of longer movie/audio tracks, while old price-cap seconds stay unchanged', async () => {
  const result = await info(lipSyncMp4({ video: 7.2, movie: 12, audio: 15 }));
  assert.equal(result.videoSeconds, 7.2);
  assert.equal(result.seconds, 15);
  assert.equal((await info(lipSyncMp4({ video: 7.2, movie: 4 }))).videoSeconds, 4);
});

test('visual coverage refuses missing, disabled, multiple or ambiguous tracks without changing legacy length admission', async () => {
  for (const options of [{ handler: 'soun' }, { handler: 'meta' }, { enabled: false }, { duplicateVideo: true }, { duplicateHandler: true }, { composition: true }, { video: 0 }]) {
    const result = await info(lipSyncMp4({ movie: 12, ...options }));
    assert.equal(result?.videoSeconds, null, JSON.stringify(options));
    assert.equal(result?.seconds, 12, 'the existing conservative upper-bound length is unchanged');
  }
});

test('a simple shortened edit constrains visual coverage; nonzero/empty starts and uncertain edits are unknown', async () => {
  assert.equal((await info(lipSyncMp4({ edit: { seconds: 5 } }))).videoSeconds, 5);
  for (const edit of [{ seconds: 5, start: 1 }, { seconds: 5, start: -1 }, { seconds: 7.3 }]) {
    const result = await info(lipSyncMp4({ edit }));
    assert.equal(result?.videoSeconds ?? null, null);
  }
});

test('a constant presentation offset is supported only when its plain edit exactly cancels it', async () => {
  assert.equal((await info(lipSyncMp4({ compositionOffset: 0.2, edit: { seconds: 7.2, start: 0.2 } }))).videoSeconds, 7.2);
  for (const edit of [null, { seconds: 7.2, start: 0 }, { seconds: 7.2, start: 0.3 }]) {
    assert.equal((await info(lipSyncMp4({ compositionOffset: 0.2, edit }))).videoSeconds, null);
  }
});

test('LatentSync refuses speech longer than proven visual coverage and unknown lengths before payment', () => {
  assert.deepEqual(checkSource(latent, sources(7.2, 8.542)), { ok: false, error: 'lipsync_audio_exceeds_video' });
  for (const unknown of [null, undefined, NaN, Infinity, 0, -1]) {
    assert.deepEqual(checkSource(latent, sources(unknown, 5)), { ok: false, error: 'lipsync_video_length_unknown' });
  }
  for (const unknown of [0, -1]) assert.deepEqual(checkSource(latent, sources(7.2, unknown)), { ok: false, error: 'source_length_unknown' });
  for (const seconds of [7.2, 5]) assert.deepEqual(checkSource(latent, sources(7.2, seconds)), { ok: true });
  assert.deepEqual(shapePayload(latent, { video_url: 'https://media.test/video.mp4', audio_url: 'https://media.test/audio.wav' }), { video_url: 'https://media.test/video.mp4', audio_url: 'https://media.test/audio.wav' });
  assert.deepEqual(checkSource(capabilityFor('fal-ai/mmaudio-v2'), { video_url: { seconds: 5, videoSeconds: null } }), { ok: true });
});
