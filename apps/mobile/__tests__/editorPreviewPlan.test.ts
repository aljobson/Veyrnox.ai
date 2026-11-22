import { evaluatedParameters, evaluatedReveal, evaluatedTransform, FILTER_DEFAULTS, parameterKeyframe } from '../../../app/veyrnox/_lib/editorAnimation.mjs';
import { colourDefaults } from '../../../app/veyrnox/_lib/editorColour.mjs';
import { evaluatedMask } from '../../../app/veyrnox/_lib/editorMask.mjs';
import { emptySequence } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { sequenceLayers } from '../../../app/veyrnox/_lib/editorSequenceRender.mjs';
import { captionPresentation } from '../../../app/veyrnox/_lib/editorWords.mjs';
import { editorPreviewPlan } from '../src/lib/editorPreviewPlan';
import type { Timeline } from '../src/lib/nativeEditorModel';
import { webSequenceV3 } from './fixtures/webSequenceV3';

const image = (id: string) => ({ id, kind: 'image', frames: 90, name: id, hasAudio: false, width: 640, height: 360 });
const clip = (id: string, mediaId: string, trackId: string, start = 0, len = 30) => ({ id, mediaId, trackId, start, len, in: 0, volume: 1, transition: 0 });

test('adapts the webSequenceV3 frame with canonical ordering and evaluated values', () => {
    const timeline = webSequenceV3(), frame = 45;
    const canonical = sequenceLayers(timeline, frame);
    const plan = editorPreviewPlan(timeline, frame);

    expect(plan.visuals.map(layer => layer.clip.id)).toEqual(canonical.visuals.map((layer: any) => layer.clip.id));
    expect(plan.texts.map(layer => layer.item.id)).toEqual(canonical.texts.map((layer: any) => layer.id));
    expect(plan.visuals[0]).toMatchObject({
        sourceIndex: canonical.visuals[0].k,
        sourceTimeSeconds: canonical.visuals[0].time,
        offset: canonical.visuals[0].offset,
        transform: evaluatedTransform(canonical.visuals[0].clip, canonical.visuals[0].offset),
        reveal: evaluatedReveal(canonical.visuals[0].clip, canonical.visuals[0].offset),
        filter: evaluatedParameters(canonical.visuals[0].clip, canonical.visuals[0].offset).filter,
        colour: evaluatedParameters(canonical.visuals[0].clip, canonical.visuals[0].offset).colour,
        mask: evaluatedMask(canonical.visuals[0].clip, canonical.visuals[0].offset),
    });
    expect(plan.texts[0]).toMatchObject({
        offset: canonical.texts[0].offset,
        transform: evaluatedTransform(canonical.texts[0], canonical.texts[0].offset),
        reveal: evaluatedReveal(canonical.texts[0], canonical.texts[0].offset),
        presentation: captionPresentation(canonical.texts[0], canonical.texts[0].offset),
    });
    expect(plan.capabilities.unsupported.map(use => use.capability)).toEqual(expect.arrayContaining([
        'video-source', 'smart-picture', 'text-layer', 'caption-words',
    ]));
    expect(plan.capabilities.exact).toBe(false);
});

test('inherits half-open, hidden-track and track-order semantics from sequenceLayers', () => {
    const base = emptySequence();
    const timeline = {
        ...base,
        media: { low: image('low'), high: image('high'), hidden: image('hidden'), ended: image('ended') },
        tracks: [
            { id: 'video-1', kind: 'video', name: 'Low', locked: false, muted: false, hidden: false },
            { id: 'video-0', kind: 'video', name: 'High', locked: false, muted: false, hidden: false },
            { id: 'video-2', kind: 'video', name: 'Hidden', locked: false, muted: false, hidden: true },
            ...base.tracks.filter(track => track.kind !== 'video'),
        ],
        video: [
            clip('v1', 'high', 'video-0'), clip('v2', 'hidden', 'video-2'), clip('v3', 'low', 'video-1'), clip('v4', 'ended', 'video-0', 0, 15),
        ],
    } as unknown as Timeline;

    expect(editorPreviewPlan(timeline, 14).visuals.map(layer => layer.clip.id)).toEqual(['v3', 'v1', 'v4']);
    expect(editorPreviewPlan(timeline, 15).visuals.map(layer => layer.clip.id)).toEqual(['v3', 'v1']);
    expect(editorPreviewPlan(timeline, 30).visuals).toEqual([]);
});

