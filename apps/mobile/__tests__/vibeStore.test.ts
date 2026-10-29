import * as SecureStore from 'expo-secure-store';
import { ApiError, createApiClient, type ApiClient } from '../src/lib/api';
import type { SessionTask } from '../src/auth/sessionTask';
import type { CreatorAnswers } from '../src/lib/creatorAnswers';
import { VIBE_REQUEST_DEADLINE_MS, serializeVibe } from '../src/lib/creatorProfile';
import { clearAllVibes, clearVibe, loadVibe, recordVibeSkip, runVibeIntent, runVibeSync, storeVibe, vibeOffered } from '../src/lib/creatorProfileStore';
import { subscribeVibe, subscribeVibeIdle } from '../src/lib/vibeEvents';
const mockDisk = new Map<string, string>();
let mockOwner: string | undefined = 'A', generation = 0;
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(async (key: string) => mockDisk.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { mockDisk.set(key, value); }),
    deleteItemAsync: jest.fn(async (key: string) => { mockDisk.delete(key); }),
}));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner }));
jest.mock('../src/lib/creatorProfile', () => ({ ...jest.requireActual('../src/lib/creatorProfile'), CREATOR_PROFILE_ENABLED: true }));
const SLOT = 'veyrnox.vibe.v2';
const A1: CreatorAnswers = { look: 'neon_rain', goal: 'story', pace: 'octopus', chaos: 2, destination: 'tiktok', audience: 'me', voice: 'calm' };
const A2: CreatorAnswers = { ...A1, chaos: 4 };
const chosen = (answers = A1, synced = true) => ({ version: 1 as const, state: 'completed' as const, answers, synced });
const skipped = (synced = false) => ({ version: 1 as const, state: 'skipped' as const, answers: null, synced });
const task = (): SessionTask => { const gen = generation, user = mockOwner ?? null; return { gen, user, current: () => gen === generation && user === (mockOwner ?? null), tokens: async () => null }; };
function deferred<T = void>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
const tick = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const fail = () => new ApiError(0, 'network', { timedOut: true });
function server(initial: any = null) {
    let profile = initial;
    const log: string[] = [];
    const hooks: Partial<Record<string, () => Promise<unknown>>> = {};
    const payload = () => profile ? { status: profile.state, answers: profile.answers ?? {} } : { status: 'none' };
    const api = { request: jest.fn(async <T>(_path: string, init?: RequestInit): Promise<T> => {
        const method = init?.method ?? 'GET'; log.push(method);
        if (hooks[method]) await hooks[method]!();
        if (method === 'PUT') profile = chosen(JSON.parse(String(init?.body)));
        if (method === 'DELETE') profile = null;
        if (method === 'POST' && !profile) profile = skipped(true);
        return payload() as T;
    }) as jest.MockedFunction<ApiClient['request']> };
    return { api, log, hooks, get profile() { return profile; }, set profile(p: any) { profile = p; } };
}
const save = (api: ReturnType<typeof server>['api'], answers = A1) => runVibeIntent(api, task(), { kind: 'save', answers });
const reset = (api: ReturnType<typeof server>['api']) => runVibeIntent(api, task(), { kind: 'reset' });
const held = () => JSON.parse(mockDisk.get(SLOT) ?? '{}').held;
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockDisk.clear(); mockOwner = 'A'; generation++; });
afterEach(() => { jest.useRealTimers(); });

