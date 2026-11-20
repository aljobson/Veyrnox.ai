import { ApiError } from '../src/lib/api';
import { createBeatCloud } from '../src/lib/beatNative/cloud';
import { probeBeatCloud } from '../src/lib/beatNative/probe';
import { BeatCloudSync } from '../src/lib/beatNative/cloudSync';
import { createBeatStore } from '../src/lib/beatNative/store';
import { setTempo } from '../src/lib/beatNative/doc';
import { createHistory, record, travel } from '../src/lib/beatNative/history';
import { errorState, retryDelay } from '../src/lib/beatNative/rules';
import { memoryFiles, deferred, tick, fakeApi, failure, response, project, USER, OTHER, VERSION, version } from './beatNativeFixtures';
const originalFetch = global.fetch;
beforeEach(() => jest.useFakeTimers());
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

test.each([['VERSION_CONFLICT', 409, 'conflict', 10000], ['NOT_FOUND', 404, 'removed', null], ['LIMIT_REACHED', 413, 'limit', null], ['RATE_LIMITED', 429, 'rate_limited', 60000]])('real %s envelopes are normalized before shared rules', async (code, status, state, delay) => {
    const { api } = fakeApi(() => failure(String(code), Number(status), 90));
    try { await createBeatCloud(api).list(); throw new Error('expected failure'); }
    catch (error) {
        expect(error).toBeInstanceOf(ApiError); expect((error as ApiError).code).toBe(code);
        expect((error as ApiError).retryAfterSeconds).toBe(90);
        expect(errorState(error)).toBe(state); expect(retryDelay(0, error)).toBe(delay);
    }
});

test.each([['NOT_FOUND', 404, 'off'], ['ANY_CODE', 404, 'off'], ['music_beat_unavailable', 503, 'off'], ['DENIED', 403, 'error']])('collection probe folds %s to %s', async (code, status, state) => {
    const { api } = fakeApi(() => failure(String(code), Number(status)));
    expect(await probeBeatCloud(api)).toEqual({ state });
});

test('bad response shapes throw bad_response; network probe is offline', async () => {
    const { api } = fakeApi(() => response({ projects: [{}] }));
    await expect(createBeatCloud(api).list()).rejects.toMatchObject({ code: 'bad_response' });
    expect(await probeBeatCloud(api)).toEqual({ state: 'error' });
    fakeApi(() => { throw new TypeError('offline'); });
    expect(await probeBeatCloud(api)).toEqual({ state: 'offline' });
});

test('off permits local saves and no cloud request after the collection probe', async () => {
    const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Offline works');
    const { api, fetcher } = fakeApi(() => failure('NOT_FOUND', 404));
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER);
    store.putBeat(setTempo(doc, 100)); await jest.advanceTimersByTimeAsync(800);
    await sync.link(); await sync.cycle('checkpoint'); await sync.cycle('autosave', true);
    expect(sync.snapshot().state).toBe('off'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(files.data.get(`${doc.id}.json`)).toContain('100'); sync.dispose();
});

test('first link uses revision zero, replays the key after a lost reply, and persists the cloud link', async () => {
    const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Link');
    let writes = 0;
    const { api, fetcher } = fakeApi((_url, init) => {
        if (init.method !== 'PUT') return response({ projects: [] });
        if (++writes === 1) throw new TypeError('lost reply');
        return response({ project: project(doc.id, 1) });
    });
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER); await sync.link();
    expect(sync.snapshot().state).toBe('offline');
    await jest.advanceTimersByTimeAsync(9999); expect(writes).toBe(1);
    await jest.advanceTimersByTimeAsync(1); expect(writes).toBe(2);
    const puts = fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(puts[0][1]?.body))).toMatchObject({ expected_revision: 0, mode: 'autosave' });
    expect((puts[0][1]?.headers as Record<string, string>)['Idempotency-Key']).toBe((puts[1][1]?.headers as Record<string, string>)['Idempotency-Key']);
    expect(store.getRecord(doc.id)?.cloud).toEqual({ userId: USER, projectId: project(doc.id).id, revision: 1, syncedUpdatedAt: doc.updatedAt });
    const relaunched = createBeatStore(files); await relaunched.hydrateBeats();
    expect(relaunched.getRecord(doc.id)?.cloud).toEqual(store.getRecord(doc.id)?.cloud); sync.dispose();
});

