import { createNativeAssetPort, type NativePlayableAsset } from '../src/lib/beatNative/nativeAssets';
import type { ApiClient } from '../src/lib/api';
import type { SessionTask } from '../src/auth/sessionTask';
import { soundAsset, BEAT_SOUNDS } from '../src/lib/beatNative/labs';
import { fakeContext } from './beatNativeTakeFixtures';
import { USER } from './beatNativeFixtures';
import { createNativeHeldAssets } from '../src/lib/beatNative/nativeHeldAssets';

const remote: NativePlayableAsset = {
    source: 'song',
    ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', jobId: '33333333-3333-4333-8333-333333333333' },
    name: 'Song', durationSec: 2, bpm: null, sourceChannels: 2, encodedBytes: 100,
};
const stem: NativePlayableAsset = {
    source: 'stem',
    ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', requestId: '44444444-4444-4444-8444-444444444444', part: 'vocals' },
    name: 'Vocals', durationSec: 2, bpm: null, sourceChannels: 2, encodedBytes: 123,
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
test('stem archives require a signed size, extract the selected part, validate and decode it', async () => {
    const context = fakeContext().context, decoded = context.createBuffer(2, 96_000, 48_000), backing = new Uint8Array([9, 1, 2, 3, 9]), bytes = backing.subarray(1, 4);
    context.decodeAudioData = jest.fn(async () => decoded);
    const request = jest.fn(async () => ({ url: 'https://audio.test/stems.zip', size_bytes: 456 }));
    const loadStem = jest.fn(async () => bytes), checkDecoded = jest.fn();
    const port = createNativeAssetPort(api(request), task().value, { loadStem, checkDecoded, validAsset: () => true });
    await expect(port.load({ ...stem, encodedBytes: 3 }, 120, context)).resolves.toBe(decoded);
    expect(request).toHaveBeenCalledWith('/api/v1/music/stem-requests/44444444-4444-4444-8444-444444444444/archive', { signal: undefined }, expect.any(Object));
    expect(loadStem).toHaveBeenCalledWith({ url: 'https://audio.test/stems.zip', sizeBytes: 456, part: 'vocals', signal: undefined, current: expect.any(Function) });
    const encoded = (context.decodeAudioData as jest.Mock).mock.calls[0][0] as ArrayBuffer;
    expect([...new Uint8Array(encoded)]).toEqual([1, 2, 3]);
    expect(checkDecoded).toHaveBeenCalledWith(decoded, { ...stem, encodedBytes: 3 });
});
test('two parts from one request download and scan the archive once', async () => {
    const context = fakeContext().context, decoded = context.createBuffer(2, 96_000, 48_000);
    context.decodeAudioData = jest.fn(async () => decoded);
    const request = jest.fn(async () => ({ url: 'https://audio.test/stems.zip', size_bytes: 456 }));
    const loadStemParts = jest.fn(async () => ({ vocals: new Uint8Array(123), instrumental: new Uint8Array(123) }));
    const port = createNativeAssetPort(api(request), task().value, { loadStemParts, checkDecoded: jest.fn(), validAsset: () => true });
    const instrumental = { ...stem, ref: { ...stem.ref as Record<string, string>, part: 'instrumental' }, name: 'Instrumental' };
    await port.load(stem, 120, context);
    await port.load(instrumental, 120, context);
    expect(loadStemParts).toHaveBeenCalledTimes(1);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    // Once both parts have crossed into decoded owners, no extracted archive entry stays resident.
    await port.load(stem, 120, context);
    expect(loadStemParts).toHaveBeenCalledTimes(2);
    port.close?.();
});
test('one aborted stem waiter does not cancel a concurrent live waiter', async () => {
    const context = fakeContext().context, decoded = context.createBuffer(2, 96_000, 48_000);
    context.decodeAudioData = jest.fn(async () => decoded);
    const request = jest.fn(async () => ({ url: 'https://audio.test/stems.zip', size_bytes: 456 }));
    let resolveParts!: (parts: { vocals: Uint8Array; instrumental: Uint8Array }) => void;
    let sharedSignal: AbortSignal | undefined;
    const loadStemParts = jest.fn(({ signal }: { signal?: AbortSignal }) => new Promise<{ vocals: Uint8Array; instrumental: Uint8Array }>((resolve, reject) => {
        sharedSignal = signal; resolveParts = resolve;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const port = createNativeAssetPort(api(request), task().value, { loadStemParts: loadStemParts as never, checkDecoded: jest.fn(), validAsset: () => true });
    const instrumental = { ...stem, ref: { ...stem.ref as Record<string, string>, part: 'instrumental' }, name: 'Instrumental' };
    const firstController = new AbortController(), secondController = new AbortController();
    const first = port.load(stem, 120, context, firstController.signal);
    const second = port.load(instrumental, 120, context, secondController.signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    firstController.abort(new Error('first_cancelled'));
    await expect(first).rejects.toThrow('first_cancelled');
    expect(sharedSignal?.aborted).toBe(false);
    resolveParts({ vocals: new Uint8Array(123), instrumental: new Uint8Array(123) });
    await expect(second).resolves.toBe(decoded);
    expect(loadStemParts).toHaveBeenCalledTimes(1);
});
test('archive release aborts an otherwise live shared transfer', async () => {
    const context = fakeContext().context;
    const request = jest.fn(async () => ({ url: 'https://audio.test/stems.zip', size_bytes: 456 }));
    const loadStemParts = jest.fn(({ signal }: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const port = createNativeAssetPort(api(request), task().value, { loadStemParts: loadStemParts as never, validAsset: () => true });
    const pending = port.load(stem, 120, context);
    await new Promise(resolve => setTimeout(resolve, 0));
    port.releaseArchives?.();
    await expect(pending).rejects.toThrow('audio_load_cancelled');
});
test('missing stem size is refused before download and an expired archive URL is re-signed once', async () => {
    const context = fakeContext().context, decoded = context.createBuffer(2, 96_000, 48_000), session = task();
    context.decodeAudioData = jest.fn(async () => decoded);
    const missing = jest.fn(async () => ({ url: 'https://audio.test/stems.zip' })), loadStem = jest.fn();
    await expect(createNativeAssetPort(api(missing), session.value, { loadStem, validAsset: () => true }).load(stem, 120, context)).rejects.toThrow('asset_unavailable');
    expect(loadStem).not.toHaveBeenCalled();

    const request = jest.fn().mockResolvedValueOnce({ url: 'https://audio.test/old.zip', size_bytes: 100 })
        .mockResolvedValueOnce({ url: 'https://audio.test/new.zip', size_bytes: 100 });
    loadStem.mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 403 })).mockResolvedValueOnce(new Uint8Array(123));
    const port = createNativeAssetPort(api(request), session.value, { loadStem, checkDecoded: jest.fn(), validAsset: () => true });
    await expect(port.load(stem, 120, context)).resolves.toBe(decoded);
    expect(request).toHaveBeenCalledTimes(2); expect(loadStem).toHaveBeenCalledTimes(2);
});
test('a held response is canonicalized, retained by signing identity, and blocks later signing', async () => {
    const heldAssets = createNativeHeldAssets(), context = fakeContext().context, request = jest.fn()
        .mockRejectedValue(Object.assign(new Error('private response'), { status: 404, body: { error: 'held' } }));
    const port = createNativeAssetPort(api(request), task().value, { heldAssets, validAsset: () => true });
    await expect(port.load(remote, 120, context)).rejects.toMatchObject({ status: 404, code: 'held' });
    expect(heldAssets.isHeld(remote)).toBe(true);
    await expect(port.load({ ...remote, name: 'Alias' }, 120, context)).rejects.toMatchObject({ code: 'held' });
    expect(request).toHaveBeenCalledTimes(1);
});
test('an aborted late held response cannot repopulate a store cleared for retry', async () => {
    const heldAssets = createNativeHeldAssets(), context = fakeContext().context, controller = new AbortController();
    const request = jest.fn(async () => {
        controller.abort(new Error('superseded'));
        throw Object.assign(new Error('late held'), { status: 404, code: 'held' });
    });
    const port = createNativeAssetPort(api(request), task().value, { heldAssets, validAsset: () => true });
    await expect(port.load(remote, 120, context, controller.signal)).rejects.toThrow('superseded');
    expect(heldAssets.isHeld(remote)).toBe(false);
});
