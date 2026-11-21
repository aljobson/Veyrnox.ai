import { switchTrackAddMode } from '../src/lib/music/trackAddForm';
import { parseMusicTrackAddQuote } from '../../../lib/musicBackend';
import type { ApiClient } from '../src/lib/api';
import { createTrackAddQuote, startTrackAdd, getTrackAdd, getTrackAddAudio } from '../src/lib/music/client';
import { isMusicTrackAddQuote, isTrackAddStart, isTrackAddRequest, isTrackAddAudio, trackAddInputError } from '../src/lib/music/validateTrackAdd';
import { MUSIC_PROMPT_MAX, MUSIC_LYRICS_MAX } from '../src/lib/music/shared';
import { SONG_ID, VERSION_ID } from './fixtures/musicActions';
import { trackQuote, trackStart, trackReplay, trackRequest, trackAudio, vocals, instrumental } from './fixtures/musicTrackAdd';
const request = jest.fn();
const api = { request } as unknown as ApiClient;
beforeEach(() => request.mockReset());
const fixtures: [string, Record<string, unknown>, (v: unknown) => boolean][] = [
    ['quote', trackQuote, isMusicTrackAddQuote], ['start', trackStart, isTrackAddStart],
    ['replay', trackReplay, isTrackAddStart], ['status', trackRequest, isTrackAddRequest], ['audio', trackAudio, isTrackAddAudio],
];
describe.each(fixtures)('%s response', (_name, fixture, validate) => {
    test('accepts the complete server shape', () => expect(validate(fixture)).toBe(true));
    test.each(Object.keys(fixture))('requires a valid %s field', key => {
        const partial = Object.fromEntries(Object.entries(fixture).filter(([k]) => k !== key));
        expect(validate(partial)).toBe(false);
        for (const bad of [null, {}, [], NaN]) expect(validate({ ...fixture, [key]: bad })).toBe(false);
    });
    test.each([undefined, null, {}, [], 'invalid'])('rejects %p', value => expect(validate(value)).toBe(false));
});
test.each([
    { mode: 'other' }, { source_duration_seconds: 0 }, { source_duration_seconds: 121 }, { source_duration_seconds: Infinity },
    { upload_credits: -1 }, { track_credits: -1 }, { total_credits: 11 }, { balance: -1 }, { balance_after: Infinity },
    { expires_at: 'yesterday' }, { affordable: 1 }, { quote_id: ' ' },
])('quote rejects malformed fields %p', patch => expect(isMusicTrackAddQuote({ ...trackQuote, ...patch })).toBe(false));
test('quote needs no model or candidate fields and accepts negative projected balance', () => {
    expect(trackQuote).not.toHaveProperty('model_id'); expect(trackQuote).not.toHaveProperty('output_count');
    expect(isMusicTrackAddQuote({ ...trackQuote, balance_after: -10, affordable: false })).toBe(true);
});
test.each(['queued', 'running', 'ready', 'failed', 'refunded'])('closed state accepts %s', state => {
    expect(isTrackAddStart({ ...trackStart, state })).toBe(true); expect(isTrackAddRequest({ ...trackRequest, state })).toBe(true);
});
test.each(['source_upload', 'part_generation', 'complete'])('closed stage accepts %s', stage => expect(isTrackAddRequest({ ...trackRequest, stage })).toBe(true));
test('unknown state/stage and invalid start discriminator are rejected', () => {
    expect(isTrackAddRequest({ ...trackRequest, state: 'succeeded' })).toBe(false);
    expect(isTrackAddRequest({ ...trackRequest, stage: 'finished' })).toBe(false);
    expect(isTrackAddStart({ ...trackStart, state: 'partial' })).toBe(false);
    expect(isTrackAddStart({ ...trackStart, idempotent: false })).toBe(false);
    expect(isTrackAddStart({ ...trackReplay, balance_after: 76 })).toBe(true);
    expect(isTrackAddStart({ ...trackReplay, balance_after: null })).toBe(false);
});
test.each([
    { url: 'http://mock.test/a' }, { url: '/relative.mp3' }, { url: 'file:///part.mp3' }, { url: 'https://user:pass@mock.test/a' },
    { url: 'https://' }, { mime_type: 'video/mp4' }, { mime_type: 'text/html' }, { size_bytes: -1 }, { expires_in: 0 }, { expires_in: Infinity },
])('audio rejects unsafe or malformed %p', patch => expect(isTrackAddAudio({ ...trackAudio, ...patch })).toBe(false));
test.each(['audio/mpeg', 'audio/wav'])('audio permits server MIME %s', mime_type => expect(isTrackAddAudio({ ...trackAudio, mime_type })).toBe(true));
test.each([undefined, 'auto', 'female', 'male'] as const)('vocals gender %p produces the exact trimmed body', async vocal_gender => {
    request.mockResolvedValue(trackQuote);
    await expect(createTrackAddQuote(api, SONG_ID, VERSION_ID, { ...vocals, vocal_gender }, true)).resolves.toEqual(trackQuote);
    expect(request.mock.calls[0][0]).toBe(`/api/v1/music/songs/${SONG_ID}/track-add-quotes`);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ version_id: VERSION_ID, mode: 'vocals', prompt: 'warm harmonies',
        lyrics: 'Sing along', vocal_gender: vocal_gender ?? 'auto', rights_confirmed: true, lyrics_rights_confirmed: true });
});
test('instrumental sends all seven fields with empty lyrics, false lyrics rights and auto gender', async () => {
    request.mockResolvedValue({ ...trackQuote, mode: 'instrumental' });
    await createTrackAddQuote(api, SONG_ID, VERSION_ID, instrumental, true);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ version_id: VERSION_ID, mode: 'instrumental', prompt: 'warm piano',
        lyrics: '', vocal_gender: 'auto', rights_confirmed: true, lyrics_rights_confirmed: false });
});
test.each([
    [{ mode: 'other' }, 'track_mode_invalid'], [{ prompt: '' }, 'prompt_invalid'], [{ prompt: 'x'.repeat(MUSIC_PROMPT_MAX + 1) }, 'prompt_invalid'],
    [{ lyrics: '' }, 'lyrics_invalid'], [{ lyrics: '  ' }, 'lyrics_invalid'], [{ lyrics: 'x'.repeat(MUSIC_LYRICS_MAX + 1) }, 'lyrics_invalid'],
    [{ vocal_gender: null }, 'vocal_gender_invalid'], [{ vocal_gender: 'unknown' }, 'vocal_gender_invalid'],
    [{ lyrics_rights_confirmed: false }, 'lyrics_rights_required'], [{ mode: 'instrumental' }, 'lyrics_not_applicable'],
])('invalid input %p fails locally with %s', async (patch, code) => {
    const input = { ...vocals, ...patch } as typeof vocals;
    expect(trackAddInputError(input)).toBe(code);
    await expect(createTrackAddQuote(api, SONG_ID, VERSION_ID, input, true)).rejects.toMatchObject({ code });
    expect(request).not.toHaveBeenCalled();
});
test('input boundaries and source rights are checked', async () => {
    expect(trackAddInputError({ ...vocals, prompt: 'x'.repeat(MUSIC_PROMPT_MAX), lyrics: 'x'.repeat(MUSIC_LYRICS_MAX) })).toBeNull();
    for (const key of ['mode', 'prompt', 'lyrics', 'lyrics_rights_confirmed'])
        expect(trackAddInputError(Object.fromEntries(Object.entries(vocals).filter(([k]) => k !== key)))).not.toBeNull();
    for (const patch of [{ lyrics: 'text' }, { lyrics_rights_confirmed: true }, { vocal_gender: 'female' }])
        expect(trackAddInputError({ ...instrumental, ...patch })).toBe('lyrics_not_applicable');
    await expect(createTrackAddQuote(api, SONG_ID, VERSION_ID, vocals, false)).rejects.toMatchObject({ code: 'source_rights_required' });
    expect(request).not.toHaveBeenCalled();
});
test('client start, replay, status and audio use separate request routes', async () => {
    request.mockResolvedValueOnce(trackStart).mockResolvedValueOnce(trackReplay).mockResolvedValueOnce(trackRequest).mockResolvedValueOnce(trackAudio);
    expect(await startTrackAdd(api, SONG_ID, trackQuote.quote_id, 'trackadd.fixed')).toEqual(trackStart);
    expect(await startTrackAdd(api, SONG_ID, trackQuote.quote_id, 'trackadd.fixed')).toEqual(trackReplay);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ quote_id: trackQuote.quote_id, idempotency_key: 'trackadd.fixed' });
    expect(request.mock.calls[1][1].body).toBe(request.mock.calls[0][1].body);
    expect(await getTrackAdd(api, trackRequest.id)).toEqual(trackRequest);
    expect(await getTrackAddAudio(api, trackRequest.id)).toEqual(trackAudio);
    expect(request.mock.calls.map(([p]) => p)).toEqual([`/api/v1/music/songs/${SONG_ID}/track-adds`, `/api/v1/music/songs/${SONG_ID}/track-adds`,
        `/api/v1/music/track-add-requests/${trackRequest.id}`, `/api/v1/music/track-add-requests/${trackRequest.id}/audio`]);
});
test('all client boundaries reject incomplete payloads and mismatched identity/mode', async () => {
    for (const call of [() => createTrackAddQuote(api, SONG_ID, VERSION_ID, vocals, true), () => startTrackAdd(api, SONG_ID, trackQuote.quote_id, 'trackadd.fixed'),
        () => getTrackAdd(api, trackRequest.id), () => getTrackAddAudio(api, trackRequest.id)]) {
        request.mockResolvedValueOnce({}); await expect(call()).rejects.toMatchObject({ code: 'bad_response' });
    }
    request.mockResolvedValueOnce({ ...trackQuote, mode: 'instrumental' });
    await expect(createTrackAddQuote(api, SONG_ID, VERSION_ID, vocals, true)).rejects.toMatchObject({ code: 'bad_response' });
    request.mockResolvedValueOnce({ ...trackRequest, id: SONG_ID });
    await expect(getTrackAdd(api, trackRequest.id)).rejects.toMatchObject({ code: 'bad_response' });
});

