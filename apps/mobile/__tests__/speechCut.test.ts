import { applySpeechRanges, keptAfterRemovals, parseSmartCutAnalysis, retakeRanges, silenceRangePlan, silenceRanges, silenceRemovalProposalPlan, SpeechCutPlanError, speechClip } from '../src/lib/speechCut';
import { emptyTimeline, framesIn, type Timeline } from '../src/lib/nativeEditorModel';
// Shared fixtures are exercised by the real web normalizer/planner, never copied expected steps.
const { fixtures, assetId, silence, stretched, words } = require('../../../tests/fixtures/speechCut.mjs');
const web = require('../../../app/veyrnox/_lib/smartCutAnalysis.js');
function timeline(duration = 12): Timeline {
    return { ...emptyTimeline(), seq: 1, media: { [`j-${assetId}`]: { id: `j-${assetId}`, name: 'Take', kind: 'video', frames: duration * 30 } },
        video: [{ id: 'v1', mediaId: `j-${assetId}`, in: 0, start: 0, len: duration * 30, trackId: 'video-0', rate: 1, volume: 1, transition: 0 }] };
}
function normalized(result: unknown, duration = 12) {
    const value = web.normaliseScribeResult({ assetId, duration, result }); expect(value.ok).toBe(true);
    const parsed = parseSmartCutAnalysis(value.analysis, { assetId, duration }); expect(parsed).toEqual(web.parseSmartCutAnalysis(value.analysis, { assetId, duration }));
    if (!parsed.ok) throw Error(parsed.error); return parsed.analysis;
}
function parity(result: unknown, duration = 12, start = 0, end = duration) {
    const analysis = normalized(result, duration), tl = timeline(duration);
    tl.video[0] = { ...tl.video[0], in: Math.ceil(start * 30), len: Math.floor((end - start) * 30) };
    const target = speechClip(tl, null)!;
    const plan = web.buildSpeechAwareCutPlan({ clips: [{ id: 'v1', assetId, duration, in_s: start, out_s: end }], analyses: { [assetId]: analysis } });
    const expected = plan.segments.map((s: any) => ({ start: s.start, end: s.end, label: s.label }));
    const kept = silenceRanges(analysis, start, end);
    expect(kept.map(({ start, end }) => ({ start, end }))).toEqual(expected.map(({ start, end }: any) => ({ start, end })));
    // Compare complete resulting documents, including source trims, offsets, lanes and duration.
    expect(applySpeechRanges(tl, target, kept)).toEqual(applySpeechRanges(tl, target, expected));
    return { analysis, kept, next: applySpeechRanges(tl, target, kept) };
}
test.each(fixtures as { language: string; restart: unknown; control: unknown; repetition: unknown }[])('$language word-shaped fixture normalizes ISO-639-3 and matches web timeline', (fixture: any) => {
    expect(parity(fixture.restart).analysis.language).toBe(fixture.language);
    parity(fixture.control, 12, .5, 10);
});
test.each(fixtures as { language: string; restart: unknown; control: unknown; repetition: unknown }[])('$language utterance restart keeps last; control and short repetition propose nothing', (fixture: any) => {
    const a = normalized(fixture.restart), removed = retakeRanges(a);
    expect(removed).toHaveLength(1); expect(removed[0].start).toBeLessThan(1); expect(removed[0].end).toBeLessThan(5);
    const kept = keptAfterRemovals(removed, 0, 12); expect(kept.some(r => r.start <= 5 && r.end > 6)).toBe(true);
    expect(retakeRanges(normalized(fixture.control))).toEqual([]);
    expect(retakeRanges(normalized(fixture.repetition))).toEqual([]);
    expect(retakeRanges({ ...a, language: 'und' })).toEqual([]);
});
test('silence-only never proposes erasing a whole clip', () => {
    expect(web.normaliseScribeResult({ assetId, duration: 12, result: silence })).toEqual({ ok: false, error: 'analysis_no_speech' });
    expect(parseSmartCutAnalysis({ version: 1, assetId, duration: 12, provider: 'fal-scribe-v2', transcript: '', chunks: [] }).ok).toBe(false);
});
test('a stretched word spanning a pause is kept intact', () => {
    const { kept, next } = parity(stretched, 6); expect(kept).toHaveLength(1); expect(kept[0].start).toBeLessThan(.2); expect(kept[0].end).toBeGreaterThan(5.8); expect(next).not.toBeNull();
});
test('ten sections and sixty-second output caps match web; locked/overfull timelines refused', () => {
    const result = { language_code: 'eng', text: 'words', words: Array.from({ length: 15 }, (_, i) => ({ type: 'word', text: `word${i}`, start: i * 5, end: i * 5 + 3 })) };
    const { kept, next } = parity(result, 75); expect(kept).toHaveLength(10); expect(framesIn(next!)).toBeLessThanOrEqual(1800);
    const long = normalized({ language_code: 'eng', text: 'long', words: [{ type: 'word', text: 'long', start: 0, end: 75 }] }, 75);
    expect(() => web.buildSpeechAwareCutPlan({ clips: [{ id: 'v1', assetId, duration: 75 }], analyses: { [assetId]: long } })).toThrow(expect.objectContaining({ code: 'unit_exceeds_budget' }));
    expect(() => silenceRangePlan(long, 0, 75)).toThrow(expect.objectContaining({ code: 'unit_exceeds_budget' }));
    const tl = timeline(); tl.tracks = tl.tracks.map(t => ({ ...t, locked: true })); expect(applySpeechRanges(tl, speechClip(tl, null)!, [{ start: 1, end: 2, label: '' }])).toBeNull();
});

