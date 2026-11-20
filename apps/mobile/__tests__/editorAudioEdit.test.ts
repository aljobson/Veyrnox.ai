import { audioPatch, audioApplyAll, audioSectionsVisible, noiseStartAtPlayhead } from '../src/lib/editorAudioEdit';
import { AUDIO_DEFAULTS } from '../../../app/veyrnox/_lib/editorAudioSettings.mjs';
import { AUDIO_EFFECT_DEFAULTS } from '../../../app/veyrnox/_lib/editorAudioEffects.mjs';
import { updateSequenceClip } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { sourceFrame } from '../../../app/veyrnox/_lib/editorSpeed.mjs';
import { webSequenceV3 } from './fixtures/webSequenceV3';
import type { Clip } from '../src/lib/nativeEditorModel';
const sel = { track: 'video' as const, id: 'v1' };
test.each([
    { eq: { low: -6, mid: 0, high: 3 } }, { audioProcessing: { ...AUDIO_DEFAULTS, voice: 'radio', pitch: 3 } },
    { preservePitch: true }, { audioEffects: { ...AUDIO_EFFECT_DEFAULTS, echoMix: .4 } },
    { audioProcessing: { ...AUDIO_DEFAULTS }, preservePitch: false }, { audioEffects: { ...AUDIO_EFFECT_DEFAULTS } },
])('patch equals web and never mutates input: %j', patch => {
    const tl = webSequenceV3(), before = JSON.stringify(tl);
    const result = audioPatch(tl, sel, patch);
    expect(result).toEqual({ timeline: updateSequenceClip(tl, 'video', 'v1', patch) });
    if ('timeline' in result) expect(validateSequence(result.timeline)).toBeNull();
    expect(JSON.stringify(tl)).toBe(before);
});
test('maps noise, echo, silent source and locked refusals', () => {
    const tl = webSequenceV3();
    expect(audioPatch(tl, sel, { audioProcessing: { ...AUDIO_DEFAULTS, noiseReduction: .5, noiseStart: 30 } })).toEqual({ refused: 'noiseRange' });
    expect(audioPatch(tl, sel, { audioEffects: { ...AUDIO_EFFECT_DEFAULTS, echoDelay: 1, echoRepeats: 8 } })).toEqual({ refused: 'echoTail' });
    const silent = { ...tl, media: { m: { ...tl.media.m, kind: 'image', hasAudio: false } } };
    silent.video = silent.video.map(c => { const copy = { ...c }; delete copy.audioProcessing; delete copy.audioEffects; return copy; });
    expect(audioPatch(silent, sel, { audioEffects: { ...AUDIO_EFFECT_DEFAULTS, echoMix: .4 } })).toEqual({ refused: 'noSound' });
    tl.tracks[0].locked = true;
    expect(audioPatch(tl, sel, { preservePitch: true })).toEqual({ refused: 'locked' });
});
test('apply all copies only voice pitch gate and skips freeze and silent sources', () => {
    const tl = webSequenceV3();
    tl.audio = [{ id: 'a11', mediaId: 'm', trackId: 'audio-0', start: 0, in: 0, len: 60, volume: 1,
        audioProcessing: { ...AUDIO_DEFAULTS, noiseReduction: .2, noiseStart: 2 } }];
    tl.video.push({ id: 'v12', mediaId: 'm', trackId: 'video-0', start: 300, in: 0, len: 10, freezeFrame: 0, volume: 0, transition: 0 });
    tl.media.silent = { id: 'silent', kind: 'image', frames: 90, hasAudio: false, width: 10, height: 10, name: 'Image' };
    tl.video.push({ id: 'v13', mediaId: 'silent', trackId: 'video-0', start: 320, in: 0, len: 10, volume: 1, transition: 0 }); tl.seq = 13;
    const settings = { ...AUDIO_DEFAULTS, voice: 'radio', pitch: 3, gateDb: -30 };
    const before = JSON.stringify(tl), result = audioApplyAll(tl, settings);
    expect('timeline' in result).toBe(true);
    if ('timeline' in result) {
        const apply = (c: Clip) => audioSectionsVisible(c, tl.media[c.mediaId!])
            ? { ...c, audioProcessing: { ...AUDIO_DEFAULTS, ...c.audioProcessing, voice: 'radio', pitch: 3, gateDb: -30 } } : c;
        expect(result.timeline).toEqual({ ...tl, video: tl.video.map(apply), audio: tl.audio.map(apply) });
        expect(validateSequence(result.timeline)).toBeNull();
    }
    expect(JSON.stringify(tl)).toBe(before); tl.tracks[1].locked = true;
    expect(audioApplyAll(tl, settings)).toEqual({ refused: 'lockedAll' });
});
test.each([{ rate: 2 }, { reverse: true }, { speedCurve: [{ frame: 0, rate: .5 }, { frame: 60, rate: 2 }] }])('noise uses web source mapping %j', extra => {
    const tl = webSequenceV3(), clip = { ...tl.video[0], ...extra, start: 30 };
    expect(noiseStartAtPlayhead(clip, tl.media.m, 45)).toBe(Math.floor(sourceFrame(clip, 15) / 30 * 100) / 100);
    expect(noiseStartAtPlayhead(clip, tl.media.m, 29)).toBeNull();
    expect(noiseStartAtPlayhead(clip, tl.media.m, 120)).toBeNull();
});
