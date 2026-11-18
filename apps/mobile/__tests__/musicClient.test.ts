import { ApiError, type ApiClient } from '../src/lib/api';
import {
    createQuote, getEntitlements, getLibraryTab, getSong, isMusicOff, listSongs, probeMusic, recordListen,
    setSongLifecycle, startGeneration,
} from '../src/lib/music';
// @ts-ignore server parsers, used to prove the phone sends bodies the routes accept
import { parseMusicGeneration, parseMusicQuote } from '../../../lib/musicBackend.js';

const UUID = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';
const KEY = 'music-key-12345678';
let request: jest.Mock;
let api: ApiClient;
beforeEach(() => { request = jest.fn(); api = { request } as unknown as ApiClient; });
const sentBody = () => JSON.parse(request.mock.calls[request.mock.calls.length - 1][1].body);

const entitlements = {
    available: true, mode: 'simple', output_count: 2, concurrency_limit: 4, balance: 40, free_credits: 0, free_expires_at: null,
    models: [{ id: 'ace-step', name: 'ACE-Step', credits_per_candidate: 5, total_credits: 10, available: true }],
    custom_drafts: { available: true, autosave: true, generation_supported: false, lyrics_max: 3000, styles_max: 500, title_max: 80 },
    policy: { version: 'music-prompt-v1', pre_debit: true },
};

describe('entitlements', () => {
    test('reads the create-screen contract', async () => {
        request.mockResolvedValue(entitlements);
        expect((await getEntitlements(api)).models[0].id).toBe('ace-step');
        expect(request).toHaveBeenCalledWith('/api/v1/music/entitlements');
    });
    test.each([null, {}, { ...entitlements, models: 'x' }, { ...entitlements, balance: '40' }, { ...entitlements, custom_drafts: null }])('rejects malformed %p', async (v) => {
        request.mockResolvedValue(v);
        await expect(getEntitlements(api)).rejects.toMatchObject({ code: 'bad_response' });
    });
});

describe('library tabs', () => {
    test('each tab reads its own key', async () => {
        request.mockResolvedValueOnce({ songs: [{ id: 'a' }] });
        expect(await getLibraryTab(api, 'history')).toEqual({ tab: 'history', songs: [{ id: 'a' }] });
        expect(request).toHaveBeenLastCalledWith('/api/v1/music/library-tabs?tab=history');
        request.mockResolvedValueOnce({ hooks: [] });
        expect(await getLibraryTab(api, 'hooks')).toEqual({ tab: 'hooks', hooks: [] });
        request.mockResolvedValueOnce({ images: [{ id: 'i' }], covers: [] });
        expect(await getLibraryTab(api, 'covers')).toEqual({ tab: 'covers', images: [{ id: 'i' }], covers: [] });
    });
    test.each([['history', { hooks: [] }], ['covers', { images: [] }], ['hooks', { hooks: [1] }]] as const)('%s rejects %p', async (tab, v) => {
        request.mockResolvedValue(v);
        await expect(getLibraryTab(api, tab)).rejects.toMatchObject({ code: 'bad_response' });
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
        request.mockResolvedValue({ id: 'x', actions: ['crop'] });
        expect((await getSong(api, 'a/b')).actions).toEqual(['crop']);
        expect(request).toHaveBeenLastCalledWith('/api/v1/music/songs/a%2Fb');
        request.mockResolvedValue({ id: 'x' });
        await expect(getSong(api, 'x')).rejects.toMatchObject({ code: 'bad_response' });
    });
    test('lifecycle sends PATCH with action and revision', async () => {
        request.mockResolvedValue({ song: { id: 'x' }, idempotent: true });
        expect(await setSongLifecycle(api, UUID, 'trash', 3)).toEqual({ song: { id: 'x' }, idempotent: true });
        expect(request.mock.calls[0][1].method).toBe('PATCH');
        expect(sentBody()).toEqual({ action: 'trash', revision: 3 });
    });
});

describe('quote and generation', () => {
    const quote = { quote_id: UUID, mode: 'simple', model_id: 'ace-step', output_count: 2, credits_per_candidate: 5, total_credits: 10, balance: 40, balance_after: 30, affordable: true, expires_at: '2026-11-18T10:00:00Z', policy_version: 'music-prompt-v1' };
    test('simple and custom quote bodies pass the server parser', async () => {
        request.mockResolvedValue(quote);
        await createQuote(api, { prompt: 'lofi beat', duration_seconds: 30 });
        expect(parseMusicQuote(sentBody()).ok).toBe(true);
        await createQuote(api, { mode: 'custom', draft_revision: 2, instrumental: false, rights_confirmed: true });
        expect(parseMusicQuote(sentBody()).ok).toBe(true);
    });
    test('quote rejects a malformed answer', async () => {
        request.mockResolvedValue({ ...quote, affordable: 'yes' });
        await expect(createQuote(api, { prompt: 'x' })).rejects.toMatchObject({ code: 'bad_response' });
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
    test('generation rejects candidates without a job id', async () => {
        request.mockResolvedValue({ generation_id: UUID, state: 'queued', candidates: [{ ordinal: 1 }], balance_after: 1 });
        await expect(startGeneration(api, UUID, KEY)).rejects.toMatchObject({ code: 'bad_response' });
    });
});

describe('probeMusic (feature flags are server-side)', () => {
    test('on', async () => {
        expect(await probeMusic(async () => 7)).toEqual({ state: 'on', data: 7 });
    });
    test.each(['music_unavailable', 'music_library_unavailable', 'music_library_tabs_unavailable', 'music_remix_unavailable', 'music_future_unavailable'])('404 %s is off', async (code) => {
        expect(await probeMusic(async () => { throw new ApiError(404, code); })).toEqual({ state: 'off', code });
    });
    test('getEntitlements 404 music_unavailable gives off, not a throw', async () => {
        request.mockRejectedValue(new ApiError(404, 'music_unavailable'));
        expect(await probeMusic(() => getEntitlements(api))).toEqual({ state: 'off', code: 'music_unavailable' });
    });
    test('a missing song is an error, not off', async () => {
        expect(await probeMusic(async () => { throw new ApiError(404, 'not_found'); })).toEqual({ state: 'error', code: 'not_found', status: 404 });
    });
    test.each([[new ApiError(502, 'temporarily_unavailable'), 502], [new ApiError(401, 'not_authenticated'), 401], [new ApiError(0, 'network'), 0], [new Error('boom'), 0]])('%p is an error', async (err, status) => {
        const r = await probeMusic(async () => { throw err; });
        expect(r.state).toBe('error');
        expect((r as { status: number }).status).toBe(status);
    });
    test('only a 404 can be off', () => {
        expect(isMusicOff(new ApiError(503, 'music_unavailable'))).toBe(false);
        expect(isMusicOff(null)).toBe(false);
    });
});
