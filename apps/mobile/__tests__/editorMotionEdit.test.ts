import * as edit from '../src/lib/editorMotionEdit';
import { emptyTimeline, type Timeline, type Selection } from '../src/lib/nativeEditorModel';
import { updateSequenceClip } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { TRANSFORM_DEFAULTS, motionPreset, parameterKeyframe, evaluatedTransform } from '../../../app/veyrnox/_lib/editorAnimation.mjs';
import { maskDefaults, maskKeyframe } from '../../../app/veyrnox/_lib/editorMask.mjs';
import { SMART_PICTURE } from '../../../app/veyrnox/_lib/editorSmartPicture.mjs';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { filterSet } from '../src/lib/editorLookEdit';
const sel: Selection = { track: 'video', id: 'v1' };
const fixture = (): Timeline => ({ ...emptyTimeline(), seq: 3,
    media: { m: { id: 'm', kind: 'video', frames: 900, name: 'Movie', hasAudio: true, width: 640, height: 360 } },
    video: [{ id: 'v1', mediaId: 'm', start: 10, in: 0, len: 90, volume: 1, transition: 0, trackId: 'video-0' }],
});
const same = (tl: Timeline, result: edit.MotionResult, patch: object) => {
    expect(result).toEqual({ timeline: updateSequenceClip(tl, 'video', sel.id, patch) });
    if ('timeline' in result) expect(validateSequence(result.timeline)).toBeNull();
};
test.each(['pan-right', 'rise', 'arc', 'push-in'])('%s equals web even on short clips', name => {
    for (const len of [1, 2, 90]) {
        const tl = fixture(); tl.video[0].len = len;
        same(tl, edit.motionPresetApply(tl, sel, name), { keyframes: motionPreset(tl.video[0], name) });
    }
});
test('transform upserts exact linear key inside only, and unchanged values do not seed keys', () => {
    const tl = fixture(), clip = tl.video[0]; clip.keyframes = motionPreset(clip, 'arc');
    const original = JSON.stringify(tl);
    for (const frame of [5, 40, 110]) {
        const transform = { ...evaluatedTransform(clip, frame - clip.start, false), x: .7 };
        const key = { frame: 30, x: .7, y: transform.y, scale: transform.scale, rotation: transform.rotation, opacity: transform.opacity, easing: 'linear' };
        same(tl, edit.transformEdit(tl, sel, frame, 'x', .7), { transform,
            ...(frame === 40 ? { keyframes: [...clip.keyframes!, key].sort((a, b) => a.frame - b.frame) } : {}) });
    }
    expect(edit.transformEdit(tl, sel, 40, 'x', evaluatedTransform(clip, 30, false).x)).toEqual({ timeline: tl });
    expect(JSON.stringify(tl)).toBe(original);
});
test('motion add/edit/remove/clear equal web and collisions refuse', () => {
    const tl = fixture(), c = tl.video[0];
    same(tl, edit.motionKeyAdd(tl, sel, 20), { keyframes: [{ frame: 10, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }] });
    c.keyframes = motionPreset(c, 'arc');
    same(tl, edit.motionKeyEdit(tl, sel, 1, 'frame', -3), { keyframes: [{ ...c.keyframes![1], frame: -3 }, c.keyframes![0], c.keyframes![2]] });
    expect(edit.motionKeyEdit(tl, sel, 1, 'frame', 0)).toEqual({ refused: 'invalid' });
    same(tl, edit.motionKeyRemove(tl, sel, 1), { keyframes: [c.keyframes![0], c.keyframes![2]] });
    same(tl, edit.motionKeysClear(tl, sel), { keyframes: [] });
});
test('picture keys and S6 brightness preserve web seeding', () => {
    const tl = fixture(), c = tl.video[0];
    same(tl, edit.parameterKeyAdd(tl, sel, 10), { parameterKeyframes: [parameterKeyframe(c, 0)] });
    c.parameterKeyframes = [parameterKeyframe(c, 0), parameterKeyframe(c, 89)];
    const filter = { brightness: 2, contrast: 1, saturate: 1, hue: 0, blur: 0 };
    const patch = { filter, parameterKeyframes: [parameterKeyframe({ ...c, filter, parameterKeyframes: [] }, 0), c.parameterKeyframes[1]] };
    same(tl, edit.clipPatch(tl, sel, 10, { filter }), patch);
    same(tl, filterSet(tl, c.id, 'brightness', 2, 0) as edit.MotionResult, patch);
    same(tl, edit.parameterKeyEasing(tl, sel, 0, 'ease-in'), { parameterKeyframes: [{ ...c.parameterKeyframes[0], easing: 'ease-in' }, c.parameterKeyframes[1]] });
    same(tl, edit.parameterKeyRemove(tl, sel, 0), { parameterKeyframes: [c.parameterKeyframes[1]] });
    same(tl, edit.parameterKeysClear(tl, sel), { parameterKeyframes: [] });
});
test('mask geometry, invert, resets and key operations equal web', () => {
    const tl = fixture(), c = tl.video[0]; c.mask = 'circle'; c.maskSettings = maskDefaults('circle');
    same(tl, edit.maskShape(tl, sel, 'horizontal'), { mask: 'horizontal', maskSettings: maskDefaults('horizontal'), maskKeyframes: [] });
    same(tl, edit.maskKeyAdd(tl, sel, 20), { maskKeyframes: [maskKeyframe(c, 10)] });
    c.maskKeyframes = [maskKeyframe(c, 0), maskKeyframe(c, 89)];
    const settings = { ...maskDefaults('circle'), width: .5 };
    same(tl, edit.maskEdit(tl, sel, 40, 'width', .5), { maskSettings: settings,
        maskKeyframes: [c.maskKeyframes[0], maskKeyframe({ ...c, maskSettings: settings, maskKeyframes: [] }, 30), c.maskKeyframes[1]] });
    same(tl, edit.maskEdit(tl, sel, 40, 'inverted', true), { maskSettings: { ...c.maskSettings, inverted: true } });
    same(tl, edit.maskKeyEasing(tl, sel, 0, 'ease-out'), { maskKeyframes: [{ ...c.maskKeyframes[0], easing: 'ease-out' }, c.maskKeyframes[1]] });
    same(tl, edit.maskKeyRemove(tl, sel, 0), { maskKeyframes: [c.maskKeyframes[1]] });
    same(tl, edit.maskReset(tl, sel), { maskSettings: maskDefaults('circle'), maskKeyframes: [] });
});
test('smart picture uses complete web defaults', () => {
    const tl = fixture();
    same(tl, edit.smartPictureEdit(tl, sel, 'keyEnabled', true), { smartPicture: { ...SMART_PICTURE, keyEnabled: true } });
    tl.video[0].smartPicture = { ...SMART_PICTURE, light: 1 };
    same(tl, edit.smartPictureReset(tl, sel), { smartPicture: SMART_PICTURE });
});
test('full, outside and locked prechecks; mask permits replacing a key at capacity', () => {
    const tl = fixture(), c = tl.video[0];
    c.keyframes = Array.from({ length: 40 }, (_, frame) => ({ frame, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }));
    c.parameterKeyframes = Array.from({ length: 40 }, (_, frame) => parameterKeyframe(c, frame));
    c.mask = 'circle'; c.maskKeyframes = Array.from({ length: 40 }, (_, frame) => maskKeyframe(c, frame));
    for (const add of [edit.motionKeyAdd, edit.parameterKeyAdd, edit.maskKeyAdd]) {
        expect(add(tl, sel, 60)).toEqual({ refused: 'full' }); expect(add(tl, sel, 0)).toEqual({ refused: 'outside' });
    }
    expect(edit.motionKeyAdd(tl, sel, 10)).toEqual({ refused: 'full' });
    expect(edit.maskKeyAdd(tl, sel, 10)).toEqual({ timeline: tl });
    tl.tracks[0].locked = true;
    expect(edit.transformEdit(tl, sel, 20, 'x', .7)).toEqual({ refused: 'locked' });
});
test('evaluatedAt uses relative frames without animation', () => {
    const tl = fixture(), c = tl.video[0]; c.transform = TRANSFORM_DEFAULTS;
    c.animation = { in: 'fade', duration: 15 }; c.keyframes = motionPreset(c, 'push-in');
    expect(edit.evaluatedAt(c, 55).transform).toEqual(evaluatedTransform(c, 45, false));
});

