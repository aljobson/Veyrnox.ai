import { bestCutOutputPlans, musicVideoPlan } from '../src/lib/bestCutOutputs';
import { buildBestCutPlan, type BestCutInput } from '../src/lib/bestCutPlan';
import type { SpeechAnalysis } from '../src/lib/speechCut';

function input(id: string, starts: number[], duration = 160): BestCutInput {
    const chunks = starts.map((start, index) => ({ start, end: start + 12, text: `complete section ${index + 1}.` }));
    const analysis: SpeechAnalysis = { version: 1, assetId: id, duration, provider: 'fal-scribe-v2', transcript: chunks.map(row => row.text).join(' '), language: 'en', chunks };
    return { mediaId: id, analysis };
}

test('builds multiple validated reels from the planner omitted tail', () => {
    const inputs = [input('long', [0, 20, 40, 60, 80, 100, 120])];
    const plan = buildBestCutPlan(inputs, 'complete section 1.\ncomplete section 2.\ncomplete section 3.\ncomplete section 4.\ncomplete section 5.\ncomplete section 6.\ncomplete section 7.')!;
    expect(plan.warnings).toContain('output_limit_reached');
    const outputs = bestCutOutputPlans(plan, inputs, 3);
    expect(outputs.length).toBeGreaterThan(1);
    expect(outputs.length).toBeLessThanOrEqual(3);
    expect(outputs.every(output => output.ranges.at(-1)!.start + output.ranges.at(-1)!.to - output.ranges.at(-1)!.from <= output.fps * 60)).toBe(true);
    expect(outputs.flatMap(output => output.ranges).every((range, index, rows) => !rows.slice(0, index).some(previous => previous.mediaId === range.mediaId && previous.from < range.to && previous.to > range.from))).toBe(true);
});

test('returns one output when the source has no safe omitted tail', () => {
    const inputs = [input('short', [1, 12], 30)];
    const plan = buildBestCutPlan(inputs)!;
    expect(bestCutOutputPlans(plan, inputs, 5)).toEqual([plan]);
});

test('Music Video keeps complete imported sections and omits speech-edit claims', () => {
    const inputs = [input('take-a', [1], 20), input('take-b', [1], 25)];
    const plan = musicVideoPlan(inputs)!;
    expect(plan.ranges.map(range => [range.mediaId, range.from, range.to])).toEqual([['take-a', 0, 600], ['take-b', 0, 750]]);
    expect(plan.ranges[1].start).toBe(600);
    expect(plan.removedPauses).toBe(0);
    expect(plan.removedRetakes).toBe(0);
});
