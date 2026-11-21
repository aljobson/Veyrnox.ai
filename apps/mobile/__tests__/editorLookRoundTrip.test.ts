import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
import { timelineOf, framesIn, type Timeline } from '../src/lib/nativeEditorModel';
import * as edit from '../src/lib/editorLookEdit';
import { addPoint, movePoint } from '../src/lib/editorCurvePoints';
import { colourDefaults } from '../../../app/veyrnox/_lib/editorColour.mjs';
import { FILTER_DEFAULTS } from '../../../app/veyrnox/_lib/editorAnimation.mjs';
import { updateSequenceClip, setSequenceTransition } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { documentProblem } from '../src/lib/editorDocumentGate';
import { utf8Bytes, type ProjectDocument } from '../src/lib/editorBridge';
test('native look chain equals the web after every step; unrelated fields and timing survive', () => {
    const source = webSequenceV3(); delete source.video[0].parameterKeyframes;
    source.media.i = { id: 'i', name: 'Still', kind: 'image', frames: 90, hasAudio: false, width: 100, height: 100 };
    source.video.push({ ...source.video[1], id: 'v3', start: 240, transition: 20, transitionType: 'clock-wipe' });
    source.video[1].transitionType = 'slide'; source.background = '#15211f';
    const colour = colourDefaults(); colour.hsl.red.hue = 12;
    colour.curves.master = Array.from({ length: 8 }, (_, i) => ({ x: i / 7, y: i / 7 }));
    Object.assign(source.video[0], { colourAdjustment: colour, filter: { ...FILTER_DEFAULTS, contrast: 1.2 }, effect: { type: 'tiles', intensity: .5 },
        blend: 'screen', crop: { x: .1, y: .1, width: .8, height: .8 }, background: { type: 'image', color: '#15211f', blur: 18, mediaId: 'i' } });
    let tl = timelineOf(source), web = timelineOf(source);
    const timing = (value: Timeline) => value.video.map(({ start, len, in: from }) => ({ start, len, in: from }));
    const originalTiming = timing(tl), total = framesIn(tl);
    const background = { type: 'image' as const, color: '#15211f', blur: 18, mediaId: 'i' };
    const patch = (value: object) => updateSequenceClip(web, 'video', 'v1', value);
    const steps: [() => edit.LookResult, () => Timeline][] = [
        [() => edit.colourSet(tl, 'v1', 'exposure', .7, 10), () => patch({ colourAdjustment: { ...web.video[0].colourAdjustment, exposure: .7 } })],
        [() => edit.curveSet(tl, 'v1', 'master', movePoint(tl.video[0].colourAdjustment!.curves.master, 1, .18, .2), 10),
            () => patch({ colourAdjustment: { ...web.video[0].colourAdjustment, curves: { ...web.video[0].colourAdjustment!.curves,
                master: web.video[0].colourAdjustment!.curves.master.map((p, i) => i === 1 ? { x: .18, y: .2 } : p) } } })],
        [() => edit.curveSet(tl, 'v1', 'red', addPoint(tl.video[0].colourAdjustment!.curves.red), 10),
            () => patch({ colourAdjustment: { ...web.video[0].colourAdjustment, curves: { ...web.video[0].colourAdjustment!.curves,
                red: [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }] } } })],
        [() => edit.hslSet(tl, 'v1', 'red', 'hue', 30, 10), () => patch({ colourAdjustment: { ...web.video[0].colourAdjustment,
            hsl: { ...web.video[0].colourAdjustment!.hsl, red: { ...web.video[0].colourAdjustment!.hsl.red, hue: 30 } } } })],
        [() => edit.effectSet(tl, 'v1', 'tiles', .75), () => patch({ effect: { type: 'tiles', intensity: .75 } })],
        [() => edit.blendSet(tl, 'v1', 'overlay'), () => patch({ blend: 'overlay' })],
        [() => edit.cropSet(tl, 'v1', { x: .9, y: .1, width: .8, height: .8 }), () => patch({ crop: { x: .2, y: .1, width: .8, height: .8 } })],
        [() => edit.backgroundAll(tl, background), () => web.video.reduce((next, clip) => updateSequenceClip(next, 'video', clip.id, { background }), web)],
        [() => edit.transitionSet(tl, 'v3', 'clock-wipe'), () => setSequenceTransition(web, 'v3', 'clock-wipe', 20)],
        [() => edit.transitionLength(tl, 'v3', 25), () => setSequenceTransition(web, 'v3', 'clock-wipe', 25)],
        [() => edit.colourReset(tl, 'v2', 0), () => {
            const next = structuredClone(web); delete next.video[1].colourAdjustment;
            return updateSequenceClip(next, 'video', 'v2', {});
        }],
    ];
    for (const [run, webRun] of steps) {
        const result = run(); if (!('timeline' in result)) throw Error(result.refused); tl = result.timeline; web = webRun();
        expect(tl).toEqual(web); expect(validateSequence(tl)).toBeNull();
        expect(documentProblem(envelope(tl) as ProjectDocument)).toBeNull(); expect(utf8Bytes(JSON.stringify(envelope(tl)))).toBeLessThanOrEqual(32768);
        expect(timing(tl)).toEqual(originalTiming); expect(framesIn(tl)).toBe(total);
        expect(tl.video[1].transitionType).toBe('slide'); expect(tl.video[1].transition).toBe(source.video[1].transition ?? 0);
        const { background: _background, ...unchanged } = tl.video[1];
        expect(unchanged).toEqual(timelineOf(source).video[1]);
        expect(tl.text).toEqual(source.text); expect(tl.audio).toEqual(source.audio);
    }
    expect(JSON.parse(JSON.stringify(envelope(tl))).timeline).toEqual(tl);
});