test('unchanged S6 filter values do not create or replace picture keys', () => {
    const tl = fixture(), c = tl.video[0]; c.parameterKeyframes = [parameterKeyframe(c, 0), parameterKeyframe(c, 89)];
    expect(filterSet(tl, c.id, 'brightness', 1, 30)).toEqual({ timeline: tl });
});
test('colour patches use the same S6 picture seeding inside and outside the clip', () => {
    const tl = fixture(), c = tl.video[0]; c.parameterKeyframes = [parameterKeyframe(c, 0), parameterKeyframe(c, 89)];
    for (const frame of [5, 40, 110]) {
        const colourAdjustment = { ...edit.evaluatedAt(c, frame).parameters.colour, exposure: 1 };
        const key = parameterKeyframe({ ...c, colourAdjustment, parameterKeyframes: [] }, frame - c.start);
        same(tl, edit.clipPatch(tl, sel, frame, { colourAdjustment }), { colourAdjustment,
            ...(frame === 40 ? { parameterKeyframes: [c.parameterKeyframes[0], key, c.parameterKeyframes[1]] } : {}) });
    }
});
test('mask settings outside a clip do not change retained keys, and operations never mutate nested input', () => {
    const tl = fixture(), c = tl.video[0]; c.mask = 'circle'; c.maskKeyframes = [maskKeyframe(c, 0), maskKeyframe(c, 89)];
    c.keyframes = motionPreset(c, 'arc'); c.parameterKeyframes = [parameterKeyframe(c, 0)];
    const original = JSON.stringify(tl);
    const freeze = (v: any) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } };
    freeze(tl);
    same(tl, edit.maskEdit(tl, sel, 5, 'width', .4), { maskSettings: { ...maskDefaults('circle'), width: .4 } });
    for (const result of [edit.motionKeyEdit(tl, sel, 1, 'y', .8), edit.motionKeyAdd(tl, sel, 40), edit.parameterKeyAdd(tl, sel, 40),
        edit.maskKeyAdd(tl, sel, 40), edit.maskShape(tl, sel, 'vertical'), edit.maskReset(tl, sel), edit.smartPictureEdit(tl, sel, 'keyColor', '#0000ff')]) {
        expect('timeline' in result).toBe(true);
    }
    expect(JSON.stringify(tl)).toBe(original);
});

