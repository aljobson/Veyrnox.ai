import { act, createElement } from 'react';
import { createRoot } from 'test-renderer';
import { ApiError, type ApiClient } from '../src/lib/api';
import { claimCheckin, checkinErrorKey, getCheckinStatus } from '../src/lib/checkin';
import { appCache, bindCacheUser, wipeCache } from '../src/lib/appCache';
import { POLICIES } from '../src/lib/cache';
import { CreditsChip } from '../src/components/HeaderChips';

const mockApi = {
    request: jest.fn(),
    getBalance: jest.fn(async () => ({ balance: 10, free_credits: 10, free_expires_at: null })),
} as unknown as ApiClient;
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (callback: () => void) => {
        const React = jest.requireActual('react');
        React.useEffect(callback, [callback]);
    },
}));
const claim = { ok: true, already_claimed: false, streak: 3, day: 3, credits: 2, balance_after: 12 };
const request = mockApi.request as jest.Mock;
beforeEach(async () => {
    request.mockReset();
    (mockApi.getBalance as jest.Mock).mockResolvedValue({ balance: 10, free_credits: 10, free_expires_at: null });
    await wipeCache(); await bindCacheUser('alice');
});
afterEach(async () => { await wipeCache(); });
test('404 hides the feature on GET and POST; BUSY has retry copy', async () => {
    request.mockRejectedValue(new ApiError(404, 'not_found'));
    expect(await getCheckinStatus(mockApi)).toBeNull();
    expect(await claimCheckin(mockApi)).toBeNull();
    expect(checkinErrorKey(new ApiError(409, 'checkin_busy'))).toBe('checkin.busy');
    request.mockRejectedValue(new ApiError(403, 'account_unavailable'));
    await expect(claimCheckin(mockApi)).rejects.toMatchObject({ code: 'account_unavailable' });
});
test('claim updates the mounted HeaderChips CreditsChip and cache without navigation', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    try {
        await act(async () => { root.render(createElement(CreditsChip)); });
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === '10 credits').length).toBeGreaterThan(0);
        request.mockResolvedValue(claim);
        (mockApi.getBalance as jest.Mock).mockResolvedValue({ balance: 12, free_credits: 10, free_expires_at: null });
        await act(async () => { expect(await claimCheckin(mockApi)).toEqual(claim); });
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === '12 credits').length).toBeGreaterThan(0);
        expect(mockApi.request).toHaveBeenCalledWith('/api/v1/checkin', { method: 'POST' });
        expect((await appCache.read(POLICIES.balance, 'alice'))?.value).toEqual({ balance: 12, free_credits: 10, free_expires_at: null });
    } finally { await act(async () => root.unmount()); }
});
test('an in-flight claim cannot publish to a newly signed-in account', async () => {
    let resolve!: (value: unknown) => void;
    request.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = claimCheckin(mockApi);
    await bindCacheUser('bob');
    resolve(claim); await pending;
    expect(await appCache.read(POLICIES.balance, 'bob')).toBeNull();
});

test('the cache settles on spendable credits when expired buckets remain in ledger balance', async () => {
    request.mockResolvedValue({ ...claim, balance_after: 22 });
    (mockApi.getBalance as jest.Mock).mockResolvedValue({ balance: 12, free_credits: 0, free_expires_at: null });
    await claimCheckin(mockApi);
    expect((await appCache.read<{ balance: number }>(POLICIES.balance, 'alice'))?.value.balance).toBe(12);
});