test.each(['mine', 'theirs'] as const)('conflict %s uses their revision and checkpoint/stash', async choice => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Mine'), theirs = { ...doc, title: 'Theirs' };
    let conflict = true;
    const bodies: { mode: string; expected_revision: number; doc_json: string }[] = [];
    const { api } = fakeApi((url, init) => {
        if (init.method === 'PUT') {
            bodies.push(JSON.parse(String(init.body)));
            if (conflict) return failure('VERSION_CONFLICT', 409);
            return response({ project: project(doc.id, choice === 'mine' ? 5 : 4) });
        }
        return url.endsWith(doc.id) ? response({ project: project(doc.id, 4), doc_json: JSON.stringify(theirs) }) : response({ projects: [] });
    });
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER); await sync.link();
    expect(sync.snapshot().conflict?.doc).toEqual(theirs);
    store.putBeat(setTempo(store.getBeat(doc.id)!, 130));
    conflict = false; await sync.resolve(choice);
    const saved = bodies.at(-1)!;
    expect(saved.expected_revision).toBe(4); expect(saved.mode).toBe(choice === 'mine' ? 'checkpoint' : 'stash');
    expect(JSON.parse(saved.doc_json).tempo.bpm).toBe(130);
    expect(store.getBeat(doc.id)?.title).toBe(choice === 'mine' ? 'Mine' : 'Theirs');
    expect(sync.snapshot().state).toBe('synced'); expect(store.getRecord(doc.id)?.cloud?.revision).toBe(choice === 'mine' ? 5 : 4);
    sync.dispose();
});

test.each([true, false])('item NOT_FOUND re-probes collection before removal (off=%s)', async off => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Local'); let collections = 0;
    const { api } = fakeApi((_url, init) => init.method === 'PUT' ? failure('NOT_FOUND', 404) : (++collections > 1 && off ? failure('NOT_FOUND', 404) : response({ projects: [] })));
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER); await sync.link();
    expect(collections).toBe(2); expect(sync.snapshot().state).toBe(off ? 'off' : 'removed');
    expect(store.getRecord(doc.id)?.cloud?.syncedUpdatedAt).toBe(off ? 0 : undefined); sync.dispose();
});

test.each([['LIMIT_REACHED', 413, 'limit', 0], ['RATE_LIMITED', 429, 'rate_limited', 60000]])('%s status and backoff', async (code, status, state, delay) => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Retry'); let writes = 0;
    const { api } = fakeApi((_url, init) => { if (init.method === 'PUT') { writes++; return failure(String(code), Number(status)); } return response({ projects: [] }); });
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER); await sync.link();
    expect(sync.snapshot().state).toBe(state);
    await jest.advanceTimersByTimeAsync(Number(delay) ? Number(delay) - 1 : 300000); expect(writes).toBe(1);
    if (delay) { await jest.advanceTimersByTimeAsync(1); expect(writes).toBe(2); }
    sync.dispose();
});

test('account change aborts work and a delayed response cannot link the new account', async () => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Account'), gate = deferred<Response>();
    let signal: AbortSignal | null | undefined;
    const { api, setUser } = fakeApi((_url, init) => { if (init.method === 'PUT') { signal = init.signal; return gate.promise; } return response({ projects: [] }); });
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER);
    const linking = sync.link(); await tick(); expect(signal).toBeDefined();
    setUser(OTHER); await sync.start(OTHER); expect(signal?.aborted).toBe(true);
    gate.resolve(response({ project: project(doc.id, 1) })); await linking;
    expect(store.getRecord(doc.id)?.cloud?.revision).toBe(0); expect(sync.snapshot().state).toBe('other'); sync.dispose();
});

test('offline undo survives relaunch and a new controller writes it to cloud', async () => {
    const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Undo');
    store.putBeat(setTempo(doc, 130));
    const edited = store.getBeat(doc.id)!;
    const history = record(createHistory(doc), edited);
    store.setCloudLink(doc.id, { userId: USER, projectId: project(doc.id).id, revision: 4, syncedUpdatedAt: edited.updatedAt });
    store.putBeat(travel(history, 'undo').present); await store.flushBeats();
    const relaunched = createBeatStore(files); await relaunched.hydrateBeats();
    const { api, fetcher } = fakeApi((_url, init) => response(init.method === 'PUT' ? { project: project(doc.id, 5) } : { projects: [] }));
    const sync = new BeatCloudSync(api, relaunched, doc.id); await sync.start(USER);
    const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(JSON.parse(String(put[1]?.body)).doc_json).tempo.bpm).toBe(doc.tempo.bpm); sync.dispose();
});

