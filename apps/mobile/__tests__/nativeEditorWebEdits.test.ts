import { splitSequenceClip, trimSequence, sourceFrame, setSequenceRate } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { splitClip, pasteClipboard, copySelections, duplicateSelections, type Timeline, type Selection } from '../src/lib/nativeEditorModel';
import { canTrim, canChangeSpeed, changeItemSpeed, trimItem } from '../src/lib/editorTimeline';
import { webSequenceV3 } from './fixtures/webSequenceV3';
const video: Selection = { track: 'video', id: 'v1' }, text: Selection = { track: 'text', id: 't3' };
test.each(['original', 'trimmed', 'split'] as const)('%s animated clip changes speed exactly like web and remains editable', kind => {
    let tl = webSequenceV3();
    const clip = tl.video[0];
    delete clip.keyframes; delete clip.parameterKeyframes; delete clip.maskKeyframes;
    clip.animation = { in: 'fade', out: 'fade', duration: 15 };
    let selection = video;
    if (kind === 'trimmed') tl = trimItem(tl, video, 'in', 30, false, 0)!;
    if (kind === 'split') {
        tl = splitClip(tl, video, 30)!;
        selection = { track: 'video', id: tl.video.find(c => c.start === 30)!.id };
    }
    const original = tl.video.find(c => c.id === selection.id)!;
    expect(canChangeSpeed(original)).toBe(true);
    const next = changeItemSpeed(tl, selection, 2)!;
    expect(next).toEqual(setSequenceRate(tl, selection.track, selection.id, 2));
    const changed = next.video.find(c => c.id === selection.id)!;
    const len = kind === 'original' ? 45 : 30;
    expect(changed).toMatchObject({ len, rate: 2, animation: { in: 'fade', out: 'fade', offset: 0, span: len },
        keyframes: [], parameterKeyframes: [], maskKeyframes: [], speedCurve: [], fadeIn: len, fadeOut: len });
    expect(validateSequence(next)).toBeNull();
    expect(canChangeSpeed(changed)).toBe(true);
    expect(changeItemSpeed(next, selection, 1)).toEqual(setSequenceRate(next, selection.track, selection.id, 1));
});
const cases: [string, Selection, Record<string, unknown>][] = [
    ['rate', video, { rate: 2 }], ['reverse', video, { rate: 2, reverse: true, in: 400 }],
    ['ramp', video, { speedCurve: [{ frame: 0, rate: 1 }, { frame: 90, rate: 2 }] }], ['caption', text, {}],
];
test.each(cases)('%s split exactly matches the shared web operation', (_name, selection, patch) => {
    const tl = webSequenceV3(); Object.assign(tl[selection.track][0], patch);
    expect(validateSequence(tl)).toBeNull();
    const expected = splitSequenceClip(tl, selection.track, selection.id, 30);
    expect(expected.error).toBeUndefined();
    const next = splitClip(tl, selection, 30);
    expect(next).toEqual(expected); expect(validateSequence(next)).toBeNull();
});
test.each(cases.filter(([name]) => name !== 'ramp'))('%s trims match the web with timed fields', (_name, selection, patch) => {
    for (const [edge, delta] of [['in', 10], ['out', -10]] as const) {
        const tl = webSequenceV3(); Object.assign(tl[selection.track][0], patch);
        const expected = trimSequence(tl, selection.track, selection.id, edge, delta);
        expect(expected.error).toBeUndefined();
        const next = trimItem(tl, selection, edge, delta, false, 0);
        expect(next).toEqual(expected); expect(validateSequence(next)).toBeNull();
    }
});
test('trim eligibility expands without expanding speed editing', () => {
    const tl = webSequenceV3();
    for (const item of [tl.video[0], tl.text[0]]) { expect(canTrim(item)).toBe(true); expect(canChangeSpeed(item)).toBe(false); }
    for (const patch of [{ speedCurve: [] }, { freezeFrame: 0 }]) expect(canTrim({ ...tl.video[0], ...patch })).toBe(false);
});
test.each(cases.filter(([name]) => name !== 'ramp'))('paste inside %s retains the same source and timed tail as web split', (_name, selection, patch) => {
    const tl = webSequenceV3(); Object.assign(tl[selection.track][0], patch);
    const clipboard = copySelections(tl, [selection])!;
    const next = pasteClipboard(tl, clipboard, 30)!.timeline;
    const expected = splitSequenceClip({ ...tl, seq: tl.seq + 1 }, selection.track, selection.id, 30);
    const tail = next[selection.track].find(c => c.id === `${selection.track[0]}${tl.seq + 2}`)!;
    expect(tail).toEqual({ ...expected[selection.track][1], start: 120 });
    if (selection.track !== 'text') for (const frame of [0, 20, 59]) {
        expect(sourceFrame(tail, frame)).toBeCloseTo(sourceFrame(tl[selection.track][0], frame + 30));
    }
    expect(validateSequence(next)).toBeNull();
});
test.each([video, text])('paste and duplicate preserve all advanced fields for $track', selection => {
    const tl = webSequenceV3(), original = tl[selection.track][0];
    for (const result of [pasteClipboard(tl, copySelections(tl, [selection]), 300), duplicateSelections(tl, [selection])]) {
        const copy = result!.timeline[selection.track].find(c => c.id === result!.selections[0].id)!;
        expect(copy).toEqual({ ...original, id: copy.id, start: copy.start });
        expect(validateSequence(result!.timeline)).toBeNull();
    }
});
