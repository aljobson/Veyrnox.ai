import { ApiError, type ApiClient } from '../src/lib/api';
import { createMusicCreateFlow } from '../src/lib/music/createFlow';
import { createGenerationTracker } from '../src/lib/music/queue';
import { createGenerationAttempts } from '../src/lib/music/attempts';
import { custom, draft, entitlements, generation, input, quote, view } from './fixtures/musicCreate';
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
let request: jest.Mock, flow: ReturnType<typeof createMusicCreateFlow>;
function makeFlow() {
    const api = { request } as unknown as ApiClient;
    return createMusicCreateFlow(api, createGenerationTracker({ api, subscribeAppState: () => () => {}, setTimer: () => () => {} }), jest.fn(() => 'key-12345678'));
}
beforeEach(async () => {
    request = jest.fn(async (path, init) => {
        if (path.endsWith('/entitlements')) return entitlements;
        if (path.endsWith('/drafts/custom')) return { draft: init ? { ...draft, ...JSON.parse(init.body), revision: JSON.parse(init.body).revision + 1 } : draft };
        if (path.endsWith('/generation-quotes')) return JSON.parse(init.body).mode === 'custom' ? { ...quote, mode: 'custom', model_id: custom.model_id } : quote;
        if (path.endsWith('/generations')) return generation;
        return view;
    });
    flow = makeFlow(); await flow.load(); flow.edit(input);
});
afterEach(() => flow.dispose());
const customFlow = async () => { flow.edit({ mode: 'custom' }); await flow.loadDraft(); flow.edit(custom, true); };
test('custom saves then quotes with returned revision and immutable input', async () => {
    await customFlow(); await flow.review();
    const calls = request.mock.calls.filter(([path]) => path.endsWith('/drafts/custom') || path.endsWith('/generation-quotes'));
    expect(calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'PUT', 'POST']);
    expect(JSON.parse(calls[2][1].body)).toEqual({ mode: 'custom', draft_revision: 1, instrumental: false, rights_confirmed: true, duration_seconds: 30 });
    await flow.confirm(); expect(flow.tracker.snapshot().entries[0].input.lyrics).toBe(custom.lyrics);
    flow.edit({ lyrics: 'shared draft changed' }); expect(flow.tracker.snapshot().entries[0].input.lyrics).toBe(custom.lyrics);
});
test('editing during a save preserves text and uses the saved revision on the next review', async () => {
    await customFlow(); const wait = deferred(); request.mockImplementationOnce(() => wait.promise);
    const old = flow.review();
    const edits = { lyrics: 'New lyrics while saving', title: 'New title', styles: 'New styles' };
    flow.edit(edits);
    wait.resolve({ draft: { ...draft, ...custom, revision: 1 } }); await old;
    expect(flow.snapshot().draft?.revision).toBe(1);
    expect(flow.snapshot().input).toMatchObject(edits);
    expect(flow.attempts.snapshot()).toBeNull();
    expect(request.mock.calls.filter(([p]) => p.endsWith('/generation-quotes'))).toHaveLength(0);
    request.mockImplementationOnce(async (_path, init) => {
        const saved = JSON.parse(init.body);
        if (saved.revision !== 1) throw new ApiError(409, 'revision_conflict', { draft: { ...draft, revision: 1 } });
        return { draft: { ...draft, ...saved, revision: 2 } };
    });
    await flow.review();
    const puts = request.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(puts[1][1].body)).toMatchObject({ revision: 1, ...edits });
    const quotes = request.mock.calls.filter(([p]) => p.endsWith('/generation-quotes'));
    expect(quotes).toHaveLength(1);
    expect(JSON.parse(quotes[0][1].body).draft_revision).toBe(2);
    expect(flow.snapshot().error).toBeNull();
    expect(flow.attempts.snapshot()?.input).toMatchObject(edits);
});
test.each(['edit', 'mode', 'newer', 'account'])('delayed custom save discarded after %s', async action => {
    await customFlow(); const wait = deferred(); request.mockImplementationOnce(() => wait.promise);
    const old = flow.review();
    if (action === 'edit') flow.edit({ lyrics: 'changed' });
    if (action === 'mode') flow.edit({ mode: 'simple' });
    if (action === 'account') flow.dispose();
    if (action === 'newer') await flow.review();
    const before = request.mock.calls.filter(([p]) => p.endsWith('/generation-quotes')).length;
    wait.resolve({ draft: { ...draft, ...custom, revision: 1 } }); await old;
    expect(request.mock.calls.filter(([p]) => p.endsWith('/generation-quotes'))).toHaveLength(before);
    if (action !== 'newer') expect(flow.attempts.snapshot()).toBeNull();
});
test.each(['edit', 'mode', 'newer', 'account'])('delayed quote discarded after %s', async action => {
    const wait = deferred(); request.mockImplementationOnce(() => wait.promise); const old = flow.review();
    if (action === 'edit') flow.edit({ prompt: 'changed' });
    if (action === 'mode') flow.edit({ mode: 'custom' });
    if (action === 'account') flow.dispose();
    if (action === 'newer') { request.mockResolvedValueOnce({ ...quote, quote_id: 'new' }); await flow.review(); }
    wait.resolve(quote); await old;
    expect(flow.attempts.snapshot()?.quote.quote_id ?? null).toBe(action === 'newer' ? 'new' : null);
});
test('server conflict is explicit; keep mine saves using server revision', async () => {
    await customFlow(); const server = { ...draft, revision: 7, lyrics: 'server words' };
    request.mockRejectedValueOnce(new ApiError(409, 'revision_conflict', { draft: server }));
    await flow.review(); expect(flow.snapshot().conflict).toEqual(server); expect(flow.attempts.snapshot()).toBeNull();
    flow.keepMine(); await flow.review();
    const puts = request.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(puts[1][1].body)).toMatchObject({ revision: 7, lyrics: custom.lyrics });
});
test('use server version replaces editor and requires a new review', async () => {
    await customFlow(); request.mockRejectedValueOnce(new ApiError(409, 'revision_conflict', { draft: { ...draft, revision: 8, lyrics: 'server' } }));
    await flow.review(); flow.useServer(); expect(flow.snapshot().input.lyrics).toBe('server'); expect(flow.attempts.snapshot()).toBeNull();
});
test('locked model blocks both real flow entry points without requests', async () => {
    flow.dispose(); request.mockResolvedValueOnce({ ...entitlements, models: entitlements.models.map(m => ({ ...m, available: false })) });
    flow = makeFlow(); await flow.load(); flow.edit({ ...input, model_id: custom.model_id }); request.mockClear();
    await flow.review(); await flow.confirm(); expect(request).not.toHaveBeenCalled();
});
test('off is a circuit breaker for review, confirm, draft and probe', async () => {
    request.mockRejectedValueOnce(new ApiError(404, 'music_unavailable')); await flow.review();
    expect(flow.snapshot().status).toBe('off'); request.mockClear();
    await flow.load(); await flow.review(); await flow.confirm(); await flow.loadDraft(); expect(request).not.toHaveBeenCalled();
});
test('tracker off propagates to flow', () => { flow.tracker.off(); expect(flow.snapshot().status).toBe('off'); });
test('concurrency maps local limit and server rejection to the same reason', async () => {
    await flow.review(); request.mockRejectedValueOnce(new ApiError(409, 'concurrency_limit')); await flow.confirm();
    expect(flow.snapshot().error).toBe('no_slot'); expect(flow.attempts.snapshot()?.phase).toBe('UNSUBMITTED');
    for (let i = 0; i < 4; i++) flow.tracker.add({ ...generation, generation_id: String(i) }, input);
    request.mockClear(); await flow.confirm(); expect(request).not.toHaveBeenCalled(); expect(flow.snapshot().error).toBe('no_slot');
});
test('ambiguous noncommit recovery after expiry clears attempt on definitive rejection', async () => {
    jest.useFakeTimers(); const soon = { ...quote, expires_at: new Date(Date.now() + 1000).toISOString() };
    request.mockResolvedValueOnce(soon); await flow.review(); request.mockRejectedValueOnce(new ApiError(0, 'network')); await flow.confirm();
    const key = flow.attempts.snapshot()!.key; jest.advanceTimersByTime(2000);
    request.mockRejectedValueOnce(new ApiError(409, 'quote_expired')); await flow.confirm();
    expect(flow.attempts.snapshot()).toBeNull();
    const confirms = request.mock.calls.filter(([path]) => path.endsWith('/generations'));
    expect(confirms.map(([, init]) => JSON.parse(init.body).idempotency_key)).toEqual([key, key]);
    await flow.review(); expect(flow.attempts.snapshot()).not.toBeNull(); jest.useRealTimers();
});
test('same key across network, 503, 429; single inflight request; success clears', async () => {
    const api = { request } as unknown as ApiClient, mint = jest.fn().mockReturnValueOnce('first-key').mockReturnValue('second-key');
    const attempts = createGenerationAttempts(api, mint); attempts.prepare(quote, input);
    for (const error of [new ApiError(0, 'network'), new ApiError(503, 'pair_acceptance_unknown'), new ApiError(429, 'rate_limited')]) {
        request.mockRejectedValueOnce(error); await expect(attempts.confirm(quote)).rejects.toBe(error);
    }
    const wait = deferred(); request.mockImplementationOnce(() => wait.promise);
    const one = attempts.confirm(quote), two = attempts.confirm(quote); expect(two).toBe(one);
    wait.resolve({ ...generation, idempotent: true }); await one;
    expect(attempts.snapshot()).toBeNull();
    expect(request.mock.calls.filter(([p]) => p.endsWith('/generations')).map(([, init]) => JSON.parse(init.body).idempotency_key)).toEqual(Array(4).fill('first-key'));
    attempts.prepare({ ...quote, quote_id: 'different' }, input); expect(attempts.snapshot()?.key).toBe('second-key');
    attempts.reset(); expect(attempts.snapshot()).toBeNull();
});
test('replay acknowledgement has one tracker row and one charge in a counting server', async () => {
    let charges = 0; const accepted = new Map<string, unknown>();
    request.mockImplementation(async (_path, init) => {
        const body = JSON.parse(init.body);
        if (accepted.has(body.idempotency_key)) return { ...generation, idempotent: true };
        accepted.set(body.idempotency_key, generation); charges++; throw new ApiError(503, 'pair_acceptance_unknown');
    });
    const attempts = createGenerationAttempts({ request } as unknown as ApiClient, () => 'counting-key'); attempts.prepare(quote, input);
    await expect(attempts.confirm(quote)).rejects.toThrow();
    const result = await attempts.confirm(quote); flow.tracker.add(result, input); flow.tracker.add(result, input);
    expect(charges).toBe(1); expect(flow.tracker.snapshot().entries).toHaveLength(1);
});