test('preserves the canonical outgoing/incoming transition pair and evaluated transition values', () => {
    const base = emptySequence();
    const timeline = {
        ...base,
        media: { a: image('a'), b: image('b') },
        video: [clip('v1', 'a', 'video-0', 0, 20), { ...clip('v2', 'b', 'video-0', 20, 20), transition: 10, transitionType: 'cross-zoom' }],
    } as unknown as Timeline;
    const canonical = sequenceLayers(timeline, 20);
    const plan = editorPreviewPlan(timeline, 20);

    expect(plan.visuals.map(layer => layer.clip.id)).toEqual(canonical.visuals.map((layer: any) => layer.clip.id));
    expect(plan.visuals.map(layer => layer.transition?.role)).toEqual(['outgoing', 'incoming']);
    expect(plan.visuals.map(layer => layer.transition)).toMatchObject([
        { type: 'cross-zoom', duration: 10, progress: .1, alpha: 1, zoom: 1.06, blur: expect.any(Number) },
        { type: 'cross-zoom', duration: 10, progress: .1, alpha: .1, zoom: 1.54, blur: expect.any(Number) },
    ]);
    expect(plan.capabilities.unsupported.filter(use => use.capability === 'transition')).toEqual([
        expect.objectContaining({ itemId: 'v1', detail: 'cross-zoom' }),
        expect.objectContaining({ itemId: 'v2', detail: 'cross-zoom' }),
    ]);
});

test('reports exact static frames and never hides unsupported active features', () => {
    const base = emptySequence();
    const simple = {
        ...base,
        media: { image: image('image') },
        video: [{ ...clip('v1', 'image', 'video-0'), crop: { x: .1, y: .1, width: .8, height: .8 }, blend: 'multiply', mask: 'circle' }],
    } as unknown as Timeline;
    expect(editorPreviewPlan(simple, 0).capabilities).toMatchObject({ exact: true, unsupported: [] });

    const supportedFilter = {
        ...simple,
        video: [{ ...simple.video[0], filter: { brightness: 1.2, contrast: 1, saturate: 1, hue: 0, blur: 0 },
            background: { type: 'blur', color: '#000000', blur: 18, mediaId: '' } }],
    } as unknown as Timeline;
    const supportedReport = editorPreviewPlan(supportedFilter, 0).capabilities;
    expect(supportedReport).toMatchObject({ exact: true, unsupported: [] });
    expect(supportedReport.requirements).toContainEqual(expect.objectContaining({ capability: 'basic-filter', supported: true, itemId: 'v1' }));

    const unsupported = {
        ...supportedFilter,
        video: [{ ...supportedFilter.video[0], colourAdjustment: { ...colourDefaults(), exposure: .4 }, effect: { type: 'grain', intensity: .5 } }],
        text: [{ id: 't1', text: 'Title', start: 0, len: 30, trackId: 'text-0', x: .5, y: .5, size: 8 }],
    } as unknown as Timeline;
    const report = editorPreviewPlan(unsupported, 0).capabilities;
    expect(report.exact).toBe(false);
    expect(report.unsupported).not.toContainEqual(expect.objectContaining({ capability: 'basic-filter' }));
    expect(report.unsupported).toEqual(expect.arrayContaining([
        expect.objectContaining({ capability: 'advanced-colour', itemId: 'v1' }),
        expect.objectContaining({ capability: 'effect', itemId: 'v1', detail: 'grain' }),
        expect.objectContaining({ capability: 'text-layer', itemId: 't1' }),
    ]));
});