test('trim and output caps drop partial words identically to web', () => {
    const trimmed = { language_code: 'eng', text: 'partial kept', words: [
        { type: 'word', text: 'partial', start: 1.8, end: 2.4 },
        { type: 'word', text: 'kept', start: 2.45, end: 3 },
    ] };
    const result = parity(trimmed, 8, 2, 6);
    expect(result.kept[0].start).toBeGreaterThanOrEqual(2.4);
    expect(result.kept[0].label).toBe('kept');

    const capped = { language_code: 'eng', text: 'first crossing', words: [
        { type: 'word', text: 'first', start: 0, end: 59 },
        { type: 'word', text: 'crossing', start: 59.7, end: 60.3 },
    ] };
    expect(parity(capped, 70).kept.at(-1)?.end).toBe(59);

    const onlyPartial = normalized({ language_code: 'eng', text: 'partial', words: [{ type: 'word', text: 'partial', start: 1.8, end: 2.4 }] }, 8);
    expect(() => silenceRangePlan(onlyPartial, 2, 6)).toThrow(SpeechCutPlanError);
    expect(() => silenceRangePlan(onlyPartial, 2, 6)).toThrow(expect.objectContaining({ code: 'trim_intersects_unit' }));
});
test('in-place silence removal never preselects a trim-boundary word or applies the Smart Cut output cap', () => {
    const analysis = normalized({ language_code: 'eng', text: 'boundary kept later', words: [
        { type: 'word', text: 'boundary', start: 1.8, end: 2.4 },
        { type: 'word', text: 'kept', start: 2.6, end: 3 },
        { type: 'word', text: 'later', start: 64, end: 65 },
    ] }, 70);
    const proposal = silenceRemovalProposalPlan(analysis, 2, 70);
    const boundaryIndex = proposal.removals.findIndex((range) => range.start <= 2 && range.end >= 2.4);
    expect(boundaryIndex).toBeGreaterThanOrEqual(0);
    expect(proposal.checked[boundaryIndex]).toBe(false);
    expect(proposal.warningDetails.some((warning) => warning.code === 'output_limit_reached')).toBe(false);
    expect(proposal.ranges.at(-1)?.end).toBeGreaterThanOrEqual(65);
});
test('had had, very very, distant repeats, unknown language and fewer than four tokens never propose', () => {
    for (const phrase of ['had had', 'very very', 'I want tea']) {
        const result = { text: phrase, words: [...words(phrase, 1), ...words(phrase, 5)], language_code: 'eng' };
        expect(retakeRanges(normalized(result))).toEqual([]);
    }
    const a = normalized(fixtures[0].restart); a.chunks = a.chunks.map(c => c.start >= 5 ? { ...c, start: c.start + 9, end: c.end + 9 } : c); a.duration = 25;
    expect(retakeRanges(a)).toEqual([]);
    expect(normalized({ ...fixtures[0].restart, language_code: 'xxx' }).language).toBe('und');
});
test('prefix restarts remove an earlier fragment, never a complete take followed by a shorter fragment', () => {
    const fragment = 'I would like some', complete = 'I would like some coffee with milk today';
    const result = (a: string, b: string) => ({ language_code: 'eng', text: `${a} ${b}`, words: [...words(a, 1), ...words(b, 5)] });
    expect(retakeRanges(normalized(result(fragment, complete)))).toHaveLength(1);
    expect(retakeRanges(normalized(result(complete, fragment)))).toEqual([]);
});
test('reverse, source trimming and rate preserve selected range; selected audio wins over first video', () => {
    const tl = timeline(); tl.video[0] = { ...tl.video[0], in: 60, len: 120, rate: 2, reverse: true };
    const next = applySpeechRanges(tl, speechClip(tl, null)!, [{ start: 1, end: 4, label: '' }, { start: 6, end: 11, label: '' }])!;
    expect(next.video.map(c => [c.in, c.len, c.start])).toEqual([[180, 60, 0], [60, 30, 60]]);
    tl.audio = [{ ...tl.video[0], id: 'a1', trackId: 'audio-0' }]; expect(speechClip(tl, { track: 'audio', id: 'a1' })?.track).toBe('audio');
});

