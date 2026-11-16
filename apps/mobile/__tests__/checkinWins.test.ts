import type { ApiClient } from '../src/lib/api';
import type { YourWins } from '../src/lib/yourWins';

const wins = (current: number) => ({ ok: true, streak: { current, best: current, last7: [] }, milestones: [] } as unknown as YourWins);
const claim = { ok: true, already_claimed: false, streak: 1, day: 1, credits: 1, balance_after: 65 };
const request = jest.fn();
const api = { request, getBalance: jest.fn(async () => ({ balance: 65, free_credits: 0, free_expires_at: null })) } as unknown as ApiClient;
test('a check-in drops the cached wins so the card shows the new streak without a restart', async () => {
    const original = process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED;
    process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED = 'true';
    let checkin!: typeof import('../src/lib/checkin'), yourWins!: typeof import('../src/lib/yourWins'), cache!: typeof import('../src/lib/appCache');
    jest.isolateModules(() => { checkin = require('../src/lib/checkin'); yourWins = require('../src/lib/yourWins'); cache = require('../src/lib/appCache'); });
    try {
        await cache.wipeCache(); await cache.bindCacheUser('alice');
        request.mockResolvedValueOnce(wins(0));
        expect((await yourWins.fetchYourWins(api))?.streak?.current).toBe(0);
        request.mockResolvedValueOnce(claim);
        await checkin.claimCheckin(api);
        request.mockResolvedValueOnce(wins(1));
        expect((await yourWins.fetchYourWins(api))?.streak?.current).toBe(1);
        expect(request).toHaveBeenLastCalledWith('/api/v1/wins');
    } finally {
        await cache.wipeCache();
        if (original === undefined) delete process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED; else process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED = original;
    }
});