test('client bodies agree with the actual server parser, including omitted versus explicit auto', async () => {
    for (const parameters of [vocals, instrumental]) {
        request.mockResolvedValue({ ...trackQuote, mode: parameters.mode });
        await createTrackAddQuote(api, SONG_ID, VERSION_ID, parameters, true);
        const body = JSON.parse(request.mock.lastCall![1].body);
        expect(parseMusicTrackAddQuote(body)).toMatchObject({ ok: true, mode: parameters.mode, vocalGender: 'auto' });
        const { vocal_gender, ...omitted } = body; void vocal_gender;
        expect(parseMusicTrackAddQuote(omitted)).toEqual(parseMusicTrackAddQuote(body));
    }
});

test('choosing the mode that is already selected keeps the typed lyrics and rights', () => {
    const params = { mode: 'vocals' as const, prompt: 'warm', lyrics: 'la la', vocal_gender: 'female' as const, lyrics_rights_confirmed: true };
    expect(switchTrackAddMode(params, 'vocals')).toBe(params);
    expect(switchTrackAddMode(params, 'instrumental')).toEqual({ ...params, mode: 'instrumental', lyrics: '', vocal_gender: 'auto', lyrics_rights_confirmed: false });
});

test('the quote credit sum tolerates floating point rounding but not a real mismatch', () => {
    expect(isMusicTrackAddQuote({ ...trackQuote, upload_credits: 1.1, track_credits: 5.9, total_credits: 7 })).toBe(true);
    expect(isMusicTrackAddQuote({ ...trackQuote, upload_credits: 1, track_credits: 5, total_credits: 7 })).toBe(false);
});