test('storeVibe for A is a no-op once B is current and leaves B’s record', async () => {
    mockOwner = 'B'; await storeVibe(chosen(A2), 'B'); const notify = jest.fn(), off = subscribeVibe(notify);
    await storeVibe(chosen(), 'A'); expect(await loadVibe()).toEqual(chosen(A2)); expect(notify).not.toHaveBeenCalled(); off();
});
test('offline A skip is unreadable and never synced for B; a direct account switch also hides completed answers', async () => {
    await storeVibe(skipped(), 'A'); mockOwner = undefined; await clearAllVibes(); mockOwner = 'B'; generation++;
    const s = server(); expect(await loadVibe()).toBeNull(); await runVibeSync(s.api, task()); expect(s.log).toEqual([]);
    mockOwner = 'A'; await storeVibe(chosen(), 'A'); mockOwner = 'B'; expect(await loadVibe()).toBeNull();
});
test('legacy v1 is deleted without migration and signed out writes are ignored', async () => {
    let firstRun!: typeof import('../src/lib/creatorProfileStore');
    jest.isolateModules(() => { firstRun = require('../src/lib/creatorProfileStore'); });
    mockDisk.set('veyrnox.vibe.v1', serializeVibe(chosen())); expect(await firstRun.loadVibe()).toBeNull(); expect(mockDisk.has('veyrnox.vibe.v1')).toBe(false);
    mockOwner = undefined; await storeVibe(chosen(), ''); expect(mockDisk.has(SLOT)).toBe(false);
});
test('load checks ownership after the asynchronous read', async () => {
    await storeVibe(chosen(), 'A'); const gate = deferred<string | null>(); jest.mocked(SecureStore.getItemAsync).mockReturnValueOnce(gate.promise);
    const reading = loadVibe(); await tick(); mockOwner = 'B'; gate.resolve(JSON.stringify({ owner: 'A', value: serializeVibe(chosen()) })); expect(await reading).toBeNull();
});
test('clearAllVibes preserves the current account and clearVibe never clears another owner', async () => {
    await storeVibe(chosen(), 'A'); mockOwner = 'B'; await clearVibe(); expect(mockDisk.has(SLOT)).toBe(true);
    await storeVibe(chosen(A2), 'B'); await clearAllVibes(); expect(await loadVibe()).toEqual(chosen(A2));
    mockOwner = undefined; await clearAllVibes(); expect(mockDisk.has(SLOT)).toBe(false);
});
test.each(['save', 'skip', 'reset'] as const)('%s resolving after an account switch writes nothing for B', async kind => {
    const s = server(), gate = deferred(); s.hooks[kind === 'save' ? 'PUT' : kind === 'skip' ? 'POST' : 'DELETE'] = () => gate.promise;
    const pending = runVibeIntent(s.api, task(), kind === 'save' ? { kind, answers: A1 } : { kind }); await tick();
    mockOwner = 'B'; generation++; await storeVibe(chosen(A2), 'B'); gate.resolve();
    expect(await pending).toEqual({ kind: 'stale-session' }); expect(await loadVibe()).toEqual(chosen(A2));
});
test('account_changed rejection of a dead task is silent, including sync', async () => {
    const s = server(), gate = deferred(); s.hooks.PUT = () => gate.promise;
    const result = save(s.api); await tick(); generation++; gate.reject(new ApiError(401, 'account_changed'));
    expect(await result).toEqual({ kind: 'stale-session' }); expect(await loadVibe()).toBeNull(); expect(s.log).toEqual(['PUT']);
    await storeVibe(chosen(A1, false), 'A'); const gate2 = deferred(); s.hooks.PUT = () => gate2.promise;
    const sync = runVibeSync(s.api, task()); await tick(); generation++; gate2.reject(new ApiError(401, 'account_changed')); await sync;
    expect(await loadVibe()).toEqual(chosen(A1, false));
});
test.each(['none', '404', 'network', 'completed'])('eligibility is server-confirmed: %s', async status => {
    const s = server(status === 'completed' ? chosen() : null);
    if (status === '404' || status === 'network') s.hooks.GET = async () => { throw status === '404' ? new ApiError(404, 'off') : fail(); };
    expect(await vibeOffered(s.api, task())).toBe(status === 'none');
    expect(await loadVibe()).toEqual(status === 'completed' ? chosen() : null);
});
test('Reset during hydration refuses a GET and notifies once', async () => {
    await storeVibe(chosen(), 'A'); const s = server(chosen()), gate = deferred(); s.hooks.DELETE = () => gate.promise;
    const notify = jest.fn(), off = subscribeVibe(notify); const deleting = reset(s.api); await tick();
    expect(await vibeOffered(s.api, task())).toBe(false); gate.resolve(); await deleting;
    expect(await loadVibe()).toBeNull(); expect(s.profile).toBeNull(); expect(s.log).toEqual(['DELETE']); expect(notify).toHaveBeenCalledTimes(1); off();
});
test('hydration GET sent before Reset, answered after, stores nothing', async () => {
    const s = server(chosen()), gate = deferred(); s.hooks.GET = () => gate.promise;
    const hydration = vibeOffered(s.api, task()); await tick(); await reset(s.api); const notify = jest.fn(), off = subscribeVibe(notify);
    gate.resolve(); expect(await hydration).toBe(false); expect(await loadVibe()).toBeNull(); expect(notify).not.toHaveBeenCalled(); off();
});
test('two quick choices send only the newer choice', async () => {
    const s = server(); const one = save(s.api), two = save(s.api, A2);
    expect(await one).toEqual({ kind: 'superseded' }); expect(await two).toEqual({ kind: 'applied', result: 'ok' });
    expect(await loadVibe()).toEqual(chosen(A2)); expect(s.profile).toEqual(chosen(A2)); expect(s.log).toEqual(['PUT']);
});
test('choice then Reset wins on phone and server; queued old sync never sends', async () => {
    await storeVibe(chosen(A1, false), 'A'); const s = server(), gate = deferred(); s.hooks.PUT = () => gate.promise;
    const first = save(s.api, A2); await tick(); const sync = runVibeSync(s.api, task()), deleting = reset(s.api); gate.resolve();
    expect(await first).toEqual({ kind: 'superseded' }); await sync; await deleting;
    expect(await loadVibe()).toBeNull(); expect(s.profile).toBeNull(); expect(s.log).toEqual(['PUT', 'DELETE']);
});
test('a timed-out PUT holds Reset until a reconcile GET observes the ghost write', async () => {
    const s = server(), gate = deferred(); s.hooks.PUT = () => gate.promise;
    const first = save(s.api); await tick(); const deleting = reset(s.api); gate.reject(fail()); await tick();
    expect(s.log).toEqual(['PUT']); s.profile = chosen(); await jest.advanceTimersByTimeAsync(1000);
    expect(await first).toEqual({ kind: 'superseded' }); expect(await deleting).toEqual({ kind: 'applied', result: 'ok' });
    expect(s.log).toEqual(['PUT', 'GET', 'DELETE']); expect(s.profile).toBeNull(); expect(await loadVibe()).toBeNull();
});
test.each([true, false])('timed-out Reset reconciles whether DELETE landed: %s', async landed => {
    await storeVibe(chosen(), 'A'); const s = server(chosen()); s.hooks.DELETE = async () => { if (landed) s.profile = null; throw fail(); };
    const result = reset(s.api); await tick(); await jest.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ kind: 'applied', result: landed ? 'ok' : 'failed' });
    expect(await loadVibe()).toEqual(landed ? null : chosen()); expect(s.profile).toEqual(landed ? null : chosen()); expect(s.log).toEqual(['DELETE', 'GET']);
});
test('reconcile is bounded and an obsolete failure returns superseded', async () => {
    const s = server(); s.hooks.PUT = async () => { throw fail(); }; s.hooks.GET = async () => { throw fail(); };
    const first = save(s.api); await tick(); const next = reset(s.api); await jest.advanceTimersByTimeAsync(7000);
    expect(await first).toEqual({ kind: 'superseded' }); expect(await next).toEqual({ kind: 'applied', result: 'ok' });
    expect(s.log).toEqual(['PUT', 'GET', 'GET', 'GET', 'DELETE']); expect(await loadVibe()).toBeNull(); expect(s.profile).toBeNull();
});
test('old GET after same-account sign-out/sign-in never overwrites new answers', async () => {
    const s = server(chosen()), gate = deferred(); s.hooks.GET = () => gate.promise;
    const old = vibeOffered(s.api, task()); await tick(); generation++; await save(s.api, A2);
    const notify = jest.fn(), off = subscribeVibe(notify); gate.resolve(); expect(await old).toBe(false);
    expect(await loadVibe()).toEqual(chosen(A2)); expect(notify).not.toHaveBeenCalled(); off();
});
test('same-owner generations share tail order and old finally cannot decrement new active count', async () => {
    const s = server(), one = deferred(), two = deferred(); s.hooks.PUT = () => one.promise;
    const first = save(s.api); await tick(); generation++; const second = save(s.api, A2); await tick(); expect(s.log).toEqual(['PUT']);
    s.hooks.PUT = () => two.promise; one.resolve(); expect(await first).toEqual({ kind: 'stale-session' }); await tick();
    await runVibeSync(s.api, task()); expect(s.log).toEqual(['PUT', 'PUT']); two.resolve(); await second;
    expect(await loadVibe()).toEqual(chosen(A2)); expect(s.profile).toEqual(chosen(A2));
});
test('Reset then Home sync never restores the old profile', async () => {
    await storeVibe(chosen(A1, false), 'A'); const s = server(chosen()), gate = deferred(); s.hooks.DELETE = () => gate.promise;
    const deleting = reset(s.api); await tick(); await runVibeSync(s.api, task()); expect(s.log).toEqual(['DELETE']);
    gate.resolve(); await deleting; await runVibeSync(s.api, task()); expect(s.log).toEqual(['DELETE']); expect(s.profile).toBeNull(); expect(await loadVibe()).toBeNull();
});
test('sync before retake drops its synced mark; sync during retake never supersedes it', async () => {
    await storeVibe(chosen(A1, false), 'A'); const s = server(), gate = deferred(); s.hooks.PUT = () => gate.promise;
    const syncing = runVibeSync(s.api, task()); await tick(); const retake = save(s.api, A2); await runVibeSync(s.api, task());
    const notify = jest.fn(), off = subscribeVibe(notify); gate.resolve(); await syncing;
    expect(await retake).toEqual({ kind: 'applied', result: 'ok' }); expect(notify).toHaveBeenCalledTimes(1); off();
    expect(await loadVibe()).toEqual(chosen(A2)); expect(s.profile).toEqual(chosen(A2)); expect(s.log).toEqual(['PUT', 'PUT']);
});
test.each([false, true])('finish then Skip preserves the completed server answers (failed kept GET=%s)', async failedGet => {
    const s = server(), gate = deferred(); s.hooks.PUT = () => gate.promise;
    const first = save(s.api); await tick(); const skip = recordVibeSkip(s.api, task());
    if (failedGet) s.hooks.GET = async () => { throw fail(); };
    gate.resolve(); expect(await first).toEqual({ kind: 'superseded' }); expect(await skip).toEqual({ kind: 'applied', result: 'kept' });
    expect(s.log).toEqual(['PUT', 'POST', 'GET']); expect(await loadVibe()).toEqual(failedGet ? null : chosen());
    if (failedGet) { delete s.hooks.GET; expect(await vibeOffered(s.api, task())).toBe(false); }
    expect(await loadVibe()).toEqual(s.profile);
});
test('Home skip sync takes kept answers and plain skip stores skipped then synced', async () => {
    await storeVibe(skipped(), 'A'); const s = server(chosen()); await runVibeSync(s.api, task());
    expect(await loadVibe()).toEqual(s.profile); expect(s.log).toEqual(['POST', 'GET']);
    await clearVibe(); const empty = server(), gate = deferred(); empty.hooks.POST = () => gate.promise;
    const pending = recordVibeSkip(empty.api, task()); await tick(); expect(await loadVibe()).toEqual(skipped());
    gate.resolve(); await pending; expect(await loadVibe()).toEqual(skipped(true)); expect(empty.log).toEqual(['POST']);
});
test('skip answered an unknown body reconciles to the server state', async () => {
    const s = server(chosen()); s.api.request.mockImplementationOnce(async () => ({} as any));
    const pending = recordVibeSkip(s.api, task()); await tick(); await jest.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ kind: 'applied', result: 'failed' }); expect(await loadVibe()).toEqual(s.profile); expect(s.log).toEqual(['GET']);
});
test('storage-notify background job is refused; idle job runs, and background jobs emit no idle', async () => {
    const s = server(); s.hooks.PUT = async () => { throw new ApiError(404, 'off'); };
    const idle = jest.fn(); const work: Promise<void>[] = [];
    const changeOff = subscribeVibe(() => { work.push(runVibeSync(s.api, task())); });
    const idleOff = subscribeVibeIdle(() => { idle(); work.push(runVibeSync(s.api, task())); });
    await save(s.api); await tick(); await Promise.all(work); changeOff(); idleOff();
    expect(s.log).toEqual(['PUT', 'PUT']); expect(idle).toHaveBeenCalledTimes(1); expect(await loadVibe()).toEqual(chosen(A1, false));
});
test('stale finally emits no idle', async () => {
    const s = server(), gate = deferred(); s.hooks.PUT = () => gate.promise; const idle = jest.fn(), off = subscribeVibeIdle(idle);
    const old = save(s.api); await tick(); generation++; gate.resolve(); await old; expect(idle).not.toHaveBeenCalled(); off();
});
test('hold write failure sends nothing, does not reconcile, and the next queue operation succeeds', async () => {
    await storeVibe(chosen(A1, false), 'A'); jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('disk'));
    const s = server(); expect(await reset(s.api)).toEqual({ kind: 'applied', result: 'failed' }); expect(s.log).toEqual([]);
    await storeVibe(chosen(A2), 'A'); expect(await loadVibe()).toEqual(chosen(A2));
});
test.each(['save', 'reset'] as const)('%s local apply fails: outcome failed; held old answers cannot be uploaded', async kind => {
    await storeVibe(chosen(A1, false), 'A'); const s = server(chosen());
    const failing = kind === 'save' ? SecureStore.setItemAsync : SecureStore.deleteItemAsync;
    const implementation = jest.mocked(failing).getMockImplementation()!;
    s.hooks[kind === 'save' ? 'PUT' : 'DELETE'] = async () => { jest.mocked(failing).mockImplementation(async () => { throw new Error('disk'); }); };
    const idle = jest.fn(), off = subscribeVibeIdle(idle);
    const outcome = await runVibeIntent(s.api, task(), kind === 'save' ? { kind, answers: A2 } : { kind }); await tick();
    expect(outcome).toEqual({ kind: 'applied', result: 'failed' }); expect(held()).toBe(true); expect(idle).toHaveBeenCalledTimes(1); off();
    jest.mocked(failing).mockImplementation(implementation as any); await runVibeSync(s.api, task());
    expect(await loadVibe()).toEqual(kind === 'save' ? chosen(A2) : null); expect(s.profile).toEqual(kind === 'save' ? chosen(A2) : null);
    expect(s.log).toEqual([kind === 'save' ? 'PUT' : 'DELETE']);
});
test('failed skip with no server answer keeps its own unheld intent for the next sync', async () => {
    const s = server(); s.hooks.POST = s.hooks.GET = async () => { throw fail(); };
    const skip = recordVibeSkip(s.api, task()); await tick(); await jest.advanceTimersByTimeAsync(7000);
    expect(await skip).toEqual({ kind: 'applied', result: 'failed' }); expect(await loadVibe()).toEqual(skipped()); expect(held()).not.toBe(true);
    delete s.hooks.POST; delete s.hooks.GET; await runVibeSync(s.api, task()); expect(await loadVibe()).toEqual(s.profile);
});
test('new Reset drops pending A2; readers cannot remove its hold, and a restart recovers from server without PUT', async () => {
    await storeVibe(chosen(A1, false), 'A'); const s = server(chosen()), gate = deferred();
    const original = jest.mocked(SecureStore.setItemAsync).getMockImplementation()!;
    s.hooks.PUT = async () => { jest.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error('disk')); };
    expect(await save(s.api, A2)).toEqual({ kind: 'applied', result: 'failed' }); await tick();
    jest.mocked(SecureStore.setItemAsync).mockImplementation(original); s.hooks.DELETE = () => gate.promise;
    const deleting = reset(s.api); await tick(); expect(await loadVibe()).toEqual(chosen(A1, false)); expect(held()).toBe(true);
    generation++; gate.resolve(); expect(await deleting).toEqual({ kind: 'stale-session' }); await runVibeSync(s.api, task());
    expect(await loadVibe()).toBeNull(); expect(s.profile).toBeNull(); expect(s.log).toEqual(['PUT', 'DELETE', 'GET']);
});