test('overlap merging and punctuation utterances use timestamps without cutting inside words', () => {
    const overlapped = { language_code: 'eng', text: 'a b c', words: [
        { type: 'word', text: 'a', start: 1, end: 3 }, { type: 'word', text: 'b', start: 2, end: 4 }, { type: 'word', text: 'c', start: 5, end: 6 },
    ] };
    expect(parity(overlapped).kept).toHaveLength(2);
    const repeated = { language_code: 'eng', text: 'I would like tea. I would like tea.', words: [...words('I would like tea.', 1), ...words('I would like tea.', 1.8)] };
    expect(retakeRanges(normalized(repeated))).toHaveLength(1); // punctuation, although the gap is under .45s
    const tl = timeline(); tl.audio = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, start: 0, len: 30, trackId: 'audio-0' }));
    expect(applySpeechRanges(tl, speechClip(tl, null)!, [{ start: 1, end: 2, label: '' }])).toBeNull();
});

test.each(['snappy', 'natural', 'relaxed', 'balanced'] as const)('%s silence preset matches the web planner and timing quality matches web', (preset) => {
    const result = { language_code: 'eng', text: 'one two three four', words: [
        { type: 'word', text: 'one', start: .5, end: 1 }, { type: 'word', text: 'two', start: 1.6, end: 2 },
        { type: 'word', text: 'three', start: 3, end: 3.5 }, { type: 'word', text: 'four', start: 5, end: 5.5 } ] };
    const analysis = normalized(result);
    const plan = web.buildSpeechAwareCutPlan({ clips: [{ id: 'v1', assetId, duration: 12, in_s: 0, out_s: 12 }], analyses: { [assetId]: analysis }, silencePreset: preset });
    expect(silenceRanges(analysis, 0, 12, preset).map(({ start, end }) => ({ start, end }))).toEqual(plan.segments.map((s: any) => ({ start: s.start, end: s.end })));
    expect(analysis.timingQuality).toBe('word');
    expect(web.parseSmartCutAnalysis({ ...analysis, provider: 'fal-wizper' }, { assetId, duration: 12 }).analysis.timingQuality).toBe('phrase');
    expect(parseSmartCutAnalysis({ ...analysis, provider: 'fal-wizper' }, { assetId, duration: 12 })).toEqual(web.parseSmartCutAnalysis({ ...analysis, provider: 'fal-wizper' }, { assetId, duration: 12 }));
});
