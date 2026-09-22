import test from 'node:test';
import assert from 'node:assert/strict';

import { STEPS, stitchTracks, voiceLengthMs, TOPIC_RE, NARRATION_MAX_CHARS } from '../lib/autoShortSteps.js';
import { capabilityFor, checkInputs, shapePayload } from '../lib/modelCapabilities.js';
import * as kie from '../packages/adapters/kie.js';

test('script and stitch are not sellable catalog endpoints', () => {
    // Only the orchestrator may call them, under the parent job's debit.
    assert.equal(capabilityFor(STEPS.script.endpoint), null);
    assert.equal(capabilityFor(STEPS.stitch.endpoint), null);
});

test('voice pins timestamps on and caps the narration', () => {
    const { record } = STEPS.voice;
    assert.deepEqual(shapePayload(record, { text: 'Hello there.' }), { text: 'Hello there.', timestamps: true });
    assert.equal(checkInputs(record, { text: 'x'.repeat(NARRATION_MAX_CHARS) }).ok, true);
    assert.equal(checkInputs(record, { text: 'x'.repeat(NARRATION_MAX_CHARS + 1) }).ok, false);
    // The sellable ElevenLabs record keeps timestamps off.
    assert.equal(capabilityFor(STEPS.voice.endpoint).fixed.timestamps, false);
});

test('scene is vertical 8s 720p Veo 3.1 Lite on kie', () => {
    const { endpoint, preset } = STEPS.scene;
    const req = kie.buildRequest(kie.parseEndpoint(endpoint), { prompt: 'an octopus', ...preset });
    assert.equal(req.ok, true);
    assert.equal(req.body.model, 'veo3_lite');
    assert.equal(req.body.aspect_ratio, '9:16');
    assert.equal(req.body.duration, 8);
    assert.equal(req.body.resolution, '720p');
});

test('stitch lays four 8s scenes end to end under one voice track', () => {
    const tracks = stitchTracks(['a', 'b', 'c', 'd'], 'v', 25263);
    assert.deepEqual(tracks[0].keyframes.map((k) => [k.timestamp, k.duration, k.url]),
        [[0, 8000, 'a'], [8000, 8000, 'b'], [16000, 8000, 'c'], [24000, 8000, 'd']]);
    assert.deepEqual(tracks[1], { id: 'voice', type: 'audio', keyframes: [{ timestamp: 0, duration: 25263, url: 'v' }] });
    // A voice longer than the video is cut at the video's end.
    assert.equal(stitchTracks(['a', 'b', 'c', 'd'], 'v', 40000)[1].keyframes[0].duration, 32000);
    assert.throws(() => stitchTracks(['a', 'b', 'c'], 'v', 1000));
});

test('voice length comes from the last character end across chunks', () => {
    // Shape observed in slice 0: character alignment, chunked, not words.
    const chunks = [
        { characters: ['O'], character_start_times_seconds: [0], character_end_times_seconds: [9.776] },
        { characters: ['.'], character_start_times_seconds: [25.1], character_end_times_seconds: [25.263] },
    ];
    assert.equal(voiceLengthMs(chunks), 25263);
    assert.equal(voiceLengthMs([]), null);
    assert.equal(voiceLengthMs(null), null);
});

test('topic is 3 to 200 characters of text', () => {
    assert.ok(TOPIC_RE.test('3 facts about octopuses'));
    assert.ok(TOPIC_RE.test('Pourquoi le ciel est-il bleu ?'));
    assert.ok(!TOPIC_RE.test('ab'));
    assert.ok(!TOPIC_RE.test('x'.repeat(201)));
    assert.ok(!TOPIC_RE.test('line\nbreak'));
    assert.ok(!TOPIC_RE.test('<script>'));
});
