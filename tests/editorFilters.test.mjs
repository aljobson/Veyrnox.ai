import test from 'node:test';
import assert from 'node:assert/strict';
import { FILTER_DEFAULTS, parameterKeyframe, evaluatedParameters } from '../app/veyrnox/_lib/editorAnimation.mjs';
import { colourDefaults, colourProblem, adjustColourPixels } from '../app/veyrnox/_lib/editorColour.mjs';
import { FILTER_LOOKS, FILTER_CATEGORIES, searchFilterLooks, applyFilterLook, resetFilterGrade } from '../app/veyrnox/_lib/editorFilters.mjs';
import { emptySequence, addSequenceMedia, addSequenceClip, addSequenceTrack, updateSequenceClip, updateSequenceTrack } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { emptyProjectDocument, withTimeline, validProjectDocument } from '../lib/projectDocument.js';

const ok = result => { assert.equal(result.error, undefined, result.error); return result; };
function fixture() {
    let timeline = ok(addSequenceMedia(emptySequence(), { id: 'source', kind: 'image', name: 'Original image', frames: 300, width: 640, height: 360, hasAudio: false }));
    timeline = ok(addSequenceClip(timeline, 'video', 'source', { len: 120 }));
    timeline = ok(addSequenceTrack(timeline, 'video'));
    timeline = ok(addSequenceClip(timeline, 'video', 'source', { start: 30, len: 90, trackId: timeline.tracks.at(-1).id }));
    return timeline;
}
const selected = timeline => timeline.video.map(clip => ({ track: 'video', id: clip.id }));

test('every original catalog grade is distinct, bounded and searchable by category and colour treatment', () => {
    assert.equal(new Set(FILTER_LOOKS.map(item => item.id)).size, 16);
    assert.equal(new Set(FILTER_LOOKS.map(item => JSON.stringify([item.filter, item.colour]))).size, 16);
    for (const preset of FILTER_LOOKS) {
        assert.equal(colourProblem(preset.colour), null);
        assert.equal(validateSequence(applyFilterLook(fixture(), selected(fixture()), preset.id)), null);
        assert.ok(Object.isFrozen(preset.colour.hsl.red));
    }
    assert.ok(FILTER_CATEGORIES.includes('Portrait'));
    assert.deepEqual(searchFilterLooks('  BLUE  ', 'Cinema').map(item => item.id), ['night-blue']);
    assert.deepEqual(searchFilterLooks('warm portrait', 'Portrait').map(item => item.id), ['gentle-portrait', 'warm-portrait']);
    assert.equal(searchFilterLooks('warm', 'Monochrome').length, 0);
    assert.equal(searchFilterLooks('unfindable').length, 0);
});

test('zero strength is the identical unchanged edit even with an existing grade, curves and animated grading', () => {
    let timeline = fixture(), colour = colourDefaults();
    colour.temperature = .3;
    colour.curves.red = [{ x: 0, y: .1 }, { x: .4, y: .6 }, { x: 1, y: .9 }];
    timeline = ok(updateSequenceClip(timeline, 'video', timeline.video[0].id, { colourAdjustment: colour, filter: { ...FILTER_DEFAULTS, contrast: 1.4 }, parameterKeyframes: [parameterKeyframe(timeline.video[0], 0)] }));
    const before = JSON.stringify(timeline);
    assert.equal(applyFilterLook(timeline, selected(timeline), 'night-blue', 0), timeline);
    assert.equal(JSON.stringify(timeline), before);
});

test('half strength blends from the current grade and changes every targeted clip in one valid edit while preserving all other fields', () => {
    let timeline = fixture(), colour = colourDefaults();
    colour.temperature = .4;
    colour.curves.master = [{ x: 0, y: .1 }, { x: .5, y: .6 }, { x: 1, y: 1 }];
    timeline = ok(updateSequenceClip(timeline, 'video', timeline.video[0].id, {
        filter: { ...FILTER_DEFAULTS, contrast: 1.6 }, colourAdjustment: colour,
        transform: { x: .2, y: .7, scale: .8, rotation: 20, opacity: .6, flipX: true, flipY: false },
        effect: { type: 'grain', intensity: .2 }, mask: 'circle', blend: 'multiply',
    }));
    const before = JSON.stringify(timeline), next = ok(applyFilterLook(timeline, selected(timeline), 'cool-film', .5));
    assert.equal(next.video[0].filter.contrast, 1.36);
    assert.ok(Math.abs(next.video[0].colourAdjustment.temperature - .1) < 1e-12);
    assert.equal(next.video[1].filter.contrast, 1.06);
    assert.deepEqual(next.video[0].colourAdjustment.curves, colour.curves);
    const other = clip => Object.fromEntries(Object.entries(clip).filter(([key]) => !['filter', 'colourAdjustment'].includes(key)));
    timeline.video.forEach((clip, index) => assert.deepEqual(other(next.video[index]), other(clip)));
    assert.equal(next.media, timeline.media);
    assert.equal(next.tracks, timeline.tracks);
    assert.equal(JSON.stringify(timeline), before);
});

