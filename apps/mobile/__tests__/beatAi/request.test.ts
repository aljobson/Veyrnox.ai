import { randomUUID } from 'expo-crypto';
import { placementIds } from '../../src/lib/beatAi/shared';
import { ApiError } from '../../src/lib/api';
import { ConsentDeclinedError } from '../../src/lib/aiConsent';
import { guardPaidAction, setHardPaywallLocked } from '../../src/lib/hardPaywall';
import { pendingStore } from '../../src/lib/beatAi/pending';
import { magicPendingStore } from '../../src/lib/beatAi/magicPending';
import { magicLayers } from '../../src/lib/beatAi/magicLayers';
import { ReceiptRequest } from '../../src/lib/beatAi/request';
import { resetNetworkState } from '../../src/lib/networkState';
import { files, client, owner, beatId, quote, row, magicRow, id, deferred, asset } from './fixtures';
import type { Pending, MagicPending } from '../../src/lib/beatAi/types';
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000042') }));
const finish = jest.fn(async () => ({ message: 'beatAi.placed' }));
function setup() {
    const f = files(), c = client(), storage = pendingStore(f.port); let current = true;
    const off = jest.fn();
    const request = new ReceiptRequest<Pending>({ owner, beatId, storage, client: c.client, current: () => current, off, finish });
    return { ...f, ...c, storage, flow: request, off, stop: () => { current = false; } };
}
beforeEach(() => { resetNetworkState(); jest.clearAllMocks(); });
afterEach(() => { setHardPaywallLocked(false); });
test('write before POST; rapid taps single-flight; ambiguous retry preserves original price and key', async () => {
    const x = setup(); const wait = deferred<unknown>();
    await x.flow.price(async () => quote, () => row());
    x.request.mockImplementation(async () => { expect((await x.storage.read(owner, beatId))[0].quote.total_credits).toBe(37); return wait.promise; });
    const first = x.flow.send(), second = x.flow.send();
    wait.resolve({ generation_id: id(8), state: 'queued' }); await Promise.all([first, second]);
    expect(x.request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(x.request.mock.calls[0][1].body).idempotency_key).toBe(row().key);
});
test('failed durable write blocks POST', async () => {
    const x = setup(); await x.flow.price(async () => quote, () => row());
    jest.mocked(x.port.write).mockRejectedValue(new Error('disk_full')); await x.flow.send(); expect(x.request).not.toHaveBeenCalled();
});
for (const error of [new ApiError(0, 'network'), new ApiError(401, 'not_authenticated'), new ApiError(429, 'rate_limited', { retryAfterSeconds: 60 }), new ApiError(503, 'beat_ai_unavailable')]) {
    test(`ambiguous ${error.status} keeps receipt and resumes without POST`, async () => {
        const x = setup(); await x.flow.price(async () => quote, () => row()); x.request.mockRejectedValue(error); await x.flow.send();
        expect((await x.storage.read(owner, beatId))[0].key).toBe(row().key);
        const resumed = setup(); // use the original store for the restarted controller
        const flow = new ReceiptRequest<Pending>({ owner, beatId, storage: x.storage, client: resumed.client, current: () => true, off: jest.fn(), finish });
        await flow.resume(row()); expect(resumed.request).not.toHaveBeenCalled(); expect(flow.snapshot().quote?.total_credits).toBe(37); expect(flow.snapshot().message).toBe('beatAi.original');
        resumed.request.mockResolvedValue({ generation_id: id(8), state: 'queued' }); await flow.send();
        expect(JSON.parse(resumed.request.mock.calls[0][1].body).idempotency_key).toBe(row().key);
    });
}
test('lost ack followed by flag flip preserves key; definitive refusal retires', async () => {
    const x = setup(); await x.flow.price(async () => quote, () => row());
    x.request.mockRejectedValueOnce(new ApiError(0, 'network')).mockRejectedValueOnce(new ApiError(503, 'beat_ai_unavailable'));
    await x.flow.send(); await x.flow.send(); expect(x.off).toHaveBeenCalled(); expect(await x.storage.read(owner, beatId)).toHaveLength(1);
    expect(x.request.mock.calls.map(call => JSON.parse(call[1].body).idempotency_key)).toEqual([row().key, row().key]);
    x.request.mockRejectedValue(new ApiError(400, 'prompt_invalid')); await x.flow.send(); expect(await x.storage.read(owner, beatId)).toEqual([]);
});
test('account B cannot read A; generation change after poll prevents finish and retirement', async () => {
    const x = setup(), accepted = { ...row(), requestId: id(8) }; await x.storage.put(accepted);
    expect(await x.storage.read(id(9), beatId)).toEqual([]);
    const wait = deferred<unknown>(); x.request.mockReturnValue(wait.promise);
    const resume = x.flow.resume(accepted); await Promise.resolve(); await Promise.resolve(); x.stop();
    wait.resolve({ state: 'succeeded', candidates: [] }); await resume;
    expect(finish).not.toHaveBeenCalled(); expect(await x.storage.read(owner, beatId)).toHaveLength(1);
});
test('Magic terminal candidates survive relaunch; saved layer precedes retirement', async () => {
    const f = files(), c = client(), storage = magicPendingStore(f.port), layers = magicLayers(f.port);
    const accepted: MagicPending = { ...magicRow(), requestId: id(8) };
    const candidates = [{ ordinal: 1, state: 'succeeded', song_id: id(5), version_id: id(6), job_id: id(7) }];
    const create = () => new ReceiptRequest<MagicPending>({ owner, beatId, storage, client: c.client, current: () => true, off: jest.fn(), finish: async (row, status) => ({ keep: { ...row, terminal: status.state, candidates: status.candidates }, message: 'beatAi.results' }) });
    await storage.put(accepted); c.request.mockResolvedValue({ state: 'succeeded', candidates });
    await create().resume(accepted); const saved = (await storage.read(owner, beatId))[0];
    c.request.mockClear(); const restarted = create(); await restarted.resume(saved);
    expect(restarted.snapshot().record?.candidates).toEqual(candidates); expect(restarted.snapshot().message).toBe(''); expect(c.request).not.toHaveBeenCalled();
    await layers.change(owner, beatId, () => [{ songId: id(5), audioUrl: `/api/v1/jobs/${id(7)}/asset`, title: 'Keys', bars: 4, bpm: 120, muted: false }]);
    expect(await layers.read(owner, beatId)).toHaveLength(1); await restarted.discard(); expect(await storage.read(owner, beatId)).toEqual([]);
});
test('Magic quote/confirm is single-flight with its own durable key, and failed terminal retires', async () => {
    const f = files(), c = client(), storage = magicPendingStore(f.port);
    const flow = new ReceiptRequest<MagicPending>({ owner, beatId, storage, client: c.client, current: () => true, off: jest.fn(), finish: async () => ({ message: 'beatAi.failed' }) });
    await flow.price(async () => quote, () => magicRow());
    c.request.mockImplementation(async () => { expect((await storage.read(owner, beatId))[0].key).toBe(magicRow().key); return { generation_id: id(8), state: 'queued' }; });
    await Promise.all([flow.send(), flow.send()]); expect(c.request).toHaveBeenCalledTimes(1);
    c.request.mockResolvedValue({ state: 'refunded' }); await flow.check();
    expect(flow.snapshot().message).toBe('beatAi.failed'); expect(await storage.read(owner, beatId)).toEqual([]);
});
test('receipt cap and corrupt rows fail closed; B never touches A namespace', async () => {
    const x = setup();
    for (let n = 10; n < 18; n++) { const key = `beat-ai.${id(n)}`; await x.storage.put({ ...row(), key, placementIds: placementIds(key) }); }
    await expect(x.storage.put(row())).rejects.toThrow('pending_limit');
    const before = [...x.data.entries()];
    jest.mocked(x.port.read).mockClear(); expect(await x.storage.read(id(9), beatId)).toEqual([]);
    expect(jest.mocked(x.port.read).mock.calls.every(([name]) => name.includes(id(9)))).toBe(true); expect([...x.data.entries()]).toEqual(before);
});
test('lost acknowledgement then an action-route 404 keeps the same receipt/key and panel', async () => {
    const x = setup();
    const source = asset;
    const extend: Pending = { ...row(), op: 'extend', submitPath: `/music/songs/${source.ref.songId}/extends`,
        source: { songId: source.ref.songId, versionId: source.ref.versionId, assetId: 'a1', asset: source } };
    await x.flow.price(async () => quote, () => extend);
    x.request.mockRejectedValueOnce(new ApiError(0, 'network')).mockRejectedValueOnce(new ApiError(404, 'music_extend_unavailable'));
    await x.flow.send(); await x.flow.send();
    expect(await x.storage.read(owner, beatId)).toEqual([extend]);
    expect(x.request.mock.calls.map(call => JSON.parse(call[1].body).idempotency_key)).toEqual([extend.key, extend.key]);
    expect(x.flow.snapshot().error).toBe('beatAi.a35'); expect(x.off).not.toHaveBeenCalled();
});
test.each(['music_extend_unavailable', 'music_target_stems_unavailable', 'music_replace_unavailable', 'music_unavailable', 'beat_ai_unavailable'])('poll %s retains receipt/key', async code => {
    const x = setup(), accepted = { ...row(), requestId: id(8) }; await x.storage.put(accepted);
    x.request.mockRejectedValue(new ApiError(404, '', { error: { code } })); await x.flow.resume(accepted);
    expect(await x.storage.read(owner, beatId)).toEqual([accepted]); expect(x.flow.snapshot().pollRefused).toBe(false);
    if (code !== 'music_unavailable' && code !== 'beat_ai_unavailable') expect(x.off).not.toHaveBeenCalled();
});
test('quote, submit and poll display specific refusal keys and rate-limit parameters', async () => {
    const x = setup();
    await x.flow.price(async () => { throw new ApiError(403, 'plan_unavailable'); }, () => row());
    expect(x.flow.snapshot().error).toBe('beatAi.a29');
    await x.flow.price(async () => quote, () => row()); x.request.mockRejectedValue(new ApiError(409, 'quote_expired')); await x.flow.send();
    expect(x.flow.snapshot().error).toBe('beatAi.a36');
    const accepted = { ...row(), requestId: id(8) }; await x.storage.put(accepted);
    x.request.mockRejectedValue(new ApiError(429, 'rate_limited', { retryAfterSeconds: 7 })); await x.flow.resume(accepted);
    expect(x.flow.snapshot()).toMatchObject({ error: 'beatAi.a44', errorParams: { n: 7 } });
});
test('both receipt kinds mint one expo-crypto UUID per quote and reuse it on retry', async () => {
    const x = setup();
    await x.flow.price(async () => quote, (_quote, uuid) => { const key = `beat-ai.${uuid}`; return { ...row(), key, placementIds: placementIds(key) }; });
    x.request.mockRejectedValue(new ApiError(0, 'network')); await x.flow.send(); await x.flow.send();
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect((await x.storage.read(owner, beatId))[0].key).toBe(`beat-ai.${id(42)}`);
    const f = files(), storage = magicPendingStore(f.port);
    const magic = new ReceiptRequest<MagicPending>({ owner, beatId, storage, client: x.client, current: () => true, off: jest.fn(), finish });
    await magic.price(async () => quote, (_quote, uuid) => ({ ...magicRow(), key: `magic.${uuid}` }));
    await magic.send(); await magic.send(); expect(randomUUID).toHaveBeenCalledTimes(2);
    expect((await storage.read(owner, beatId))[0].key).toBe(`magic.${id(42)}`);
});

