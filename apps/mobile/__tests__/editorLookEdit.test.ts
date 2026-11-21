import * as look from '../src/lib/editorLookEdit';
import { emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';
import { updateSequenceClip, setSequenceTransition } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { colourDefaults } from '../../../app/veyrnox/_lib/editorColour.mjs';
import { evaluatedParameters, FILTER_DEFAULTS, parameterKeyframe } from '../../../app/veyrnox/_lib/editorAnimation.mjs';
import { BACKGROUND_DEFAULTS } from '../../../app/veyrnox/_lib/editorBackground.mjs';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { helperEnglish } from '../../../lib/helperMessages.mjs';
export const fixture = (): Timeline => ({ ...emptyTimeline(), seq: 3,
    media: { m: { id: 'm', kind: 'video', frames: 900, name: 'Movie', hasAudio: true, width: 640, height: 360 } },
    video: [0, 1, 2].map(i => ({ id: `v${i}`, mediaId: 'm', start: i * 90, in: 0, len: 90, volume: 1, transition: 0, trackId: 'video-0' })),
});
function same(result: look.LookResult, web: unknown) {
    expect(result).toEqual({ timeline: web });
    if ('timeline' in result) expect(validateSequence(result.timeline)).toBeNull();
}
test('all look writes equal web patches, without mutating input', () => {
    const tl = fixture(), before = JSON.stringify(tl), c = colourDefaults();
    const cases: [look.LookResult, object][] = [
        [look.colourSet(tl, 'v1', 'exposure', .12345, 0), { colourAdjustment: { ...c, exposure: .123 } }],
        [look.hslSet(tl, 'v1', 'red', 'hue', 12, 0), { colourAdjustment: { ...c, hsl: { ...c.hsl, red: { ...c.hsl.red, hue: 12 } } } }],
        [look.curveSet(tl, 'v1', 'master', [{ x: 0, y: .2 }, { x: 1, y: 1 }], 0),
            { colourAdjustment: { ...c, curves: { ...c.curves, master: [{ x: 0, y: .2 }, { x: 1, y: 1 }] } } }],
        [look.curveResetChannel(tl, 'v1', 'red', 0), { colourAdjustment: c }],
        [look.filterSet(tl, 'v1', 'brightness', 1.5, 0), { filter: { ...FILTER_DEFAULTS, brightness: 1.5 } }],
        [look.effectSet(tl, 'v1', 'tiles', .55), { effect: { type: 'tiles', intensity: .55 } }],
        [look.blendSet(tl, 'v1', 'screen'), { blend: 'screen' }],
        [look.cropSet(tl, 'v1', { x: .9, y: .8, width: .8, height: .4 }), { crop: { x: .2, y: .6, width: .8, height: .4 } }],
        [look.backgroundSet(tl, 'v1', { type: 'solid' }), { background: { ...BACKGROUND_DEFAULTS, type: 'solid' } }],
    ];
    for (const [result, patch] of cases) same(result, updateSequenceClip(tl, 'video', 'v1', patch));
    same(look.transitionSet(tl, 'v1', 'clock-wipe'), setSequenceTransition(tl, 'v1', 'clock-wipe', 15));
    same(look.transitionLength(tl, 'v1', 20), setSequenceTransition(tl, 'v1', 'dissolve', 20));
    same(look.transitionNone(tl, 'v0'), updateSequenceClip(tl, 'video', 'v0', { transition: 0 }));
    expect(JSON.stringify(tl)).toBe(before);
});
test('resets delete own properties and intensity keeps the effect type', () => {
    const tl = fixture(); Object.assign(tl.video[1], { colourAdjustment: colourDefaults(), filter: FILTER_DEFAULTS,
        crop: { x: 0, y: 0, width: 1, height: 1 }, effect: { type: 'tiles', intensity: .5 } });
    for (const [result, field] of [[look.colourReset(tl, 'v1', 0), 'colourAdjustment'], [look.filterReset(tl, 'v1', 0), 'filter'],
        [look.cropReset(tl, 'v1'), 'crop'], [look.effectSet(tl, 'v1', 'none', .5), 'effect']] as const) {
        if (!('timeline' in result)) throw Error('refused');
        expect(Object.hasOwn(result.timeline.video[1], field)).toBe(false); expect(validateSequence(result.timeline)).toBeNull();
    }
    same(look.effectIntensity(tl, 'v1', .7), updateSequenceClip(tl, 'video', 'v1', { effect: { type: 'tiles', intensity: .7 } }));
});
test('animated writes seed evaluated values and upsert just the current picture key', () => {
    const tl = fixture(), clip = tl.video[1];
    clip.parameterKeyframes = [parameterKeyframe(clip, 0), { ...parameterKeyframe(clip, 89), brightness: 2, exposure: 1 }];
    const filter = { ...evaluatedParameters(clip, 30).filter, contrast: 1.5 };
    const key = parameterKeyframe({ ...clip, filter, parameterKeyframes: [] }, 30);
    same(look.filterSet(tl, clip.id, 'contrast', 1.5, 30), updateSequenceClip(tl, 'video', clip.id,
        { filter, parameterKeyframes: [clip.parameterKeyframes[0], key, clip.parameterKeyframes[1]] }));
});
test.each([-10, 30, 89, 100])('animated reset at offset %s preserves other keys and removes neutral base', offset => {
    const tl = fixture(), clip = tl.video[1]; clip.colourAdjustment = { ...colourDefaults(), exposure: 1 };
    clip.parameterKeyframes = [parameterKeyframe(clip, 0), parameterKeyframe(clip, 89)];
    for (const field of ['colourAdjustment', 'filter'] as const) {
        const patch = { [field]: field === 'filter' ? FILTER_DEFAULTS : colourDefaults() };
        const keys = offset >= 0 && offset < clip.len
            ? [...clip.parameterKeyframes.filter(k => k.frame !== offset), parameterKeyframe({ ...clip, ...patch, parameterKeyframes: [] }, offset)]
                .sort((a, b) => a.frame - b.frame) : clip.parameterKeyframes;
        const result = field === 'filter' ? look.filterReset(tl, clip.id, offset) : look.colourReset(tl, clip.id, offset);
        if (!('timeline' in result)) throw Error('refused');
        expect(result.timeline.video[1].parameterKeyframes).toEqual(keys);
        expect(Object.hasOwn(result.timeline.video[1], field)).toBe(false);
    }
});
test('background type switches select first image, clear media and bulk refuses locked video lanes', () => {
    const tl = fixture(); tl.media.i = { id: 'i', kind: 'image', frames: 90, width: 50, height: 50, hasAudio: false, name: 'Still' };
    same(look.backgroundSet(tl, 'v1', { type: 'image' }), updateSequenceClip(tl, 'video', 'v1',
        { background: { ...BACKGROUND_DEFAULTS, type: 'image', mediaId: 'i' } }));
    tl.video[1].background = { ...BACKGROUND_DEFAULTS, type: 'image', mediaId: 'i' };
    same(look.backgroundSet(tl, 'v1', { type: 'blur' }), updateSequenceClip(tl, 'video', 'v1', { background: { ...BACKGROUND_DEFAULTS, type: 'blur' } }));
    const background = { ...BACKGROUND_DEFAULTS, type: 'solid' as const };
    same(look.backgroundAll(tl, background), tl.video.reduce((next, c) => updateSequenceClip(next, 'video', c.id, { background }), tl));
    tl.tracks[0].locked = true; expect(look.backgroundAll(tl, background)).toEqual({ refused: 'lockedAll' });
});
test('lock, adjacency, invalid backgrounds and unknown diagnostics refuse without mutation', () => {
    const tl = fixture(), before = JSON.stringify(tl);
    expect(look.transitionSet(tl, 'v0', 'dissolve')).toEqual({ refused: 'notAdjacent' });
    expect(look.backgroundSet(tl, 'v1', { type: 'image' })).toEqual({ refused: 'invalid' });
    expect(look.colourSet(tl, 'v1', 'gamma', 0, 0)).toEqual({ refused: 'invalid' });
    expect(JSON.stringify(tl)).toBe(before); tl.tracks[0].locked = true;
    expect(look.filterSet(tl, 'v1', 'brightness', 2, 0)).toEqual({ refused: 'locked' });
    expect(look.lookRefusal(helperEnglish('this_project_is_too_large_to_save_use'))).toBe('tooLarge');
    for (const error of ['unknown', null, 42, {}]) expect(look.lookRefusal(error)).toBe('invalid');
});
test('an eighth point crossing 30000 bytes refuses and preserves the seven-point source', () => {
    const tl = fixture(), colour = colourDefaults();
    for (const channel of Object.keys(colour.curves)) colour.curves[channel] = Array.from({ length: 8 }, (_, i) =>
        ({ x: Math.round(i / 7 * 1000) / 1000, y: Math.round(i / 7 * 1000) / 1000 }));
    tl.video = Array.from({ length: 23 }, (_, i) => ({ ...tl.video[0], id: `v${i}`, start: i * 90, colourAdjustment: structuredClone(colour) }));
    tl.video[0].colourAdjustment!.curves.master.splice(1, 1);
    tl.text = [{ id: 't50', text: 'x', start: 0, len: 90, trackId: 'text-0', x: .5, y: .8, size: 6 }];
    const padding = 29995 - JSON.stringify(tl).length;
    expect(padding).toBeGreaterThan(0); expect(padding).toBeLessThan(1000);
    tl.text[0].text += 'x'.repeat(padding);
    expect(validateSequence(tl)).toBeNull(); const before = JSON.stringify(tl);
    const points = tl.video[0].colourAdjustment!.curves.master;
    const next = [points[0], { x: .143, y: .143 }, ...points.slice(1)];
    expect(look.curveSet(tl, 'v0', 'master', next)).toEqual({ refused: 'tooLarge' });
    expect(JSON.stringify(tl)).toBe(before);
});
test('reselecting Image preserves the second image and the complete timeline', () => {
    const tl = fixture();
    for (const id of ['first', 'second']) tl.media[id] = { id, kind: 'image', frames: 90, name: id, width: 50, height: 50, hasAudio: false };
    tl.video[1].background = { ...BACKGROUND_DEFAULTS, type: 'image', mediaId: 'second' };
    expect(look.backgroundSet(tl, 'v1', { type: 'image' })).toEqual({ timeline: tl });
});
test('bulk backgrounds validate the final array even when the first replacement alone exceeds 30000 bytes', () => {
    const tl = fixture(), background = { ...BACKGROUND_DEFAULTS, type: 'solid' as const };
    const imageId = 'i'.repeat(64);
    tl.media[imageId] = { id: imageId, kind: 'image', frames: 90, name: 'Still', width: 50, height: 50, hasAudio: false };
    for (const clip of tl.video.slice(1)) clip.background = { ...BACKGROUND_DEFAULTS, type: 'image', mediaId: imageId };
    tl.text = [];
    while (JSON.stringify(tl).length < 28900) {
        const i = tl.text.length;
        tl.text.push({ id: `t${i}`, text: 'x'.repeat(900), start: i * 90, len: 90, trackId: 'text-0', x: .5, y: .8, size: 6 });
    }
    tl.text.push({ ...tl.text[0], id: 't99', start: 2700, text: '' });
    tl.text[tl.text.length - 1].text = 'x'.repeat(29999 - JSON.stringify(tl).length);
    expect(validateSequence(tl)).toBeNull();
    const before = JSON.stringify(tl);
    expect(look.backgroundSet(tl, 'v0', background)).toEqual({ refused: 'tooLarge' });
    const next = { ...tl, video: tl.video.map(c => ({ ...c, background: { ...background } })) };
    expect(validateSequence(next)).toBeNull();
    expect(look.backgroundAll(tl, background)).toEqual({ timeline: next });
    expect(JSON.stringify(tl)).toBe(before);
});

test.each([false, true])('bulk default background preserves the original timeline (near cap %s)', nearCap => {
    const tl = fixture();
    if (nearCap) {
        const { nearLimit } = require('./fixtures/editorNearLimit');
        tl.text = (nearLimit(false).timeline as Timeline).text;
        tl.text[27].text = tl.text[27].text.slice(0, -1000);
        tl.text[27].text += 'x'.repeat(29999 - JSON.stringify(tl).length);
    }
    expect(validateSequence(tl)).toBeNull();
    const result = look.backgroundAll(tl, { ...BACKGROUND_DEFAULTS });
    expect(result).toEqual({ timeline: tl });
    if (!('timeline' in result)) throw Error('refused');
    expect(result.timeline).toBe(tl);
    expect(tl.video.every(c => !Object.hasOwn(c, 'background'))).toBe(true);
});
test('bulk background retains matching explicit and implicit clips and only replaces changed clips', () => {
    const tl = fixture();
    tl.video[1].background = { ...BACKGROUND_DEFAULTS };
    tl.video[2].background = { ...BACKGROUND_DEFAULTS, type: 'solid' };
    const before = JSON.stringify(tl), result = look.backgroundAll(tl, { ...BACKGROUND_DEFAULTS });
    if (!('timeline' in result)) throw Error('refused');
    expect(result.timeline.video[0]).toBe(tl.video[0]); expect(result.timeline.video[1]).toBe(tl.video[1]);
    expect(result.timeline.video[2]).not.toBe(tl.video[2]);
    expect(result.timeline.video[2].background).toEqual(BACKGROUND_DEFAULTS);
    expect(JSON.stringify(tl)).toBe(before);
});
