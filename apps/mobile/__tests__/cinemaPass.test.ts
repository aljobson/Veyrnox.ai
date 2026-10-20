import { fetchPass, parsePass, passIsLive } from '../src/lib/cinemaPass';

const NOW = Date.parse('2026-10-20T00:00:00Z');

test('no pass reads as null; statuses map; junk dates are dropped', () => {
    expect(parsePass({ pass: null })).toBeNull();
    expect(parsePass('x')).toBeNull();
    expect(parsePass({ pass: { status: 'active', current_period_end: '2026-11-01T00:00:00Z', cancel_at_period_end: true } })).toEqual({ status: 'active', periodEnd: '2026-11-01T00:00:00Z', cancelsAtPeriodEnd: true });
    expect(parsePass({ pass: { status: 'canceled', current_period_end: 'nope' } })).toEqual({ status: 'ended', periodEnd: null, cancelsAtPeriodEnd: false });
    expect(parsePass({ pass: { status: 'pending' } })?.status).toBe('pending');
});

test('an active pass past its end date is not live', () => {
    expect(passIsLive({ status: 'active', periodEnd: '2026-11-01T00:00:00Z', cancelsAtPeriodEnd: false }, NOW)).toBe(true);
    expect(passIsLive({ status: 'active', periodEnd: '2026-10-01T00:00:00Z', cancelsAtPeriodEnd: false }, NOW)).toBe(false);
    expect(passIsLive({ status: 'ended', periodEnd: null, cancelsAtPeriodEnd: false }, NOW)).toBe(false);
    expect(passIsLive(null, NOW)).toBe(false);
});

test('reads the route with no query and never sends a write', async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const api = { request: async (path: string, init?: RequestInit) => { calls.push({ path, init }); return { pass: null } as never; } };
    expect(await fetchPass(api)).toBeNull();
    expect(calls).toEqual([{ path: '/api/v1/cinema/pass', init: undefined }]);
});
