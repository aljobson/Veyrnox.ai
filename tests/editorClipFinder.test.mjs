import test from 'node:test';
import assert from 'node:assert/strict';
import { FINDER_DEFAULTS, energyWindows, candidateSegments, scoreSegment, rankSegments, speechFromCaptions, insertClipSegments } from '../app/veyrnox/_lib/editorClipFinder.mjs';
import { emptySequence, addSequenceMedia, addSequenceClip, addSequenceText, sequenceEnd } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';

const media = { id: 'l-src', kind: 'video', frames: 900, width: 1280, height: 720, hasAudio: true, name: 'source.mp4' };
const ok = v => { assert.equal(v.error, undefined, v.error); assert.equal(validateSequence(v), null); return v; };
const base = () => ok(addSequenceClip(ok(addSequenceMedia(emptySequence(), media)), 'video', media.id, { len: 900 }));
// A 30 s clip with shots at 5 s steps. Loudness: loud only 10 to 15 s. Everything else quiet.
const cuts = [5, 10, 15, 20, 25];
const quiet = Array.from({ length: 60 }, (_, i) => (i >= 20 && i < 30 ? 0.8 : 0.08));

test('energyWindows gives the RMS of each window and a short last window', () => {
    const samples = [...Array(8).fill(0.5), ...Array(4).fill(1)];
    const e = energyWindows(samples, 8, 1);
    assert.deepEqual(e.values.map(v => Number(v.toFixed(3))), [0.5, 1]);
    assert.equal(e.windowSeconds, 1);
    assert.deepEqual(energyWindows([], 8).values, []);
});

test('candidates are runs of whole shots inside the length range, and a long shot gets sliding windows', () => {
    const c = candidateSegments(30, cuts);
    assert.ok(c.every(s => s.end - s.start >= 3 && s.end - s.start <= 10));
    assert.ok(c.some(s => s.start === 10 && s.end === 15) && c.some(s => s.start === 5 && s.end === 15));
    assert.ok(!c.some(s => s.start === 0 && s.end === 30));
    const open = candidateSegments(30, []);
    assert.ok(open.length > 5 && open.every(s => Math.abs(s.end - s.start - 6) < 1e-9), 'no cuts: windows of the target length');
    assert.deepEqual(candidateSegments(2, []), []);
});

test('the loudest shot wins when only audio differs, and the reason says so', () => {
    const [top] = rankSegments({ duration: 30, cuts, energy: { windowSeconds: 0.5, values: quiet } });
    assert.deepEqual([top.start, top.end], [10, 15]);
    assert.ok(top.reasons.includes('Loud, lively audio') && top.reasons.includes('Starts and ends on a cut'));
});

test('the most spoken shot wins when only words differ', () => {
    const speech = [{ start: 20, end: 25, words: 14 }, { start: 2, end: 4, words: 1 }];
    const [top] = rankSegments({ duration: 30, cuts, speech });
    assert.deepEqual([top.start, top.end], [20, 25]);
    assert.ok(top.reasons.some(r => /Lots of speech \(about 2\.8 words a second\)/.test(r)), top.reasons.join('|'));
});

test('picks are best first, never more than count, and do not overlap beyond the limit', () => {
    const picks = rankSegments({ duration: 30, cuts, energy: { windowSeconds: 0.5, values: quiet } }, { count: 4 });
    assert.ok(picks.length > 1 && picks.length <= 4);
    for (let i = 1; i < picks.length; i++) assert.ok(picks[i - 1].score >= picks[i].score);
    for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) {
        const shared = Math.max(0, Math.min(picks[i].end, picks[j].end) - Math.max(picks[i].start, picks[j].start));
        assert.ok(shared / Math.min(picks[i].end - picks[i].start, picks[j].end - picks[j].start) <= FINDER_DEFAULTS.maxOverlap);
    }
});

