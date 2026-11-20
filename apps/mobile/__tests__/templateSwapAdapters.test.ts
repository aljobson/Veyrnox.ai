import { createFileLeases } from '../src/lib/templateSwap/fileLeases';
import { createSwapGateway } from '../src/lib/templateSwap/gateway';
import { ApiError } from '../src/lib/api';
import { uploadSource } from '../src/lib/uploads';
jest.mock('../src/lib/i18n', () => ({ t: (key: string) => key }));
test('leases keep shared retry bytes until the last attempt releases; account purge is final', () => {
    const remove = jest.fn(), leases = createFileLeases(remove);
    leases.acquire('a', 'file://photo'); leases.acquire('a', 'file://photo');
    leases.release('file://photo'); expect(remove).not.toHaveBeenCalled();
    leases.acquire('a', 'file://photo'); leases.release('file://photo');
    leases.release('file://photo'); expect(remove).toHaveBeenCalledTimes(1);
    leases.acquire('a', 'file://other'); leases.purge('a'); expect(remove).toHaveBeenLastCalledWith('file://other');
});
test('one gateway maps all paths, preserves signal, headers, JSON and task guards', async () => {
    let current = true;
    const task = { gen: 1, user: 'a', current: () => current }, api = { request: jest.fn(async () => ({ ok: true })) };
    const gateway = createSwapGateway(api as never, () => task), signal = new AbortController().signal;
    for (const path of ['/generations', '/balance', '/jobs?idempotency_key=a']) {
        await gateway(path, { method: path === '/generations' ? 'POST' : 'GET', body: path === '/generations' ? '{"inputs":{}}' : undefined, signal });
        expect(api.request).toHaveBeenLastCalledWith(`/api/v1${path}`, expect.objectContaining({ signal, headers: { 'Content-Type': 'application/json' } }), { task, owner: 'a' });
    }
    api.request.mockImplementation(async () => { current = false; return { ok: true }; });
    await expect(gateway('/balance')).rejects.toMatchObject({ code: 'account_changed' });
});
test('parsed provider job_id survives the gateway unchanged', async () => {
    const error = new ApiError(422, 'provider_input_rejected', { job_id: 'job' });
    const gateway = createSwapGateway({ request: async () => { throw error; } } as never, () => ({ gen: 1, user: 'a', current: () => true }));
    await expect(gateway('/generations')).rejects.toBe(error);
});
test('upload reservation and PUT receive the same abort signal', async () => {
    const signal = new AbortController().signal, put = jest.fn(), api = { request: jest.fn(async () => ({ key: 'k', upload_url: 'https://upload', content_type: 'image/png' })) };
    await uploadSource(api as never, { uri: 'file://processed', size: 10 }, 'image/png', () => {}, signal, put);
    expect(api.request).toHaveBeenCalledWith('/api/v1/uploads', expect.objectContaining({ signal }));
    expect(put.mock.calls[0][4]).toBe(signal);
});
test('cancellation after reservation never starts the PUT', async () => {
    const controller = new AbortController(), put = jest.fn();
    const api = { request: jest.fn(async () => { controller.abort(); return { key: 'k', upload_url: 'https://upload', content_type: 'image/png' }; }) };
    await expect(uploadSource(api as never, { uri: 'file://processed' }, 'image/png', () => {}, controller.signal, put)).rejects.toMatchObject({ code: 'upload_cancelled' });
    expect(put).not.toHaveBeenCalled();
});