function bodyClient(stallGet = false) {
    const body = deferred<any>(), signals: AbortSignal[] = [], log: string[] = [];
    const fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
        const method = init?.method ?? 'GET'; log.push(method); signals.push(init!.signal!);
        return { ok: true, status: 200, headers: new Headers(), json: () => method === 'PUT' || (stallGet && method === 'GET') ? body.promise : Promise.resolve(method === 'GET' ? { status: 'completed', answers: A1 } : {}) } as Response;
    });
    globalThis.fetch = fetch;
    const api = createApiClient({ baseUrl: 'https://example.test', getAccessToken: async () => `h.${btoa(JSON.stringify({ sub: 'A' }))}.s`, onSessionLost: jest.fn() });
    return { api, body, signals, log };
}
test('headers arrive but PUT body stalls: whole-request deadline reconciles and releases queued Reset; late body is inert', async () => {
    const s = bodyClient(); const pending = runVibeIntent(s.api, task(), { kind: 'save', answers: A1 }); await tick(); const next = runVibeIntent(s.api, task(), { kind: 'reset' });
    await jest.advanceTimersByTimeAsync(VIBE_REQUEST_DEADLINE_MS); expect(s.signals[0].aborted).toBe(true); expect(s.log).toEqual(['PUT']);
    await jest.advanceTimersByTimeAsync(1000); expect(await pending).toEqual({ kind: 'superseded' }); await next;
    expect(s.log).toEqual(['PUT', 'GET', 'DELETE']); const notify = jest.fn(), off = subscribeVibe(notify);
    s.body.resolve({ status: 'completed', answers: A1 }); await tick(); expect(await loadVibe()).toBeNull(); expect(notify).not.toHaveBeenCalled(); off();
});
test('stalled reconcile bodies each consume one bounded attempt, then next intent runs', async () => {
    const s = bodyClient(true); const pending = runVibeIntent(s.api, task(), { kind: 'save', answers: A1 }); await tick();
    await jest.advanceTimersByTimeAsync(4 * VIBE_REQUEST_DEADLINE_MS + 7000);
    expect(await pending).toEqual({ kind: 'applied', result: 'failed' }); expect(s.log).toEqual(['PUT', 'GET', 'GET', 'GET']);
    await runVibeIntent(s.api, task(), { kind: 'reset' }); expect(s.log.at(-1)).toBe('DELETE'); expect(await loadVibe()).toBeNull();
});
test('hydration with a stalled body resolves false at the deadline', async () => {
    const s = bodyClient(true); const pending = vibeOffered(s.api, task()); await tick(); await jest.advanceTimersByTimeAsync(VIBE_REQUEST_DEADLINE_MS);
    expect(await pending).toBe(false); expect(s.signals[0].aborted).toBe(true); expect(await loadVibe()).toBeNull();
});

