import { sourceRange } from '../../../app/veyrnox/_lib/editorSpeed.mjs';
import { adoptedMotionClip } from '../src/lib/editorNativeMediaActions';
import { canonicalMotionTimeline, EDITOR_MOTION_BAKED_FIELDS } from '../src/lib/editorMotionPreRender';
import { EDITOR_MOTION_ADOPTION_CORPUS } from './fixtures/editorMotionAdoptionCorpus';

const bakedContract = [
    'in', 'rate', 'reverse', 'speedCurve', 'freezeFrame', 'preservePitch',
    'fit', 'crop', 'transform', 'keyframes', 'animation', 'parameterKeyframes', 'filter', 'colourAdjustment',
    'mask', 'maskSettings', 'maskKeyframes', 'semanticMask', 'smartPicture', 'effect', 'background',
    'volume', 'fadeIn', 'fadeOut', 'pan', 'eq', 'audioProcessing', 'audioEffects',
] as const;

test('canonical motion baked-field list cannot silently lose a source, visual, mask, or audio semantic', () => {
    expect(EDITOR_MOTION_BAKED_FIELDS).toEqual(bakedContract);
});

test.each(EDITOR_MOTION_ADOPTION_CORPUS)('$id canonical pre-render retains rate/reverse/curve and the complete edited stack', fixture => {
    const before = JSON.stringify(fixture.timeline);
    const prepared = canonicalMotionTimeline(fixture.timeline, { track: 'video', id: fixture.clip.id });
    expect(prepared).not.toBeNull();
    expect(JSON.stringify(fixture.timeline)).toBe(before);
    expect(prepared!.timeline.fps).toBe(fixture.timeline.fps);
    expect(prepared!.timeline.video).toEqual([prepared!.clip]);
    expect(prepared!.timeline.audio).toEqual([]);
    expect(prepared!.timeline.text).toEqual([]);
    expect(sourceRange(prepared!.clip)).toEqual(sourceRange(fixture.clip));
    for (const field of EDITOR_MOTION_BAKED_FIELDS) expect(prepared!.clip[field]).toEqual(fixture.clip[field]);
    expect(prepared!.clip).toMatchObject({ start: 0, transition: 0, blend: 'source-over' });
});

test.each(EDITOR_MOTION_ADOPTION_CORPUS)('$id adoption resets every baked field and invalidates the semantic mask', fixture => {
    const before = JSON.stringify(fixture.clip);
    const adopted = adoptedMotionClip(fixture.clip, `processed-${fixture.id}`, fixture.clip.len);
    expect(JSON.stringify(fixture.clip)).toBe(before);
    expect(adopted).toMatchObject({ id: fixture.clip.id, mediaId: `processed-${fixture.id}`, start: fixture.clip.start,
        len: fixture.clip.len, in: 0, trackId: fixture.clip.trackId, groupId: fixture.clip.groupId, volume: 1,
        transition: fixture.clip.transition, transitionType: fixture.clip.transitionType, blend: fixture.clip.blend });
    for (const field of EDITOR_MOTION_BAKED_FIELDS) {
        if (field === 'in') expect(adopted.in).toBe(0);
        else if (field === 'volume') expect(adopted.volume).toBe(1);
        else expect(adopted).not.toHaveProperty(field);
    }
    expect(adopted).not.toHaveProperty('semanticMask');
    expect(adopted).not.toHaveProperty('rate');
    expect(adopted).not.toHaveProperty('reverse');
    expect(adopted).not.toHaveProperty('speedCurve');
});

test.each(EDITOR_MOTION_ADOPTION_CORPUS)('$id adoption caps the timeline range when native output is shorter', fixture => {
    const outputFrames = fixture.clip.len - Math.round(fixture.timeline.fps / 2);
    expect(adoptedMotionClip(fixture.clip, `short-${fixture.id}`, outputFrames)).toMatchObject({ len: outputFrames, in: 0 });
});