test('a stale off response still closes the current account circuit', async () => {
    let reject!: (error: unknown) => void;
    request.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const old = flow.review(); flow.edit({ prompt: 'Changed while waiting' });
    reject(new ApiError(404, 'music_unavailable')); await old;
    expect(flow.snapshot().status).toBe('off'); request.mockClear(); await flow.review(); expect(request).not.toHaveBeenCalled();
});

test('declining consent on recovery does not downgrade an ambiguous attempt', async () => {
    const attempts = createGenerationAttempts({ request } as unknown as ApiClient, () => 'guard-recovery-key');
    attempts.prepare(quote, input); request.mockRejectedValueOnce(new ApiError(0, 'network'));
    await expect(attempts.confirm(quote)).rejects.toThrow();
    request.mockRejectedValueOnce(new ApiError(400, 'consent_declined'));
    await expect(attempts.confirm(quote)).rejects.toThrow();
    expect(attempts.snapshot()).toMatchObject({ phase: 'AMBIGUOUS', key: 'guard-recovery-key' });
});

test('an edit during a declined first confirmation cannot restore the old quote', async () => {
    await flow.review(); let reject!: (error: unknown) => void;
    request.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const confirming = flow.confirm(); flow.edit({ prompt: 'New input' });
    reject(new ApiError(400, 'consent_declined')); await confirming;
    expect(flow.attempts.snapshot()).toBeNull();
});