test('typed client validates versions and delete shapes and sends the required paths', async () => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Version');
    const { api, fetcher } = fakeApi((url, init) => {
        if (init.method === 'DELETE') return response({ removed: true });
        return response(url.endsWith(VERSION) ? { version: version(), doc_json: JSON.stringify(doc) } : { versions: [version()] });
    });
    const client = createBeatCloud(api);
    expect((await client.versions(doc.id)).versions).toHaveLength(1);
    expect((await client.version(doc.id, VERSION)).doc_json).toBe(JSON.stringify(doc));
    await expect(client.remove(doc.id, 4)).resolves.toEqual({ removed: true });
    expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ method: 'DELETE', body: JSON.stringify({ expected_revision: 4 }) });
});

test('off state keeps take documents local without any media calls', async () => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('With a take');
    const withTake = { ...doc, assets: { a1: { source: 'take' as const, ref: 'shelf-one', name: 'Take', durationSec: 3, bpm: null, sourceChannels: 1, encodedBytes: 0 } } };
    expect(store.putBeat(withTake)).toBe(true);
    const { api, fetcher } = fakeApi(() => failure('music_unavailable', 404));
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER); await sync.link();
    expect(sync.snapshot().state).toBe('off'); expect(fetcher).toHaveBeenCalledTimes(1); sync.dispose();
});

test('changed account during delayed stash leaves the local document and releases the barrier', async () => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Stay local'), stash = deferred<Response>();
    const { api, setUser } = fakeApi((url, init) => {
        if (init.method === 'PUT') return JSON.parse(String(init.body)).mode === 'stash' ? stash.promise : failure('VERSION_CONFLICT', 409);
        return url.endsWith(doc.id) ? response({ project: project(doc.id, 3), doc_json: JSON.stringify({ ...doc, title: 'Account' }) }) : response({ projects: [] });
    });
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER); await sync.link();
    const resolving = sync.resolve('theirs'); await tick(); expect(store.saveState(doc.id)).toBe('busy');
    setUser(OTHER); await sync.start(OTHER);
    stash.resolve(response({ project: project(doc.id, 3) })); await resolving;
    expect(store.getBeat(doc.id)?.title).toBe('Stay local'); expect(store.saveState(doc.id)).not.toBe('busy');
    expect(store.putBeat(setTempo(store.getBeat(doc.id)!, 140))).toBe(true); sync.dispose();
});

test.each(['{invalid', '{}'])('invalid account document %s shows error and stops retries until requested', async json => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Safe');
    const { api, fetcher } = fakeApi((url, init) => {
        if (init.method === 'PUT') return failure('VERSION_CONFLICT', 409);
        return url.endsWith(doc.id) ? response({ project: project(doc.id, 2), doc_json: json }) : response({ projects: [] });
    });
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER); await sync.link();
    expect(sync.snapshot().state).toBe('error'); expect(sync.snapshot().conflict).toBeNull();
    const count = fetcher.mock.calls.length;
    store.putBeat(setTempo(store.getBeat(doc.id)!, 123));
    await jest.advanceTimersByTimeAsync(600000); await sync.cycle('autosave', true);
    expect(fetcher).toHaveBeenCalledTimes(count); expect(store.getBeat(doc.id)?.title).toBe('Safe');
    await sync.retry(); expect(fetcher.mock.calls.length).toBeGreaterThan(count); sync.dispose();
});

test.each(['filesystem', 'local_conflict'])('%s is a local error, never offline', async failureKind => {
    const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Local error');
    const { api } = fakeApi((_url, init) => response(init.method === 'PUT' ? { project: project(doc.id) } : { projects: [] }));
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER);
    if (failureKind === 'filesystem') files.write = jest.fn(async () => { throw new Error('disk_full'); });
    else {
        const original = store.setCloudLink;
        jest.spyOn(store, 'setCloudLink').mockImplementation((id, link) => link.projectId ? false : original(id, link));
    }
    await sync.link(); expect(sync.snapshot().state).toBe('error'); sync.dispose();
});

