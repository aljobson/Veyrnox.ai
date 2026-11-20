import type { ApiClient } from '../src/lib/api';
import { createAddSectionQuote, createReplaceQuote, startAddSection, startReplace, commitReplaceTake, replaceCommitKey } from '../src/lib/music/client';
import { isMusicAddSectionQuote, isMusicReplaceQuote, isReplaceCommit, validReplaceRange } from '../src/lib/music/validateSectionActions';
import { SECTION_POSITIONS, SECTION_DURATIONS } from '../src/lib/music/sectionActionTypes';
import { replaceRange, sourceRangeHint } from '../src/lib/music/sectionForm';
import { MUSIC_REPLACE_RANGE_MAX, MUSIC_REPLACE_DURATION_MAX } from '../src/lib/music/shared';
import { addSectionQuote, replaceQuote, generationReplay, addParameters } from './fixtures/musicSectionActions';
import { SONG_ID, VERSION_ID } from './fixtures/musicActions';
// @ts-ignore server-owned pure parser validates the mirrored closed lists.
import { parseMusicAddSectionQuote, parseMusicReplaceQuote } from '../../../lib/musicBackend';
const missing = (v: object, key: string) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== key));
for (const [name, validate, fixture] of [['add', isMusicAddSectionQuote, addSectionQuote], ['replace', isMusicReplaceQuote, replaceQuote],
    ['commit', isReplaceCommit, { version_id: VERSION_ID, idempotent: false }]] as const) describe(name, () => {
    test('accepts complete fixture', () => expect(validate(fixture)).toBe(true));
    test.each(Object.keys(fixture))('requires and validates %s', key => {
        for (const value of [missing(fixture, key), { ...fixture, [key]: {} }, { ...fixture, [key]: null }]) expect(validate(value)).toBe(false);
    });
});
test('rejects nonfinite numbers, wrong counts, dates, limits and UUIDs', () => {
    for (const [validate, quote] of [[isMusicAddSectionQuote, addSectionQuote], [isMusicReplaceQuote, replaceQuote]] as const) {
        for (const key of ['total_credits', 'credits_per_candidate', 'balance', 'balance_after', 'source_duration_seconds'])
            for (const value of [NaN, Infinity, -Infinity]) expect(validate({ ...quote, [key]: value })).toBe(false);
        for (const patch of [{ output_count: 1 }, { expires_at: 'tomorrow' }, { source_duration_seconds: 0 }, { source_duration_seconds: 121 }]) expect(validate({ ...quote, ...patch })).toBe(false);
    }
    expect(isMusicReplaceQuote({ ...replaceQuote, end_seconds: 61 })).toBe(false);
    for (const version_id of ['bad', `${VERSION_ID}\n`, 12]) expect(isReplaceCommit({ version_id, idempotent: false })).toBe(false);
    expect(isReplaceCommit({ version_id: VERSION_ID, idempotent: 'true' })).toBe(false);
});
test('closed position and duration lists mirror the server parser exactly', () => {
    for (const position of [...SECTION_POSITIONS, 'middle', '', null]) for (const duration_seconds of [0, 9, ...SECTION_DURATIONS, 11, 20.5, 31, '10']) {
        const body = { ...addParameters, version_id: VERSION_ID, rights_confirmed: true, position, duration_seconds };
        expect(parseMusicAddSectionQuote(body).ok).toBe(SECTION_POSITIONS.some(p => p === position) && SECTION_DURATIONS.some(d => d === duration_seconds));
    }
});
test.each(SECTION_POSITIONS)('exact add request at %s for all durations, omitted/empty/present lyrics', async position => {
    for (const duration_seconds of SECTION_DURATIONS) for (const lyrics of [undefined, '', '  la la  ']) {
        const quote = { ...addSectionQuote, position, duration_seconds, instrumental: !lyrics?.trim() };
        const request = jest.fn().mockResolvedValue(quote);
        await createAddSectionQuote({ request } as unknown as ApiClient, SONG_ID, VERSION_ID, { ...addParameters, position, duration_seconds, lyrics });
        expect(request.mock.calls[0][0]).toBe(`/api/v1/music/songs/${SONG_ID}/add-section-quotes`);
        expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ version_id: VERSION_ID, position, duration_seconds, styles: 'ambient', rights_confirmed: true,
            ...(lyrics === undefined ? {} : { lyrics: lyrics.trim() }) });
    }
});
test.each([{ position: 'middle' }, { duration_seconds: 15 }, { styles: ' ' }, { styles: 'a'.repeat(501) }, { lyrics: 'a'.repeat(3001) }, { lyrics: null }])('invalid add input %p sends nothing', async patch => {
    const request = jest.fn();
    await expect(createAddSectionQuote({ request } as unknown as ApiClient, SONG_ID, VERSION_ID, { ...addParameters, ...patch } as never)).rejects.toBeDefined();
    expect(request).not.toHaveBeenCalled();
});
test('every selectable half-second range agrees with the server and sends exactly the displayed numbers', async () => {
    const failures: unknown[] = [], request = jest.fn(), api = { request } as unknown as ApiClient;
    for (let start_half = 0; start_half <= MUSIC_REPLACE_DURATION_MAX * 2; start_half++) {
        for (let end_half = 0; end_half <= MUSIC_REPLACE_DURATION_MAX * 2; end_half++) {
            const range = replaceRange({ start_half, end_half }), { start_seconds: start, end_seconds: end } = range;
            const server = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && !(end - start < 1 || end - start > MUSIC_REPLACE_RANGE_MAX);
            if (validReplaceRange(start, end) !== server) failures.push(range);
            if (!server) continue;
            const body = { version_id: VERSION_ID, prompt: 'piano', ...range, rights_confirmed: true };
            if (!parseMusicReplaceQuote(body).ok) failures.push(body);
            request.mockResolvedValue({ ...replaceQuote, ...range });
            await createReplaceQuote(api, SONG_ID, VERSION_ID, { prompt: '  piano  ', ...range });
            const sent = JSON.parse(request.mock.lastCall[1].body);
            if (sent.start_seconds !== Number(String(start_half / 2)) || sent.end_seconds !== Number(String(end_half / 2))) failures.push(sent);
        }
    }
    expect(failures).toEqual([]); expect(request.mock.calls.length).toBeGreaterThan(5000);
    expect(sourceRangeHint(12.3)).toBe(24); expect(sourceRangeHint(undefined)).toBe(120);
});
test.each([[0, 0.9], [0, 30.1], [2, 2], [3, 2], [-1, 2], [NaN, 2], [0, Infinity]])('invalid range %p..%p never transports', async (start_seconds, end_seconds) => {
    const request = jest.fn();
    await expect(createReplaceQuote({ request } as unknown as ApiClient, SONG_ID, VERSION_ID, { prompt: 'piano', start_seconds, end_seconds })).rejects.toMatchObject({ code: 'range_invalid' });
    expect(request).not.toHaveBeenCalled();
});
test.each([1, 30])('range boundary %s sends exact trimmed request', async end_seconds => {
    const request = jest.fn().mockResolvedValue({ ...replaceQuote, end_seconds });
    await createReplaceQuote({ request } as unknown as ApiClient, SONG_ID, VERSION_ID, { prompt: '  piano ', start_seconds: 0, end_seconds });
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ version_id: VERSION_ID, prompt: 'piano', start_seconds: 0, end_seconds, rights_confirmed: true });
});
test('confirms accept lenient replay and commit has exact deterministic body', async () => {
    const request = jest.fn().mockResolvedValue(generationReplay), api = { request } as unknown as ApiClient;
    for (const [route, start] of [['sections', startAddSection], ['replacements', startReplace]] as const) {
        expect(await start(api, SONG_ID, replaceQuote.quote_id, 'same-key')).toEqual(generationReplay);
        expect(request.mock.lastCall[0]).toBe(`/api/v1/music/songs/${SONG_ID}/${route}`);
        expect(JSON.parse(request.mock.lastCall[1].body)).toEqual({ quote_id: replaceQuote.quote_id, idempotency_key: 'same-key' });
    }
    request.mockResolvedValue({ version_id: VERSION_ID, idempotent: true });
    await commitReplaceTake(api, SONG_ID, generationReplay.generation_id, VERSION_ID);
    expect(request.mock.lastCall[0]).toBe(`/api/v1/music/songs/${SONG_ID}/replacements/commit`);
    expect(JSON.parse(request.mock.lastCall[1].body)).toEqual({ generation_id: generationReplay.generation_id, version_id: VERSION_ID,
        idempotency_key: replaceCommitKey(generationReplay.generation_id, VERSION_ID) });
});
test('all new client boundaries reject partial replies and mismatched echoes', async () => {
    const request = jest.fn().mockResolvedValue({}), api = { request } as unknown as ApiClient;
    const calls = [() => createAddSectionQuote(api, SONG_ID, VERSION_ID, addParameters),
        () => createReplaceQuote(api, SONG_ID, VERSION_ID, { prompt: 'piano', start_seconds: 0, end_seconds: 1 }),
        () => startAddSection(api, SONG_ID, VERSION_ID, 'key'), () => startReplace(api, SONG_ID, VERSION_ID, 'key'),
        () => commitReplaceTake(api, SONG_ID, VERSION_ID, VERSION_ID)];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'bad_response' });
    request.mockResolvedValue({ ...addSectionQuote, position: 'beginning' }); await expect(calls[0]()).rejects.toMatchObject({ code: 'bad_response' });
    request.mockResolvedValue({ ...replaceQuote, end_seconds: 2 }); await expect(calls[1]()).rejects.toMatchObject({ code: 'bad_response' });
});
