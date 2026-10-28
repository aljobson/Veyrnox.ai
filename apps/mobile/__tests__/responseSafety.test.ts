import { ApiError, createApiClient } from '../src/lib/api';
import { createCache, createMemoryStorage, POLICIES } from '../src/lib/cache';
import { publishBalance, subscribeBalance } from '../src/lib/balanceEvents';
import { isCheckinClaim, isCheckinStatus } from '../src/lib/responseShapes';

const good = { balance: 12, free_credits: 2, free_expires_at: null };
const api = () => createApiClient({ baseUrl: 'https://test.example', getAccessToken: async () => 'token', onSessionLost: jest.fn() });
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
test('successful HTML and empty responses throw bad_response', async () => {
    for (const body of ['<html>Sign in to Wi-Fi</html>', '']) {
        globalThis.fetch = jest.fn(async () => new Response(body, { status: 200 }));
        await expect(api().request('/test')).rejects.toMatchObject({ status: 200, code: 'bad_response' });
    }
});
test.each([null, [], 'error', 12, false])('non-object error body %p remains an ApiError', async body => {
    globalThis.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status: 503 }));
    await expect(api().request('/test')).rejects.toMatchObject({ status: 503, code: 'unknown' });
});
test.each([{}, null, { ...good, balance: '12' }, { ...good, free_credits: null }])('rejects malformed balance %p', async body => {
    globalThis.fetch = jest.fn(async () => new Response(JSON.stringify(body)));
    await expect(api().getBalance()).rejects.toMatchObject({ code: 'bad_response' });
});
test.each([true, false])('discards an older cached {} before a refresh; refresh succeeds=%s', async succeeds => {
    const storage = createMemoryStorage(), cache = createCache(storage);
    await storage.set('veyrnox.cache.v1.balance.alice', JSON.stringify({ savedAt: Date.now(), value: {} }));
    const onData = jest.fn();
    const fetcher = jest.fn(async () => { if (!succeeds) throw new Error('offline'); return good; });
    const refresh = cache.swr({ policy: POLICIES.balance, userId: 'alice', fetcher, onData });
    if (succeeds) {
        await expect(refresh).resolves.toMatchObject({ value: good });
        expect(onData).toHaveBeenCalledTimes(1);
        expect(onData.mock.calls[0][0]).toEqual(good);
    } else {
        await expect(refresh).rejects.toThrow('offline');
        expect(onData).not.toHaveBeenCalled();
        expect(await cache.read(POLICIES.balance, 'alice')).toBeNull();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
});
test('bad refreshes, direct writes and publications retain the last finite balance', async () => {
    const cache = createCache(createMemoryStorage()), listener = jest.fn(), unsubscribe = subscribeBalance(listener);
    await cache.write(POLICIES.balance, good, 'alice');
    for (const balance of [NaN, Infinity, -Infinity, undefined]) {
        await cache.write(POLICIES.balance, { ...good, balance }, 'alice');
        publishBalance('alice', balance as number);
    }
    await cache.write(POLICIES.balance, {}, 'alice');
    const onData = jest.fn();
    await expect(cache.swr({ policy: POLICIES.balance, userId: 'alice', fetcher: async () => ({}), onData })).resolves.toMatchObject({ value: good });
    expect(onData).toHaveBeenCalledTimes(1);
    expect((await cache.read(POLICIES.balance, 'alice'))?.value).toEqual(good);
    expect(listener).not.toHaveBeenCalled(); unsubscribe();
});
test('bad balance with no saved copy fails SWR without a write or publication', async () => {
    const cache = createCache(createMemoryStorage()), onData = jest.fn();
    await expect(cache.swr({ policy: POLICIES.balance, userId: 'alice', fetcher: async () => ({}), onData })).rejects.toBeInstanceOf(ApiError);
    expect(onData).not.toHaveBeenCalled(); expect(await cache.read(POLICIES.balance, 'alice')).toBeNull();
});
test('check-in guards reject missing fields, non-finite numbers and non-array rewards', () => {
    const status = { ok: true, claimed_today: false, streak: 0, next_day: 1, next_credits: 1, rewards: [1, 2] };
    const claim = { ok: true, already_claimed: false, streak: 1, day: 1, credits: 1, balance_after: 11 };
    expect(isCheckinStatus(status)).toBe(true); expect(isCheckinClaim(claim)).toBe(true);
    for (const bad of [null, {}, { ...status, rewards: {} }, { ...status, rewards: [Infinity] }, { ...status, next_day: NaN }]) expect(isCheckinStatus(bad)).toBe(false);
    for (const bad of [null, {}, { ...claim, balance_after: NaN }, { ...claim, credits: Infinity }, { ...claim, streak: '1' }]) expect(isCheckinClaim(bad)).toBe(false);
});

test('bad_response uses existing generic display messages', () => {
    const { generationMessage } = require('../src/lib/generationSubmit');
    const { faceFilterUploadMessage } = require('../src/lib/faceFilters');
    const { checkinErrorKey } = require('../src/lib/checkin');
    const { t } = require('../src/lib/i18n');
    const error = new ApiError(200, 'bad_response');
    expect(generationMessage(error)).toBe(t('form.err.default'));
    expect(faceFilterUploadMessage(error)).toBe(t('common.error'));
    expect(checkinErrorKey(error)).toBe('checkin.error');
});
