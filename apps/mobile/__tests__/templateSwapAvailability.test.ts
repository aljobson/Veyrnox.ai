jest.mock('expo-router', () => ({ useFocusEffect: jest.fn(), useRouter: jest.fn() }));
import { fetchSwapAvailability, nextOffer } from '../src/lib/templateSwap/availability';
const offer = { id: 'x', model: 'kling-o1-reference' as const, credits: 47, durationSeconds: 5 as const, images: 2 as const, role: 'main character' };
const fetcher = (status: number, value: unknown = offer) => jest.fn(async () => ({ status, json: async () => value })) as unknown as typeof fetch;
test('dark build makes no request; strict 200 only', async () => {
    const f = fetcher(200); expect(await fetchSwapAvailability('x', { fetcher: f })).toEqual({ kind: 'absent' }); expect(f).not.toHaveBeenCalled();
    expect(await fetchSwapAvailability('x', { enabled: true, fetcher: f })).toEqual({ kind: 'offer', offer });
    for (const patch of [{ id: 'y' }, { model: 'other' }, { credits: 0 }, { credits: 1.2 }, { images: 1 }, { durationSeconds: 6 }, { role: ' ' }]) expect(await fetchSwapAvailability('x', { enabled: true, fetcher: fetcher(200, { ...offer, ...patch }) })).toEqual({ kind: 'transient' });
    expect(await fetchSwapAvailability('x', { enabled: true, fetcher: fetcher(404) })).toEqual({ kind: 'absent' });
    expect(nextOffer(offer, 'x', { kind: 'transient' })).toBe(offer);
    expect(nextOffer(offer, 'y', { kind: 'transient' })).toBeNull();
    expect(nextOffer(offer, 'x', { kind: 'absent' })).toBeNull();
});
test('manual four-second deadline works without AbortSignal.timeout/any', async () => {
    jest.useFakeTimers(); const f = jest.fn(() => new Promise(() => {}));
    const promise = fetchSwapAvailability('x', { enabled: true, fetcher: f as never });
    jest.advanceTimersByTime(4000); expect(await promise).toEqual({ kind: 'transient' });
    expect((f.mock.calls as unknown as [string, RequestInit][])[0][1].signal?.aborted).toBe(true); jest.useRealTimers();
});