test('Decide later pauses a conflict without retrying and Choose version reopens it', async () => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Mine');
    const { api, fetcher } = fakeApi((url, init) => init.method === 'PUT' ? failure('VERSION_CONFLICT', 409) :
        response(url.endsWith(doc.id) ? { project: project(doc.id, 3), doc_json: JSON.stringify({ ...doc, title: 'Theirs' }) } : { projects: [] }));
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER); await sync.link();
    const conflict = sync.snapshot().conflict; sync.later();
    expect(sync.snapshot()).toMatchObject({ state: 'paused_conflict', conflict: null });
    const count = fetcher.mock.calls.length;
    store.putBeat(setTempo(store.getBeat(doc.id)!, 120)); await jest.advanceTimersByTimeAsync(600000);
    expect(fetcher).toHaveBeenCalledTimes(count);
    sync.chooseVersion(); expect(sync.snapshot()).toMatchObject({ state: 'conflict', conflict }); sync.dispose();
});

test.each([false, true])('newer account revision fast-forwards only a clean phone copy (edit during read=%s)', async editDuringRead => {
    const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Clean'), gate = deferred<Response>();
    store.setCloudLink(doc.id, { userId: USER, projectId: doc.id, revision: 2, syncedUpdatedAt: doc.updatedAt });
    const theirs = { ...doc, title: 'Account revision 3', updatedAt: doc.updatedAt + 100 };
    const { api, fetcher } = fakeApi(url => url.endsWith(doc.id) ? gate.promise : response({ projects: [] }));
    const sync = new BeatCloudSync(api, store, doc.id), opening = sync.start(USER);
    await tick();
    if (editDuringRead) store.putBeat(setTempo(doc, 130));
    gate.resolve(response({ project: project(doc.id, 3), doc_json: JSON.stringify(theirs) })); await opening;
    if (editDuringRead) {
        expect(sync.snapshot().state).toBe('conflict'); expect(store.getBeat(doc.id)?.tempo.bpm).toBe(130);
    } else {
        expect(sync.snapshot()).toMatchObject({ state: 'synced', conflict: null });
        expect(store.getBeat(doc.id)).toEqual(theirs); expect(store.getRecord(doc.id)?.cloud?.revision).toBe(3);
        const relaunched = createBeatStore(files); await relaunched.hydrateBeats(); expect(relaunched.getBeat(doc.id)).toEqual(theirs);
    }
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false); sync.dispose();
});

test('unchanged lifecycle sync preserves the view and retry deadline; checkpoints still write', async () => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Clean');
    store.setCloudLink(doc.id, { userId: USER, projectId: doc.id, revision: 2, syncedUpdatedAt: doc.updatedAt });
    let reads = 0, writes = 0;
    const { api } = fakeApi((url, init) => {
        if (init.method === 'PUT') { writes++; return response({ project: project(doc.id, 3) }); }
        if (!url.endsWith(doc.id)) return response({ projects: [] });
        if (++reads === 1) throw new TypeError('offline');
        return response({ project: project(doc.id, 2), doc_json: JSON.stringify(doc) });
    });
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(USER);
    const view = sync.snapshot(); expect(view.state).toBe('offline');
    await jest.advanceTimersByTimeAsync(2000); await sync.cycle('autosave', true);
    expect(sync.snapshot()).toBe(view);
    await jest.advanceTimersByTimeAsync(7999); expect(reads).toBe(1);
    await jest.advanceTimersByTimeAsync(1); expect(reads).toBe(2); expect(sync.snapshot().state).toBe('synced');
    await sync.cycle('checkpoint', true); expect(writes).toBe(1); sync.dispose();
});

test('signed out skips the probe; an expired account probe also shows signed out', async () => {
    const store = createBeatStore(memoryFiles()), doc = store.newBeat('Local');
    const { api, fetcher } = fakeApi(() => failure('UNAUTHORIZED', 401));
    const sync = new BeatCloudSync(api, store, doc.id); await sync.start(null);
    expect(sync.snapshot().state).toBe('signed_out'); expect(fetcher).not.toHaveBeenCalled();
    await sync.start(USER); expect(sync.snapshot().state).toBe('signed_out'); expect(fetcher).toHaveBeenCalledTimes(1);
    sync.dispose();
});
