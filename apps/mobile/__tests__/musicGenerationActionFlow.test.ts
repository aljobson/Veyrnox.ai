import { ApiError, type ApiClient } from '../src/lib/api';
import { resetNetworkState } from '../src/lib/network';
import { resetCacheUser, bindCacheUser } from '../src/lib/appCache';
import { createSongActionFlow } from '../src/lib/music/actionFlow';
import { createActionAttempts } from '../src/lib/music/actionAttempts';
import { generationAction, GENERATION_ACTION_REJECTIONS } from '../src/lib/music/generationAction';
import { getMusicCreateSession } from '../src/lib/music/createSession';
import { subscribeSongChanges } from '../src/lib/music/songChanges';
import type { GenerationActionStart } from '../src/lib/music/generationActionTypes';
import type { MusicGenerationView } from '../src/lib/music/types';
import { generationSong, extendQuote, coverQuote, generationStart, generationReplay, generationView, readyView } from './fixtures/musicGenerationActions';
import { SONG_ID, NEXT_VERSION_ID, deferred } from './fixtures/musicActions';
for (const kind of ['extend', 'cover'] as const) describe(kind, () => {
    let request: jest.Mock, api: ApiClient, flow: ReturnType<typeof createSongActionFlow<GenerationActionStart, MusicGenerationView>>;
    const quote = kind === 'extend' ? extendQuote : coverQuote;
    const posts = () => request.mock.calls.filter(([p]) => p.endsWith(`/${kind}s`));
    const parameters = { prompt: '  ambient  ', source_influence: 50 };
    const input = { song_id: SONG_ID, version_id: generationSong.version_id, rights_confirmed: true, parameters };
    beforeEach(async () => {
        jest.useFakeTimers(); resetNetworkState(); resetCacheUser(); await bindCacheUser('generation-action-user');
        request = jest.fn(async (p: string) => p.endsWith(`/${kind}-quotes`) ? quote : p.endsWith(`/${kind}s`) ? generationStart
            : p.includes('/generations/') ? generationView : generationSong);
        api = { request } as unknown as ApiClient;
        flow = createSongActionFlow(api, generationAction(kind, SONG_ID), SONG_ID,
            { mintKey: () => 'fixed-12345678', poll: { initialAppState: 'active', subscribeAppState: () => () => {} } });
        await flow.load(); flow.edit({ rights_confirmed: true, parameters });
    });
    afterEach(() => { flow.dispose(); resetCacheUser(); jest.useRealTimers(); resetNetworkState(); });
    test('review refreshes source, preserves every quote field without outputs, and never spends', async () => {
        flow.edit({ rights_confirmed: false }); await flow.review(); expect(flow.snapshot().error).toBe('source_rights_required');
        flow.edit({ rights_confirmed: true }); request.mockResolvedValueOnce({ ...generationSong, version_id: NEXT_VERSION_ID });
        await flow.review(); expect(posts()).toHaveLength(0);
        const pending = flow.attempts.snapshot()!; expect(pending).toMatchObject({ quote, phase: 'UNSUBMITTED', key: `${kind}.fixed-12345678` });
        expect(Object.isFrozen(pending.quote)).toBe(true); expect(pending.quote).not.toHaveProperty('outputs');
        expect(JSON.parse(request.mock.calls.find(([p]) => p.endsWith(`/${kind}-quotes`))![1].body)).toEqual({ version_id: NEXT_VERSION_ID,
            prompt: 'ambient', rights_confirmed: true, ...(kind === 'cover' ? { source_influence: 50 } : {}) });
    });
    test.each(['prompt', 'source_influence', 'rights'])('%s edit invalidates the unsubmitted quote', async key => {
        await flow.review(); flow.edit(key === 'rights' ? { rights_confirmed: false } : { parameters: { ...parameters, [key]: key === 'prompt' ? 'new' : 60 } });
        expect(flow.attempts.snapshot()).toBeNull(); await flow.confirm(); expect(posts()).toHaveLength(0);
    });
    test('late quote for old input is ignored', async () => {
        const wait = deferred<typeof quote>(); request.mockResolvedValueOnce(generationSong).mockImplementationOnce(() => wait.promise);
        const review = flow.review(); await Promise.resolve(); flow.edit({ parameters: { ...parameters, prompt: 'new' } });
        wait.resolve(quote); await review; expect(flow.attempts.snapshot()).toBeNull();
    });
    test.each([undefined, null, 76])('same-key replay after unknown acceptance and expiry shows only balance %p', async balance_after => {
        request.mockResolvedValueOnce(generationSong).mockResolvedValueOnce({ ...quote, expires_at: new Date(Date.now() + 1000).toISOString() });
        await flow.review(); const pending = flow.attempts.snapshot()!;
        request.mockRejectedValueOnce(new ApiError(503, 'pair_acceptance_unknown')); await flow.confirm();
        expect(flow.attempts.snapshot()).toMatchObject({ phase: 'AMBIGUOUS', key: pending.key });
        const count = request.mock.calls.length; flow.edit({ parameters: { prompt: 'new' } }); await flow.review();
        expect(request).toHaveBeenCalledTimes(count); expect(flow.snapshot().input.parameters).toEqual(parameters);
        jest.advanceTimersByTime(2000); request.mockResolvedValueOnce({ ...generationReplay, balance_after }); await flow.confirm();
        expect(posts().map(([, init]) => JSON.parse(init.body))).toEqual(Array(2).fill({ quote_id: quote.quote_id, idempotency_key: pending.key }));
        expect(flow.snapshot().balance).toBe(balance_after ?? null);
    });
    test('ambiguous attempts replay after a balance drop', async () => {
        const attempts = createActionAttempts(api, generationAction(kind, SONG_ID), () => 'fixed'); attempts.prepare(quote, input);
        request.mockRejectedValueOnce(new ApiError(503, 'pair_acceptance_unknown'));
        await expect(attempts.confirm(quote)).rejects.toMatchObject({ code: 'pair_acceptance_unknown' });
        const key = attempts.snapshot()!.key; request.mockResolvedValueOnce(generationReplay);
        await expect(attempts.confirm({ ...quote, affordable: false, balance: 0, expires_at: '2000-01-01T00:00:00Z' })).resolves.toEqual(generationReplay);
        expect(posts().map(([, init]) => JSON.parse(init.body).idempotency_key)).toEqual([key, key]);
    });
    test.each([{ affordable: false }, { expires_at: '2000-01-01T00:00:00Z' }])('unsubmitted %p never spends', async patch => {
        request.mockResolvedValueOnce(generationSong).mockResolvedValueOnce({ ...quote, ...patch });
        await flow.review(); await flow.confirm(); expect(posts()).toHaveLength(0); expect(flow.attempts.snapshot()?.phase).toBe('UNSUBMITTED');
    });
    test('double confirm has one POST and uses the initial response balance', async () => {
        await flow.review(); const wait = deferred<typeof generationStart>(); request.mockImplementationOnce(() => wait.promise);
        const first = flow.confirm(), second = flow.confirm(); await Promise.resolve(); await Promise.resolve();
        expect(posts()).toHaveLength(1); wait.resolve({ ...generationStart, balance_after: 76 }); await Promise.all([first, second]);
        expect(flow.snapshot().balance).toBe(76); expect(flow.attempts.snapshot()).toBeNull();
    });
    test.each([...GENERATION_ACTION_REJECTIONS])('%s definitively clears the attempt', async code => {
        await flow.review(); request.mockRejectedValueOnce(new ApiError(code === 'prompt_not_allowed' ? 422 : 409, code)); await flow.confirm();
        expect(flow.attempts.snapshot()).toBeNull(); expect(flow.snapshot()).toMatchObject({ result: null, balance: null, poll: null });
    });
    test.each(['source_duration_unavailable', 'source_duration_invalid'])('%s cannot prepare or spend', async code => {
        request.mockResolvedValueOnce(generationSong).mockRejectedValueOnce(new ApiError(400, code));
        await flow.review(); await flow.confirm(); expect(flow.attempts.snapshot()).toBeNull(); expect(posts()).toHaveLength(0);
    });
    test.each(['queued', 'running', 'succeeded', 'partial', 'failed', 'refunded'])('poll handles %s', async state => {
        await flow.review(); await flow.confirm(); request.mockResolvedValue({ ...generationView, state }); await jest.advanceTimersByTimeAsync(1500);
        expect(flow.snapshot().poll).toMatchObject({ state: ['succeeded', 'partial', 'failed', 'refunded'].includes(state) ? 'done' : 'polling', value: { state } });
    });
    test('terminal-with-ready notifies songs once; transient errors never imply failure', async () => {
        const changed = jest.fn(), stop = subscribeSongChanges(changed);
        await flow.review(); await flow.confirm(); request.mockRejectedValue(new ApiError(503, 'temporarily_unavailable')); await flow.refresh();
        expect(flow.snapshot().poll).toMatchObject({ state: 'polling', value: null });
        request.mockResolvedValue({ ...readyView, state: 'partial' }); await flow.refresh(); await flow.refresh();
        expect(changed).toHaveBeenCalledTimes(1); stop();
    });
    test('accepted generation survives screen disposal in P2 queue; account change stops all polling', async () => {
        await flow.review(); await flow.confirm(); const tracker = getMusicCreateSession(api).tracker;
        expect(tracker.snapshot().entries[0].id).toBe(generationStart.generation_id);
        flow.dispose(); expect(tracker.snapshot().entries).toHaveLength(1);
        await bindCacheUser('other-user'); const count = request.mock.calls.length; await jest.advanceTimersByTimeAsync(10000);
        expect(request).toHaveBeenCalledTimes(count); expect(tracker.snapshot().entries).toHaveLength(0);
    });
    test('a failing tracker adoption never blocks polling or reports a false failure after acceptance', async () => {
        const add = jest.spyOn(getMusicCreateSession(api).tracker, 'add').mockImplementation(() => { throw new Error('tracker down'); });
        await flow.review(); await flow.confirm();
        expect(flow.snapshot().error).toBeNull(); expect(flow.snapshot().result).toMatchObject({ generation_id: generationStart.generation_id });
        expect(flow.snapshot().poll).not.toBeNull(); add.mockRestore();
    });
    test.each(['quote', 'confirm', 'status'])('call-time off at %s hides controls', async step => {
        const off = new ApiError(404, `music_${kind}_unavailable`);
        if (step === 'quote') request.mockResolvedValueOnce(generationSong).mockRejectedValueOnce(off);
        await flow.review(); if (step === 'confirm') request.mockRejectedValueOnce(off);
        if (step !== 'quote') await flow.confirm();
        if (step === 'status') { request.mockRejectedValueOnce(off); await flow.refresh(); }
        expect(flow.snapshot().status).toBe('off'); expect(flow.attempts.snapshot()).toBeNull();
    });
});
