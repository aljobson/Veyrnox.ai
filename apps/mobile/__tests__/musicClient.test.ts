import { song, version, hook } from './fixtures/music';
import { ApiError, type ApiClient } from '../src/lib/api';
import {
    analyzeMusicInspiration, createQuote, getEntitlements, getLibraryTab, getSong, isMusicOff, listSongs, probeMusic, recordListen,
    setSongLifecycle, startGeneration,
} from '../src/lib/music';
import {
    enrollMusicVoice, listMusicVoices, reissueMusicVoiceChallenge, revokeMusicVoice, submitMusicVoiceChallenge,
} from '../src/lib/music/voices';
// @ts-ignore server parsers, used to prove the phone sends bodies the routes accept
import { parseMusicGeneration, parseMusicQuote } from '../../../lib/musicBackend.js';

const UUID = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';
const KEY = 'music-key-12345678';
let request: jest.Mock;
let api: ApiClient;
beforeEach(() => { request = jest.fn(); api = { request } as unknown as ApiClient; });
const sentBody = () => JSON.parse(request.mock.calls[request.mock.calls.length - 1][1].body);

const controls = {
    description: true, seed: false, variety: false, style_influence: false, exclude_styles: false, tempo_key_meter: false,
    duration_seconds: { min: 10, max: 60, default: 60 }, lyrics: false, styles: false, instrumental: 'required',
};
const model = {
    id: 'ace-step', name: 'ACE-Step', generation_modes: ['simple'], controls, credits_per_candidate: 5, total_credits: 10,
    instrumental_only: true, requires_paid_plan: false, available: true,
};
const entitlements = {
    available: true, mode: 'simple', output_count: 2, concurrency_limit: 4, balance: 40, free_credits: 0, free_expires_at: null,
    models: [model],
    custom_drafts: { available: true, autosave: true, generation_supported: false, lyrics_max: 3000, styles_max: 500, title_max: 80 },
    features: { albums: false, inspiration: false, studioChat: false, dailyChallenge: false, persistentQueue: false },
    inspiration_sources: [],
    policy: { version: 'music-prompt-v1', pre_debit: true },
};

describe('entitlements', () => {
    test('reads the create-screen contract', async () => {
        request.mockResolvedValue(entitlements);
        expect((await getEntitlements(api)).models[0].id).toBe('ace-step');
        expect(request).toHaveBeenCalledWith('/api/v1/music/entitlements');
    });
    test('fails closed when an older or rolled-back server omits rollout capabilities', async () => {
        const { features: _features, ...legacyEntitlements } = entitlements;
        request.mockResolvedValue(legacyEntitlements);
        expect((await getEntitlements(api)).features).toEqual({
            albums: false, inspiration: false, studioChat: false, dailyChallenge: false, persistentQueue: false, voices: false,
        });
    });
    test('normalizes a pre-voices feature projection without hiding known capabilities', async () => {
        request.mockResolvedValue({ ...entitlements, features: { ...entitlements.features, albums: true } });
        await expect(getEntitlements(api)).resolves.toMatchObject({ features: { albums: true, voices: false } });
    });
    test('shows inspiration only for a valid, unique server source contract', async () => {
        request.mockResolvedValueOnce({ ...entitlements,
            features: { ...entitlements.features, inspiration: true }, inspiration_sources: ['audio'] });
        await expect(getEntitlements(api)).resolves.toMatchObject({
            features: { inspiration: true }, inspiration_sources: ['audio'],
        });

        for (const inspiration_sources of [undefined, ['audio', 'audio'], ['raw_video']]) {
            request.mockResolvedValueOnce({ ...entitlements,
                features: { ...entitlements.features, inspiration: true }, inspiration_sources });
            await expect(getEntitlements(api)).resolves.toMatchObject({
                features: { inspiration: false }, inspiration_sources: [],
            });
        }

        request.mockResolvedValueOnce({ ...entitlements, inspiration_sources: ['audio'] });
        await expect(getEntitlements(api)).resolves.toMatchObject({
            features: { inspiration: false }, inspiration_sources: [],
        });
    });
    test('keeps a known daily challenge but drops only malformed or disabled challenge fields', async () => {
        const daily = {
            catalog_version: 'v1', id: 'v1:2026-11-24:glass-after-rain', date: '2026-11-24',
            reset_at: '2026-11-25T00:00:00.000Z', title_key: 'music.dailyChallenge.prompt.glass-after-rain.title',
            prompt_key: 'music.dailyChallenge.prompt.glass-after-rain.prompt', no_reward: true,
        };
        const enabled = { ...entitlements, features: { ...entitlements.features, dailyChallenge: true }, daily_challenge: daily };
        request.mockResolvedValueOnce(enabled);
        expect((await getEntitlements(api)).daily_challenge).toEqual(daily);
        request.mockResolvedValueOnce({ ...enabled, daily_challenge: { ...daily, catalog_version: 'v2' } });
        expect((await getEntitlements(api)).daily_challenge).toBeUndefined();
        request.mockResolvedValueOnce({ ...entitlements, daily_challenge: daily });
        expect((await getEntitlements(api)).daily_challenge).toBeUndefined();
    });
    const without = (o: Record<string, unknown>, k: string) => { const { [k]: _drop, ...rest } = o; return rest; };
    test.each([
        null, {}, { ...entitlements, models: 'x' }, { ...entitlements, balance: '40' }, { ...entitlements, custom_drafts: null },
        without(entitlements, 'policy'),
        { ...entitlements, features: { ...entitlements.features, albums: 'yes' } },
        { ...entitlements, features: null },
        { ...entitlements, policy: { version: 'v' } },
        { ...entitlements, custom_drafts: without(entitlements.custom_drafts, 'lyrics_max') },
        { ...entitlements, models: [without(model, 'controls')] },
        { ...entitlements, models: [without(model, 'generation_modes')] },
        { ...entitlements, models: [{ ...model, controls: without(controls, 'duration_seconds') }] },
        { ...entitlements, models: [{ ...model, controls: { ...controls, instrumental: 'maybe' } }] },
        { ...entitlements, models: [{ ...model, available: 'yes' }] },
        { ...entitlements, free_expires_at: 5 },
    ])('rejects malformed %j', async (v) => {
        request.mockResolvedValue(v);
        await expect(getEntitlements(api)).rejects.toMatchObject({ code: 'bad_response' });
    });
});