for (const kind of ['AI', 'Magic'] as const) {
    test.each(['subscription_required', 'consent_declined'])(`${kind}: a local %s refusal after a lost acknowledgement keeps the receipt/key`, async code => {
        const f = files(), c = client();
        const storage = kind === 'AI' ? pendingStore(f.port) : magicPendingStore(f.port);
        const receipt = kind === 'AI' ? row() : magicRow();
        const flow = new ReceiptRequest<Pending | MagicPending>({ owner, beatId, storage, client: c.client, current: () => true, off: jest.fn(), finish });
        let declined = false;
        const sent = jest.fn();
        c.request.mockImplementation(async (path: string, init: RequestInit) => {
            guardPaidAction(path, init.method!);
            if (declined) throw new ConsentDeclinedError();
            sent(JSON.parse(init.body as string).idempotency_key);
            throw new ApiError(0, 'network');
        });
        await flow.price(async () => quote, () => receipt); await flow.send();
        if (code === 'subscription_required') setHardPaywallLocked(true); else declined = true;
        await flow.send();
        expect(c.request).toHaveBeenCalledTimes(2); expect(sent).toHaveBeenCalledTimes(1);
        expect(await storage.read(owner, beatId)).toEqual([receipt]);
        expect(flow.snapshot().record?.key).toBe(receipt.key); expect(flow.snapshot().error).toBeTruthy();
        expect(c.request.mock.calls.map(call => JSON.parse(call[1].body).idempotency_key)).toEqual([receipt.key, receipt.key]);
        setHardPaywallLocked(false); declined = false; await flow.send();
        expect(sent.mock.calls).toEqual([[receipt.key], [receipt.key]]);
    });
}
test('resuming an accepted request has no resend wording even when its GET fails', async () => {
    const x = setup(), accepted = { ...row(), requestId: id(8) }; await x.storage.put(accepted);
    x.request.mockRejectedValue(new ApiError(0, 'network')); await x.flow.resume(accepted);
    expect(x.flow.snapshot().message).toBe(''); expect(x.flow.snapshot().record?.requestId).toBe(id(8));
    expect(x.request).toHaveBeenCalledTimes(1); expect(x.request.mock.calls[0][1].method).toBeUndefined();
});
