import { adoptedMotionClip, semanticMaskSourceFrame, timelineWithSemanticMask, timelineWithoutSemanticMask } from '../src/lib/editorNativeMediaActions';
import { emptyTimeline, invalidateChangedSemanticMasks, type Clip } from '../src/lib/nativeEditorModel';
import { editorMotionSelectedRange } from '../src/components/editor/tools/useEditorMotionProcessing';
import { editorPersonMaskNeedsRegeneration, editorPersonMaskSourceSupported } from '../src/components/editor/tools/useEditorPersonMask';
import { editorSemanticMaskIdentity, editorSemanticMaskMatches } from '../src/lib/editorSemanticMaskIdentity';

test('motion adoption resets alpha-pre-rendered fields and preserves only timeline relationships', () => {
    const clip: Clip = { id: 'clip', mediaId: 'old', start: 90, in: 45, len: 120, trackId: 'video-0', groupId: 'group',
        volume: .7, fadeIn: 4, fadeOut: 5, transition: 6, rate: 2, reverse: true, preservePitch: true,
        speedCurve: [{ frame: 0, rate: 2 }], freezeFrame: 3, keyframes: [{ frame: 0, x: .2 }], parameterKeyframes: [{ frame: 0 }],
        maskKeyframes: [{ frame: 0 }], mask: 'circle', maskSettings: { x: .5, y: .5, width: .7, height: .7, rotation: 0, feather: .1, inverted: false },
        smartPicture: { denoise: .5, keyEnabled: false, keyColor: '#0f0', keyTolerance: .1, keyFeather: .1, despill: .1, light: .2, lightX: .5, lightY: .5, lightRadius: .5 },
        crop: { x: 0, y: 0, width: 1, height: 1 }, effect: { type: 'blur', intensity: .4 }, animation: { in: 'fade' },
        transform: { x: .1 }, filter: { brightness: 1.2 }, colourAdjustment: { exposure: 0, temperature: 0, tint: 0, shadows: 0, highlights: 0, gamma: 1, hsl: {}, curves: {} } };
    const result = adoptedMotionClip(clip, 'new', 120);
    expect(result).toEqual({ id: 'clip', mediaId: 'new', start: 90, in: 0, len: 120, trackId: 'video-0', groupId: 'group',
        volume: 1, transition: 6 });
});

test('motion adoption keeps the baked duration and refuses to invent unavailable frames', () => {
    expect(adoptedMotionClip({ id: 'clip', mediaId: 'old', start: 0, len: 20 }, 'new', 100).len).toBe(20);
    expect(adoptedMotionClip({ id: 'clip', mediaId: 'old', start: 0, len: 20 }, 'new', 8).len).toBe(8);
});

test('semantic masks preserve exact source-frame identity only for still or frozen sources', () => {
    const image = emptyTimeline(); image.media.image = { id: 'image', kind: 'image', frames: 1 };
    image.video = [{ id: 'clip', mediaId: 'image', start: 5, in: 7, len: 20, trackId: 'video-0' }];
    expect(semanticMaskSourceFrame(image, { track: 'video', id: 'clip' })).toBe(7);
    image.media.image.kind = 'video'; expect(semanticMaskSourceFrame(image, { track: 'video', id: 'clip' })).toBeNull();
    image.video[0].freezeFrame = 42; expect(semanticMaskSourceFrame(image, { track: 'video', id: 'clip' })).toBe(42);
});

test('semantic mask apply/remove is one sequence change and removes only unshared mask media', () => {
    const timeline = emptyTimeline(); timeline.media.image = { id: 'image', kind: 'image', frames: 1 };
    timeline.video = [{ id: 'clip', mediaId: 'image', start: 0, len: 20, trackId: 'video-0' }];
    const applied = timelineWithSemanticMask(timeline, { track: 'video', id: 'clip' }, 'l-mask', 'person', 0, 256, 256)!;
    expect(applied.seq).toBe(1); expect(applied.video[0].semanticMask).toEqual({ version: 1, mediaId: 'l-mask', category: 'person', sourceFrame: 0 });
    expect(applied.media['l-mask']).toMatchObject({ kind: 'image', width: 256, height: 256 });
    const removed = timelineWithoutSemanticMask(applied, { track: 'video', id: 'clip' })!;
    expect(removed.timeline.seq).toBe(2); expect(removed.timeline.video[0].semanticMask).toBeUndefined(); expect(removed.timeline.media['l-mask']).toBeUndefined();
});