describe('audio inspiration', () => {
    const result = { analysis_id: UUID, brief: 'Warm pulse', tags: ['warm'], receipt: 'a.b',
        expires_at: '2026-11-24T12:00:00Z', idempotent: false };
    test('posts the exact rights-bound contract and validates the result', async () => {
        request.mockResolvedValue(result);
        await expect(analyzeMusicInspiration(api, 'audio', 'uploads/key.mp3', KEY)).resolves.toEqual(result);
        expect(request.mock.calls[0][0]).toBe('/api/v1/music/inspiration');
        expect(sentBody()).toEqual({ kind: 'audio', key: 'uploads/key.mp3', rights_confirmed: true, idempotency_key: KEY });
    });
    test.each([{ ...result, brief: '' }, { ...result, tags: ['x', 'x'] }, { ...result, idempotent: 'no' }])('rejects malformed %j', async value => {
        request.mockResolvedValue(value);
        await expect(analyzeMusicInspiration(api, 'image', 'uploads/key.jpg', KEY)).rejects.toMatchObject({ code: 'bad_response' });
    });
});

describe('verified voices', () => {
    const profile = { id: UUID, name: 'My voice', status: 'challenge_issued', submission_revision: 0,
        challenge_expires_at: '2026-11-24T12:00:00Z', review_expires_at: null, verified_at: null,
        verification_expires_at: null, reason_code: null, created_at: '2026-11-24T11:00:00Z',
        updated_at: '2026-11-24T11:00:00Z' };
    const challenge = { phrase: 'amber river 123456', expires_at: profile.challenge_expires_at };

    test('uses narrow contracts and header idempotency for consent withdrawal', async () => {
        request.mockResolvedValueOnce({ profiles: [profile], policy: { enrollment_available: false } });
        await expect(listMusicVoices(api)).resolves.toEqual({ profiles: [profile], enrollmentAvailable: false });
        expect(request).toHaveBeenLastCalledWith('/api/v1/music/voices');

        request.mockResolvedValueOnce({ profile, challenge });
        await enrollMusicVoice(api, { name: 'My voice', referenceKey: 'uploads/ref.wav', idempotencyKey: KEY });
        expect(sentBody()).toMatchObject({ owner_attestation: true, adult_attestation: true,
            eligible_region_attestation: true, idempotency_key: KEY });

        request.mockResolvedValueOnce({ profile, challenge });
        await reissueMusicVoiceChallenge(api, UUID, KEY);
        expect(sentBody()).toEqual({ idempotency_key: KEY });

        request.mockResolvedValueOnce({ profile, challenge_reissue_required: true, idempotent: true });
        await expect(reissueMusicVoiceChallenge(api, UUID, KEY)).resolves.toBeNull();

        request.mockResolvedValueOnce({ profile });
        await submitMusicVoiceChallenge(api, UUID, { challengeKey: 'uploads/live.wav', phrase: challenge.phrase,
            idempotencyKey: KEY });
        expect(sentBody()).toEqual({ challenge_source_key: 'uploads/live.wav', phrase: challenge.phrase,
            live_recording_attestation: true, idempotency_key: KEY });

        request.mockResolvedValueOnce({ profile: { ...profile, status: 'revoked' } });
        await revokeMusicVoice(api, UUID, KEY);
        expect(request).toHaveBeenLastCalledWith(`/api/v1/music/voices/${UUID}`, {
            method: 'DELETE', headers: { 'Idempotency-Key': KEY },
        });
    });

    test('rejects malformed profile projections', async () => {
        request.mockResolvedValueOnce({ profiles: [{ ...profile, status: 'approved' }], policy: { enrollment_available: true } });
        await expect(listMusicVoices(api)).rejects.toMatchObject({ code: 'bad_response' });
    });
});

