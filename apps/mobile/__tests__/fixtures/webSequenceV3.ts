import { emptySequence } from '../../../../app/veyrnox/_lib/editorSequence.mjs';
import { TEXT_DEFAULTS } from '../../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { MASK_DEFAULTS, maskKeyframe } from '../../../../app/veyrnox/_lib/editorMask.mjs';
import { AUDIO_DEFAULTS } from '../../../../app/veyrnox/_lib/editorAudioSettings.mjs';
import { AUDIO_EFFECT_DEFAULTS } from '../../../../app/veyrnox/_lib/editorAudioEffects.mjs';
import { TRANSFORM_DEFAULTS, motionPreset, parameterKeyframe } from '../../../../app/veyrnox/_lib/editorAnimation.mjs';
import { WORD_STYLE } from '../../../../app/veyrnox/_lib/editorWords.mjs';
import { TEXT_EXTRAS } from '../../../../app/veyrnox/_lib/editorTextStyle.mjs';
import { SMART_PICTURE } from '../../../../app/veyrnox/_lib/editorSmartPicture.mjs';
import { colourDefaults } from '../../../../app/veyrnox/_lib/editorColour.mjs';
import type { Timeline } from '../../src/lib/nativeEditorModel';

export function webSequenceV3(): Timeline {
    const clip = { id: 'v1', mediaId: 'm', start: 0, in: 100, len: 90, volume: 1, transition: 0, trackId: 'video-0' };
    const animation = { in: 'fade', out: 'none', duration: 15, combo: 'float', period: 60, amount: .5, offset: 0, span: 90 };
    const sha = 'a'.repeat(64);
    return {
        ...emptySequence(), seq: 10,
        media: { m: { id: 'm', kind: 'video', frames: 900, name: 'Source', hasAudio: true, width: 640, height: 360 } },
        video: [{ ...clip, mask: 'circle', maskSettings: { ...MASK_DEFAULTS, feather: .1 },
            maskKeyframes: [maskKeyframe(clip, 0), maskKeyframe(clip, 89)],
            smartPicture: { ...SMART_PICTURE, denoise: .5 }, colourAdjustment: { ...colourDefaults(), exposure: .5 },
            transform: { ...TRANSFORM_DEFAULTS }, keyframes: motionPreset(clip, 'arc'),
            parameterKeyframes: [parameterKeyframe(clip, 0), parameterKeyframe(clip, 89)], animation,
            eq: { low: 1, mid: 2, high: -1 }, audioProcessing: { ...AUDIO_DEFAULTS }, audioEffects: { ...AUDIO_EFFECT_DEFAULTS },
            blend: 'multiply', crop: { x: .1, y: .1, width: .8, height: .8 }, fadeIn: 60, fadeOut: 60 },
            { ...clip, id: 'v2', start: 150, trackId: 'video-1' }],
        text: [{ id: 't3', text: 'Hello world', caption: true, start: 0, len: 90, trackId: 'text-0', x: .5, y: .85, size: 6,
            style: { ...TEXT_DEFAULTS, ...TEXT_EXTRAS }, wordStyle: { ...WORD_STYLE },
            words: [{ text: 'Hello', start: 0, len: 45 }, { text: 'world', start: 45, len: 45 }],
            keyframes: motionPreset(clip, 'arc'), animation }],
        tracks: [...emptySequence().tracks, { id: 'video-1', kind: 'video', name: 'Video 2', locked: false, muted: false, hidden: false, solo: true }],
        markers: [{ id: 'm10', frame: 50, label: 'Beat', color: '#ffffff' }],
        fonts: [{ family: `VXFont_${sha}`, name: 'Test', sourceName: 'test.ttf', sha256: sha, bytes: 100, format: 'ttf',
            rights: { credit: 'Author', usage: 'Test permission', url: '' } }],
    } as unknown as Timeline;
}
export const envelope = (timeline: unknown) => ({ schema_version: 3 as const, project_id: '11111111-1111-4111-8111-111111111111',
    brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 }, timeline });
