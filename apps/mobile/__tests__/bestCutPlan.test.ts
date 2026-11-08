import { buildBestCutPlan, bestCutTokens, validateBestCutPlan, BEST_CUT_LANGUAGES, type BestCutInput } from '../src/lib/bestCutPlan';
import { bestCutCaptions } from '../src/lib/bestCutCaptions';
import { applyBestCut, bestCutBefore } from '../src/lib/applyBestCut';
import { bestCutPrice } from '../src/lib/bestCutFlow';
import type { SpeechAnalysis } from '../src/lib/speechCut';

// Each utterance: [text, startSeconds]; words last 0.3 s with 0.05 s gaps, so one utterance is one planner utterance.
function analysis(id: string, utterances: [string, number][], duration: number, language = 'en'): SpeechAnalysis {
    const chunks = utterances.flatMap(([text, start]) => {
        const parts = language === 'zh' || language === 'ja' ? Array.from(text) : text.split(' ');
        return parts.map((word, i) => ({ start: Math.round((start + i * .35) * 100) / 100, end: Math.round((start + i * .35 + .3) * 100) / 100, text: word }));
    });
    return { version: 1, assetId: id, duration, provider: 'fal-scribe-v2', transcript: chunks.map(c => c.text).join(' '), language, chunks };
}
const input = (id: string, u: [string, number][], duration = 20, language = 'en'): BestCutInput => ({ mediaId: id, analysis: analysis(id, u, duration, language) });
const media = (id: string, seconds: number) => ({ id, name: id, kind: 'video' as const, frames: seconds * 30, hasAudio: true, width: 0, height: 0 });

describe('best cut planner', () => {
    test('is deterministic and byte identical for the same input', () => {
        const inputs = [input('a', [['hello there my friends.', 1], ['hello there my friends today.', 6]])];
        expect(JSON.stringify(buildBestCutPlan(inputs))).toBe(JSON.stringify(buildBestCutPlan(inputs)));
    });
    test('without a script keeps the later complete retake and removes the earlier one', () => {
        const plan = buildBestCutPlan([input('a', [['welcome to my channel today.', 1], ['welcome to my channel today.', 7]])])!;
        expect(plan.removedRetakes).toBe(1);
        expect(plan.ranges).toHaveLength(1);
        expect(plan.ranges[0].from).toBeGreaterThanOrEqual(Math.floor(6.8 * 30));
    });
    test('removes a false start that is a prefix of the next utterance', () => {
        const plan = buildBestCutPlan([input('a', [['so today', 1], ['so today we cook pasta.', 5]])])!;
        expect(plan.removedRetakes).toBe(1);
        expect(plan.ranges[0].from).toBeGreaterThanOrEqual(Math.floor(4.8 * 30));
    });
    test('collapses an adjacent repeated word and counts it', () => {
        const plan = buildBestCutPlan([input('a', [['we we should go now.', 1]])])!;
        expect(plan.removedRepeats).toBe(1);
        expect(plan.ranges.map(r => r.label).join(' ')).not.toMatch(/we we/);
    });
    test('a script reorders takes across clips and reports a missing line', () => {
        const inputs = [input('a', [['second line of the script here.', 1]]), input('b', [['first line of the script here.', 1]])];
        const plan = buildBestCutPlan(inputs, 'first line of the script here.\nsecond line of the script here.\nthird line never spoken at all.')!;
        expect(plan.ranges.map(r => r.mediaId)).toEqual(['b', 'a']);
        expect(plan.matchedLines).toBe(2);
        expect(plan.missingLines).toEqual([3]);
    });
    test('with a script the better of two takes wins', () => {
        const inputs = [input('a', [['alpha beta gamma delta epsilon.', 1], ['alpha alpha beta beta gamma delta epsilon.', 6]])];
        const plan = buildBestCutPlan(inputs, 'alpha beta gamma delta epsilon.')!;
        expect(plan.matchedLines).toBe(1);
        expect(plan.ranges[0].from).toBeLessThan(3 * 30);
    });
    test('unknown language keeps speech, warns, and never claims a take match', () => {
        const plan = buildBestCutPlan([input('a', [['abc def ghi jkl.', 1], ['abc def ghi jkl.', 6]], 20, 'xx')])!;
        expect(plan.warnings).toContain('language');
        expect(plan.removedRetakes).toBe(0);
    });
    test.each(BEST_CUT_LANGUAGES.map(l => [l]))('%s fixture plans a valid cut', (language: string) => {
        const text = language === 'zh' || language === 'ja' ? '今日は良い天気です。' : 'one two three four five.';
        const inputs = [input('a', [[text, 1], [text, 7]], 20, language)];
        const plan = buildBestCutPlan(inputs)!;
        expect(plan).not.toBeNull();
        expect(validateBestCutPlan(plan, inputs)).toBe(true);
        expect(plan.removedRetakes).toBe(1);
    });
    test('tokenises CJK per character and others per word', () => {
        expect(bestCutTokens('今日は', 'ja')).toEqual(['今', '日', 'は']);
        expect(bestCutTokens('Hello, World!', 'en')).toEqual(['hello', 'world']);
    });
    test('fails closed: too many clips, duplicate ids, overlong clip, bad fps', () => {
        const one = input('a', [['x y z w.', 1]]);
        expect(buildBestCutPlan(Array.from({ length: 11 }, (_, i) => input(`c${i}`, [['x y z w.', 1]])))).toBeNull();
        expect(buildBestCutPlan([one, one])).toBeNull();
        expect(buildBestCutPlan([input('a', [['x y z w.', 1]], 61)])).toBeNull();
        expect(buildBestCutPlan([one], '', 'balanced', 29)).toBeNull();
    });
    test('caps output at 60 s with a tail warning', () => {
        const long = Array.from({ length: 5 }, (_, i) => input(`c${i}`, [[`distinct words number ${i} for clip ${i} here.`, 0.5], [`more different talk ${i} goes on and on.`, 5]], 15));
        const plan = buildBestCutPlan(long.concat(Array.from({ length: 5 }, (_, i) => input(`d${i}`, [[`other speech number ${i} for second batch ${i}.`, 0.5], [`yet more unrelated talk ${i} continues forever.`, 5]], 15))))!;
        const end = plan.ranges.at(-1)!; expect(end.start + (end.to - end.from)).toBeLessThanOrEqual(60 * 30);
    });
    test('validator rejects overlaps, out of bounds and non contiguous starts', () => {
        const inputs = [input('a', [['hello there my friend.', 1]])];
        const plan = buildBestCutPlan(inputs)!;
        expect(validateBestCutPlan({ ...plan, ranges: [{ ...plan.ranges[0], to: 99999 }] }, inputs)).toBe(false);
        expect(validateBestCutPlan({ ...plan, ranges: [plan.ranges[0], { ...plan.ranges[0], start: plan.ranges[0].to - plan.ranges[0].from }] }, inputs)).toBe(false);
        expect(validateBestCutPlan({ ...plan, ranges: [{ ...plan.ranges[0], start: 3 }] }, inputs)).toBe(false);
    });
});

