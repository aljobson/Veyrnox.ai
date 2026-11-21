import type { ApiClient } from '../src/lib/api';
import { createExportQuote, startExport, getExport } from '../src/lib/music/exportClient';
import { quote, start, file } from './fixtures/musicExport';
const request = jest.fn(), api = { request } as unknown as ApiClient;
beforeEach(() => request.mockReset());
test('exact encoded paths and bodies; review never starts an export', async () => {
    request.mockResolvedValueOnce({ quote }); await createExportQuote(api, 'song/a?b', 'version', 'mp3');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual(['/api/v1/music/songs/song%2Fa%3Fb/export-quotes',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"version_id":"version","format":"mp3"}' }, { timeoutMs: 30000 }]);
    request.mockResolvedValueOnce(start); await startExport(api, 'song/a?b', quote.id, 'export.test-key');
    expect(request.mock.calls[1][0]).toBe('/api/v1/music/songs/song%2Fa%3Fb/exports');
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ quote_id: quote.id, idempotency_key: 'export.test-key' });
    request.mockResolvedValueOnce({ export: file }); await getExport(api, file.id, 'mp3');
    expect(request.mock.calls[2]).toEqual([`/api/v1/music/exports/${file.id}`, undefined, { timeoutMs: 30000 }]);
    request.mockResolvedValueOnce({ export: file }); await expect(getExport(api, 'a/b?', 'mp3')).rejects.toMatchObject({ code: 'bad_response' });
    expect(request.mock.calls[3][0]).toBe('/api/v1/music/exports/a%2Fb%3F');
});
test('invalid successes are rejected without carrying server data', async () => {
    request.mockResolvedValue({ url: file.url });
    for (const promise of [createExportQuote(api, 's', 'v', 'mp3'), startExport(api, 's', quote.id, 'export.test'), getExport(api, file.id, 'mp3')]) {
        await expect(promise).rejects.toMatchObject({ code: 'bad_response', body: {} });
    }
});
