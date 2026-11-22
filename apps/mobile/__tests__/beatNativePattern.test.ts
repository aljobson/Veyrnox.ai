import {
    clearPattern,
    copyPattern,
    createBeat,
    patternHasHits,
    selectPattern,
    setMetronome,
    setSteps,
    setSwing,
    toggleStep,
    validateBeat,
    type BeatDoc,
} from '../src/lib/beatNative/doc';
import { createHistory, record, replacePresent, travel } from '../src/lib/beatNative/history';

const ID = '00000000-0000-4000-8000-0000000000a1';
const valid = (doc: BeatDoc) => {
    expect(validateBeat(doc).ok).toBe(true);
    return doc;
};

test('the typed seam exposes canonical pattern, swing, metronome and length edits', () => {
    let doc = createBeat({ id: ID, now: 1 });
    expect(doc.signature).toEqual([4, 4]);
    doc = setSwing(doc, 0.24);
    doc = setMetronome(doc, true);
    doc = setSteps(doc, 32);
    doc = selectPattern(doc, 'D');
    expect(valid(doc)).toMatchObject({ swing: 0.24, metronome: true, steps: 32, currentPattern: 'D' });
});

test('16 steps hides rather than deletes upper hits and population checks include them', () => {
    let doc = setSteps(createBeat({ id: ID, now: 1 }), 32);
    doc = toggleStep(doc, 'kick', 20);
    doc = setSteps(doc, 16);
    expect(patternHasHits(doc, 'A')).toBe(true);
    expect(doc.patterns.A.rows.kick).toContainEqual([20, 100]);
    doc = setSteps(doc, 32);
    expect(doc.patterns.A.rows.kick).toContainEqual([20, 100]);
    expect(validateBeat(doc).ok).toBe(true);
});

test('copy deep-clones all visible and hidden hits while clear affects only the current slot', () => {
    let doc = setSteps(createBeat({ id: ID, now: 1 }), 32);
    doc = toggleStep(doc, 'kick', 20);
    doc = copyPattern(doc, 'A', 'B');
    expect(doc.patterns.B).toEqual(doc.patterns.A);
    expect(doc.patterns.B).not.toBe(doc.patterns.A);
    expect(doc.patterns.B.rows.kick).not.toBe(doc.patterns.A.rows.kick);
    doc = selectPattern(doc, 'B');
    doc = clearPattern(doc);
    expect(patternHasHits(doc, 'B')).toBe(false);
    expect(patternHasHits(doc, 'A')).toBe(true);
    expect(validateBeat(doc).ok).toBe(true);
});

test('pattern navigation replaces history present and survives undo without adding an entry', () => {
    const first = createBeat({ id: ID, now: 1 });
    let history = createHistory(first);
    history = record(history, setSwing(first, 0.2), { label: 'swing' });
    const selected = selectPattern(history.present, 'C');
    history = replacePresent(history, selected);
    expect(history.past).toHaveLength(1);
    history = travel(history, 'undo', 10);
    expect(history.present.currentPattern).toBe('C');
    expect(history.present.swing).toBe(0);
});
