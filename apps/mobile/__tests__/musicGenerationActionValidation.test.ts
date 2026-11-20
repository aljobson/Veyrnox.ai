import type { ApiClient } from '../src/lib/api';
import { createExtendQuote, createCoverQuote, startExtend, startCover } from '../src/lib/music/client';
import { isMusicExtendQuote, isMusicCoverQuote, parseGenerationActionStart } from '../src/lib/music/validateGenerationActions';
import { isMusicGeneration } from '../src/lib/music/validate';
import { extendQuote, coverQuote, generationStart, generationReplay } from './fixtures/musicGenerationActions';
import { SONG_ID, VERSION_ID } from './fixtures/musicActions';
const missing = (v: object, key: string) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== key));
for (const [name, validate, fixture] of [['extend', isMusicExtendQuote, extendQuote], ['cover', isMusicCoverQuote, coverQuote]] as const) {
    describe(name, () => {
        test('accepts the complete server response without outputs', () => { expect(validate(fixture)).toBe(true); expect(fixture).not.toHaveProperty('outputs'); });
        test.each(Object.keys(fixture))('requires and validates %s', key => {
            expect(validate(missing(fixture, key))).toBe(false); expect(validate({ ...fixture, [key]: {} })).toBe(false);
        });
        test('rejects bad dates, nonfinite numbers, wrong count and nonpositive duration', () => {
            for (const field of ['credits_per_candidate', 'total_credits', 'balance', 'balance_after', 'source_duration_seconds']) {
                for (const value of [NaN, Infinity, -Infinity]) expect(validate({ ...fixture, [field]: value })).toBe(false);
            }
            for (const source_duration_seconds of [0, -1]) expect(validate({ ...fixture, source_duration_seconds })).toBe(false);
            expect(validate({ ...fixture, expires_at: 'tomorrow' })).toBe(false);
            expect(validate({ ...fixture, output_count: 1 })).toBe(false);
        });
    });
}
test('action replay wrapper preserves P2 validation and omits unavailable balances', () => {
    expect(parseGenerationActionStart(generationStart)).toEqual(generationStart);
    for (const balance_after of [undefined, null, NaN, Infinity]) {
        const replay = { ...generationReplay, balance_after };
        expect(parseGenerationActionStart(replay)).toEqual(generationReplay); expect(isMusicGeneration(replay)).toBe(false);
        expect(parseGenerationActionStart({ ...generationStart, balance_after })).toBeNull();
    }
    expect(parseGenerationActionStart({ ...generationReplay, balance_after: 76 })?.balance_after).toBe(76);
    for (const key of ['generation_id', 'state', 'candidates']) {
        expect(parseGenerationActionStart(missing(generationReplay, key))).toBeNull();
        expect(parseGenerationActionStart({ ...generationReplay, [key]: {} })).toBeNull();
    }
    for (const key of ['ordinal', 'label', 'job_id', 'state']) expect(parseGenerationActionStart({ ...generationReplay,
        candidates: [missing(generationReplay.candidates[0], key)] })).toBeNull();
    expect(parseGenerationActionStart({ ...generationReplay, idempotent: false })).toBeNull();
});
test.each([10, 50, 90])('cover influence %s is accepted with exactly the server body', async source_influence => {
    const request = jest.fn().mockResolvedValue({ ...coverQuote, source_influence });
    await createCoverQuote({ request } as unknown as ApiClient, SONG_ID, VERSION_ID, '  warm piano  ', source_influence);
    expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][0]).toBe(`/api/v1/music/songs/${SONG_ID}/cover-quotes`);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ version_id: VERSION_ID, prompt: 'warm piano', source_influence, rights_confirmed: true });
});
test.each([9, 91, 50.5, NaN])('invalid influence %s is rejected before transport', async influence => {
    const request = jest.fn(); await expect(createCoverQuote({ request } as unknown as ApiClient, SONG_ID, VERSION_ID, 'piano', influence)).rejects.toMatchObject({ code: 'source_influence_invalid' });
    expect(request).not.toHaveBeenCalled(); expect(isMusicCoverQuote({ ...coverQuote, source_influence: influence })).toBe(false);
});
test.each(['', '   ', 'a'.repeat(501)])('invalid prompt never requests a quote', async prompt => {
    const request = jest.fn(), api = { request } as unknown as ApiClient;
    await expect(createExtendQuote(api, SONG_ID, VERSION_ID, prompt)).rejects.toMatchObject({ code: 'prompt_invalid' });
    await expect(createCoverQuote(api, SONG_ID, VERSION_ID, prompt, 50)).rejects.toMatchObject({ code: 'prompt_invalid' }); expect(request).not.toHaveBeenCalled();
});
test('extend quote and both confirms send exact bodies, with no paid POST before confirm', async () => {
    const request = jest.fn().mockResolvedValue(extendQuote), api = { request } as unknown as ApiClient;
    await createExtendQuote(api, SONG_ID, VERSION_ID, '  piano  ');
    expect(request.mock.calls[0][0]).toBe(`/api/v1/music/songs/${SONG_ID}/extend-quotes`);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ version_id: VERSION_ID, prompt: 'piano', rights_confirmed: true });
    expect(request).toHaveBeenCalledTimes(1);
    for (const [route, start] of [['extends', startExtend], ['covers', startCover]] as const) {
        request.mockResolvedValue(generationReplay); expect(await start(api, SONG_ID, extendQuote.quote_id, 'same-key')).toEqual(generationReplay);
        expect(request.mock.lastCall[0]).toBe(`/api/v1/music/songs/${SONG_ID}/${route}`);
        expect(JSON.parse(request.mock.lastCall[1].body)).toEqual({ quote_id: extendQuote.quote_id, idempotency_key: 'same-key' });
        request.mockResolvedValue({}); await expect(start(api, SONG_ID, extendQuote.quote_id, 'same-key')).rejects.toMatchObject({ code: 'bad_response' });
    }
});
test('client rejects incomplete quotes and mismatched influence', async () => {
    const request = jest.fn().mockResolvedValue({}), api = { request } as unknown as ApiClient;
    await expect(createExtendQuote(api, SONG_ID, VERSION_ID, 'piano')).rejects.toMatchObject({ code: 'bad_response' });
    await expect(createCoverQuote(api, SONG_ID, VERSION_ID, 'piano', 50)).rejects.toMatchObject({ code: 'bad_response' });
    request.mockResolvedValue({ ...coverQuote, source_influence: 60 });
    await expect(createCoverQuote(api, SONG_ID, VERSION_ID, 'piano', 50)).rejects.toMatchObject({ code: 'bad_response' });
    expect(isMusicExtendQuote({ ...extendQuote, extend_seconds_after: 60 })).toBe(false);
});