test('F1 ambiguous recovery ignores current model and length blockers and reuses its key', async () => {
    const changed = { ...entitlements, models: entitlements.models.map(model => ({ ...model })), custom_drafts: { ...entitlements.custom_drafts } };
    flow.dispose(); request.mockResolvedValueOnce(changed); flow = makeFlow(); await flow.load(); flow.edit(input);
    await flow.review(); request.mockRejectedValueOnce(new ApiError(503, 'pair_acceptance_unknown')); await flow.confirm();
    const pending = flow.attempts.snapshot()!;
    changed.models[0].available = false; changed.custom_drafts.title_max = 1;
    request.mockClear(); await flow.confirm();
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ quote_id: pending.quote.quote_id, idempotency_key: pending.key });
    expect(flow.attempts.snapshot()).toBeNull(); expect(flow.tracker.snapshot().entries).toHaveLength(1);
});

describe.each(['first send', 'recovery'])('F2 attempt preservation on %s', phase => {
    test.each([[401, 'not_authenticated'], [403, 'account_frozen'], [500, 'internal'], [503, 'pair_acceptance_unknown'],
        [429, 'rate_limited'], [400, 'unrecognized_rejection'], [401, 'quote_expired'], [403, 'quote_expired']] as const)(
        'retains the key on %i %s', async (status, code) => {
            const attempts = createGenerationAttempts({ request } as unknown as ApiClient, () => 'preserved-key');
            attempts.prepare(quote, input);
            if (phase === 'recovery') {
                request.mockRejectedValueOnce(new ApiError(0, 'network'));
                await expect(attempts.confirm(quote)).rejects.toThrow();
            }
            request.mockRejectedValueOnce(new ApiError(status, code));
            await expect(attempts.confirm(quote)).rejects.toMatchObject({ status, code });
            expect(attempts.snapshot()).toMatchObject({ key: 'preserved-key', phase: 'AMBIGUOUS', input });
            await attempts.confirm(quote);
            const sends = request.mock.calls.filter(([path]) => path.endsWith('/generations'));
            expect(sends.every(([, init]) => JSON.parse(init.body).idempotency_key === 'preserved-key')).toBe(true);
            expect(attempts.snapshot()).toBeNull();
        });
});

test.each([[409, 'quote_expired'], [409, 'quote_stale'], [409, 'quote_already_used'], [402, 'insufficient_balance'],
    [400, 'prompt_not_allowed'], [400, 'invalid_request'], [400, 'invalid_inputs'], [400, 'quote_id_invalid'],
    [400, 'idempotency_key_invalid'], [409, 'idempotency_conflict'], [409, 'revision_conflict'],
    [400, 'invalid_json'], [413, 'body_too_large'], [404, 'not_found'], [400, 'no_balance_row']] as const)(
    'F2 definitive rejection %i %s clears an ambiguous attempt', async (status, code) => {
        const attempts = createGenerationAttempts({ request } as unknown as ApiClient, () => 'definitive-key');
        attempts.prepare(quote, input); request.mockRejectedValueOnce(new ApiError(0, 'network'));
        await expect(attempts.confirm(quote)).rejects.toThrow();
        request.mockRejectedValueOnce(new ApiError(status, code));
        await expect(attempts.confirm(quote)).rejects.toMatchObject({ code }); expect(attempts.snapshot()).toBeNull();
    });
