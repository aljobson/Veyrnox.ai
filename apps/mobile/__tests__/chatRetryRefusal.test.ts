import { retryRefusalIsUnsettled } from '../src/lib/chat';

describe('retryRefusalIsUnsettled (REPLAY-01, EARLY-REPLAY-01)', () => {
    test('any refusal of a retry is looked for, never called free', () => {
        for (const status of [400, 402, 403, 409, 429, 502, 503]) expect(retryRefusalIsUnsettled(true, status)).toBe(true);
    });
    test('a refusal of a first send ends it as before', () => {
        for (const status of [400, 402, 409, 429, 503]) expect(retryRefusalIsUnsettled(false, status)).toBe(false);
    });
});
