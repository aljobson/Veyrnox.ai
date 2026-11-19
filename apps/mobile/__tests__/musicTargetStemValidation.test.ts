import type { ApiClient } from '../src/lib/api';
import { createTargetStemQuote, startTargetStems, getTargetStemRequest, getTargetStemAsset } from '../src/lib/music/client';
import { isMusicTargetStemQuote, isTargetStemStart, isTargetStemRequest, isTargetStemAsset } from '../src/lib/music/validateTargetStems';
import { MUSIC_TARGET_STEM_INSTRUMENTS } from '../src/lib/music/shared';
import { targetQuote, targetStart, targetReplay, targetRequest, targetAsset, residualAsset } from './fixtures/musicTargetStems';
import { SONG_ID, VERSION_ID } from './fixtures/musicActions';
const missing = (value: object, key: string) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
for (const [name, validate, fixture, optional] of [
    ['quote', isMusicTargetStemQuote, targetQuote, []],
    ['start', isTargetStemStart, targetStart, ['balance_after', 'idempotent']],
    ['replay', isTargetStemStart, targetReplay, ['balance_after', 'idempotent']],
    ['request', isTargetStemRequest, targetRequest, []],
    ['target', (v: unknown) => isTargetStemAsset(v, 'target'), targetAsset, []],
    ['residual', (v: unknown) => isTargetStemAsset(v, 'residual'), residualAsset, []],
] as const) {
    describe(name, () => {
        test('accepts complete fixture', () => expect(validate(fixture)).toBe(true));
        test.each(Object.keys(fixture))('checks promised field %s', key => {
            expect(validate(missing(fixture, key))).toBe((optional as readonly string[]).includes(key));
            expect(validate({ ...fixture, [key]: {} })).toBe(false);
        });
        test.each([null, [], {}, 'payload'])('rejects incomplete payload %p', value => expect(validate(value)).toBe(false));
    });
}
test.each(MUSIC_TARGET_STEM_INSTRUMENTS)('sends %s exactly with rights and source, never confirms while quoting', async instrument => {
    const request = jest.fn().mockResolvedValue({ ...targetQuote, instrument }), api = { request } as unknown as ApiClient;
    await createTargetStemQuote(api, SONG_ID, VERSION_ID, instrument);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual([`/api/v1/music/songs/${SONG_ID}/target-stem-quotes`, expect.objectContaining({ method: 'POST',
        body: JSON.stringify({ version_id: VERSION_ID, instrument, rights_confirmed: true }) })]);
});
test('rejects nonfinite, invalid dates, durations, instrument IDs, output pairs and states', () => {
    for (const key of ['total_credits', 'balance', 'balance_after', 'source_duration_seconds']) {
        for (const value of [Infinity, NaN]) expect(isMusicTargetStemQuote({ ...targetQuote, [key]: value })).toBe(false);
    }
    for (const source_duration_seconds of [0, -1]) expect(isMusicTargetStemQuote({ ...targetQuote, source_duration_seconds })).toBe(false);
    for (const instrument of ['Guitar', 'unknown', null]) {
        expect(isMusicTargetStemQuote({ ...targetQuote, instrument })).toBe(false);
        expect(isTargetStemRequest({ ...targetRequest, instrument })).toBe(false);
    }
    expect(isMusicTargetStemQuote({ ...targetQuote, expires_at: 'invalid' })).toBe(false);
    expect(isTargetStemRequest({ ...targetRequest, created_at: 'invalid' })).toBe(false);
    expect(isTargetStemRequest({ ...targetRequest, credits: NaN })).toBe(false);
    for (const outputs of [[], ['target'], ['target', 'target'], ['residual', 'target'], ['target', 7]]) {
        expect(isMusicTargetStemQuote({ ...targetQuote, outputs })).toBe(false);
        expect(isTargetStemRequest({ ...targetRequest, state: 'ready', outputs })).toBe(false);
    }
    for (const state of ['queued', 'running', 'ready', 'failed', 'refunded']) {
        expect(isTargetStemStart({ ...targetReplay, state })).toBe(true);
        expect(isTargetStemRequest({ ...targetRequest, state, outputs: state === 'ready' ? ['target', 'residual'] : [] })).toBe(true);
    }
    for (const state of ['unknown', ['ready'], null]) {
        expect(isTargetStemStart({ ...targetReplay, state })).toBe(false);
        expect(isTargetStemRequest({ ...targetRequest, state })).toBe(false);
    }
    expect(isTargetStemRequest({ ...targetRequest, outputs: ['target', 'residual'] })).toBe(false);
    expect(isTargetStemStart({ ...targetReplay, balance_after: NaN })).toBe(false);
    expect(isTargetStemStart({ ...targetReplay, idempotent: false })).toBe(false);
});
test('asset validation requires HTTPS, matching kind, audio MIME and finite size/expiry', () => {
    for (const url of ['http://mock.test/a', 'javascript:alert(1)', 'file:///a', '/a', 'invalid']) expect(isTargetStemAsset({ ...targetAsset, url }, 'target')).toBe(false);
    expect(isTargetStemAsset(residualAsset, 'target')).toBe(false);
    for (const mime_type of ['application/zip', 'audio/', 'video/mp4', 'audio/wav\n']) expect(isTargetStemAsset({ ...targetAsset, mime_type }, 'target')).toBe(false);
    for (const key of ['size_bytes', 'expires_in']) {
        for (const value of [Infinity, NaN, -1]) expect(isTargetStemAsset({ ...targetAsset, [key]: value }, 'target')).toBe(false);
    }
    expect(isTargetStemAsset({ ...targetAsset, expires_in: 0 }, 'target')).toBe(false);
});
const cases = [
    { fixture: targetQuote, path: `/songs/${SONG_ID}/target-stem-quotes`, call: (api: ApiClient) => createTargetStemQuote(api, SONG_ID, VERSION_ID, 'guitar'),
        body: { version_id: VERSION_ID, instrument: 'guitar', rights_confirmed: true } },
    { fixture: targetReplay, path: `/songs/${SONG_ID}/target-stems`, call: (api: ApiClient) => startTargetStems(api, SONG_ID, targetQuote.quote_id, 'targetstems.test-1234'),
        body: { quote_id: targetQuote.quote_id, idempotency_key: 'targetstems.test-1234' } },
    { fixture: targetRequest, path: `/target-stem-requests/${targetRequest.id}`, call: (api: ApiClient) => getTargetStemRequest(api, targetRequest.id) },
    { fixture: targetAsset, path: `/target-stem-requests/${targetRequest.id}/target`, call: (api: ApiClient) => getTargetStemAsset(api, targetRequest.id, 'target') },
    { fixture: residualAsset, path: `/target-stem-requests/${targetRequest.id}/residual`, call: (api: ApiClient) => getTargetStemAsset(api, targetRequest.id, 'residual') },
];
test.each(cases)('$path uses exact contract and rejects incomplete response', async ({ fixture, path, call, ...entry }) => {
    const request = jest.fn().mockResolvedValue(fixture), api = { request } as unknown as ApiClient;
    expect(await call(api)).toEqual(fixture); expect(request.mock.calls[0][0]).toBe(`/api/v1/music${path}`);
    if ('body' in entry) {
        expect(request.mock.calls[0][1].method).toBe('POST'); expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(entry.body);
    }
    request.mockResolvedValue({}); await expect(call(api)).rejects.toMatchObject({ code: 'bad_response' });
});
test('rejects a mismatched instrument, request ID or asset kind', async () => {
    const request = jest.fn().mockResolvedValue({ ...targetQuote, instrument: 'piano' }), api = { request } as unknown as ApiClient;
    await expect(createTargetStemQuote(api, SONG_ID, VERSION_ID, 'guitar')).rejects.toMatchObject({ code: 'bad_response' });
    request.mockResolvedValue({ ...targetRequest, id: 'different' }); await expect(getTargetStemRequest(api, targetRequest.id)).rejects.toMatchObject({ code: 'bad_response' });
    request.mockResolvedValue(residualAsset); await expect(getTargetStemAsset(api, targetRequest.id, 'target')).rejects.toMatchObject({ code: 'bad_response' });
});