test('evaluates parameter-keyframed basic filters into an exact supported static plan', () => {
    const base = emptySequence();
    const source = { ...clip('v1', 'image', 'video-0', 0, 30), filter: { ...FILTER_DEFAULTS, brightness: .5, hue: -60 } };
    const first = parameterKeyframe(source, 0), last = {
        ...parameterKeyframe(source, 20), frame: 20, brightness: 2.5, contrast: 1.5, saturate: .4, hue: 60, blur: 10,
    };
    const animated = { ...source, parameterKeyframes: [first, last] };
    const timeline = { ...base, media: { image: image('image') }, video: [animated] } as unknown as Timeline;
    const plan = editorPreviewPlan(timeline, 10);

    expect(plan.visuals[0].filter).toEqual(evaluatedParameters(animated, 10).filter);
    expect(plan.visuals[0].filter).toMatchObject({ brightness: 1.5, contrast: 1.25, saturate: .7, hue: 0, blur: 5 });
    expect(plan.capabilities).toMatchObject({ exact: true, unsupported: [] });
    expect(plan.capabilities.requirements).toContainEqual(expect.objectContaining({ capability: 'basic-filter', supported: true, itemId: 'v1' }));
});

test('reports audible hidden media because visibility does not remove it from the web mix', () => {
    const base = emptySequence();
    const timeline = {
        ...base,
        media: { sound: { id: 'sound', kind: 'audio', frames: 90, name: 'Sound', hasAudio: true, width: 0, height: 0 } },
        tracks: base.tracks.map(track => track.id === 'audio-0' ? { ...track, hidden: true } : track),
        audio: [{ ...clip('a1', 'sound', 'audio-0'), transition: undefined }],
    } as unknown as Timeline;
    expect(editorPreviewPlan(timeline, 0).capabilities.unsupported).toContainEqual(expect.objectContaining({ capability: 'audio-mix', itemId: 'a1' }));
});

test('reports orphan media only while its visual or transition tail matters and keeps original source indices', () => {
    const base = emptySequence();
    const timeline = {
        ...base,
        media: { image: image('image') },
        video: [
            clip('v1', 'missing', 'video-0', 0, 10),
            { ...clip('v2', 'image', 'video-0', 10, 20), transition: 5 },
            clip('v3', 'also-missing', 'video-0', 60, 10),
        ],
    } as unknown as Timeline;

    expect(editorPreviewPlan(timeline, 0).capabilities.unsupported).toContainEqual(expect.objectContaining({ capability: 'missing-media', itemId: 'v1' }));
    const seam = editorPreviewPlan(timeline, 10);
    expect(seam.visuals.map(layer => layer.clip.id)).toEqual(['v2']);
    expect(seam.visuals[0].sourceIndex).toBe(1);
    expect(seam.capabilities.unsupported).toContainEqual(expect.objectContaining({ capability: 'missing-media', itemId: 'v1' }));
    expect(editorPreviewPlan(timeline, 15).capabilities.unsupported).not.toContainEqual(expect.objectContaining({ capability: 'missing-media' }));
});

test('reports active audio clips whose media is missing', () => {
    const base = emptySequence();
    const timeline = { ...base, audio: [{ ...clip('a1', 'missing', 'audio-0', 10, 10), transition: undefined }] } as unknown as Timeline;
    expect(editorPreviewPlan(timeline, 9).capabilities.unsupported).toEqual([]);
    expect(editorPreviewPlan(timeline, 10).capabilities.unsupported).toContainEqual(expect.objectContaining({ capability: 'missing-media', scope: 'audio', itemId: 'a1' }));
    expect(editorPreviewPlan(timeline, 20).capabilities.unsupported).toEqual([]);
});
