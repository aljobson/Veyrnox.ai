import type { ApiClient } from '../src/lib/api';
import { mediaApi } from '../src/lib/media';
import { approvePlan, planMessage, type Plan } from '../src/lib/montage';
import { OFFLINE_PAID_MESSAGE, OfflineError, ensureOnline, isOffline, markOffline, resetNetworkState } from '../src/lib/network';

const plan = { idempotencyKey: 'k', expiresAt: Date.now() + 60_000 } as unknown as Plan;
const request = jest.fn();
const api = { request } as unknown as ApiClient;
const req = { modelId: 'm', prompt: 'p', durationSeconds: null, confirmedCredits: 3, idempotencyKey: 'k' };
const realFetch = globalThis.fetch;

beforeEach(() => {
    resetNetworkState();
    request.mockReset().mockResolvedValue({ job_id: 'j1' });
});
afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('paid actions while offline', () => {
    test('a generation is refused and nothing is sent', async () => {
        markOffline();
        globalThis.fetch = jest.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch;
        await expect(mediaApi(api).createGeneration(req)).rejects.toBeInstanceOf(OfflineError);
        expect(request).not.toHaveBeenCalled();
    });
    test('approving a video plan is refused and nothing is sent', async () => {
        markOffline();
        globalThis.fetch = jest.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch;
        await expect(approvePlan(api, plan, 'a brief about bees')).rejects.toBeInstanceOf(OfflineError);
        expect(request).not.toHaveBeenCalled();
    });
    test('the screen message says nothing was sent or charged', () => {
        expect(planMessage(new OfflineError())).toBe(OFFLINE_PAID_MESSAGE);
        expect(OFFLINE_PAID_MESSAGE).toMatch(/not charged/);
    });
    test('a stale offline mark does not block: the probe finds the network back and the action goes through', async () => {
        markOffline();
        globalThis.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
        await expect(mediaApi(api).createGeneration(req)).resolves.toEqual({ job_id: 'j1' });
        expect(request).toHaveBeenCalledTimes(1);
        expect(isOffline()).toBe(false);
    });
    test('online is never probed', async () => {
        const probe = jest.fn();
        await ensureOnline(probe);
        expect(probe).not.toHaveBeenCalled();
    });
});
