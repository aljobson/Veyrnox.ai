import { audioPatch, audioApplyAll, noiseStartAtPlayhead } from '../src/lib/editorAudioEdit';
import { originalAudioMedia } from '../src/lib/editorOriginalAudio';
import { AUDIO_DEFAULTS } from '../../../app/veyrnox/_lib/editorAudioSettings.mjs';
import { AUDIO_EFFECT_DEFAULTS } from '../../../app/veyrnox/_lib/editorAudioEffects.mjs';
import { addSequenceMedia, addSequenceClip, updateSequenceClip } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { timelineOf, framesIn, type Timeline, type Clip } from '../src/lib/nativeEditorModel';
import { insertMediaAt } from '../src/lib/editorInsertMedia';
import { utf8Bytes } from '../src/lib/editorBridge';
import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
const addClip = addSequenceClip as (tl: Timeline, kind: string, id: string, options: Partial<Clip>) => Timeline;
test('audio edits round trip through web schema with unchanged timing and unrelated fields', () => {
    let fixture = webSequenceV3();
    fixture = addClip(addSequenceMedia(fixture, originalAudioMedia('tap-click', 'l-web')), 'audio', 'l-web', { start: 0 }) as Timeline;
    let phone = timelineOf(fixture), web = timelineOf(fixture);
    const verify = () => {
        expect(validateSequence(phone)).toBeNull(); expect(phone).toEqual(web);
        expect(utf8Bytes(JSON.stringify(envelope(phone)))).toBeLessThanOrEqual(32768);
        expect(framesIn(phone)).toBe(framesIn(fixture));
        for (const kind of ['video', 'audio', 'text'] as const) for (const old of fixture[kind]) {
            const next = phone[kind].find(c => c.id === old.id)!;
            expect([next.start, next.len, 'in' in next ? next.in : undefined]).toEqual([old.start, old.len, 'in' in old ? old.in : undefined]);
        }
        expect(phone.text).toEqual(fixture.text);
    };
    const patch = (value: Partial<Clip>) => {
        const result = audioPatch(phone, { track: 'video', id: 'v1' }, value);
        if (!('timeline' in result)) throw Error(result.refused);
        phone = result.timeline; web = updateSequenceClip(web, 'video', 'v1', value) as Timeline; verify();
    };
    patch({ eq: { low: -6, mid: 2, high: -1 } });
    patch({ audioProcessing: { ...AUDIO_DEFAULTS, voice: 'radio', pitch: 3 } });
    patch({ audioProcessing: { ...phone.video[0].audioProcessing!, noiseStart: noiseStartAtPlayhead(phone.video[0], phone.media.m, 30)!, noiseReduction: .5 } });
    patch({ audioEffects: { ...AUDIO_EFFECT_DEFAULTS, echoMix: .4 } }); patch({ preservePitch: true });
    const settings = phone.video[0].audioProcessing!, all = audioApplyAll(phone, settings);
    if (!('timeline' in all)) throw Error(all.refused); phone = all.timeline;
    const apply = (c: Clip) => web.media[c.mediaId!].hasAudio && c.freezeFrame === undefined
        ? { ...c, audioProcessing: { ...AUDIO_DEFAULTS, ...c.audioProcessing, voice: settings.voice, pitch: settings.pitch, gateDb: settings.gateDb } } : c;
    web = { ...web, video: web.video.map(apply), audio: web.audio.map(apply) }; verify();
    const media = originalAudioMedia('soft-keys', 'l-phone'), inserted = insertMediaAt(phone, media, 150);
    if (!('timeline' in inserted)) throw Error(inserted.error);
    phone = inserted.timeline;
    web = addClip(addSequenceMedia(web, media), 'audio', media.id,
        { start: 150, len: 90, trackId: 'audio-0', transition: 0, rate: 1 }) as Timeline; verify();
});