test('dynamic semantic masks keep their timeline-time identity and video metadata', () => {
    const timeline = emptyTimeline(); timeline.media.video = { id: 'video', kind: 'video', frames: 300 };
    timeline.video = [{ id: 'clip', mediaId: 'video', start: 0, in: 30, len: 90, trackId: 'video-0' }];
    const applied = timelineWithSemanticMask(timeline, { track: 'video', id: 'clip' }, 'l-mask-video', 'person', 30, 256, 144,
        { fps: 30, frames: 90 })!;
    expect(applied.video[0].semanticMask).toEqual({ version: 1, mediaId: 'l-mask-video', category: 'person', sourceFrame: 30,
        dynamic: { fps: 30, frames: 90, identity: editorSemanticMaskIdentity(timeline.video[0]) } });
    expect(editorSemanticMaskMatches(applied.video[0])).toBe(true);
    expect(editorSemanticMaskMatches({ ...applied.video[0], reverse: true })).toBe(false);
    expect(applied.media['l-mask-video']).toMatchObject({ kind: 'video', frames: 90, hasAudio: false });
    expect(editorPersonMaskSourceSupported(timeline, { track: 'video', id: 'clip' }, 'file:///clip.mp4')).toBe(true);
});

test.each([
    { in: 31 }, { len: 89 }, { rate: 2 }, { reverse: true }, { freezeFrame: 42 }, { speedCurve: [{ frame: 0, rate: 1.5 }] }, { mediaId: 'replacement' },
])('source-time edit %j clears a semantic mask and requests regeneration', patch => {
    const timeline = emptyTimeline(); timeline.media.video = { id: 'video', kind: 'video', frames: 300 };
    timeline.video = [{ id: 'clip', mediaId: 'video', start: 0, in: 30, len: 90, trackId: 'video-0',
        semanticMask: { version: 1, mediaId: 'mask', category: 'person', sourceFrame: 30,
            dynamic: { fps: 30, frames: 90, identity: 'sm2-00000000' } } }];
    const next = { ...timeline, video: [{ ...timeline.video[0], ...patch }] };
    expect(invalidateChangedSemanticMasks(timeline, next).video[0].semanticMask).toBeUndefined();
    expect(editorPersonMaskNeedsRegeneration('clip', 'clip', true, false, true, false)).toBe(true);
});

test('unrelated edits retain the mask and an explicit removal does not report stale', () => {
    const timeline = emptyTimeline(); timeline.video = [{ id: 'clip', mediaId: 'video', start: 0, in: 30, len: 90,
        semanticMask: { version: 1, mediaId: 'mask', category: 'person', sourceFrame: 30 } }];
    const next = { ...timeline, video: [{ ...timeline.video[0], volume: .5 }] };
    expect(invalidateChangedSemanticMasks(timeline, next).video[0].semanticMask).toBeDefined();
    expect(editorPersonMaskNeedsRegeneration('clip', 'clip', true, false, false, false)).toBe(false);
    expect(editorPersonMaskNeedsRegeneration('clip', 'clip', true, false, true, true)).toBe(false);
    expect(editorPersonMaskNeedsRegeneration('clip', 'other', true, false, true, false)).toBe(false);
});

test('processes only the selected trimmed source range before adoption', () => {
    expect(editorMotionSelectedRange({ in: 150, len: 90 }, 30)).toEqual({ fromSeconds: 5, durationSeconds: 3 });
    expect(editorMotionSelectedRange({ in: 150, len: 90, reverse: true }, 30)).toEqual({ fromSeconds: 61 / 30, durationSeconds: 3 });
    expect(editorMotionSelectedRange({ in: 150, len: 90, rate: 2 }, 30)).toEqual({ fromSeconds: 5, durationSeconds: 179 / 30 });
    expect(editorMotionSelectedRange({ in: 150, len: 90, freezeFrame: 42 }, 30)).toEqual({ fromSeconds: 1.4, durationSeconds: 1 / 30 });
});
