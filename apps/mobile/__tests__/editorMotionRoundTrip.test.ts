import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
import { timelineOf, framesIn, splitClip, type Timeline } from '../src/lib/nativeEditorModel';
import * as edit from '../src/lib/editorMotionEdit';
import { motionPreset, evaluatedTransform, parameterKeyframe, evaluatedParameters } from '../../../app/veyrnox/_lib/editorAnimation.mjs';
import { maskDefaults, maskKeyframe, evaluatedMask } from '../../../app/veyrnox/_lib/editorMask.mjs';
import { SMART_PICTURE } from '../../../app/veyrnox/_lib/editorSmartPicture.mjs';
import { updateSequenceClip, splitSequenceClip } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { utf8Bytes } from '../src/lib/editorBridge';
const sel = { track: 'video' as const, id: 'v1' };
test('phone motion chain and envelope equal the web after every operation', () => {
    const source = webSequenceV3();
    for (const field of ['keyframes', 'parameterKeyframes', 'maskKeyframes', 'mask', 'maskSettings', 'smartPicture'] as const) delete source.video[0][field];
    let tl = timelineOf(source), web = timelineOf(source);
    const total = framesIn(tl), untouched = JSON.stringify(tl.video[1]);
    const patch = (value: object) => updateSequenceClip(web, 'video', sel.id, value) as Timeline;
    const steps: [() => edit.MotionResult, () => Timeline][] = [
        [() => edit.transformEdit(tl, sel, 0, 'x', .6), () => patch({ transform: { ...evaluatedTransform(web.video[0], 0, false), x: .6 } })],
        [() => edit.motionPresetApply(tl, sel, 'arc'), () => patch({ keyframes: motionPreset(web.video[0], 'arc') })],
        [() => edit.motionKeyEdit(tl, sel, 1, 'y', .4), () => patch({ keyframes: web.video[0].keyframes!.map((k, i) => i === 1 ? { ...k, y: .4 } : k) })],
        [() => edit.clipPatch(tl, sel, 44, { transform: { ...edit.evaluatedAt(tl.video[0], 44).transform, x: .7, y: .3 } }), () => {
            const transform = { ...evaluatedTransform(web.video[0], 44, false), x: .7, y: .3 };
            const { x, y, scale, rotation, opacity } = transform;
            return patch({ transform, keyframes: web.video[0].keyframes!.map(k => k.frame === 44 ? { frame: 44, x, y, scale, rotation, opacity, easing: 'linear' } : k) });
        }],
        [() => edit.parameterKeyAdd(tl, sel, 44), () => patch({ parameterKeyframes: [parameterKeyframe(web.video[0], 44)] })],
        [() => edit.clipPatch(tl, sel, 44, { filter: { ...evaluatedParameters(tl.video[0], 44).filter, brightness: 2 } }), () => {
            const filter = { ...evaluatedParameters(web.video[0], 44).filter, brightness: 2 };
            return patch({ filter, parameterKeyframes: [parameterKeyframe({ ...web.video[0], filter, parameterKeyframes: [] }, 44)] });
        }],
        [() => edit.maskShape(tl, sel, 'circle'), () => patch({ mask: 'circle', maskSettings: maskDefaults('circle'), maskKeyframes: [] })],
        [() => edit.maskEdit(tl, sel, 44, 'width', .7), () => patch({ maskSettings: { ...evaluatedMask(web.video[0], 44), width: .7 } })],
        [() => edit.maskKeyAdd(tl, sel, 44), () => patch({ maskKeyframes: [maskKeyframe(web.video[0], 44)] })],
        [() => edit.maskEdit(tl, sel, 60, 'height', .6), () => {
            const maskSettings = { ...evaluatedMask(web.video[0], 60), height: .6 };
            return patch({ maskSettings, maskKeyframes: [...web.video[0].maskKeyframes!, maskKeyframe({ ...web.video[0], maskSettings, maskKeyframes: [] }, 60)] });
        }],
        [() => edit.smartPictureEdit(tl, sel, 'keyEnabled', true), () => patch({ smartPicture: { ...SMART_PICTURE, keyEnabled: true } })],
        [() => edit.smartPictureEdit(tl, sel, 'keyColor', '#0000ff'), () => patch({ smartPicture: { ...SMART_PICTURE, keyEnabled: true, keyColor: '#0000ff' } })],
        [() => ({ timeline: splitClip(tl, sel, 40)! }), () => splitSequenceClip(web, 'video', sel.id, 40) as Timeline],
    ];
    for (const [phone, website] of steps) {
        const result = phone(); web = website(); if (!('timeline' in result)) throw Error(result.refused);
        tl = result.timeline; expect(tl).toEqual(web); expect(validateSequence(tl)).toBeNull();
        expect(utf8Bytes(JSON.stringify(envelope(tl)))).toBeLessThanOrEqual(32768);
        expect(framesIn(tl)).toBe(total); expect(JSON.stringify(tl.video.find(c => c.id === 'v2'))).toBe(untouched);
    }
    tl.tracks[0].locked = true; const before = JSON.stringify(tl);
    expect(edit.transformEdit(tl, sel, 0, 'x', .3)).toEqual({ refused: 'locked' }); expect(JSON.stringify(tl)).toBe(before);
});
