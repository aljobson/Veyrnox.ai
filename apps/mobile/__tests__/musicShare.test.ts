jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)), randomUUID: () => require('node:crypto').randomUUID() }));
import { ApiError, type ApiClient } from '../src/lib/api';
import { createShareAttempts, createShareLink, listShareLinks, newShareToken, revokeShareLink, shareUrl } from '../src/lib/music/share';
import { link } from './fixtures/music';
let request: jest.Mock, api: ApiClient;
const token = 'a'.repeat(43);
beforeEach(() => { request = jest.fn(); api = { request } as unknown as ApiClient; });
const respond = (_: string, init: RequestInit) => Promise.resolve({ link: { ...link, version_id: JSON.parse(init.body as string).version_id, url: `/listen/${JSON.parse(init.body as string).token}` } });
test('32 random bytes become 43 base64url characters without padding', () => {
    const first = newShareToken(); expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(first).not.toBe(newShareToken());
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
});
test('only a public listen path can become a share URL', () => {
    expect(shareUrl(`/listen/${token}`)).toBe(`https://veyrnox.ai/listen/${token}`);
    for (const path of ['', '//evil.test', `https://veyrnox.ai/listen/${token}`, `/listen/${token}?x=1`, `/listen/${token}#x`, '/listen/abc', `/listen/${token}\n`]) expect(() => shareUrl(path)).toThrow();
});
test('exact bodies and encoded IDs; list and revoke validate their envelopes', async () => {
    request.mockResolvedValueOnce({ links: [link] }); expect(await listShareLinks(api, 'a/b')).toEqual([link]);
    expect(request).toHaveBeenLastCalledWith('/api/v1/music/songs/a%2Fb/share-links');
    request.mockImplementationOnce(respond); await createShareLink(api, 'a/b', 'v1', token, 'key-123456');
    expect(request.mock.calls[1]).toEqual(['/api/v1/music/songs/a%2Fb/share-links', expect.objectContaining({ method: 'POST', body: JSON.stringify({ version_id: 'v1', token, idempotency_key: 'key-123456' }) })]);
    request.mockResolvedValueOnce({ link: { id: link.id, revoked_at: 'today' }, idempotent: false });
    await revokeShareLink(api, 'a/b', 'key-123456');
    expect(request.mock.calls[2]).toEqual(['/api/v1/music/share-links/a%2Fb', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ idempotency_key: 'key-123456' }) })]);
    request.mockResolvedValue({ link: {}, links: [{}] });
    await expect(listShareLinks(api, 's')).rejects.toMatchObject({ code: 'bad_response' });
    await expect(revokeShareLink(api, 'l', 'k')).rejects.toMatchObject({ code: 'bad_response' });
    await expect(createShareLink(api, 's', 'v', token, 'k')).rejects.toMatchObject({ code: 'bad_response' });
});
test.each([new Error('network'), new ApiError(0, 'timeout'), new ApiError(500, 'internal'), new ApiError(201, 'bad_response')])('ambiguous %p retries IDENTICAL bodies; success ends attempt', async error => {
    const attempts = createShareAttempts(api);
    request.mockRejectedValueOnce(error).mockImplementation(respond);
    await expect(attempts.confirm('s1', 'v1')).rejects.toThrow();
    await attempts.confirm('s1', 'v1');
    expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
    await attempts.confirm('s1', 'v1');
    expect(request.mock.calls[2][1].body).not.toBe(request.mock.calls[1][1].body);
});
test('malformed successful response retains tuple, changing version ends it even if changed back', async () => {
    const attempts = createShareAttempts(api);
    request.mockResolvedValueOnce({}).mockImplementation(respond);
    await expect(attempts.confirm('s1', 'v1')).rejects.toMatchObject({ code: 'bad_response' });
    attempts.select('v2'); attempts.select('v1');
    await attempts.confirm('s1', 'v1');
    expect(request.mock.calls[0][1].body).not.toBe(request.mock.calls[1][1].body);
});
