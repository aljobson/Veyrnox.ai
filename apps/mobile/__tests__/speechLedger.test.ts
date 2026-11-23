import { ApiError, type ApiClient } from '../src/lib/api';
import { createSpeechSubmit } from '../src/lib/speech/speechLedger';
import { buildAuditionRequest } from '../src/lib/speech/audition';
import { buildSpeechRequest } from '../src/lib/speech/studio';
import { DEFAULT_TTS_SETTINGS, TTS_VOICES } from '../src/lib/speech/shared';
import { rememberSubmitted, submittedRequests } from '../src/lib/submittedRequests';
import type { CatalogModel } from '../src/lib/media';

let mockOwner: string | undefined = 'a';
const mockSubscribers = new Set<() => void>();
const mockStorage = new Map<string, string>();
let mockWriteFails = false, mockReadFails = false;
jest.mock('../src/lib/appCache', () => ({
    getCacheUser: () => mockOwner,
    subscribeCacheUser: (fn: () => void) => { mockSubscribers.add(fn); return () => mockSubscribers.delete(fn); },
    appStorage: {
        get: async (key: string) => { if (mockReadFails) throw new Error('read failed'); return mockStorage.get(key) ?? null; },
        set: async (key: string, value: string) => { if (mockWriteFails) throw new Error('disk full'); mockStorage.set(key, value); },
        remove: async (key: string) => { mockStorage.delete(key); }, keys: async () => [...mockStorage.keys()],
    },
}));
jest.mock('../src/lib/submittedRequests', () => {
    const actual = jest.requireActual('../src/lib/submittedRequests');
    return { ...actual, rememberSubmitted: jest.fn(actual.rememberSubmitted) };
});
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => {}, hasAgreed: async () => true } }));
jest.mock('../src/lib/celebrate', () => ({ noteLocalSubmission: jest.fn() }));
jest.mock('../src/lib/generationProgress', () => ({ noteJobStarted: jest.fn() }));
jest.mock('../src/lib/analytics/generations', () => ({ noteGenerationSubmitted: jest.fn() }));
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `ledger-${++n}` }; });
const model: CatalogModel = { id: 'minimax-speech-2.6-hd', name: 'Speech', modality: 'text-to-speech', credits: 6, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
const voices = TTS_VOICES.slice(0, 3).map(v => v.id);
const board = (ids = voices.slice(0, 2), prompt = 'Hello') => buildAuditionRequest(prompt, DEFAULT_TTS_SETTINGS, ids, model);
const single = (voice = voices[0], prompt = 'Hello') => buildSpeechRequest(prompt, { ...DEFAULT_TTS_SETTINGS, voice }, model);
const post = jest.fn();
const api = { request: post } as unknown as ApiClient;
const bodies = () => post.mock.calls.map(([, init]) => JSON.parse(init.body));
const changeOwner = (owner?: string) => { mockOwner = owner; mockSubscribers.forEach(fn => fn()); };
const lost = () => new ApiError(0, 'network');
function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
beforeEach(() => {
    changeOwner('a'); mockStorage.clear(); mockWriteFails = false; mockReadFails = false;
    jest.mocked(rememberSubmitted).mockClear();
    let id = 0; post.mockReset().mockImplementation(async () => ({ job_id: `job-${++id}` }));
});

test('reordered board resumes all accepted indices before POST and only reconciles the lost voice', async () => {
    const submit = createSpeechSubmit(), request = board();
    post.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(lost());
    await expect(submit.run(api, request, 2)).rejects.toMatchObject({ code: 'network' });
    const reordered = board([voices[1], voices[0]]), started = jest.fn(), jobs = jest.fn();
    post.mockImplementationOnce(async () => {
        expect(started).toHaveBeenLastCalledWith(1);
        expect(jobs).toHaveBeenCalledWith('one', 1);
        return { job_id: 'two' };
    });
    expect(submit.snapshot(reordered, 2, 6, 0)).toEqual({ ceilings: [6, null], total: 6, payable: 0 });
    await submit.run(api, reordered, 2, started, jobs);
    expect(bodies().map(b => b.inputs.tts_voice)).toEqual([voices[0], voices[1], voices[1]]);
    expect(bodies()[2].idempotency_key).toBe(bodies()[1].idempotency_key);
    expect(jobs.mock.calls).toEqual([['one', 1], ['two', 0]]);
    expect(jest.mocked(rememberSubmitted).mock.calls.map(([id]) => id)).toEqual(['one', 'two']);
});

test('overlapping boards reuse the lost key, create only the new voice and leave outside accepted items', async () => {
    const submit = createSpeechSubmit();
    post.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(lost());
    await expect(submit.run(api, board(), 2)).rejects.toThrow();
    await submit.run(api, board([voices[1], voices[2]]), 2);
    expect(bodies().map(b => b.inputs.tts_voice)).toEqual([voices[0], voices[1], voices[1], voices[2]]);
    expect(bodies()[2].idempotency_key).toBe(bodies()[1].idempotency_key);
    expect(bodies()[3].idempotency_key).not.toBe(bodies()[1].idempotency_key);
    expect(submit.snapshot(single(), 1, 6, 0).ceilings).toEqual([null]);
    const jobs = jest.fn(); await submit.run(api, single(), 1, undefined, jobs);
    expect(post).toHaveBeenCalledTimes(4); expect(jobs).toHaveBeenCalledWith('one', 0);
});

test('board and single fingerprints match all controls and trimmed prompt, excluding confirmed credits', async () => {
    const submit = createSpeechSubmit(), settings = { ...DEFAULT_TTS_SETTINGS, language: 'English', emotion: 'happy', speed: 1.2, volume: 2, pitch: 3 };
    const request = buildAuditionRequest(' Hello ', settings, voices.slice(0, 2), model);
    post.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(lost());
    await expect(submit.run(api, request, 2)).rejects.toThrow();
    const alone = { ...buildSpeechRequest('Hello ', { ...settings, voice: voices[1] }, model), confirmedCredits: 10 };
    await submit.run(api, alone);
    expect(bodies()[2].idempotency_key).toBe(bodies()[1].idempotency_key);
    const accepted = buildSpeechRequest('Hello', { ...settings, voice: voices[0] }, model);
    await submit.run(api, accepted);
    expect(post).toHaveBeenCalledTimes(3);
});

test('A unknown → B complete → A retains A’s key across new submit instances', async () => {
    post.mockRejectedValueOnce(lost());
    await expect(createSpeechSubmit().run(api, single())).rejects.toThrow();
    await createSpeechSubmit().run(api, single(voices[0], 'Other'));
    await createSpeechSubmit().run(api, single());
    expect(bodies()[2].idempotency_key).toBe(bodies()[0].idempotency_key);
    expect(bodies()[1].idempotency_key).not.toBe(bodies()[0].idempotency_key);
});

test.each([1, 2])('a complete %s-item run retires every included entry for another take', async count => {
    const submit = createSpeechSubmit(), request = count === 1 ? single() : board();
    post.mockRejectedValueOnce(lost());
    await expect(submit.run(api, request, count)).rejects.toThrow();
    await submit.run(api, request, count);
    await submit.run(api, request, count);
    const keys = bodies().map(b => b.idempotency_key);
    expect(keys[1]).toBe(keys[0]);
    for (const key of keys.slice(count + 1)) expect(keys.slice(0, count + 1)).not.toContain(key);
});

test.each([
    ['price_changed', false, true], ['insufficient_balance', true, true], ['insufficient_credits', true, true],
    ['subscription_required', true, true], ['rate_limited', true, true],
    ['provider_moderation', false, false], ['provider_input_rejected', false, false], ['provider_submit_failed', false, false],
] as const)('unknown then %s reports state %s and keeps key %s', async (code, unknown, kept) => {
    const submit = createSpeechSubmit(), failure = jest.fn(), error = new ApiError(400, code);
    post.mockRejectedValueOnce(lost()).mockRejectedValueOnce(error);
    await expect(submit.run(api, single())).rejects.toThrow();
    await expect(submit.run(api, single(), 1, undefined, undefined, undefined, failure)).rejects.toBe(error);
    expect(failure).toHaveBeenCalledWith({ index: 0, unknown });
    expect(submit.hasUnknownOutcome(single(), 1)).toBe(unknown);
    await submit.run(api, single());
    expect(bodies()[2].idempotency_key === bodies()[0].idempotency_key).toBe(kept);
});

test.each(['price_changed', 'insufficient_balance', 'insufficient_credits', 'subscription_required', 'provider_input_rejected'])('open %s keeps only proven no-job keys', async code => {
    const submit = createSpeechSubmit(); post.mockRejectedValueOnce(new ApiError(400, code));
    await expect(submit.run(api, single())).rejects.toThrow();
    expect(submit.hasUnknownOutcome(single(), 1)).toBe(false);
    await submit.run(api, single());
    expect(bodies()[1].idempotency_key === bodies()[0].idempotency_key).toBe(['price_changed', 'insufficient_balance', 'insufficient_credits'].includes(code));
});

test('a second instance is locked before lookup/POST and a lost first reply retains entries', async () => {
    const response = deferred<{ job_id: string }>(), entered = deferred<void>();
    post.mockResolvedValueOnce({ job_id: 'one' }).mockImplementationOnce(() => { entered.resolve(); return response.promise; });
    const first = createSpeechSubmit().run(api, board(), 2); await entered.promise;
    await expect(createSpeechSubmit().run(api, board([voices[1], voices[0]]), 2)).rejects.toMatchObject({ status: 409, code: 'submission_in_progress' });
    expect(post).toHaveBeenCalledTimes(2);
    response.reject(lost()); await expect(first).rejects.toThrow();
    await createSpeechSubmit().run(api, board([voices[1], voices[0]]), 2);
    expect(post).toHaveBeenCalledTimes(3);
    expect(bodies()[2].idempotency_key).toBe(bodies()[1].idempotency_key);
});

test.each(['success', 'failure'])('stale %s cannot write history or unlock a newer run after an A→B→A change', async outcome => {
    const old = deferred<{ job_id: string }>(), fresh = deferred<{ job_id: string }>();
    const enteredOld = deferred<void>(), enteredFresh = deferred<void>();
    post.mockImplementationOnce(() => { enteredOld.resolve(); return old.promise; })
        .mockImplementationOnce(() => { enteredFresh.resolve(); return fresh.promise; });
    const first = createSpeechSubmit().run(api, single()); await enteredOld.promise;
    changeOwner('b'); changeOwner('a');
    const next = createSpeechSubmit().run(api, single()); await enteredFresh.promise;
    if (outcome === 'success') old.resolve({ job_id: 'stale' }); else old.reject(lost());
    await expect(first).rejects.toMatchObject({ code: 'submission_reset' });
    expect(rememberSubmitted).not.toHaveBeenCalled();
    await expect(createSpeechSubmit().run(api, single())).rejects.toMatchObject({ code: 'submission_in_progress' });
    fresh.resolve({ job_id: 'fresh' }); await next;
    expect(jest.mocked(rememberSubmitted).mock.calls.map(([id]) => id)).toEqual(['fresh']);
    expect(bodies()[1].idempotency_key).not.toBe(bodies()[0].idempotency_key);
});

test('switching accounts, signing out, and returning never recover a previous key', async () => {
    post.mockRejectedValue(lost());
    for (const owner of ['a', 'b', undefined, 'a']) {
        changeOwner(owner); await expect(createSpeechSubmit().run(api, single())).rejects.toThrow();
    }
    expect(new Set(bodies().map(b => b.idempotency_key)).size).toBe(4);
});

test.each(['write', 'read'])('real history store %s failure leaves recording retryable; resume stores once', async failure => {
    mockWriteFails = failure === 'write'; mockReadFails = failure === 'read';
    post.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(lost());
    await expect(createSpeechSubmit().run(api, board(), 2)).rejects.toThrow();
    expect(mockStorage.size).toBe(0);
    mockWriteFails = false; mockReadFails = false;
    post.mockRejectedValueOnce(lost());
    await expect(createSpeechSubmit().run(api, board(), 2)).rejects.toThrow();
    expect((await submittedRequests.list()).map(item => item.id)).toEqual(['one']);
    expect(jest.mocked(rememberSubmitted).mock.calls.map(([id]) => id)).toEqual(['one', 'one']);
    await createSpeechSubmit().run(api, board(), 2);
    expect(jest.mocked(rememberSubmitted).mock.calls.filter(([id]) => id === 'one')).toHaveLength(2);
});

test.each([
    { voice: voices[1] }, { language: 'English' }, { emotion: 'happy' }, { speed: 1.2 }, { volume: 2 }, { pitch: 3 },
])('each speech control changes item identity: %p', async change => {
    const submit = createSpeechSubmit(); post.mockRejectedValueOnce(lost());
    await expect(submit.run(api, single())).rejects.toThrow();
    await submit.run(api, buildSpeechRequest('Hello', { ...DEFAULT_TTS_SETTINGS, ...change }, model));
    expect(bodies()[1].idempotency_key).not.toBe(bodies()[0].idempotency_key);
    expect(submit.hasUnknownOutcome(single(), 1)).toBe(true);
});

test('a failed confirmation read retries recording even when the original write resolved', async () => {
    const list = jest.spyOn(submittedRequests, 'list').mockRejectedValueOnce(new Error('read failed'));
    post.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(lost());
    await expect(createSpeechSubmit().run(api, board(), 2)).rejects.toThrow();
    expect(mockStorage.size).toBe(1);
    await createSpeechSubmit().run(api, board(), 2);
    expect(jest.mocked(rememberSubmitted).mock.calls.filter(([id]) => id === 'one')).toHaveLength(2);
    expect((await submittedRequests.list()).filter(item => item.id === 'one')).toHaveLength(1);
    list.mockRestore();
});

test('a refunded member remains unresolved and never removes its accepted batch peer', async () => {
    const submit = createSpeechSubmit();
    post.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(lost());
    await expect(submit.run(api, board(), 2)).rejects.toThrow();
    post.mockRejectedValueOnce(new ApiError(400, 'provider_input_rejected'));
    await expect(submit.run(api, single(voices[1]))).rejects.toMatchObject({ code: 'provider_input_rejected' });
    expect(submit.accepted(board(), 2)).toEqual([{ index: 0, jobId: 'one' }]);
    expect(submit.hasUnresolvedEntries()).toBe(true);
    await submit.run(api, board(), 2);
    expect(post).toHaveBeenCalledTimes(4);
    expect(bodies()[3].inputs.tts_voice).toBe(voices[1]);
    expect(bodies()[3].idempotency_key).not.toBe(bodies()[1].idempotency_key);
});

test('refusal preserves the accepted voice in both unfinished batches', async () => {
    const submit = createSpeechSubmit();
    post.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(lost());
    await expect(submit.run(api, board(), 2)).rejects.toThrow();
    post.mockRejectedValueOnce(lost());
    await expect(submit.run(api, board([voices[0], voices[2]]), 2)).rejects.toThrow();
    post.mockRejectedValueOnce(new ApiError(400, 'provider_submit_failed'));
    await expect(submit.run(api, single(voices[1]))).rejects.toThrow();
    await submit.run(api, single());
    expect(post).toHaveBeenCalledTimes(4);
    expect(submit.accepted(board([voices[0], voices[2]]), 2)).toEqual([{ index: 0, jobId: 'one' }]);
    await submit.run(api, board([voices[2], voices[0]]), 2);
    expect(post).toHaveBeenCalledTimes(5);
    expect(bodies()[4].idempotency_key).toBe(bodies()[2].idempotency_key);
    await submit.run(api, single());
    expect(post).toHaveBeenCalledTimes(6);
    expect(bodies()[5].idempotency_key).not.toBe(bodies()[0].idempotency_key);
});

test('a stale quote is refused without entry changes even when only payable changed', async () => {
    const submit = createSpeechSubmit(), request = single(), quote = submit.snapshot(request, 1, 6, 0);
    post.mockRejectedValueOnce(lost());
    await expect(submit.run(api, request)).rejects.toThrow();
    const before = submit.snapshot(request, 1, 6, 0);
    await expect(submit.run(api, request, 1, undefined, undefined, quote)).rejects.toMatchObject({ code: 'submission_reset' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(submit.snapshot(request, 1, 6, 0)).toEqual(before);
    await submit.run(api, request, 1, undefined, undefined, before);
    expect(bodies()[1].idempotency_key).toBe(bodies()[0].idempotency_key);
    expect(bodies()[1].max_charge_credits).toBe(6);
});

test('a retired accepted quote never becomes a zero-ceiling POST', async () => {
    const submit = createSpeechSubmit();
    post.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(lost());
    await expect(submit.run(api, board(), 2)).rejects.toThrow();
    const stale = submit.snapshot(board(), 2, 6, 0);
    await submit.run(api, board(), 2);
    await expect(submit.run(api, board(), 2, undefined, undefined, stale)).rejects.toMatchObject({ code: 'submission_reset' });
    expect(post).toHaveBeenCalledTimes(3);
    const fresh = submit.snapshot(board(), 2, 6, 0);
    expect(fresh).toEqual({ ceilings: [6, 6], total: 12, payable: 12 });
    await submit.run(api, board(), 2, undefined, undefined, fresh);
    expect(bodies().slice(3).map(body => body.max_charge_credits)).toEqual([6, 6]);
});

test('ledger observers see detached changes and owner resets, but no stale-run changes', async () => {
    const submit = createSpeechSubmit(), notify = jest.fn(), before = submit.version();
    const stop = submit.subscribe(notify);
    const response = deferred<{ job_id: string }>(), entered = deferred<void>();
    post.mockImplementationOnce(() => { entered.resolve(); return response.promise; });
    const run = createSpeechSubmit().run(api, single()); await entered.promise;
    changeOwner('b');
    expect(notify).toHaveBeenCalled(); expect(submit.version()).toBeGreaterThan(before);
    const afterReset = submit.version(); notify.mockClear();
    response.resolve({ job_id: 'stale' }); await expect(run).rejects.toMatchObject({ code: 'submission_reset' });
    expect(submit.version()).toBe(afterReset); expect(notify).not.toHaveBeenCalled();
    post.mockRejectedValueOnce(lost()); await expect(createSpeechSubmit().run(api, single())).rejects.toThrow();
    expect(submit.version()).toBeGreaterThan(afterReset); expect(notify).toHaveBeenCalled();
    stop(); notify.mockClear(); await createSpeechSubmit().run(api, single()); expect(notify).not.toHaveBeenCalled();
});


test.each([1, 2])('detached %s-voice completion resumes free before allowing another take', async count => {
    const submit = createSpeechSubmit(), request = count === 1 ? single() : board(), jobs = jest.fn();
    await submit.run(api, request, count, undefined, undefined, undefined, undefined, () => false);
    const completedKeys = bodies().map(body => body.idempotency_key);
    expect(submit.snapshot(request, count, 6, 0)).toEqual({ ceilings: Array(count).fill(null), total: 0, payable: 0 });
    await submit.run(api, request, count, undefined, jobs);
    expect(post).toHaveBeenCalledTimes(count);
    expect(jobs).toHaveBeenCalledTimes(count);
    await submit.run(api, request, count);
    expect(post).toHaveBeenCalledTimes(count * 2);
    for (const body of bodies().slice(count)) expect(completedKeys).not.toContain(body.idempotency_key);
});

test('detached completion preserves an original delivered voice even after its later take', async () => {
    const submit = createSpeechSubmit();
    post.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(lost());
    await expect(submit.run(api, board(), 2)).rejects.toThrow();
    await submit.run(api, single());
    post.mockResolvedValueOnce({ job_id: 'new-one' }); await submit.run(api, single());
    post.mockResolvedValueOnce({ job_id: 'two' });
    await submit.run(api, board(), 2, undefined, undefined, undefined, undefined, () => false);
    expect(post).toHaveBeenCalledTimes(4);
    expect(submit.accepted(board(), 2)).toEqual([{ index: 0, jobId: 'one' }, { index: 1, jobId: 'two' }]);
    const resumed = jest.fn(); await submit.run(api, board(), 2, undefined, resumed);
    expect(post).toHaveBeenCalledTimes(4);
    expect(resumed.mock.calls).toEqual([['one', 0], ['two', 1]]);
});

test('many later entries never drop a delivered accepted voice from its unfinished board', async () => {
    const submit = createSpeechSubmit();
    post.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(new ApiError(402, 'insufficient_balance'));
    await expect(submit.run(api, board(), 2)).rejects.toThrow();
    await submit.run(api, single());
    expect(post).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 63; i++) {
        post.mockRejectedValueOnce(lost());
        await expect(submit.run(api, single(voices[0], `unknown-${i}`))).rejects.toThrow();
    }
    expect(submit.accepted(board(), 2)).toEqual([{ index: 0, jobId: 'one' }]);
    post.mockResolvedValueOnce({ job_id: 'two' });
    await submit.run(api, board(), 2);
    expect(post).toHaveBeenCalledTimes(66);
    expect(bodies().at(-1).inputs.tts_voice).toBe(voices[1]);
});

test('a nearly full ledger keeps accepted voices of the run in progress', async () => {
    const submit = createSpeechSubmit();
    for (let i = 0; i < 63; i++) {
        post.mockRejectedValueOnce(lost());
        await expect(submit.run(api, single(voices[0], `unknown-${i}`))).rejects.toThrow();
    }
    post.mockResolvedValueOnce({ job_id: 'one' }).mockResolvedValueOnce({ job_id: 'two' }).mockRejectedValueOnce(lost());
    await expect(submit.run(api, board(voices), 3)).rejects.toThrow();
    post.mockResolvedValueOnce({ job_id: 'three' });
    await submit.run(api, board(voices), 3);
    expect(post).toHaveBeenCalledTimes(67);
    expect(bodies()[66].inputs.tts_voice).toBe(voices[2]);
    expect(bodies()[66].idempotency_key).toBe(bodies()[65].idempotency_key);
});

test('every unknown key survives a long session', async () => {
    const submit = createSpeechSubmit();
    for (let i = 0; i < 100; i++) {
        post.mockRejectedValueOnce(lost());
        await expect(submit.run(api, single(voices[0], `unknown-${i}`))).rejects.toThrow();
    }
    post.mockResolvedValueOnce({ job_id: 'first' });
    await submit.run(api, single(voices[0], 'unknown-0'));
    expect(bodies()[100].idempotency_key).toBe(bodies()[0].idempotency_key);
});

test('a reopened accepted voice can make a new take while its unfinished board keeps the old job', async () => {
    const submit = createSpeechSubmit();
    post.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(lost());
    await expect(submit.run(api, board(), 2)).rejects.toThrow();
    expect(submit.snapshot(single(), 1, 6, 0).ceilings).toEqual([null]);
    submit.markDelivered('one');
    expect(submit.snapshot(single(), 1, 6, 0).ceilings).toEqual([6]);
    post.mockResolvedValueOnce({ job_id: 'new-take' });
    await submit.run(api, single());
    expect(bodies()[2].idempotency_key).not.toBe(bodies()[0].idempotency_key);
    expect(submit.accepted(board(), 2)).toEqual([{ index: 0, jobId: 'one' }]);
    post.mockResolvedValueOnce({ job_id: 'two' });
    await submit.run(api, board(), 2);
    expect(post).toHaveBeenCalledTimes(4);
    expect(bodies()[3].idempotency_key).toBe(bodies()[1].idempotency_key);
});
test('marking an unknown job id delivered changes nothing', async () => {
    const submit = createSpeechSubmit();
    post.mockRejectedValueOnce(lost());
    await expect(submit.run(api, single())).rejects.toThrow();
    submit.markDelivered('not-this-job');
    expect(submit.hasUnknownOutcome(single(), 1)).toBe(true);
});

const untilPosts = async (count: number) => { for (let i = 0; i < 50 && post.mock.calls.length < count; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
test('Make another during an in-flight board keeps the accepted voice after a lost reply', async () => {
    const submit = createSpeechSubmit();
    let fail!: (error: unknown) => void;
    post.mockResolvedValueOnce({ job_id: 'one' }).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const run = submit.run(api, board(), 2);
    await untilPosts(2);
    submit.markDelivered('one');
    fail(lost());
    await expect(run).rejects.toThrow();
    expect(submit.accepted(board(), 2)).toEqual([{ index: 0, jobId: 'one' }]);
    expect(submit.snapshot(single(), 1, 6, 0).ceilings).toEqual([6]);
    post.mockResolvedValueOnce({ job_id: 'two' });
    await submit.run(api, board(), 2);
    expect(post).toHaveBeenCalledTimes(3);
    expect(bodies()[2].idempotency_key).toBe(bodies()[1].idempotency_key);
});
test('Make another during a detached board keeps every job when it finishes', async () => {
    const submit = createSpeechSubmit();
    let finish!: (value: unknown) => void;
    post.mockResolvedValueOnce({ job_id: 'one' }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const run = submit.run(api, board(), 2, undefined, undefined, undefined, undefined, () => false);
    await untilPosts(2);
    submit.markDelivered('one');
    finish({ job_id: 'two' });
    await run;
    expect(submit.accepted(board(), 2)).toEqual([{ index: 0, jobId: 'one' }, { index: 1, jobId: 'two' }]);
    await submit.run(api, board(), 2);
    expect(post).toHaveBeenCalledTimes(2);
});

