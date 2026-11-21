import { sendsContent } from '../src/lib/aiConsent';
import { isPaidAction } from '../src/lib/hardPaywall';
import { aiPaths } from '../src/lib/beatAi/shared';
import type { Op } from '../src/lib/beatAi/types';
const id = '00000000-0000-4000-8000-000000000001';
for (const op of ['generate', 'stems', 'targetStems', 'extend', 'replace'] as Op[]) {
    test(`${op}: only submit requires consent and payment`, () => {
        const paths = aiPaths(op, id);
        expect(sendsContent(`/api/v1${paths.submit}`, 'POST')).toBe(true);
        expect(isPaidAction(`/api/v1${paths.submit}`, 'POST')).toBe(true);
        expect(sendsContent(`/api/v1${paths.quote}`, 'POST')).toBe(false);
        expect(isPaidAction(`/api/v1${paths.quote}`, 'POST')).toBe(false);
    });
}
