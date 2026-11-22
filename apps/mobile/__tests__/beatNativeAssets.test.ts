import { createNativeAssetPort, type NativePlayableAsset } from '../src/lib/beatNative/nativeAssets';
import type { ApiClient } from '../src/lib/api';
import type { SessionTask } from '../src/auth/sessionTask';
import { soundAsset, BEAT_SOUNDS } from '../src/lib/beatNative/labs';
import { fakeContext } from './beatNativeTakeFixtures';
import { USER } from './beatNativeFixtures';

const remote: NativePlayableAsset = {
    source: 'song',
    ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', jobId: '33333333-3333-4333-8333-333333333333' },
    name: 'Song', durationSec: 2, bpm: null, sourceChannels: 2, encodedBytes: 100,
};
function task(user: string | null = USER) {
    let current = true;
    const value = { gen: 1, user, current: () => current, tokens: Object.assign(async () => null, { generation: () => 1, expected: 1 }) } as SessionTask;
    return { value, expire: () => { current = false; } };
}
const api = (request = jest.fn()) => ({ request, stream: jest.fn(), getBalance: jest.fn() }) as unknown as ApiClient;

test('built-in sounds decode locally without an account or API call', async () => {
    const context = fakeContext().context, decoded = context.createBuffer(2, 16, 48000);
    context.decodeAudioData = jest.fn(async () => decoded);
    const request = jest.fn(), port = createNativeAssetPort(api(request), task(null).value);
    const result = await port.load(soundAsset(BEAT_SOUNDS[0], 120), 120, context);
    expect(result).toBe(decoded); expect(context.decodeAudioData).toHaveBeenCalledTimes(1); expect(request).not.toHaveBeenCalled();
});
test('remote audio is owner-fenced, re-signs once on an expired URL, and returns the decoded buffer', async () => {
    const context = fakeContext().context, decoded = context.createBuffer(2, 96_000, 48_000), session = task();
    const request = jest.fn().mockResolvedValueOnce({ url: 'https://audio.test/old' }).mockResolvedValueOnce({ url: 'https://audio.test/new' });
    const fetchAsset = jest.fn().mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 403 })).mockResolvedValueOnce({ buffer: decoded });
    const port = createNativeAssetPort(api(request), session.value, { fetchAsset, validAsset: () => true });
    await expect(port.load(remote, 120, context)).resolves.toBe(decoded);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('/api/v1/jobs/33333333-3333-4333-8333-333333333333/asset', { signal: undefined }, { owner: USER, task: session.value });
    expect(fetchAsset.mock.calls.map(call => call[0])).toEqual(['https://audio.test/old', 'https://audio.test/new']);
});
test('invalid metadata and an account change fail before stale audio can be returned', async () => {
    const context = fakeContext().context, request = jest.fn(), session = task();
    const invalid = createNativeAssetPort(api(request), session.value, { validAsset: () => false });
    await expect(invalid.load(remote, 120, context)).rejects.toThrow('asset_unavailable');
    expect(request).not.toHaveBeenCalled();
    const decoded = context.createBuffer(2, 96_000, 48_000);
    const changed = createNativeAssetPort(api(jest.fn(async () => ({ url: 'https://audio.test/song' }))), session.value, {
        validAsset: () => true,
        fetchAsset: async () => { session.expire(); return { buffer: decoded }; },
    });
    await expect(changed.load(remote, 120, context)).rejects.toThrow('account_changed');
});
