import { cutFrames, decodeCuts, encodeCuts, SMART_CUT_FPS } from '../src/lib/smartCutHandoff';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('Smart Cut -> editor handoff (the join happens on the phone, no server job)', () => {
    test('round-trips the plan through a route param', () => {
        const cuts = [{ jobId: A, start: 0.5, end: 3 }, { jobId: B, start: 0, end: 2.25 }];
        expect(decodeCuts(encodeCuts(cuts))).toEqual(cuts);
    });

    test('refuses anything that is not a short, well-formed list', () => {
        for (const bad of [undefined, '', 'nope', '{}', '[]', '[["x",0,1]]', `[["${A}",2,1]]`, `[["${A}",-1,1]]`, `[["${A}",0,"1"]]`, `[["${A}",0,1,9]]`,
            JSON.stringify(Array(11).fill([A, 0, 1])), `[["${A}",0,99999]]`, `[["../x",0,1]]`]) {
            expect(decodeCuts(bad as string | undefined)).toBeNull();
        }
    });

    test('turns seconds into whole frames, never an empty clip, and counts every cut', () => {
        expect(SMART_CUT_FPS).toBe(30);
        expect(cutFrames({ jobId: A, start: 1, end: 3.5 })).toEqual({ in: 30, len: 75 });
        expect(cutFrames({ jobId: A, start: 0, end: 0.001 })).toEqual({ in: 0, len: 1 });
    });
});