test('Skip kept with a failed local apply holds its own skip so recovery cannot upload it', async () => {
    const s = server(chosen());
    const original = jest.mocked(SecureStore.setItemAsync).getMockImplementation()!;
    s.hooks.GET = async () => { jest.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error('disk')); };
    expect(await recordVibeSkip(s.api, task())).toEqual({ kind: 'applied', result: 'failed' }); await tick();
    expect(held()).toBe(true); expect(await loadVibe()).toEqual(skipped());
    generation++; delete s.hooks.GET; jest.mocked(SecureStore.setItemAsync).mockImplementation(original);
    await runVibeSync(s.api, task()); expect(s.log).toEqual(['POST', 'GET', 'GET']); expect(await loadVibe()).toEqual(s.profile);
});

test('a step that throws ends failed and the next step on the tail runs', async () => {
    const s = server();
    const creatorProfile = jest.requireMock<typeof import('../src/lib/creatorProfile')>('../src/lib/creatorProfile');
    const throwingSave = jest.spyOn(creatorProfile, 'saveVibe').mockImplementationOnce(() => { throw new Error('unexpected step failure'); });
    try {
        expect(await save(s.api)).toEqual({ kind: 'applied', result: 'failed' });
        expect(await loadVibe()).toBeNull(); expect(s.profile).toBeNull(); expect(s.log).toEqual([]);
        expect(await save(s.api, A2)).toEqual({ kind: 'applied', result: 'ok' });
        expect(await loadVibe()).toEqual(chosen(A2)); expect(s.profile).toEqual(chosen(A2)); expect(s.log).toEqual(['PUT']);
        expect(throwingSave).toHaveBeenLastCalledWith(expect.objectContaining({ request: expect.any(Function) }), A2);
    } finally { throwingSave.mockRestore(); }
});
test('a rejected serial op does not reject the next op or pass it the error', async () => {
    const failure = new Error('first write failed');
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(failure);
    const first = storeVibe(chosen(A1), 'A');
    const firstResult = expect(first).rejects.toBe(failure);
    const second = storeVibe(chosen(A2), 'A');
    await firstResult; await expect(second).resolves.toBeUndefined();
    expect(SecureStore.setItemAsync).toHaveBeenNthCalledWith(2, SLOT, JSON.stringify({ owner: 'A', value: serializeVibe(chosen(A2)) }));
    expect(await loadVibe()).toEqual(chosen(A2));
});
test('legacy deletion retries a failed attempt, then runs only once across queued loads', async () => {
    let firstRun!: typeof import('../src/lib/creatorProfileStore');
    jest.isolateModules(() => { firstRun = require('../src/lib/creatorProfileStore'); });
    mockDisk.set('veyrnox.vibe.v1', serializeVibe(chosen()));
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('locked'));
    expect(await firstRun.loadVibe()).toBeNull(); expect(mockDisk.has('veyrnox.vibe.v1')).toBe(true);
    expect(await Promise.all([firstRun.loadVibe(), firstRun.loadVibe(), firstRun.loadVibe()])).toEqual([null, null, null]);
    expect(mockDisk.has('veyrnox.vibe.v1')).toBe(false); expect(mockDisk.has(SLOT)).toBe(false);
    expect(jest.mocked(SecureStore.deleteItemAsync).mock.calls).toEqual([['veyrnox.vibe.v1'], ['veyrnox.vibe.v1']]);
});