describe('library tabs', () => {
    test('each tab reads its own key', async () => {
        request.mockResolvedValueOnce({ songs: [{ id: 'a', title: 'A' }] });
        expect(await getLibraryTab(api, 'history')).toEqual({ tab: 'history', songs: [{ id: 'a', title: 'A' }] });
        expect(request).toHaveBeenLastCalledWith('/api/v1/music/library-tabs?tab=history');
        request.mockResolvedValueOnce({ hooks: [] });
        expect(await getLibraryTab(api, 'hooks')).toEqual({ tab: 'hooks', hooks: [], dropped: 0 });
        request.mockResolvedValueOnce({ images: [{ id: 'i' }], covers: [] });
        expect(await getLibraryTab(api, 'covers')).toEqual({ tab: 'covers', images: [{ id: 'i' }], covers: [] });
    });
    test.each([['history', { hooks: [] }], ['covers', { images: [] }], ['hooks', { hooks: {} }]] as const)('%s rejects %p', async (tab, v) => {
        request.mockResolvedValue(v);
        await expect(getLibraryTab(api, tab)).rejects.toMatchObject({ code: 'bad_response' });
    });
    test.each([{ ...hook, end_seconds: hook.start_seconds }, { ...hook, audio_url: '/invalid' }, { ...hook, title: 1 }])('drops invalid hooks without discarding valid rows: %p', async bad => {
        request.mockResolvedValue({ hooks: [bad, hook] });
        expect(await getLibraryTab(api, 'hooks')).toEqual({ tab: 'hooks', hooks: [hook], dropped: 1 });
    });
    test('reports every dropped row when no hook is playable', async () => {
        request.mockResolvedValue({ hooks: [null, { ...hook, audio_url: '/invalid' }, { ...hook, end_seconds: 0 }] });
        expect(await getLibraryTab(api, 'hooks')).toEqual({ tab: 'hooks', hooks: [], dropped: 3 });
    });
    test('recordListen posts the action and wants recorded:true', async () => {
        request.mockResolvedValue({ recorded: true });
        await recordListen(api, UUID);
        expect(sentBody()).toEqual({ action: 'listen', song_id: UUID });
        request.mockResolvedValue({});
        await expect(recordListen(api, UUID)).rejects.toMatchObject({ code: 'bad_response' });
    });
});

describe('songs', () => {
    test('list builds the query string', async () => {
        request.mockResolvedValue({ songs: [] });
        await listSongs(api);
        expect(request).toHaveBeenLastCalledWith('/api/v1/music/songs');
        await listSongs(api, { limit: 10, q: 'a b', collection: 'trash', workspace: UUID });
        expect(request).toHaveBeenLastCalledWith(`/api/v1/music/songs?limit=10&workspace=${UUID}&q=a+b&collection=trash`);
    });
    test('list rejects a non-array', async () => {
        request.mockResolvedValue({ songs: {} });
        await expect(listSongs(api)).rejects.toMatchObject({ code: 'bad_response' });
    });
    test('detail encodes the id and needs actions', async () => {
        request.mockResolvedValue({ ...song, id: 'x', actions: ['crop'] });
        expect((await getSong(api, 'a/b')).actions).toEqual(['crop']);
        expect(request).toHaveBeenLastCalledWith('/api/v1/music/songs/a%2Fb');
        request.mockResolvedValue({ id: 'x' });
        await expect(getSong(api, 'x')).rejects.toMatchObject({ code: 'bad_response' });
    });
    test('lifecycle sends PATCH with action and revision', async () => {
        request.mockResolvedValue({ song: { id: 'x', revision: 4, lifecycle_status: 'trashed', updated_at: version.created_at }, idempotent: true });
        expect(await setSongLifecycle(api, UUID, 'trash', 3)).toEqual({ song: { id: 'x', revision: 4, lifecycle_status: 'trashed', updated_at: version.created_at }, idempotent: true });
        expect(request.mock.calls[0][1].method).toBe('PATCH');
        expect(sentBody()).toEqual({ action: 'trash', revision: 3 });
    });
});

