import { ApiError, type ApiClient } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { createCache, type CacheStorage } from '../src/lib/cache';
import { createOddlingsStore, switchLink, type OddlingsRecord } from '../src/lib/oddlingsAccountStore';
import { createOddlingsProjects } from '../src/lib/oddlingsProjects';
import { emptyDoc, toServerDocument } from '../src/lib/oddlingsDocument';
import type { PassportDoc } from '../src/lib/oddlingsLibrary';
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `uuid-key-${++n}` }; });
const memory = (): CacheStorage => {
    const data = new Map<string, string>();
    return { get: async k => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, remove: async k => { data.delete(k); }, keys: async () => [...data.keys()] };
};
const item = (id = 'X', name = id) => ({ id, name, savedAt: 1, picks: { oddling_name: name }, motionId: '' });
const doc = (...ids: string[]): PassportDoc => ({ items: ids.map(id => item(id)), draft: null });
const head = (revision = 0, d = emptyDoc(), id = 'P1') => ({ revision, document: toServerDocument(id, d) });
const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let storage: CacheStorage, app: CacheStorage, store: ReturnType<typeof createOddlingsStore>, engine: ReturnType<typeof createOddlingsProjects>;
let request: jest.Mock, api: ApiClient, clock: number;
const puts = () => request.mock.calls.filter(([, init]) => init?.method === 'PUT');
const posts = () => request.mock.calls.filter(([, init]) => init?.method === 'POST');
const record = async () => (await store.read())!;
const restart = () => { store = createOddlingsStore(storage); engine = createOddlingsProjects(api, store, () => clock); };
const link = (id: string | null = 'P1', base = emptyDoc(), revision = 0) => store.mutate(r => switchLink(r, id, base, revision));
const edit = (id = 'X', name = 'Local') => store.save({ oddling_name: name }, 2, id);
const answer = async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { const body = JSON.parse(String(init.body)); return { revision: body.expected_revision + 1, document: body.document }; }
    return head();
};
async function waitPut() { while (!puts().length) await Promise.resolve(); }
beforeEach(async () => {
    resetCacheUser(); storage = memory(); app = memory(); store = createOddlingsStore(storage); clock = Date.now();
    await bindCacheUser('A', createCache(app), app, storage);
    request = jest.fn(async (path, init) => answer(path, init)); api = { request } as unknown as ApiClient;
    engine = createOddlingsProjects(api, store, () => clock); await link();
});
test('exact encoded path, headers and v4 body at revision zero', async () => {
    await link('a/b?c'); await edit();
    expect(await engine.syncNow()).toBe('saved');
    const [path, init] = puts()[0], body = JSON.parse(init.body);
    expect(path).toBe('/api/v1/projects/a%2Fb%3Fc/document');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'Idempotency-Key': expect.any(String) });
    expect(Object.keys(body)).toEqual(['expected_revision', 'document']); expect(body.expected_revision).toBe(0);
    expect(body.document).toEqual(toServerDocument('a/b?c', (await record()).base));
    expect((await record()).ops).toEqual([]);
});
test('nonempty v1 is other work and is never overwritten', async () => {
    await edit(); request.mockResolvedValue({ revision: 2, document: { schema_version: 1 } });
    expect(await engine.syncNow()).toBe('other'); expect(puts()).toHaveLength(0); expect((await record()).projectId).toBeNull();
});
test('409 twice rebases onto fresh heads and retains remote additions, with new keys', async () => {
    await edit(); let attempt = 0;
    request.mockImplementation(async (path, init) => {
        if (!init) return head(attempt + 1, attempt ? doc('Remote') : emptyDoc());
        if (attempt++ < 2) throw new ApiError(409, 'unknown'); return answer(path, init);
    });
    expect(await engine.syncNow()).toBe('saved'); expect(puts()).toHaveLength(3);
    expect(new Set(puts().map(([, i]) => i.headers['Idempotency-Key'])).size).toBe(3);
    expect(JSON.parse(puts()[2][1].body).document.oddlings.items.map((i: { id: string }) => i.id)).toEqual(['X', 'Remote']);
});
test('three conflicts stop until another screen event', async () => {
    await edit(); request.mockImplementation(async (_p, init) => { if (init) throw new ApiError(409, 'unknown'); return head(); });
    expect(await engine.syncNow()).toBe('conflict'); expect(puts()).toHaveLength(3); expect((await record()).ops).toHaveLength(1);
});
test('committed lost response replays exact request before GET, even after head advances', async () => {
    await edit(); const committed = new Map<string, ReturnType<typeof head>>(); let commits = 0, revision = 5;
    request.mockImplementation(async (_path, init) => {
        if (!init) return head(revision, revision === 7 ? doc('Remote') : emptyDoc());
        const key = init.headers['Idempotency-Key'];
        if (committed.has(key)) return committed.get(key);
        const saved = { revision: ++revision, document: JSON.parse(init.body).document };
        committed.set(key, saved); commits++;
        if (commits === 1) { revision = 7; throw new ApiError(0, 'network'); }
        return saved;
    });
    expect(await engine.syncNow()).toBe('local'); const original = puts()[0];
    restart(); request.mockClear();
    expect(await engine.syncNow()).toBe('saved'); expect(request.mock.calls[0]).toEqual(original);
    expect(commits).toBe(1); expect((await record()).revision).toBe(6); expect((await record()).ops).toEqual([]);
});
test('uncommitted replay conflict clears request and rebases with a new key', async () => {
    await edit(); request.mockImplementation(async (_p, init) => { if (init) throw new ApiError(0, 'network'); return head(5); });
    await engine.syncNow(); const old = puts()[0][1].headers['Idempotency-Key'];
    request.mockClear(); request.mockRejectedValueOnce(new ApiError(409, 'unknown')).mockResolvedValueOnce(head(7, doc('Remote'))).mockImplementation(answer);
    expect(await engine.syncNow()).toBe('saved'); expect(puts()[0][1].headers['Idempotency-Key']).toBe(old);
    expect(puts()[1][1].headers['Idempotency-Key']).not.toBe(old);
    expect(JSON.parse(puts()[1][1].body).expected_revision).toBe(7);
});
test.each([['edit', 'New'], ['remove', null], ['draft', 'Draft']] as const)('newer %s during a PUT survives acknowledgement', async (kind, name) => {
    await edit(); if (kind === 'draft') await store.draft({ oddling_name: 'Old draft' }, 1);
    const delayed = deferred<ReturnType<typeof head>>();
    request.mockImplementationOnce(async () => head()).mockImplementationOnce(() => delayed.promise).mockImplementation(answer);
    const running = engine.syncNow(); await waitPut();
    if (kind === 'edit') await edit('X', name!);
    else if (kind === 'remove') await store.remove('X'); else await store.draft({ oddling_name: name! }, 3);
    delayed.resolve({ revision: 1, document: JSON.parse(puts()[0][1].body).document }); await running;
    const r = await record(); expect(r.ops).toHaveLength(1);
    if (kind === 'edit') expect(r.local.items[0].name).toBe('New');
    if (kind === 'remove') expect(r.local.items).toEqual([]);
    if (kind === 'draft') expect(r.local.draft?.picks.oddling_name).toBe('Draft');
    await engine.syncNow(); expect((await record()).ops).toEqual([]);
});
test('concurrent sync calls send a single PUT', async () => {
    await edit(); const delayed = deferred<ReturnType<typeof head>>();
    request.mockImplementationOnce(async () => head()).mockImplementationOnce(() => delayed.promise);
    const a = engine.syncNow(), b = engine.syncNow(); await waitPut();
    delayed.resolve({ revision: 1, document: JSON.parse(puts()[0][1].body).document });
    await Promise.all([a, b]); expect(puts()).toHaveLength(1);
});
test.each([429, 400, 402, 403, 503, 500, 502, 401, 0])('status %i preserves pending edits', async code => {
    await edit(); request.mockImplementation(async (_p, init) => { if (init) throw new ApiError(code, 'never_display_me'); return head(); });
    expect(await engine.syncNow()).toBe(code === 429 ? 'busy' : code === 400 ? 'rejected' : code === 0 || code === 401 ? 'local' : 'unavailable');
    expect((await record()).ops).toHaveLength(1); expect(puts()).toHaveLength(1);
    expect(!!(await record()).inflight).toBe(code !== 400);
});
test('400 does not retry unchanged body but a changed edit is allowed', async () => {
    await edit(); request.mockImplementation(async (_p, init) => { if (init) throw new ApiError(400, 'unknown'); return head(); });
    await engine.syncNow(); await engine.syncNow(); expect(puts()).toHaveLength(1);
    await edit('X', 'Changed'); await engine.syncNow(); expect(puts()).toHaveLength(2);
});
test('429 honors Retry-After without a retry loop', async () => {
    await edit(); request.mockImplementation(async (_p, init) => { if (init) throw new ApiError(429, 'unknown', { retryAfterSeconds: 20 }); return head(); });
    await engine.syncNow(); clock += 19000; await engine.syncNow(); expect(puts()).toHaveLength(1);
    clock += 1001; await engine.syncNow(); expect(puts()).toHaveLength(2);
});
test('unavailable is in memory and retries after ten minutes or a fresh launch', async () => {
    await edit(); request.mockRejectedValue(new ApiError(503, 'any_code'));
    await engine.syncNow(); await engine.syncNow(); expect(request).toHaveBeenCalledTimes(1);
    clock += 600001; await engine.syncNow(); expect(request).toHaveBeenCalledTimes(2);
    restart(); await engine.syncNow(); expect(request).toHaveBeenCalledTimes(3);
});
test('PUT 404 then GET 200 is unavailable; project and exact inflight stay, no DELETE', async () => {
    await edit(); request.mockImplementation(async (_p, init) => { if (init) throw new ApiError(404, 'unknown'); return head(); });
    expect(await engine.syncNow()).toBe('unavailable'); expect((await record()).projectId).toBe('P1');
    expect((await record()).inflight).not.toBeNull(); expect(request.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
});
test.each([false, true])('project gone on %s PUT probe unlinks and retains recovery across restart', async put => {
    await link('P1', doc('X'), 1); if (put) await edit(); let first = true;
    request.mockImplementation(async (path, init) => {
        if (path === '/api/v1/workspaces') return { workspaces: [] };
        if (put && first && !init) { first = false; return head(1, doc('X')); }
        throw new ApiError(404, 'unknown');
    });
    expect(await engine.syncNow()).toBe('gone'); restart();
    expect((await record()).projectId).toBeNull(); expect((await record()).recoverable?.items[0].id).toBe('X');
});
test('404 everywhere is unavailable and does not unlink', async () => {
    await edit(); request.mockRejectedValue(new ApiError(404, 'unknown'));
    expect(await engine.syncNow()).toBe('unavailable'); expect((await record()).projectId).toBe('P1');
});
test.each(['count', 'bytes'])('full by %s keeps every local item and never PUTs', async size => {
    await edit(); const remote = size === 'count' ? doc(...Array.from({ length: 24 }, (_, n) => `R${n}`)) : doc('R');
    if (size === 'bytes') await store.mutate(r => ({ ...r, local: { ...r.local, items: [{ ...r.local.items[0], picks: Object.fromEntries(Array.from({ length: 64 }, (_, n) => [`p_${String.fromCharCode(97 + n % 26)}${String.fromCharCode(97 + Math.floor(n / 26))}`, 'a'.repeat(160)])) }, ...Array.from({ length: 3 }, (_, n) => ({ ...item(`Huge${n}`), picks: { oddling_name: 'b'.repeat(160) } }))] }, ops: [{ kind: 'upsert', id: 'X', gen: 1 }, ...Array.from({ length: 3 }, (_, n) => ({ kind: 'upsert' as const, id: `Huge${n}`, gen: n + 2 }))] }));
    // Add enough legal picks to exceed the byte limit (without a per-field violation).
    if (size === 'bytes') await store.mutate(r => ({ ...r, local: { ...r.local, items: r.local.items.map(i => ({ ...i, picks: r.local.items[0].picks })) } }));
    request.mockResolvedValue(head(1, remote));
    expect(await engine.syncNow()).toBe('full'); expect(puts()).toHaveLength(0);
    expect((await record()).local.items.length).toBe(size === 'count' ? 25 : 5);
});
test('owner change during PUT discards the response', async () => {
    await edit(); const delayed = deferred<ReturnType<typeof head>>(); request.mockImplementationOnce(async () => head()).mockImplementationOnce(() => delayed.promise);
    const running = engine.syncNow(); await waitPut(); await bindCacheUser('B', createCache(app), app, storage);
    delayed.resolve(head(1, doc('X'))); await running; expect(await store.read()).toBeNull();
});
test('draft only sends when different; Save can exclude autosave until leave', async () => {
    await store.draft({ oddling_name: 'Draft' }, 1); await engine.syncNow(false); expect(puts()).toHaveLength(0);
    await engine.syncNow(); expect(puts()).toHaveLength(1);
    await store.draft({ oddling_name: 'Draft' }, 2); request.mockImplementation(async () => head(1, { items: [], draft: { savedAt: 99, picks: { oddling_name: 'Draft' } } }));
    await engine.syncNow(); expect(puts()).toHaveLength(1);
});
test.each([false, true])('reselect keeps remote ties unless local pending=%s', async pending => {
    await link('P1', doc('X'), 1); if (pending) await edit('X', 'Pending');
    request.mockImplementation(async (path, init) => init ? answer(path, init) : head(2, { items: [item('X', 'Remote')], draft: null }));
    await engine.choose('P1'); expect((await record()).local.items[0].name).toBe(pending ? 'Pending' : 'Remote'); expect(puts()).toHaveLength(pending ? 1 : 0);
});
test('ordinary switch copies no synced content', async () => {
    await link('P1', doc('X'), 1); request.mockResolvedValue(head(0, emptyDoc(), 'P2'));
    await engine.choose('P2'); expect((await record()).local.items).toEqual([]); expect(puts()).toHaveLength(0);
});
test.each([true, false])('deleted-project recovery bring=%s survives restart', async bring => {
    await link('P1', doc('X'), 1);
    request.mockImplementation(async p => { if (p === '/api/v1/workspaces') return {}; throw new ApiError(404, 'unknown'); });
    await engine.syncNow(); restart();
    request.mockImplementation(async (p, i) => i ? answer(p, i) : head(0, emptyDoc(), 'P2'));
    await engine.choose('P2', bring); expect((await record()).local.items.map(i => i.id)).toEqual(bring ? ['X'] : []);
    expect((await record()).recoverable).toBeUndefined(); expect(puts()).toHaveLength(bring ? 1 : 0);
});
test.each([false, true])('switch during delayed PUT isolates P2, restart=%s', async reboot => {
    await edit(); const delayed = deferred<ReturnType<typeof head>>(); request.mockImplementationOnce(async () => head()).mockImplementationOnce(() => delayed.promise);
    const running = engine.syncNow(); await waitPut(); await link('P2', doc('Other'), 7); const p2 = await record();
    if (reboot) restart(); delayed.resolve(head(1, doc('X'))); await running;
    expect((await record()).base).toEqual(p2.base); expect((await record()).ops).toEqual(p2.ops); expect((await record()).revision).toBe(7);
});
test('switch away and back resumes the original key without transferring its operations', async () => {
    await edit(); request.mockImplementation(async (_p, i) => { if (i) throw new ApiError(0, 'network'); return head(); });
    await engine.syncNow(); const original = puts()[0][1]; await link('P2'); await link('P1'); restart();
    request.mockImplementation(answer); await engine.syncNow(); expect(puts()[1][1]).toEqual(original); expect((await record()).inflight).toBeNull();
});
test.each([404, 403, 402, 429, 503, 0])('uncertain orphan %i stays only with its own project', async code => {
    await edit(); request.mockImplementation(async (_p, i) => { if (i) throw new ApiError(0, 'network'); return head(); });
    await engine.syncNow(); const original = puts()[0]; await link('P2', doc('X'), 1); restart();
    request.mockImplementation(async (p, i) => { if (i) throw new ApiError(code, 'unknown'); return head(1, doc('X'), 'P2'); });
    await engine.syncNow(); expect((await record()).orphans.P1).toBeDefined(); expect((await record()).ops).toEqual([]);
    request.mockImplementation(async (p, i) => i ? answer(p, i) : head(1, doc('X'), 'P2'));
    await engine.syncNow(); expect((await record()).orphans.P1).toBeUndefined();
    expect(puts().slice(1).every(([p, i]) => p === original[0] && i.body === original[1].body)).toBe(true);
});
test.each([400, 409])('definitive orphan %i drops with a one-time notice and never removes P2 X', async code => {
    await link('P1', doc('X'), 1); await store.remove('X');
    request.mockImplementation(async (_p, i) => { if (i) throw new ApiError(0, 'network'); return head(1, doc('X')); });
    await engine.syncNow(); await link('P2', doc('X'), 1); await edit('X', 'P2 edit');
    request.mockImplementation(async (p, i) => { if (p.includes('P1') && i) throw new ApiError(code, 'unknown'); return i ? answer(p, i) : head(1, doc('X'), 'P2'); });
    await engine.syncNow(); expect((await record()).local.items[0].name).toBe('P2 edit'); expect((await record()).ops).toEqual([]);
    expect(await engine.takeNotice()).toBe('orphanLost'); expect(await engine.takeNotice()).toBeUndefined();
});
test.each([4, 31])('orphan count/age bound %i drops with notice', async bound => {
    await store.mutate(r => ({ ...r, orphans: Object.fromEntries(Array.from({ length: bound === 4 ? 4 : 1 }, (_, n) => [`Old${n}`, {
        projectId: `Old${n}`, key: `old-key-${n}`, expected: 0, body: '{}', createdAt: bound === 31 ? clock - 31 * 86400000 : clock + n,
    }])) }));
    request.mockRejectedValue(new ApiError(0, 'network')); await engine.syncNow();
    expect(Object.keys((await record()).orphans)).toHaveLength(bound === 4 ? 3 : 0); expect((await record()).orphans.Old0).toBeUndefined();
    expect(await engine.takeNotice()).toBe('orphanLost');
});
test('creation replay retains exact workspace, normalized name, key and nonce after restart', async () => {
    await link(null); request.mockRejectedValue(new ApiError(0, 'network'));
    await engine.newProject('non-default', '  Oddlings  '); const first = posts()[0], intent = (await record()).pendingCreate!;
    restart(); request.mockImplementation(async (p, i) => i?.method === 'POST' ? { project: { id: 'P2', version: 1 } } : answer(p, i));
    await engine.newProject('default', 'Changed'); expect(posts()[1]).toEqual(first);
    expect(JSON.parse(first[1].body)).toEqual({ workspace_id: 'non-default', name: 'Oddlings' });
    expect(first[1].headers['Idempotency-Key']).toBe(intent.key); expect((await record()).pendingCreate).toBeNull();
});
test.each(['P1', null])('creation success selects P2 from %s when selection generation is unchanged', async current => {
    await link(current as string); request.mockImplementation(async (p, i) => i?.method === 'POST' ? { project: { id: 'P2', version: 1 } } : answer(p, i));
    await engine.newProject('W', 'Oddlings'); expect((await record()).projectId).toBe('P2');
    await edit(); await engine.syncNow(); expect(puts()[0][0]).toContain('/P2/');
});
test('later selection wins over delayed creation and terminal intent is not replayed', async () => {
    const delayed = deferred<unknown>(); request.mockImplementationOnce(() => delayed.promise).mockImplementation(answer);
    const running = engine.newProject('W', 'P2'); while (!posts().length) await Promise.resolve();
    await link('P3'); delayed.resolve({ project: { id: 'P2', version: 1 } }); await running;
    expect((await record()).projectId).toBe('P3'); expect((await record()).pendingCreate).toBeNull();
    restart(); await engine.syncNow(); expect(posts()).toHaveLength(1);
});
test.each([400, 403, 409, 404])('definitive creation failure %i clears intent and permits a new creation', async code => {
    request.mockImplementation(async (p, i) => { if (i?.method === 'POST') throw new ApiError(code, 'unknown'); return p === '/api/v1/workspaces' ? {} : head(); });
    await engine.newProject('W', 'Oddlings'); expect((await record()).pendingCreate).toBeNull(); expect(await engine.takeNotice()).toBe('createFailed');
    await engine.newProject('W', 'Again'); expect(posts()).toHaveLength(2);
});
test.each([0, 429, 402, 503, 404])('uncertain creation %i is retained and expires after a day', async code => {
    request.mockRejectedValue(new ApiError(code, 'unknown')); await engine.newProject('W', 'Oddlings');
    expect((await record()).pendingCreate).not.toBeNull(); clock += 86400001; restart(); await engine.syncNow();
    expect((await record()).pendingCreate).toBeNull(); expect(await engine.takeNotice()).toBe('createFailed'); expect(posts()).toHaveLength(1);
});
test('Start over clears the creation slot', async () => {
    request.mockRejectedValue(new ApiError(0, 'network')); await engine.newProject('W', 'Oddlings');
    await engine.startOver(); expect((await record()).pendingCreate).toBeNull();
});
test.each([false, true])('stale creation answer error=%s cannot touch newer nonce or notice', async error => {
    const delayed = deferred<unknown>(); request.mockImplementationOnce(() => delayed.promise).mockRejectedValue(new ApiError(0, 'network'));
    const a = engine.newProject('W1', 'A'); while (!posts().length) await Promise.resolve();
    await engine.startOver(); const b = engine.newProject('W2', 'B');
    while ((await record()).pendingCreate?.name !== 'B') await Promise.resolve();
    const intent = (await record()).pendingCreate;
    if (error) delayed.reject(new ApiError(400, 'unknown')); else delayed.resolve({ project: { id: 'CreatedA' } });
    await Promise.all([a, b]); expect((await record()).pendingCreate).toEqual(intent);
    expect((await record()).projectId).toBe('P1'); expect((await record()).notice).toBeUndefined();
});
test.each([503, 404])('first PUT %i retains newly created project and request; never DELETE', async code => {
    await edit(); request.mockImplementation(async (p, i) => {
        if (i?.method === 'POST') return { project: { id: 'P2', version: 1 } };
        if (i?.method === 'PUT') throw new ApiError(code, 'unknown'); return head(0, emptyDoc(), 'P2');
    });
    expect(await engine.newProject('W', 'Oddlings')).toBe('unavailable');
    expect((await record()).projectId).toBe('P2'); expect((await record()).inflight).not.toBeNull();
    expect(request.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
    const original = puts()[0]; restart(); request.mockClear(); request.mockImplementation(answer);
    await engine.syncNow(); expect(request.mock.calls[0]).toEqual(original);
});

test('an edit made after a lost response survives replay and gets a new key on its own request', async () => {
    await edit(); request.mockImplementation(async (_p, i) => { if (i) throw new ApiError(0, 'network'); return head(); });
    await engine.syncNow(); const original = puts()[0][1]; await edit('X', 'New');
    request.mockImplementation(answer); await engine.syncNow();
    expect(puts()[1][1]).toEqual(original); expect((await record()).local.items[0].name).toBe('New');
    expect((await record()).ops).toHaveLength(1); await engine.syncNow();
    expect(puts()[2][1].headers['Idempotency-Key']).not.toBe(original.headers['Idempotency-Key']);
    expect(JSON.parse(puts()[2][1].body).document.oddlings.items[0].name).toBe('New');
});

test('recovery keeps the target copy on an id collision even when the lost copy was pending', async () => {
    await edit('X', 'Lost'); await store.mutate(r => ({ ...r, projectId: null, recoverable: { ...r.local, from: 'P1', at: clock } }));
    request.mockImplementation(async () => head(1, { items: [item('X', 'Remote')], draft: null }, 'P2'));
    await engine.choose('P2'); expect((await record()).local.items[0].name).toBe('Remote'); expect(puts()).toHaveLength(0);
});
test('confirmed discard removes the recoverable pending content before new creation', async () => {
    await edit(); await store.mutate(r => ({ ...r, projectId: null, recoverable: { ...r.local, from: 'P1', at: clock } }));
    await engine.discardRecovery(); expect((await record()).recoverable).toBeUndefined(); expect((await record()).ops).toEqual([]);
    expect((await record()).local.items).toEqual([]);
});

test('reselecting the same project preserves unresolved edits through a replay conflict', async () => {
    await edit('X', 'Unsent edit');
    request.mockResolvedValueOnce(head(5)).mockRejectedValueOnce(new ApiError(0, 'network'));
    await engine.syncNow();
    const before = await record(), replay = deferred<ReturnType<typeof head>>();
    request.mockClear();
    request.mockResolvedValueOnce(head(7, doc('Remote'))).mockImplementationOnce(() => replay.promise)
        .mockResolvedValueOnce(head(7, doc('Remote'))).mockImplementation(answer);
    const choosing = engine.choose('P1'); await waitPut();
    const selected = await record();
    // Capture before releasing the replay, but always settle the request before assertions.
    replay.reject(new ApiError(409, 'unknown')); await choosing;
    expect(selected.ops).toEqual(before.ops);
    expect(selected.local).toEqual(before.local);
    expect(selected.inflight).toEqual({ ...before.inflight, linkGen: before.linkGen + 1 });
    expect(puts()[0][1].headers['Idempotency-Key']).toBe(before.inflight!.key);
    expect(puts()).toHaveLength(2);
    expect(JSON.parse(puts()[1][1].body).document.oddlings.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'X', name: 'Unsent edit' }), expect.objectContaining({ id: 'Remote' }),
    ]));
    expect((await record()).local.items.find(i => i.id === 'X')?.name).toBe('Unsent edit');
});
