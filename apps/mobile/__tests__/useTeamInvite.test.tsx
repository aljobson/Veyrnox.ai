import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { ApiError } from '../src/lib/api';
import { brandStore } from '../src/lib/publishBrand';
import { useTeamInvite } from '../src/lib/useTeamInvite';

const A = 'invite.a';
const B = 'invite.b';
const BRAND = '11111111-1111-4111-8111-111111111111';
const response = (name: string) => ({ ok: true, status: 200, json: async () => ({ brand_name: name, email: 'member@example.test', role: 'editor', status: 'pending' }) }) as Response;
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
let root: Root;
let latest: ReturnType<typeof useTeamInvite>;
let renders: ReturnType<typeof useTeamInvite>[];
let request: jest.Mock;
let reads: jest.Mock;
let originalFetch: typeof fetch;
function Probe({ token }: { token: string }) {
    latest = useTeamInvite({ request }, token);
    renders.push(latest);
    return null;
}
async function render(token: string) {
    await act(async () => { root.render(<Probe token={token} />); });
}
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    originalFetch = globalThis.fetch;
    reads = jest.fn();
    globalThis.fetch = reads;
    request = jest.fn();
    renders = [];
    brandStore.set(null);
    root = createRoot();
});
afterEach(async () => {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
    brandStore.set(null);
});

test('switch clears A synchronously, gates Accept while B loads, and shows a B load error', async () => {
    const b = deferred<Response>();
    reads.mockResolvedValueOnce(response('A')).mockReturnValueOnce(b.promise);
    await render(A);
    expect(latest.phase).toBe('ready');
    expect(latest.invite?.brandName).toBe('A');
    const oldAccept = latest.accept;
    renders = [];
    await render(B);
    expect(renders.every((state) => state.invite === null && state.error === null && state.phase === 'loading')).toBe(true);
    await act(async () => { await latest.accept(); await oldAccept(); });
    expect(request).not.toHaveBeenCalled();
    await act(async () => { b.reject(new Error('offline')); });
    expect(latest.invite).toBeNull();
    expect(latest.error).toBeTruthy();
    expect(latest.error).not.toContain('offline');
    expect(latest.phase).toBe('idle');
});

test('slow A read finishing after B is ignored', async () => {
    const a = deferred<Response>();
    reads.mockReturnValueOnce(a.promise).mockResolvedValueOnce(response('B'));
    await render(A);
    await render(B);
    expect(latest.invite?.brandName).toBe('B');
    await act(async () => { a.resolve(response('A')); });
    expect(latest.invite?.brandName).toBe('B');
    expect(latest.phase).toBe('ready');
});

test('accept for A finishing after switching to B cannot join or select a brand', async () => {
    const accepted = deferred<unknown>();
    reads.mockResolvedValueOnce(response('A')).mockResolvedValueOnce(response('B'));
    request.mockReturnValueOnce(accepted.promise);
    await render(A);
    const select = jest.spyOn(brandStore, 'set');
    let pending!: Promise<void>;
    await act(async () => { pending = latest.accept(); });
    expect(latest.phase).toBe('accepting');
    await render(B);
    await act(async () => { accepted.resolve({ brand_id: BRAND, idempotent: true }); await pending; });
    expect(latest.invite?.brandName).toBe('B');
    expect(latest.phase).toBe('ready');
    expect(latest.idempotent).toBe(false);
    expect(select).not.toHaveBeenCalled();
});

test.each([false, true])('joined A is cleared for B, including idempotent=%s', async (idempotent) => {
    reads.mockResolvedValueOnce(response('A')).mockResolvedValueOnce(response('B'));
    request.mockResolvedValueOnce({ brand_id: BRAND, idempotent });
    await render(A);
    await act(async () => { await latest.accept(); });
    expect(latest.phase).toBe('joined');
    expect(latest.idempotent).toBe(idempotent);
    expect(brandStore.get()).toBe(BRAND);
    await render(B);
    expect(latest.phase).toBe('ready');
    expect(latest.idempotent).toBe(false);
    expect(latest.invite?.brandName).toBe('B');
});

test('invalid tokens clear data without fetching; typed acceptance errors remain readable', async () => {
    reads.mockResolvedValueOnce(response('A'));
    request.mockRejectedValueOnce(new ApiError(400, 'INVITE_UNAVAILABLE'));
    await render(A);
    await act(async () => { await latest.accept(); });
    expect(latest.error).toContain('no longer open');
    expect(latest.phase).toBe('ready');
    await render('bad');
    expect(latest).toMatchObject({ invite: null, error: null, phase: 'idle', idempotent: false });
    expect(reads).toHaveBeenCalledTimes(1);
});