test('ranking is deterministic, works with no audio or speech, and refuses a clip shorter than the minimum', () => {
    const input = { duration: 30, cuts };
    assert.deepEqual(rankSegments(input), rankSegments(input));
    assert.ok(rankSegments(input).length > 0);
    assert.deepEqual(rankSegments({ duration: 2, cuts: [] }), []);
    const flat = rankSegments({ duration: 30, cuts: [], energy: { windowSeconds: 0.5, values: new Array(60).fill(0) } });
    assert.ok(flat.length > 0 && flat.every(p => Number.isFinite(p.score)), 'silence does not produce NaN');
});

test('a segment that cuts often is marked down against one continuous shot of the same length', () => {
    const ctx = { cuts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11] };
    const choppy = scoreSegment({ start: 0, end: 10 }, ctx), steady = scoreSegment({ start: 10.5, end: 20.5 }, { cuts: [] });
    assert.ok(steady.score > choppy.score);
    assert.ok(choppy.reasons.some(r => /Cuts often/.test(r)) && steady.reasons.includes('One continuous shot'));
});

test('speech is read from the clip\'s captions in source seconds, honouring where the clip starts in its source', () => {
    let tl = base();
    tl = ok(addSequenceText(tl, { text: 'one two three four', start: 60, len: 60, caption: true }));
    tl = ok(addSequenceText(tl, { text: 'outside the clip', start: 2000, len: 30, caption: true }));
    const spoken = speechFromCaptions(tl, { ...tl.video[0], in: 30, start: 0, len: 900 });
    assert.equal(spoken.length, 1);
    assert.deepEqual([spoken[0].start, spoken[0].end, spoken[0].words], [3, 5, 4]);
    assert.deepEqual(speechFromCaptions(base(), base().video[0]), []);
});

test('chosen clips go on after everything already on the timeline, in source order, as one edit', () => {
    const tl = base();
    const next = ok(insertClipSegments(tl, 'l-src', [{ start: 20, end: 25 }, { start: 10, end: 15 }]));
    assert.deepEqual(next.video.slice(1).map(c => [c.start, c.in, c.len]), [[900, 300, 150], [1050, 600, 150]]);
    assert.equal(sequenceEnd(next), 1200);
    assert.equal(tl.video.length, 1, 'the input is unchanged');
    assert.match(insertClipSegments(tl, 'l-src', []).error, /at least one/);
    assert.match(insertClipSegments(tl, 'l-src', [{ start: 5, end: 5 }]).error, /no length/);
    assert.ok(insertClipSegments(tl, 'l-missing', [{ start: 1, end: 4 }]).error);
});

import { createEnergyAccumulator } from '../app/veyrnox/_lib/editorClipFinder.mjs';
test('the energy accumulator gives the same loudness as measuring the whole signal, however the buffers are cut up', () => {
    const rate = 100, signal = Array.from({ length: 600 }, (_, i) => (i < 300 ? 0.2 : 0.8) * Math.sin(i / 3));
    const whole = energyWindows(signal, rate, 1).values;
    const acc = createEnergyAccumulator(1, 0, 6);
    for (let at = 0; at < signal.length; at += 70) acc.add(at / rate, rate, [signal.slice(at, at + 70)]);
    acc.result().values.forEach((v, i) => assert.ok(Math.abs(v - whole[i]) < 1e-9, `window ${i}`));
    assert.equal(acc.result().windowSeconds, 1);
});
test('the accumulator averages channels, starts at the clip\'s own start and ignores sound outside its range', () => {
    const acc = createEnergyAccumulator(1, 10, 12);
    acc.add(8, 4, [new Array(8).fill(1)]);                       // 8 s to 10 s: before the range
    acc.add(10, 4, [new Array(4).fill(0.6), new Array(4).fill(0.2)]); // mean 0.4 for the first window
    acc.add(11, 4, [new Array(4).fill(0)]);
    acc.add(12, 4, [new Array(4).fill(1)]);                       // after the range
    assert.deepEqual(acc.result().values.map(v => Number(v.toFixed(3))), [0.4, 0]);
    assert.deepEqual(createEnergyAccumulator(1, 0, 3).result().values, [0, 0, 0], 'no sound is silence, not NaN');
});