test('a missing or locked target refuses the complete selection without partial edits or source mutation', () => {
    const timeline = fixture(), targets = selected(timeline);
    const locked = ok(updateSequenceTrack(timeline, timeline.video[1].trackId, { locked: true })), before = JSON.stringify(locked);
    assert.match(applyFilterLook(locked, targets, 'mono').error, /Unlock every/);
    assert.match(resetFilterGrade(locked, targets).error, /Unlock every/);
    assert.equal(JSON.stringify(locked), before);
    assert.match(applyFilterLook(timeline, [...targets, { track: 'video', id: 'v999' }], 'mono').error, /selection changed/);
    assert.match(applyFilterLook(timeline, [{ track: 'audio', id: targets[0].id }], 'mono').error, /visual clips/);
    assert.match(applyFilterLook(timeline, [], 'mono').error, /Select/);
    for (const strength of [-.1, 1.01, NaN, Infinity, '1']) assert.match(applyFilterLook(timeline, targets, 'mono', strength).error, /strength/);
    assert.match(applyFilterLook(timeline, targets, 'fake').error, /original look/);
});

test('animated grading is blended without overriding or discarding keyframe positions, easing or curves', () => {
    let timeline = fixture(), clip = timeline.video[0], first = parameterKeyframe(clip, 0), last = { ...first, frame: 119, brightness: .8, exposure: -.5, temperature: .3, easing: 'ease-in-out' };
    timeline = ok(updateSequenceClip(timeline, 'video', clip.id, { parameterKeyframes: [first, last] }));
    const next = ok(applyFilterLook(timeline, [{ track: 'video', id: clip.id }], 'warm-film', .5));
    assert.deepEqual(next.video[0].parameterKeyframes.map(key => [key.frame, key.easing]), [[0, 'linear'], [119, 'ease-in-out']]);
    for (const frame of [0, 30, 60, 119]) {
        const previous = evaluatedParameters(timeline.video[0], frame), after = evaluatedParameters(next.video[0], frame);
        assert.ok(Math.abs(after.colour.temperature - (previous.colour.temperature + .22) / 2) < 1e-12);
        assert.ok(Math.abs(after.filter.saturate - (previous.filter.saturate + .82) / 2) < 1e-12);
    }
    assert.equal(next.video[1], timeline.video[1]);
    assert.deepEqual(applyFilterLook(timeline, [{ track: 'video', id: clip.id }, { track: 'video', id: clip.id }], 'warm-film', .5), next);
});

test('reset returns static and animated grading to neutral while preserving motion and masks', () => {
    let timeline = fixture(), clip = timeline.video[0], colour = colourDefaults();
    colour.curves.master = [{ x: 0, y: .2 }, { x: 1, y: .8 }];
    timeline = ok(updateSequenceClip(timeline, 'video', clip.id, { colourAdjustment: colour, mask: 'circle', animation: { in: 'zoom', out: 'fade', duration: 10 }, parameterKeyframes: [{ ...parameterKeyframe(clip, 0), brightness: .5, exposure: 1 }] }));
    const next = ok(resetFilterGrade(timeline, [{ track: 'video', id: clip.id }]));
    assert.deepEqual(next.video[0].filter, FILTER_DEFAULTS);
    assert.deepEqual(next.video[0].colourAdjustment, colourDefaults());
    assert.deepEqual(next.video[0].animation, timeline.video[0].animation);
    assert.equal(next.video[0].mask, 'circle');
    assert.deepEqual(next.video[0].parameterKeyframes, [parameterKeyframe(clip, 0)]);
    assert.equal(next.video[1], timeline.video[1]);
});

test('colour changes preserve source alpha and the grade survives canonical save/reopen', () => {
    const timeline = fixture(), next = ok(applyFilterLook(timeline, selected(timeline), 'warm-portrait'));
    const source = new Uint8ClampedArray([100, 90, 80, 80, 45, 85, 130, 0]), output = source.slice();
    adjustColourPixels(output, next.video[0].colourAdjustment);
    assert.notDeepEqual(output, source);
    assert.equal(output[3], 80); assert.equal(output[7], 0);
    assert.deepEqual(source, new Uint8ClampedArray([100, 90, 80, 80, 45, 85, 130, 0]));
    const project = '11111111-1111-4111-8111-111111111111', document = JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(project), next)));
    assert.equal(validProjectDocument(document, project), true);
    assert.deepEqual(document.timeline.video[0].colourAdjustment, next.video[0].colourAdjustment);
});


test('a batch that exceeds the existing saved-document size bound is refused atomically', () => {
    let timeline = emptySequence();
    for (let index = 0; index < 40; index++) {
        timeline = ok(addSequenceMedia(timeline, { id: `s${index}`, kind: 'image', name: `Original image ${index}`, frames: 18000, width: 640, height: 360, hasAudio: false }));
        timeline = ok(addSequenceClip(timeline, 'video', `s${index}`, { len: 90 }));
    }
    const before = JSON.stringify(timeline);
    assert.match(applyFilterLook(timeline, selected(timeline), 'warm-film', .5).error, /too large to save/);
    assert.equal(JSON.stringify(timeline), before);
    assert.equal(applyFilterLook(timeline, selected(timeline), 'warm-film', 0), timeline);
    assert.equal(validateSequence(applyFilterLook(timeline, [selected(timeline)[0]], 'warm-film', .5)), null);
});
