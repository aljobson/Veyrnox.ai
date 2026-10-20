import { POLL_DEGRADED_MS, POLL_OK_MS, nextPollDelay, readServiceStatus } from '../src/lib/serviceStatus';

describe('service status', () => {
    test('only an explicit degraded answer is an outage', () => {
        expect(readServiceStatus({ status: 'degraded' })).toBe('degraded');
        for (const body of [{ status: 'ok' }, { status: 'unknown' }, {}, null, 'degraded', [], { status: 'DEGRADED' }]) {
            expect(readServiceStatus(body)).toBe('ok');
        }
    });
    test('it looks again sooner while the notice shows', () => {
        expect(nextPollDelay('ok')).toBe(POLL_OK_MS);
        expect(nextPollDelay('degraded')).toBe(POLL_DEGRADED_MS);
        expect(POLL_DEGRADED_MS).toBeLessThan(POLL_OK_MS);
    });
});
