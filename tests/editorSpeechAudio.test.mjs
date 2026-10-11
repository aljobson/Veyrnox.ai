import test from 'node:test';
import assert from 'node:assert/strict';
import { resampleSpeechPCM, SPEECH_LIMITS } from '../app/veyrnox/_lib/editorSpeechAudio.mjs';
import { speechResultCaptions } from '../app/veyrnox/_lib/editorSpeechTiming.mjs';
const rms = data => Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
const tone = hz => Float32Array.from({ length: 4800 }, (_, i) => .5 * Math.sin(2 * Math.PI * hz * i / 48000));
test('speech resampling downmixes stereo, preserves duration and suppresses out-of-band aliases', async () => {
    const speech = await resampleSpeechPCM([tone(1000), tone(1000)], 48000), aliased = await resampleSpeechPCM([tone(12000)], 48000);
    assert.equal(speech.length, 1600); assert.ok(rms(speech) > .34 && rms(speech) < .36); assert.ok(rms(aliased.subarray(16, -16)) < .01, '12kHz content must not alias into the 16kHz recognition stream');
    const silence = await resampleSpeechPCM([new Float32Array(480), new Float32Array(480)], 48000); assert.equal(rms(silence), 0); assert.equal(SPEECH_LIMITS.seconds, 120);
});
test('cancellation, invalid samples and oversized audio are refused atomically', async () => {
    const controller = new AbortController();
    await assert.rejects(resampleSpeechPCM([tone(1000)], 48000, { signal: controller.signal, onProgress() { controller.abort(); } }), { name: 'AbortError' });
    const invalid = new Float32Array(480); invalid[200] = NaN;
    await assert.rejects(resampleSpeechPCM([invalid], 48000), /invalid samples/);
    await assert.rejects(resampleSpeechPCM([new Float32Array(120 * 8000 + 1)], 8000), /two minutes/);
});
test('actual timestamps produce source-aligned editable captions rather than estimated word timing', () => {
    const converted = speechResultCaptions({ text: ' Hello world.', chunks: [{ text: ' Hello', timestamp: [0.2, .6] }, { text: ' world.', timestamp: [.6, 1] }] }, 1.2);
    assert.equal(converted.error, undefined); assert.equal(converted.cues[0].start, 6); assert.equal(converted.cues[0].len, 24); assert.equal(converted.cues[0].wordsEstimated, false); assert.deepEqual(converted.cues[0].words, [{ text: 'Hello', start: 0, len: 12 }, { text: 'world.', start: 12, len: 12 }]);
});
test('unreliable speech timings are never filled in or redistributed to manufacture automatic alignment', () => {
    for (const timestamp of [[0, null], [0, 0], [-1, .2], [0, 2], [0, .001]]) assert.ok(speechResultCaptions({ text: 'Test', chunks: [{ text: 'Test', timestamp }] }, 1).error);
    assert.ok(speechResultCaptions({ text: 'A B', chunks: [{ text: 'A', timestamp: [0, .5] }, { text: 'B', timestamp: [.4, .6] }] }, 1).error);
    assert.ok(speechResultCaptions({ text: '', chunks: [] }, 1).error);
});
