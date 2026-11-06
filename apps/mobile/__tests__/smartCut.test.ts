import {
    buildSmartCutPlan,
    smartCutPlanUsesAvailableTakes,
    smartCutPlanWithinLimits,
    swapSmartCutTake,
    type SmartCutSource,
} from '../src/lib/smartCut';

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
});