test('returning an animated picture value to its static base still updates the playhead key', () => {
    const tl = fixture(), c = tl.video[0], filter = { brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0 };
    c.filter = filter; c.parameterKeyframes = [{ ...parameterKeyframe(c, 0), brightness: 2 }, parameterKeyframe(c, 89)];
    same(tl, edit.clipPatch(tl, sel, 10, { filter }), { filter, parameterKeyframes: [parameterKeyframe({ ...c, parameterKeyframes: [] }, 0), c.parameterKeyframes[1]] });
});

test('clearing absent motion and picture keys leaves the document unchanged', () => {
    const tl = fixture();
    expect(edit.motionKeysClear(tl, sel)).toEqual({ timeline: tl }); expect(edit.parameterKeysClear(tl, sel)).toEqual({ timeline: tl });
});


test('transform before the clip uses the web clamped expression without upserting at the clamped frame', () => {
    const tl = fixture(), c = tl.video[0], frame = 5;
    c.keyframes = [{ frame: -10, x: 0, y: 0, scale: 1, rotation: 0, opacity: .2, easing: 'linear' },
        { frame: 10, x: 1, y: 1, scale: 2, rotation: 90, opacity: 1, easing: 'linear' }];
    const web = evaluatedTransform(c, Math.max(0, frame - c.start), false);
    expect(web).not.toEqual(evaluatedTransform(c, frame - c.start, false));
    same(tl, edit.transformEdit(tl, sel, frame, 'x', .7), { transform: { ...web, x: .7 } });
    expect(edit.transformEdit(tl, sel, frame, 'x', web.x)).toEqual({ timeline: tl });
});
test.each(['transform', 'mask'] as const)('%s edit refuses a new key at capacity but permits replacement and outside writes', kind => {
    const tl = fixture(), c = tl.video[0]; c.mask = 'circle';
    c.keyframes = Array.from({ length: 40 }, (_, frame) => ({ frame, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }));
    c.maskKeyframes = Array.from({ length: 40 }, (_, frame) => maskKeyframe(c, frame));
    const original = JSON.stringify(tl), field = kind === 'transform' ? 'keyframes' : 'maskKeyframes';
    const change = (frame: number) => kind === 'transform' ? edit.transformEdit(tl, sel, frame, 'x', .7) : edit.maskEdit(tl, sel, frame, 'x', .7);
    expect(change(c.start + 50)).toEqual({ refused: 'full' });
    for (const frame of [c.start + 20, c.start - 1, c.start + c.len]) {
        const result = change(frame);
        expect('timeline' in result).toBe(true);
        if ('timeline' in result) {
            expect(validateSequence(result.timeline)).toBeNull();
            expect(result.timeline.video[0][field]).toHaveLength(40);
            if (frame === c.start + 20) expect(result.timeline.video[0][field]![20].x).toBe(.7);
            else expect(result.timeline.video[0][field]).toEqual(c[field]);
        }
    }
    expect('timeline' in edit.maskEdit(tl, sel, c.start + 50, 'inverted', true)).toBe(true);
    expect(JSON.stringify(tl)).toBe(original);
});

test('a before-clip transform edit matching the negative anchor still writes the base', () => {
    const tl = fixture(), c = tl.video[0], frame = c.start - 10;
    c.keyframes = [{ frame: -10, x: .2, y: .5, scale: 1, rotation: 0, opacity: 1, easing: 'linear' },
        { frame: 10, x: .8, y: .5, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }];
    const transform = { ...evaluatedTransform(c, Math.max(0, frame - c.start), false), x: .2 };
    same(tl, edit.transformEdit(tl, sel, frame, 'x', .2), { transform });
});
