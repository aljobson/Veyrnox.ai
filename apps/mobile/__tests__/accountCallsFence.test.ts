import { changePassword, revokeSessions, type TokenSource } from '../src/lib/auth/accountCalls';
import { AuthError } from '../src/lib/auth/supabaseAuth';
const jwt = (sub: string, n = 0) => `h.${btoa(JSON.stringify({ sub, n }))}.s`;
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const response = (status: number) => new Response('{}', { status });
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let send: jest.Mock;
beforeEach(() => { send = jest.fn().mockResolvedValue(response(200)); globalThis.fetch = send; });
const password = (tokens: TokenSource) => changePassword(tokens, 'password', 'nonce');
test.each([password, (tokens: TokenSource) => revokeSessions(tokens, 'global')])('account mutation never resends B token', async call => {
    send.mockResolvedValueOnce(response(401));
    const tokens = jest.fn().mockResolvedValueOnce(jwt('A')).mockResolvedValueOnce(jwt('B'));
    const result = await call(tokens).catch(e => e);
    expect(result).toBeInstanceOf(AuthError); expect(result).toMatchObject({ status: 401, code: 'account_changed' });
    expect(send).toHaveBeenCalledTimes(1); expect(JSON.stringify(send.mock.calls)).not.toContain(jwt('B'));
});
test.each([[jwt('A'), jwt('A', 1)], ['opaque', 'renewed']])('same-user and opaque token retries remain valid (%s)', async (first, retry) => {
    send.mockResolvedValueOnce(response(401)); const tokens = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(retry);
    await password(tokens); expect(send).toHaveBeenCalledTimes(2); expect(tokens.mock.calls).toEqual([[], [true]]);
});
test('null forced token keeps the original 401', async () => {
    send.mockResolvedValueOnce(response(401)); const tokens = jest.fn().mockResolvedValueOnce(jwt('A')).mockResolvedValueOnce(null);
    await expect(password(tokens)).rejects.toMatchObject({ status: 401, code: 'rejected' }); expect(send).toHaveBeenCalledTimes(1);
});
test('a generation move before the 401 prevents even a forced refresh', async () => {
    let gen = 1; const gate = deferred<Response>(); send.mockReturnValueOnce(gate.promise);
    const tokens = Object.assign(jest.fn(async () => jwt('A')), { generation: () => gen });
    const result = password(tokens).catch(e => e); await tick(); gen++; gate.resolve(response(401));
    expect(await result).toMatchObject({ code: 'account_changed' }); expect(tokens.mock.calls).toEqual([[false, 1]]); expect(send).toHaveBeenCalledTimes(1);
});
test('both first and forced token acquisition carry the starting generation', async () => {
    send.mockResolvedValueOnce(response(401));
    const tokens = Object.assign(jest.fn(async (force?: boolean) => jwt('A', force ? 1 : 0)), { generation: () => 8 });
    await password(tokens); expect(tokens.mock.calls).toEqual([[false, 8], [true, 8]]);
});
test('stale task-bound source is refused before any token call', async () => {
    const tokens = Object.assign(jest.fn(async () => jwt('B')), { generation: () => 2, expected: 1 });
    await expect(password(tokens)).rejects.toMatchObject({ code: 'account_changed' }); expect(tokens).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});
test('generation move during forced refresh prevents resend even with same-user token', async () => {
    let gen = 1; const gate = deferred<string>(); send.mockResolvedValueOnce(response(401));
    const tokens = Object.assign(jest.fn(async (force?: boolean) => force ? gate.promise : jwt('A')), { generation: () => gen });
    const result = password(tokens).catch(e => e); await tick(); gen++; gate.resolve(jwt('A', 1));
    expect(await result).toMatchObject({ code: 'account_changed' }); expect(send).toHaveBeenCalledTimes(1);
});
