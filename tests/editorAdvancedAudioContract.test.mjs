import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { advancedAudioMixClips } from '../app/veyrnox/_lib/editorAdvancedAudioContract.mjs';
import { peakNormalizeChannels } from '../app/veyrnox/_lib/editorAudioOutput.mjs';
import { AUDIO_EFFECT_DEFAULTS } from '../app/veyrnox/_lib/editorAudioEffects.mjs';
import { AUDIO_DEFAULTS } from '../app/veyrnox/_lib/editorAudioSettings.mjs';

const timeline = (clip, fps = 30) => ({
    schemaVersion: 3, fps, media: { source: { id: 'source', kind: 'video', frames: 600, hasAudio: true } },
    tracks: [{ id: 'video-0', kind: 'video', locked: false, muted: false, hidden: false }],
    video: [{ id: 'v1', mediaId: 'source', trackId: 'video-0', start: 15, in: 300, len: 60,
        volume: .75, transition: 0, ...clip }], audio: [], text: [],
});

test('advanced native audio transport preserves canonical frame-domain settings and exact defaults', () => {
    const speedCurve = [{ frame: 0, rate: .5 }, { frame: 60, rate: 2 }];
    const audioProcessing = { ...AUDIO_DEFAULTS, pitch: 4, noiseReduction: .3, noiseStart: 1 };
    const audioEffects = { ...AUDIO_EFFECT_DEFAULTS, width: 1.4, echoMix: .25 };
    const [clip] = advancedAudioMixClips(timeline({ rate: 1.25, reverse: true, preservePitch: true,
        speedCurve, pan: -.4, eq: { low: 2, mid: -1, high: 3 }, audioProcessing, audioEffects }));
    assert.deepEqual(clip, { mediaId: 'source', start: 15, in: 300, len: 60, transitionOut: 0,
        volume: .75, fadeIn: 0, fadeOut: 0, rate: 1.25, reverse: true, preservePitch: true,
        speedCurve, audioProcessing, audioEffects, pan: -.4, eq: { low: 2, mid: -1, high: 3 } });
    assert.deepEqual(advancedAudioMixClips(timeline({}))[0].audioProcessing, AUDIO_DEFAULTS);
    assert.deepEqual(advancedAudioMixClips(timeline({}))[0].audioEffects, AUDIO_EFFECT_DEFAULTS);
});

test('advanced native audio transport follows audible tracks and retains the canonical transition tail', () => {
    const base = timeline({ transition: 0 });
    base.video.push({ ...base.video[0], id: 'v2', start: 75, in: 0, len: 60, transition: 30 });
    assert.equal(advancedAudioMixClips(base)[0].transitionOut, 30);
    assert.equal(advancedAudioMixClips({ ...base, tracks: [{ ...base.tracks[0], muted: true }] }).length, 0);
    assert.equal(advancedAudioMixClips(timeline({ freezeFrame: 2 })).length, 0);
});

test('24fps and 60fps fixtures stay frame-domain until the native project-fps boundary', () => {
    for (const fps of [24, 60]) {
        const [clip] = advancedAudioMixClips(timeline({
            start: fps, in: fps * 3, len: fps * 2, fadeIn: fps / 2, fadeOut: fps / 4,
            speedCurve: [{ frame: 0, rate: .5 }, { frame: fps, rate: 2 }],
        }, fps));
        assert.deepEqual({ start: clip.start, in: clip.in, len: clip.len, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut },
            { start: fps, in: fps * 3, len: fps * 2, fadeIn: fps / 2, fadeOut: fps / 4 });
        assert.deepEqual([clip.start, clip.in, clip.len, clip.fadeIn, clip.fadeOut].map(value => value / fps), [1, 3, 2, .5, .25]);
        assert.deepEqual(clip.speedCurve, [{ frame: 0, rate: .5 }, { frame: fps, rate: 2 }]);
    }
});

test('web output stage matches the shared native peak-normalization fixture', async () => {
    const fixture = JSON.parse(await readFile(new URL('./fixtures/editorAudioOutput.json', import.meta.url), 'utf8'));
    for (const item of fixture.cases) {
        const channels = item.channels.map(samples => Float32Array.from(samples));
        peakNormalizeChannels(channels);
        assert.deepEqual(channels.map(samples => Array.from(samples)), item.expected, item.name);
    }
});
