import { AuthError } from '../src/lib/auth/supabaseAuth';
import { fetchPasskeys, parsePasskeys, passkeyErrorKey, removePasskey, validPasskeyId } from '../src/lib/passkeys';

const ID = 'pk_12345678';
const res = (status: number, body: unknown) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) }) as unknown as Response;

describe('passkeys', () => {
    const fetchMock = jest.fn();
    const token = async () => 'tok';
    beforeEach(() => {
        fetchMock.mockReset();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    test('reads a list or { passkeys }, drops rows that cannot be removed, and survives junk', () => {
        const row = { id: ID, friendly_name: 'iCloud Keychain', created_at: '2026-01-01T00:00:00Z', last_used_at: null };
        expect(parsePasskeys([row])).toEqual([{ id: ID, name: 'iCloud Keychain', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }]);
        expect(parsePasskeys({ passkeys: [row, { id: '../x' }, { friendly_name: 'no id' }, null, 5] })).toHaveLength(1);
        expect(parsePasskeys(null)).toEqual([]);
        expect(parsePasskeys({ passkeys: 'x' })).toEqual([]);
    });
    test('ids are checked before any request', () => {
        expect(validPasskeyId(ID)).toBe(true);
        expect(validPasskeyId('../x')).toBe(false);
        expect(validPasskeyId('short')).toBe(false);
        expect(validPasskeyId(5)).toBe(false);
    });
    test('lists with a GET and removes with a DELETE on the encoded id', async () => {
        fetchMock.mockResolvedValueOnce(res(200, [{ id: ID }]));
        expect(await fetchPasskeys(token)).toHaveLength(1);
        expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/v1/passkeys');
        fetchMock.mockResolvedValueOnce(res(200, {}));
        await removePasskey(token, ID);
        expect(String(fetchMock.mock.calls[1][0])).toContain(`/auth/v1/passkeys/${ID}`);
        expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('DELETE');
    });
    test('a bad id sends nothing', async () => {
        await expect(removePasskey(token, '../x')).rejects.toMatchObject({ status: 400 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    test('wording', () => {
        expect(passkeyErrorKey(new AuthError(0, 'network'))).toBe('pk.err.network');
        expect(passkeyErrorKey(new AuthError(404, 'x'))).toBe('pk.err.off');
        expect(passkeyErrorKey(new AuthError(403, 'insufficient_aal'))).toBe('pk.err.aal');
        expect(passkeyErrorKey(new Error('x'))).toBe('pk.err.failed');
    });
});
