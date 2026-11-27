import {
    buildSmartCutPlan,
    buildSpeechAwareCutPlan,
    smartCutPlanUsesAvailableTakes,
    smartCutPlanWithinLimits,
    swapSmartCutTake,
    type SmartCutSource,
} from '../src/lib/smartCut';
import type { SpeechAnalysis } from '../src/lib/speechCut';
import { smartCutNetCredits } from '../src/lib/smartCutBilling';

const takes: SmartCutSource[] = [
    { id: 'take-a', assetId: 'asset-a', name: 'Take A', duration: 20, rangeStart: 0, rangeEnd: 20 },
    { id: 'take-b', assetId: 'asset-b', name: 'Take B', duration: 20, rangeStart: 0, rangeEnd: 20 },
];

describe('Smart Cut planning', () => {
    test('builds a deterministic local plan within Clip Editor limits', () => {
        const input = { clips: takes, script: 'Open with the product. Show the result. End on the logo.', pacing: 'balanced' as const };
        const first = buildSmartCutPlan(input);
        const second = buildSmartCutPlan(input);

        expect(second).toEqual(first);
        expect(first.segments).toHaveLength(3);
        expect(first.segments.map(segment => segment.takeId)).toEqual(['take-a', 'take-b', 'take-a']);
        expect(smartCutPlanWithinLimits(first)).toBe(true);
        expect(smartCutPlanUsesAvailableTakes(first, takes)).toBe(true);
    });

    test('swaps a section to another take and retimes that take without overlap', () => {
        const plan = buildSmartCutPlan({ clips: takes, script: 'First. Second. Third.', pacing: 'snappy' });
        const swapped = swapSmartCutTake(plan, 'section-1', 'take-b');
        const takeB = swapped.segments.filter(segment => segment.takeId === 'take-b');

        expect(swapped.segments[0].takeId).toBe('take-b');
        expect(takeB.every((segment, index) => index === 0 || segment.start >= takeB[index - 1].end)).toBe(true);
        expect(smartCutPlanWithinLimits(swapped)).toBe(true);
    });

    test('caps the draft at ten sections and sixty seconds', () => {
        const script = Array.from({ length: 15 }, (_, index) => `Section ${index + 1}.`).join(' ');
        const plan = buildSmartCutPlan({ clips: [{ ...takes[0], duration: 120, rangeEnd: 120 }], script, pacing: 'relaxed' });

        expect(plan.segments).toHaveLength(10);
        expect(plan.totalDuration).toBeLessThanOrEqual(60);
        expect(plan.warnings.at(-1)).toContain('10-section');
    });

    test('speech-aware planning applies one global segment and duration budget across takes', () => {
        const sources: SmartCutSource[] = [
            { id: 'take-a', assetId: 'asset-a', name: 'Take A', duration: 80, rangeStart: 0, rangeEnd: 40 },
            { id: 'take-b', assetId: 'asset-b', name: 'Take B', duration: 80, rangeStart: 0, rangeEnd: 40 },
        ];
        const analysis = (assetId: string): SpeechAnalysis => ({
            version: 1, assetId, duration: 80, provider: 'fal-scribe-v2', transcript: 'words', language: 'en', timingQuality: 'word',
            chunks: Array.from({ length: 12 }, (_, index) => ({ start: index * 3, end: index * 3 + 0.5, text: `word${index}` })),
        });
        const plan = buildSpeechAwareCutPlan({ clips: sources, analyses: new Map([['asset-a', analysis('asset-a')], ['asset-b', analysis('asset-b')]]) });

        expect(plan.mode).toBe('transcript-silence');
        expect(plan.segments.length).toBeLessThanOrEqual(10);
        expect(plan.totalDuration).toBeLessThanOrEqual(60);
        expect(smartCutPlanWithinLimits(plan)).toBe(true);
        expect(plan.warningDetails?.some((warning) => warning.code === 'segment_limit_reached')).toBe(true);
    });

    test('speech-aware planning aligns the script and preserves notes', () => {
        const analysis: SpeechAnalysis = {
            version: 1, assetId: 'asset-a', duration: 20, provider: 'fal-scribe-v2', transcript: 'hello', language: 'en', timingQuality: 'word',
            chunks: [{ start: 1, end: 2, text: 'hello' }],
        };
        const plan = buildSpeechAwareCutPlan({ clips: [takes[0]], analyses: new Map([['asset-a', analysis]]), script: '  hello  ', notes: '  Prefer opening  ' });
        expect(plan.scriptProvided).toBe(true);
        expect(plan.notes).toBe('Prefer opening');
        expect(plan.segments[0]).toMatchObject({ matchCode: 'script_line_matched', matchParameters: { line: 1, confidence: .95, coverage: 1, precision: 1 } });
        expect(plan.warningDetails).not.toContainEqual(expect.objectContaining({ code: 'script_not_aligned' }));
    });

    test('speech-aware script plans swap only to analysed alternate ranges', () => {
        const analysis = (assetId: string, start: number): SpeechAnalysis => ({
            version: 1, assetId, duration: 20, provider: 'fal-scribe-v2', transcript: 'same complete line.', language: 'en', timingQuality: 'word',
            chunks: [{ start, end: start + .3, text: 'same' }, { start: start + .4, end: start + .7, text: 'complete' }, { start: start + .8, end: start + 1.1, text: 'line.' }],
        });
        const plan = buildSpeechAwareCutPlan({ clips: takes, analyses: new Map([['asset-a', analysis('asset-a', 1)], ['asset-b', analysis('asset-b', 3)]]), script: 'same complete line.' });
        const original = plan.segments[0].takeId;
        const alternate = plan.segments[0].alternates[0];
        const swapped = swapSmartCutTake(plan, plan.segments[0].id, alternate);
        expect(swapped.segments[0].takeId).toBe(alternate);
        expect(swapped.segments[0].alternates).toContain(original);
        expect(swapped.segments[0].reasonParameters).toMatchObject({ manual: true });
        expect(swapped.qualityChecks).toContainEqual(expect.objectContaining({ code: 'source_ranges_non_overlapping' }));
        expect(swapSmartCutTake(plan, plan.segments[0].id, 'not-analysed')).toBe(plan);
    });

    test('more than ten groups across three takes merge without losing speech', () => {
        const sources: SmartCutSource[] = Array.from({ length: 3 }, (_, index) => ({ id: `take-${index}`, assetId: `asset-${index}`, name: `Take ${index}`, duration: 10 }));
        const analyses = new Map(sources.map((source, takeIndex) => [source.assetId, {
            version: 1, assetId: source.assetId, duration: 10, provider: 'fal-scribe-v2', transcript: 'four groups', language: 'en', timingQuality: 'word',
            chunks: Array.from({ length: 4 }, (_, groupIndex) => ({ start: groupIndex * 2, end: groupIndex * 2 + .4, text: `take${takeIndex}-word${groupIndex}` })),
        } satisfies SpeechAnalysis]));
        const plan = buildSpeechAwareCutPlan({ clips: sources, analyses });
        const warning = plan.warningDetails?.find((item) => item.code === 'segment_limit_reached');
        expect(plan.segments).toHaveLength(10);
        expect(warning?.parameters).toMatchObject({ mergedGroups: 2, omittedGroups: 0 });
        expect(plan.segments.flatMap((segment) => segment.label.split(' '))).toEqual(
            Array.from({ length: 3 }, (_, take) => Array.from({ length: 4 }, (_, word) => `take${take}-word${word}`)).flat());
    });

    test('more than ten source clips return a distinct structured source-limit error', () => {
        const sources = Array.from({ length: 11 }, (_, index) => ({ id: `take-${index}`, assetId: `asset-${index}`, name: `Take ${index}`, duration: 2 }));
        const analyses = new Map(sources.map((source) => [source.assetId, {
            version: 1, assetId: source.assetId, duration: 2, provider: 'fal-scribe-v2', transcript: 'word', language: 'en', timingQuality: 'word',
            chunks: [{ start: .2, end: 1, text: 'word' }],
        } satisfies SpeechAnalysis]));
        expect(() => buildSpeechAwareCutPlan({ clips: sources, analyses })).toThrow(expect.objectContaining({
            code: 'source_clip_limit_reached', parameters: expect.objectContaining({ sourceClips: 11 }),
        }));
    });

    test('speech removals are scoped to the selected take window and speech sections cannot swap takes', () => {
        const source: SmartCutSource = { id: 'take-a', assetId: 'asset-a', name: 'Take A', duration: 12, rangeStart: 4, rangeEnd: 8 };
        const analysis: SpeechAnalysis = {
            version: 1, assetId: 'asset-a', duration: 12, provider: 'fal-scribe-v2', transcript: 'hello um there', language: 'en', timingQuality: 'word',
            chunks: [{ start: 4.2, end: 4.6, text: 'hello' }, { start: 5, end: 5.2, text: 'um' }, { start: 5.5, end: 6, text: 'there' }],
        };
        const plan = buildSpeechAwareCutPlan({ clips: [source], analyses: new Map([['asset-a', analysis]]), removals: [
            { takeId: 'take-a', start: 1, end: 2 },
            { takeId: 'take-a', start: 4.97, end: 5.23 },
        ] });

        expect(plan.removalsApplied).toBe(1);
        expect(plan.segments.every((segment) => segment.start >= 4 && segment.end <= 8)).toBe(true);
        const swapped = swapSmartCutTake(plan, plan.segments[0].id, 'take-b');
        expect(swapped).toBe(plan);
    });

    test('the output cap never reports omitted speech as removed silence', () => {
        const sources: SmartCutSource[] = [
            { id: 'take-a', assetId: 'asset-a', name: 'Take A', duration: 40 },
            { id: 'take-b', assetId: 'asset-b', name: 'Take B', duration: 40 },
        ];
        const analyses = new Map(sources.map((source) => [source.assetId, {
            version: 1, assetId: source.assetId, duration: 40, provider: 'fal-scribe-v2', transcript: 'continuous', language: 'en', timingQuality: 'word',
            chunks: [{ start: 0, end: 40, text: 'continuous' }],
        } satisfies SpeechAnalysis]));
        const plan = buildSpeechAwareCutPlan({ clips: sources, analyses });
        expect(plan.totalDuration).toBe(40);
        expect(plan.silenceRemoved).toBe(0);
        expect(plan.warningDetails?.some((warning) => warning.code === 'output_limit_reached')).toBe(true);
    });

    test('the output cap stops at the last complete word', () => {
        const source: SmartCutSource = { id: 'take-a', assetId: 'asset-a', name: 'Take A', duration: 70, rangeStart: 0, rangeEnd: 70 };
        const analysis: SpeechAnalysis = {
            version: 1, assetId: 'asset-a', duration: 70, provider: 'fal-scribe-v2', transcript: 'first crossing', language: 'en', timingQuality: 'word',
            chunks: [{ start: 0, end: 59, text: 'first' }, { start: 59.7, end: 60.3, text: 'crossing' }],
        };
        const plan = buildSpeechAwareCutPlan({ clips: [source], analyses: new Map([['asset-a', analysis]]) });
        expect(plan.totalDuration).toBe(59);
        expect(plan.segments.at(-1)?.end).toBe(59);
        expect(plan.warningDetails?.some((warning) => warning.code === 'output_limit_reached')).toBe(true);
    });

    test('a non-hundredth word end at the cap is canonicalized without clipping the word', () => {
        const source: SmartCutSource = { id: 'take-a', assetId: 'asset-a', name: 'Take A', duration: 70, rangeStart: 0, rangeEnd: 70 };
        const analysis: SpeechAnalysis = {
            version: 1, assetId: 'asset-a', duration: 70, provider: 'fal-scribe-v2', transcript: 'first crossing', language: 'en', timingQuality: 'word',
            chunks: [{ start: 0, end: 59.123, text: 'first' }, { start: 59.7, end: 60.3, text: 'crossing' }],
        };
        const plan = buildSpeechAwareCutPlan({ clips: [source], analyses: new Map([['asset-a', analysis]]) });
        expect(plan.segments.at(-1)?.end).toBe(59.12);
        expect(Number(((plan.segments.at(-1)?.end ?? 0) * 100).toFixed(8)) % 1).toBe(0);
    });

    test('a trim through a word drops the partial word and reports it', () => {
        const source: SmartCutSource = { id: 'take-a', assetId: 'asset-a', name: 'Take A', duration: 8, rangeStart: 2, rangeEnd: 6 };
        const analysis: SpeechAnalysis = {
            version: 1, assetId: 'asset-a', duration: 8, provider: 'fal-scribe-v2', transcript: 'partial kept', language: 'en', timingQuality: 'word',
            chunks: [{ start: 1.8, end: 2.4, text: 'partial' }, { start: 3, end: 3.5, text: 'kept' }],
        };
        const plan = buildSpeechAwareCutPlan({ clips: [source], analyses: new Map([['asset-a', analysis]]) });
        expect(plan.segments.every((segment) => segment.start >= 2 && segment.end <= 6)).toBe(true);
        expect(plan.segments.some((segment) => segment.label.includes('partial'))).toBe(false);
        expect(plan.warningDetails?.find((warning) => warning.code === 'trim_intersects_unit')?.parameters.count).toBe(1);
    });

    test('a trim through a phrase drops the partial phrase and keeps complete speech', () => {
        const source: SmartCutSource = { id: 'take-a', assetId: 'asset-a', name: 'Take A', duration: 8, rangeStart: 2, rangeEnd: 6 };
        const analysis: SpeechAnalysis = {
            version: 1, assetId: 'asset-a', duration: 8, provider: 'fal-wizper', transcript: 'partial kept', language: 'en', timingQuality: 'phrase',
            chunks: [{ start: 1.8, end: 2.4, text: 'partial phrase' }, { start: 3, end: 3.5, text: 'kept phrase' }],
        };
        const plan = buildSpeechAwareCutPlan({ clips: [source], analyses: new Map([['asset-a', analysis]]) });
        expect(plan.segments.some((segment) => segment.label.includes('partial'))).toBe(false);
        expect(plan.warningDetails?.find((warning) => warning.code === 'trim_intersects_unit')?.parameters.count).toBe(1);
    });

    test('an over-budget phrase is rejected instead of cut mid-phrase', () => {
        const source: SmartCutSource = { id: 'take-a', assetId: 'asset-a', name: 'Take A', duration: 70, rangeStart: 0, rangeEnd: 70 };
        const analysis: SpeechAnalysis = {
            version: 1, assetId: 'asset-a', duration: 70, provider: 'fal-wizper', transcript: 'one long phrase', language: 'en', timingQuality: 'phrase',
            chunks: [{ start: 0, end: 61, text: 'one long phrase' }],
        };
        expect(() => buildSpeechAwareCutPlan({ clips: [source], analyses: new Map([['asset-a', analysis]]) })).toThrow('longer than the Clip Editor output budget');
    });

    test('billing uses server evidence and a later refund overrides an earlier charge', () => {
        expect(smartCutNetCredits({ credits: 0 })).toBe(0);
        expect(smartCutNetCredits({ credits: 5 })).toBe(5);
        expect(smartCutNetCredits({ credits: 5, refunded: true })).toBe(0);
        expect(smartCutNetCredits({})).toBeNull();
    });

    test('filler removal is opt-in and only changes a plan after a reviewed range is supplied', () => {
        const source: SmartCutSource = { id: 'take-a', assetId: 'asset-a', name: 'Take A', duration: 8, rangeStart: 0, rangeEnd: 8 };
        const analysis: SpeechAnalysis = {
            version: 1, assetId: 'asset-a', duration: 8, provider: 'fal-scribe-v2', transcript: 'hello um there', language: 'en', timingQuality: 'word',
            chunks: [{ start: 1, end: 1.4, text: 'hello' }, { start: 2, end: 2.2, text: 'um' }, { start: 3, end: 3.5, text: 'there' }],
        };
        const analyses = new Map([['asset-a', analysis]]);
        const untouched = buildSpeechAwareCutPlan({ clips: [source], analyses });
        const reviewed = buildSpeechAwareCutPlan({ clips: [source], analyses, removals: [{ takeId: 'take-a', start: 1.95, end: 2.25 }] });

        expect(untouched.removalsApplied).toBe(0);
        expect(reviewed.removalsApplied).toBe(1);
        expect(reviewed.totalDuration).toBeLessThan(untouched.totalDuration);
    });

    test('a fully removed standalone filler inside the rendered window is reported as applied', () => {
        const source: SmartCutSource = { id: 'take-a', assetId: 'asset-a', name: 'Take A', duration: 8 };
        const analysis: SpeechAnalysis = {
            version: 1, assetId: 'asset-a', duration: 8, provider: 'fal-scribe-v2', transcript: 'hello um goodbye', language: 'en', timingQuality: 'word',
            chunks: [{ start: 0.5, end: 0.9, text: 'hello' }, { start: 2.5, end: 2.8, text: 'um' }, { start: 5, end: 5.5, text: 'goodbye' }],
        };
        const plan = buildSpeechAwareCutPlan({
            clips: [source], analyses: new Map([['asset-a', analysis]]), removals: [{ takeId: 'take-a', start: 2.47, end: 2.83 }],
        });

        expect(plan.segments).toHaveLength(2);
        expect(plan.removalsApplied).toBe(1);
    });
});
