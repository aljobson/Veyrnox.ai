import type { ApiClient } from '../src/lib/api';
import { createStemQuote, startStems, getStemRequest, getStemArchive, cropSong } from '../src/lib/music/client';
import { isMusicActionQuote, isStemStart, isStemRequest, isStemArchive, isCropResult } from '../src/lib/music/validateActions';
import { actionQuote, stemStart, stemReplay, stemRequest, stemArchive, cropResult, SONG_ID, VERSION_ID } from './fixtures/musicActions';
const STEMS_ATTEMPT = ['stems', 'key-1234'].join('.'), CROP_ATTEMPT = ['crop', 'key-1234'].join('.');
const missing = (value: object, key: string) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
for (const [name, validate, fixture, optional] of [
    ['quote', isMusicActionQuote, actionQuote, []],
    ['start', isStemStart, stemStart, ['balance_after', 'idempotent']],
    ['request', isStemRequest, stemRequest, []],
    ['archive', isStemArchive, stemArchive, []],
    ['crop', isCropResult, cropResult, ['format']],
] as const) {
    describe(name, () => {
        test('accepts the complete route fixture', () => expect(validate(fixture)).toBe(true));
        test.each(Object.keys(fixture))('validates promised field %s', key => {
            expect(validate(missing(fixture, key))).toBe((optional as readonly string[]).includes(key));
            expect(validate({ ...fixture, [key]: {} })).toBe(false);
        });
        test.each([null, [], {}, 'payload'])('rejects incomplete payload %p', value => expect(validate(value)).toBe(false));
    });
}
test('accepts a replay with no balance and validates optional fields when present', () => {
    expect(isStemStart(stemReplay)).toBe(true);
    expect(isStemStart({ ...stemReplay, balance_after: NaN })).toBe(false);
    expect(isStemStart({ ...stemReplay, idempotent: false })).toBe(false);
    expect(isCropResult(missing(cropResult, 'format'))).toBe(true);
});
test('rejects nonfinite numbers, malformed dates, states and output elements', () => {
    for (const key of ['total_credits', 'balance', 'balance_after']) expect(isMusicActionQuote({ ...actionQuote, [key]: Infinity })).toBe(false);
    expect(isMusicActionQuote({ ...actionQuote, expires_at: 'invalid' })).toBe(false);
    expect(isMusicActionQuote({ ...actionQuote, outputs: ['vocals', 7] })).toBe(false);
    expect(isStemRequest({ ...stemRequest, credits: NaN })).toBe(false);
    expect(isStemRequest({ ...stemRequest, created_at: 'invalid' })).toBe(false);
    for (const state of ['unknown', ['queued'], null]) expect(isStemRequest({ ...stemRequest, state })).toBe(false);
    for (const state of ['queued', 'running', 'ready', 'failed', 'refunded']) expect(isStemRequest({ ...stemRequest, state })).toBe(true);
    expect(isStemRequest({ ...stemRequest, state: 'ready', archive_url: '/api/v1/music/stem-requests/id/archive' })).toBe(true);
    expect(isCropResult({ ...cropResult, render_state: ['canonical'] })).toBe(false);
    expect(isCropResult({ ...cropResult, render_state: 'unknown' })).toBe(false);
    expect(isCropResult({ ...cropResult, render_state: 'preview_only' })).toBe(true);
    expect(isCropResult({ ...cropResult, version_number: NaN })).toBe(false);
    for (const key of ['size_bytes', 'expires_in']) expect(isStemArchive({ ...stemArchive, [key]: Infinity })).toBe(false);
    for (const url of ['javascript:alert(1)', 'http://mock.test/archive', '/archive', 'invalid']) expect(isStemArchive({ ...stemArchive, url })).toBe(false);
});
const cases = [
    { name: 'quote', fixture: actionQuote, path: `/api/v1/music/songs/${SONG_ID}/stem-quotes`,
        call: (api: ApiClient) => createStemQuote(api, SONG_ID, VERSION_ID), body: { version_id: VERSION_ID, rights_confirmed: true } },
    { name: 'start', fixture: stemReplay, path: `/api/v1/music/songs/${SONG_ID}/stems`,
        call: (api: ApiClient) => startStems(api, SONG_ID, actionQuote.quote_id, STEMS_ATTEMPT), body: { quote_id: actionQuote.quote_id, idempotency_key: STEMS_ATTEMPT } },
    { name: 'request', fixture: stemRequest, path: `/api/v1/music/stem-requests/${stemRequest.id}`, call: (api: ApiClient) => getStemRequest(api, stemRequest.id) },
    { name: 'archive', fixture: stemArchive, path: `/api/v1/music/stem-requests/${stemRequest.id}/archive`, call: (api: ApiClient) => getStemArchive(api, stemRequest.id) },
    { name: 'crop', fixture: cropResult, path: `/api/v1/music/songs/${SONG_ID}/crop`,
        call: (api: ApiClient) => cropSong(api, SONG_ID, { version_id: VERSION_ID, start_seconds: 0.1, end_seconds: 5.2 }, 'crop.key-1234'),
        body: { version_id: VERSION_ID, start_seconds: 0.1, end_seconds: 5.2, idempotency_key: CROP_ATTEMPT } },
];
test.each(cases)('$name uses the exact route/body and rejects incomplete API responses', async ({ call, fixture, path, ...entry }) => {
    const request = jest.fn().mockResolvedValue(fixture), api = { request } as unknown as ApiClient;
    expect(await call(api)).toEqual(fixture);
    expect(request.mock.calls[0][0]).toBe(path);
    if ('body' in entry) {
        expect(request.mock.calls[0][1].method).toBe('POST');
        expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(entry.body);
    }
    request.mockResolvedValue({}); await expect(call(api)).rejects.toMatchObject({ code: 'bad_response' });
});
test('status rejects a different request id', async () => {
    const api = { request: jest.fn().mockResolvedValue({ ...stemRequest, id: 'different' }) } as unknown as ApiClient;
    await expect(getStemRequest(api, stemRequest.id)).rejects.toMatchObject({ code: 'bad_response' });
});
