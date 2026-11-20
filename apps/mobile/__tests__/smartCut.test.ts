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
        expect(plan.warnings.some((warning) => warning.includes('10-section'))).toBe(true);
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
        expect(swapped.segments).toEqual(plan.segments);
        expect(swapped.warnings.at(-1)).toContain('analysed source take');
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
        expect(plan.totalDuration).toBe(60);
        expect(plan.silenceRemoved).toBe(0);
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
});