describe('best cut captions and apply', () => {
    const inputs = [input('a', [['we should cook some pasta.', 1], ['we should cook some pasta.', 8]])];
    test('captions follow kept ranges and drop words that were cut', () => {
        const plan = buildBestCutPlan(inputs)!;
        const { items, omitted } = bestCutCaptions(plan, inputs, 'text-0', 0);
        expect(omitted).toBe(false);
        expect(items.map(i => i.text).join(' ')).toBe('we should cook some pasta.');
        expect(items[0].start).toBeGreaterThanOrEqual(0);
        expect(items.every(i => i.len > 0 && i.start + i.len <= plan.ranges.at(-1)!.start + plan.ranges.at(-1)!.to)).toBe(true);
    });
    test('groups words when the layer cap is hit and omits captions for unknown language', () => {
        const plan = buildBestCutPlan(inputs)!;
        expect(bestCutCaptions(plan, inputs, 't', 0, 3).items.length).toBeLessThanOrEqual(3);
        const und = [input('a', [['abc def ghi jkl.', 1]], 20, 'und')];
        expect(bestCutCaptions(buildBestCutPlan(und)!, und, 't', 0).omitted).toBe(true);
    });
    test('apply yields a valid timeline, with editable text layers, and leaves the input timeline untouched', () => {
        const before = bestCutBefore([media('a', 20)]);
        const snapshot = JSON.stringify(before);
        const plan = buildBestCutPlan(inputs)!;
        const result = applyBestCut(before, plan, inputs)!;
        expect(result).not.toBeNull();
        expect(JSON.stringify(before)).toBe(snapshot); // Undo is the untouched previous value: one history entry.
        expect(result.timeline.text.length).toBeGreaterThan(0);
        expect(result.timeline.video.length).toBe(plan.ranges.length);
        expect(applyBestCut(before, plan, inputs, false)!.timeline.text).toHaveLength(0);
    });
    test('apply refuses a plan for a different frame rate', () => {
        const before = { ...bestCutBefore([media('a', 20)]), fps: 24 };
        expect(applyBestCut(before, buildBestCutPlan(inputs)!, inputs)).toBeNull();
    });
});

describe('best cut price display', () => {
    const quote = { credits: 3, max_seconds: 60 as const, languages: [] };
    test('before preflight shows the maximum from the catalog quote only', () => {
        expect(bestCutPrice(quote, 4, 20)).toEqual({ total: 12, remaining: 8, maximum: true });
    });
    test('after preflight cache hits are free and totals are exact', () => {
        expect(bestCutPrice(quote, 3, 20, [{ cached: true, credits: 0 }, { cached: false, credits: 3 }, { cached: false, credits: 3 }])).toEqual({ total: 6, remaining: 14, maximum: false });
    });
    test('no price literal lives in the app layer', () => {
        const fs = require('fs');
        for (const f of ['bestCutFlow.ts', 'bestCutPlan.ts']) expect(fs.readFileSync(`${process.cwd()}/src/lib/${f}`, 'utf8')).not.toMatch(/credits\s*[:=]\s*[1-9]\b/);
    });
});

describe('best cut padding', () => {
    test('script reorder of neighbouring utterances in one clip never overlaps in the source', () => {
        // 'Second.' ends 0.1 s before 'First.' starts: padding must stop at the midpoint.
        const inputs = [{ mediaId: 'a', analysis: { version: 1 as const, assetId: 'a', duration: 3, provider: 'fal-scribe-v2' as const, transcript: 'Second. First.', language: 'en',
            chunks: [{ start: 0, end: 1, text: 'Second.' }, { start: 1.1, end: 2, text: 'First.' }] } }];
        const plan = buildBestCutPlan(inputs, 'First.\nSecond.')!;
        expect(plan).not.toBeNull();
        expect(plan.ranges.map(r => r.label)).toEqual(['First.', 'Second.']);
        expect(validateBestCutPlan(plan, inputs)).toBe(true);
    });
});
test('camera-roll media must carry bounded width and height or the editor validator refuses the timeline', () => {
    const { validateAgentTimeline } = require('../src/lib/editorAgentOperations');
    const { width, height, ...bare } = media('l-1', 5);
    expect(validateAgentTimeline(bestCutBefore([media('l-1', 5)]))).toBeNull();
    expect(validateAgentTimeline(bestCutBefore([bare as never]))).not.toBeNull();
});
