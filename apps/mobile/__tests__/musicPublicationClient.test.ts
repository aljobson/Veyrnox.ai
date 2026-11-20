import { ApiError, type ApiClient } from '../src/lib/api';
import { getPublication, publishSong, unpublishSong } from '../src/lib/music/publicationClient';
import { getSharedSong } from '../src/lib/music/sharedListenClient';
import { config } from '../src/lib/config';
import { songId, input, receipt, publication, shared, token } from './fixtures/musicPublication';
const key = 'publication.test-12345', path = `/api/v1/music/songs/${songId}/publication`;
const request = jest.fn(), api = { request } as unknown as ApiClient;
beforeEach(() => request.mockReset());
test('GET, POST and DELETE use exact request bodies and receipts are acknowledgements', async () => {
    request.mockResolvedValueOnce({ publication }).mockResolvedValueOnce(receipt).mockResolvedValueOnce({ ok: true, idempotent: false });
    expect(await getPublication(api, songId)).toEqual(publication);
    expect(await publishSong(api, songId, input, key)).toBeUndefined(); expect(await unpublishSong(api, songId, key)).toBeUndefined();
    expect(request.mock.calls).toEqual([
        [path, undefined, { timeoutMs: 30000 }],
        [path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, idempotency_key: key }) }, { timeoutMs: 30000 }],
        [path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: key }) }, { timeoutMs: 30000 }],
    ]);
});
test('invalid request inputs never reach transport', async () => {
    await expect(getPublication(api, '../wrong')).rejects.toMatchObject({ code: 'song_id_invalid' });
    await expect(publishSong(api, songId, { ...input, rights_confirmed: false } as never, key)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(unpublishSong(api, songId, '')).rejects.toMatchObject({ code: 'invalid_request' }); expect(request).not.toHaveBeenCalled();
});
test('malformed receipts and GET projection fail closed', async () => {
    request.mockResolvedValue({});
    for (const call of [() => getPublication(api, songId), () => publishSong(api, songId, input, key), () => unpublishSong(api, songId, key)]) await expect(call()).rejects.toMatchObject({ code: 'bad_response' });
});
test('anonymous shared read has exact fetch keys, no identity, no caching and no signed asset response', async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => shared });
    expect(await getSharedSong(token, undefined, fetcher)).toEqual(shared.song);
    expect(fetcher).toHaveBeenCalledWith(`${config.apiBase}/api/music/shared/${token}`, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: expect.any(AbortSignal) });
});
test.each([404, 503])('shared HTTP %s is sanitized', async status => {
    const fetcher = jest.fn().mockResolvedValue({ ok: false, status });
    await expect(getSharedSong(token, undefined, fetcher)).rejects.toMatchObject({ code: status === 404 ? 'not_found' : 'shared_unavailable' });
});
test('invalid token avoids fetch; transport exceptions never expose the token or signed URL', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error(`https://host/listen/${token}?signature=secret`));
    await expect(getSharedSong('bad', undefined, fetcher)).rejects.toMatchObject({ code: 'not_found' }); expect(fetcher).not.toHaveBeenCalled();
    try { await getSharedSong(token, undefined, fetcher); throw new Error('expected failure'); }
    catch (error) { expect(error).toBeInstanceOf(ApiError); expect(String(error)).not.toContain(token); expect(JSON.stringify(error)).not.toContain('signature'); }
});
test('shared malformed asset and projection fail closed', async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ song: { ...shared.song, audio_url: 'https://signed.test' } }) });
    await expect(getSharedSong(token, undefined, fetcher)).rejects.toMatchObject({ code: 'bad_response' });
});

test('shared timeout settles even when the transport ignores abort, with no secret in the error', async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn(() => new Promise<Response>(() => {}));
    const flight = getSharedSong(token, undefined, fetcher).catch(error => error);
    await jest.advanceTimersByTimeAsync(30000); const error = await flight;
    expect(error).toMatchObject({ code: 'network' }); expect(String(error)).not.toContain(token);
    expect(fetcher.mock.calls).toHaveLength(1); jest.useRealTimers();
});
