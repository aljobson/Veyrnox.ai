import { createSwapStore } from '../../../app/veyrnox/_lib/templateSwapStore.mjs';
import { createSwapActions } from '../../../app/veyrnox/_lib/templateSwapActions.mjs';
import { lookupJobByKey, reduceAttempt, swapRequest, type SwapFile } from '../../../app/veyrnox/_lib/templateSwapClient.mjs';
import { createFileLeases } from '../src/lib/templateSwap/fileLeases';
const offer = { id: 'template', model: 'kling-o1-reference' as const, credits: 47, durationSeconds: 5 as const, images: 2 as const, role: 'main character' };
const files: SwapFile[] = ['frontal', 'crop'].map(n => ({ uri: `file://${n}.png`, type: 'image/png', size: 100, width: 500, height: 500 }));
function setup() {
    const remove = jest.fn(), leases = createFileLeases(remove), store = createSwapStore({ revoke: leases.release }); store.session('a');
    let key = 0;
    const gateway = jest.fn<Promise<any>, [string, RequestInit?]>(async () => { throw { code: 'provider_input_rejected', status: 422, body: { job_id: 'refused-job' } }; });
    const upload = jest.fn(async (file: SwapFile) => file.uri);
    const actions = createSwapActions(store, { makeKey: () => `key-${++key}`, processPhoto: async () => ({ files }), upload, gateway,
        objectURL: f => leases.acquire('a', f.uri), wait: async () => {} });
    return { store, actions, remove, gateway, upload };
}
test('refusal/retry/cancel/retry preserves older leases and ordered bytes', async () => {
    const { store, actions, remove, upload } = setup();
    await actions.choose('template', {}); await actions.submit('template', offer);
    expect(store.get('template')[0]).toMatchObject({ state: 'refund_pending', job_id: 'refused-job', key: 'key-1' });
    let resolve!: (key: string) => void;
    upload.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = actions.submit('template', offer); actions.cancel('key-2'); resolve('late-upload'); await pending;
    expect(remove).not.toHaveBeenCalled(); expect(store.get('template')[0].files).toEqual(files);
    await actions.submit('template', offer);
    expect(upload.mock.calls.slice(-2).map(call => call[0])).toEqual(files);
    actions.cancel('key-3'); expect(remove).not.toHaveBeenCalled(); actions.cancel('key-1'); expect(remove.mock.calls).toEqual(files.map(f => [f.uri]));
});
test('expiry hides and suspends, same account resumes; signout/default/account change revoke files and stale tickets', async () => {
    for (const reason of ['expired', 'signout', undefined]) {
        const { store, actions, remove } = setup(); await actions.choose('template', {});
        const ticket = store.ticket('key-1'), controller = store.controller('key-1');
        store.session(null, reason); expect(controller.signal.aborted).toBe(true); expect(store.get('template')).toEqual([]); expect(store.update(ticket, { state: 'ready' })).toBe(false);
        expect(remove).toHaveBeenCalledTimes(reason === 'expired' ? 0 : 2);
        store.session('a'); expect(store.get('template')).toHaveLength(reason === 'expired' ? 1 : 0);
        if (reason === 'expired') { store.session('b'); expect(remove).toHaveBeenCalledTimes(2); expect(store.get('template')).toEqual([]); }
    }
});
test('unknown reconciliation replays the frozen key/body and lookup alone confirms refunds', async () => {
    const { store, actions, gateway } = setup();
    gateway.mockRejectedValueOnce({ code: 'network_error', status: 0 });
    await actions.choose('template', {}); await actions.submit('template', offer);
    const a = store.get('template')[0]; expect(a.state).toBe('unknown'); const body = JSON.stringify(a.body);
    gateway.mockImplementation(async (path?: string) => path?.startsWith('/jobs') ? { job: null } : { job_id: 'accepted' } as never);
    await actions.reconcile('template', a.key);
    expect(gateway.mock.calls.filter((call: unknown[]) => call[0] === '/generations').map((call: unknown[]) => (call[1] as RequestInit).body)).toEqual([body, body]);
    expect(reduceAttempt(a, { job: { id: 'job', state: 'failed', refunded: false, refund_state: 'pending' } }).state).toBe('refund_pending');
    expect(reduceAttempt(a, { job: { id: 'job', state: 'failed', refunded: true, refund_state: 'confirmed' } }).state).toBe('refunded');
    expect(swapRequest(offer, 'key', files.map(f => ({ slot: 'image', origin: 'upload', key: f.uri })))).toEqual({ template_swap: 'template', model_id: offer.model, idempotency_key: 'key', inputs: {}, max_charge_credits: 47, references: files.map(f => ({ slot: 'image', origin: 'upload', key: f.uri })), consent: true });
});
test('lookup validates every refund state, null and malformed jobs', async () => {
    for (const refund_state of ['confirmed', 'pending', 'none', 'unknown'] as const) {
        const job = { id: 'job', state: 'failed', refunded: refund_state === 'confirmed', refund_state };
        expect(await lookupJobByKey('a', (async () => ({ job })) as never)).toEqual(job);
    }
    expect(await lookupJobByKey('a', (async () => ({ job: null })) as never)).toBeNull();
    await expect(lookupJobByKey('a', (async () => ({ job: { state: 'DEBITED' } })) as never)).rejects.toThrow('invalid_job');
});
test('late processed results after account change are discarded without attaching or uploading', async () => {
    const store = createSwapStore(); store.session('a');
    let resolve!: (value: { files: SwapFile[] }) => void;
    const discardPhoto = jest.fn(), upload = jest.fn();
    const actions = createSwapActions(store, { makeKey: () => 'k', gateway: jest.fn(), upload, objectURL: f => f.uri, discardPhoto,
        processPhoto: () => new Promise(r => { resolve = r; }) });
    const choosing = actions.choose('template', {}); store.session('b'); resolve({ files }); await choosing;
    expect(store.get('template')).toEqual([]); expect(discardPhoto).toHaveBeenCalledWith({ files }); expect(upload).not.toHaveBeenCalled();
});