describe('quote and generation', () => {
    const quote = { quote_id: UUID, mode: 'simple', model_id: 'ace-step', output_count: 2, credits_per_candidate: 5, total_credits: 10, balance: 40, balance_after: 30, affordable: true, expires_at: '2026-11-18T10:00:00Z', policy_version: 'music-prompt-v1' };
    test('simple and custom quote bodies pass the server parser', async () => {
        request.mockResolvedValue(quote);
        await createQuote(api, { mode: 'simple', prompt: 'lofi beat', instrumental: true, model_id: 'ace-step', duration_seconds: 30 });
        expect(parseMusicQuote(sentBody()).ok).toBe(true);
        await createQuote(api, { mode: 'custom', draft_revision: 2, instrumental: false, rights_confirmed: true, duration_seconds: 30 });
        expect(parseMusicQuote(sentBody()).ok).toBe(true);
    });
    test.each([{ ...quote, affordable: 'yes' }, { ...quote, mode: 'other' }, { ...quote, policy_version: undefined },
        { ...quote, model_id: undefined }, { ...quote, output_count: '2' }, { ...quote, balance: undefined }])('quote rejects malformed %j', async (v) => {
        request.mockResolvedValue(v);
        await expect(createQuote(api, { mode: 'simple', prompt: 'x', instrumental: true, model_id: 'ace-step', duration_seconds: 30 })).rejects.toMatchObject({ code: 'bad_response' });
    });
    test('generation body passes the server parser and a replay is returned as-is', async () => {
        const gen = { generation_id: UUID, state: 'queued', candidates: [{ ordinal: 1, label: 'A', job_id: 'j1', state: 'queued' }], balance_after: 30 };
        request.mockResolvedValueOnce(gen);
        await startGeneration(api, UUID, KEY);
        expect(parseMusicGeneration(sentBody()).ok).toBe(true);
        request.mockResolvedValueOnce({ ...gen, idempotent: true });
        expect((await startGeneration(api, UUID, KEY)).idempotent).toBe(true);
        expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body); // same key both times
    });
    const cand = { ordinal: 1, label: 'A', job_id: 'j1', state: 'queued' };
    const base = { generation_id: UUID, state: 'queued', candidates: [cand], balance_after: 1 };
    test.each([
        { ...base, candidates: [{ ordinal: 1 }] }, { ...base, candidates: [{ ...cand, label: undefined }] },
        { ...base, candidates: [{ ...cand, state: 5 }] }, { ...base, candidates: [{ ...cand, job_id: undefined }] },
        { ...base, state: undefined }, { ...base, idempotent: false }, { ...base, balance_after: 'x' },
    ])('generation rejects malformed %j', async (v) => {
        request.mockResolvedValue(v);
        await expect(startGeneration(api, UUID, KEY)).rejects.toMatchObject({ code: 'bad_response' });
    });
});

describe('probeMusic (feature flags are server-side)', () => {
    test('on', async () => {
        expect(await probeMusic(async () => 7)).toEqual({ state: 'on', data: 7 });
    });
    test.each(['blocks_unavailable', 'music_unavailable', 'music_library_unavailable', 'music_library_tabs_unavailable', 'music_remix_unavailable', 'music_future_unavailable', 'music_distribution_unavailable'])('404 %s is off', async (code) => {
        expect(await probeMusic(async () => { throw new ApiError(404, code); })).toEqual({ state: 'off', code });
    });
    test('getEntitlements 404 music_unavailable gives off, not a throw', async () => {
        request.mockRejectedValue(new ApiError(404, 'music_unavailable'));
        expect(await probeMusic(() => getEntitlements(api))).toEqual({ state: 'off', code: 'music_unavailable' });
    });
    test('a missing song is an error, not off', async () => {
        expect(await probeMusic(async () => { throw new ApiError(404, 'not_found'); })).toEqual({ state: 'error', code: 'not_found', status: 404 });
    });
    test.each([[new ApiError(500, 'internal'), 500], [new ApiError(502, 'temporarily_unavailable'), 502], [new ApiError(401, 'not_authenticated'), 401], [new ApiError(0, 'network'), 0], [new Error('boom'), 0]])('%p is an error', async (err, status) => {
        const r = await probeMusic(async () => { throw err; });
        expect(r.state).toBe('error');
        expect((r as { status: number }).status).toBe(status);
    });
    test('only a 404 can be off', () => {
        expect(isMusicOff(new ApiError(503, 'music_unavailable'))).toBe(false);
        expect(isMusicOff(null)).toBe(false);
    });
});
