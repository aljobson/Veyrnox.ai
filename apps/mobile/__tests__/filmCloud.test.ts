import { t } from '../src/lib/i18n';
import { cloudSaveError, commitUnlink, getActiveCloudLink, prepareKeepOnPhone, removeCloudFilm, restorePhoneSlot, SAVE_SETTLE_MS, clearOpenedFilm, CLOUD_FILMS_PATH, cloudFilmPath, cloudStatus, fetchCloudFilm, fetchCloudFilms, getOpenedFilm, loadActiveStudio, openCloudFilm, parseCloudFilms, replaceActiveStudio, saveActiveStudioToCloud } from '../src/lib/filmCloud';
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { POLICIES, createCache, createMemoryStorage } from '../src/lib/cache';
import { loadStudio, saveStudio } from '../src/lib/filmStudioStore';
import { isLocked, promptContext, shotRow } from '../src/lib/filmStudio';
declare const __dirname: string;
const { readFileSync } = require('fs');
const { resolve } = require('path');
const source = readFileSync(resolve(__dirname, '../../../app/veyrnox/_lib/filmStudio.js'), 'utf8').replace(/^export /gm, '');
const web = new Function(`${source}\nreturn { emptyFilm, lockAsset, promptContext, testMatrix, STYLE_BOARDS };`)();
const SHOT: Record<string, any> = {
    id: 'S1', location: '@room:v1', time: 'dusk', characters: '@hero:v1', props: 'none', description: 'She opens the door.', dialogue: 'none', seconds: '10', complexity: 'low',
    goal: 'Show arrival', action: 'opens', dramaturgy: 'tension', blocking: 'door left', acting: 'calm', style: 'soft', size: 'medium', movement: 'static', lens: '35mm', angle: 'eye level', cut: 'hard', pace: 'slow', transition: 'cut', oneAction: true,
};
const refs = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ source: `${prefix}-${i}`, caption: `caption ${i}`, kind: 'reference' }));
const board = (name: string, type: string, n: number) => ({ id: `b-${name}`, name, type, decision: 'approved', references: refs(n, name) });

function baseFilm(): any {
    const film = web.emptyFilm();
    return {
        ...film,
        name: 'Test film',
        script: 'A short film.',
        stack: { image: 'Image Model', video: 'Test Video', imageAccess: 'Studio', videoAccess: 'Studio', seconds: '10', aspect: '16:9' },
        shots: [SHOT],
        boards: [board('@room:v1', 'location', 8), board('@hero:v1', 'character', 10), ...web.STYLE_BOARDS.map((n: string) => board(n, 'style', 1))],
        assets: [
            { tag: '@room', version: 1, type: 'location', descriptor: 'A small room with a green door.', references: ['room-1.png'], tests: {} },
            { tag: '@hero', version: 1, type: 'character', descriptor: 'A tall woman in a grey coat.', references: ['hero-1.png'], tests: {} },
        ],
    };
}

const id = '11111111-1111-4111-8111-111111111111';
const row = (over = {}) => ({ id, name: ' A ', shot_count: 4, revision: 1, updated_at: '2026-10-21T12:00:00Z', ...over });
const raw = (name = 'A') => JSON.stringify({ ...web.emptyFilm(), name });
const response = (name = 'A') => ({ project: row(), studio_json: raw(name) });
const api = (value: unknown) => ({ request: jest.fn().mockResolvedValue(value) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(async () => { resetCacheUser(); await bindCacheUser('alice'); });
afterEach(() => resetCacheUser());

test.each([null, [], { projects: 'x' }])('malformed list %p is empty', body => expect(parseCloudFilms(body)).toEqual([]));
test('validates ids and revision, defaults fields without clamping and preserves order up to 20', () => {
    const rows = parseCloudFilms({ projects: [null, {}, row({ id: 'bad' }), row({ revision: 0 }), row({ revision: 1.5 }),
        row({ name: ' ', shot_count: 201, updated_at: 'bad' }), row({ name: 9, shot_count: -1 }), row({ name: 'x'.repeat(130), shot_count: 1.5 }), row({ shot_count: 200 })] });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ id, name: 'Untitled film', shotCount: 0, revision: 1, updatedAt: null });
    expect(rows.map(r => r.shotCount)).toEqual([0, 0, 0, 200]);
    expect(rows[1].name).toBe('Untitled film'); expect(rows[2].name).toHaveLength(120);
    const many = Array.from({ length: 25 }, (_, i) => row({ name: `${i}`, revision: i + 1 }));
    expect(parseCloudFilms({ projects: many }).map(r => r.name)).toEqual(many.slice(0, 20).map(r => r.name));
});
test('requests the exact GET paths and parses the list', async () => {
    expect(cloudFilmPath('a/b?')).toBe(`${CLOUD_FILMS_PATH}/a%2Fb%3F`);
    const client = api({ projects: [row()] });
    expect(await fetchCloudFilms(client)).toEqual(parseCloudFilms({ projects: [row()] }));
    expect(client.request).toHaveBeenCalledWith(CLOUD_FILMS_PATH);
});
test('a native studio saves as new, then updates the linked account copy with its revision', async () => {
    const request = jest.fn()
        .mockResolvedValueOnce({ project: row() })
        .mockResolvedValueOnce({ project: row({ revision: 2 }) });
    const film = baseFilm();
    await replaceActiveStudio(film);
    await saveActiveStudioToCloud({ request }, film, '11111111-1111-4111-8111-111111111111');
    const [, first] = request.mock.calls[0] as [string, RequestInit];
    expect(request.mock.calls[0][0]).toBe(CLOUD_FILMS_PATH);
    expect(first.method).toBe('POST');
    expect((first.headers as Record<string, string>)['Idempotency-Key']).toBe('11111111-1111-4111-8111-111111111111');
    await saveActiveStudioToCloud({ request }, { ...film, name: 'Changed' }, '22222222-2222-4222-8222-222222222222');
    expect(request.mock.calls[1][0]).toBe(cloudFilmPath(id));
    expect(JSON.parse(String((request.mock.calls[1][1] as RequestInit).body))).toMatchObject({ expected_revision: 1, studio_json: expect.any(String) });
    expect(getOpenedFilm()?.cloud).toEqual({ id, revision: 2 });
    expect(getOpenedFilm()?.film.name).toBe('Changed');
});
test.each([{ project: row({ id: '22222222-2222-4222-8222-222222222222' }), studio_json: raw() },
    { project: row(), studio_json: {} }, { project: row(), studio_json: '{}' }])('rejects invalid detail %p', async body => {
    const client = api(body); expect(await fetchCloudFilm(client, id)).toBeNull();
    expect(await openCloudFilm(client, id)).toEqual({ ok: false, reason: 'invalid' });
});
test.each([[0, 'offline'], [401, 'unavailable'], [403, 'unavailable'], [404, 'gone'], [429, 'busy'], [502, 'busy'], [503, 'busy'], [500, 'error'], [400, 'error']])('status %s maps to %s', (status, expected) => {
    expect(cloudStatus({ status })).toBe(expected);
});
test('unknown errors are neutral', () => { for (const error of [null, new Error('secret'), 'bad', undefined]) expect(cloudStatus(error)).toBe('error'); });
test('no account means no request', async () => {
    resetCacheUser(); const client = api(response());
    expect(await openCloudFilm(client, id)).toEqual({ ok: false, reason: 'unavailable' }); expect(client.request).not.toHaveBeenCalled();
});
test('lock and prompt text round-trip with exact original bytes and no cache writes', async () => {
    let film = baseFilm();
    film.assets = film.assets.map((asset: any) => ({ ...asset, tests: Object.fromEntries(web.testMatrix(film, asset).map((r: any, i: number) => [r.id, { result: `output-${asset.tag}-${i}`, verdict: 'pass' }])) }));
    for (const asset of film.assets) film = web.lockAsset(film, `${asset.tag}:v${asset.version}`);
    film.prompts = [{ shot: 'S1', version: 1, content: 'Prompt with\n  spacing and é', context: web.promptContext(film, film.shots[0]), at: '2026-10-21' }];
    const text = JSON.stringify({ name: film.name, schema: film.schema, ...film }, null, 2);
    const storage = createMemoryStorage(); const set = jest.spyOn(storage, 'set'); const cache = createCache(storage);
    expect(await openCloudFilm(api({ project: row(), studio_json: text }), id, cache)).toMatchObject({ ok: true, film });
    expect(set).not.toHaveBeenCalled(); expect(await loadStudio(cache, 'alice')).toBeNull();
    const active = getOpenedFilm()!;
    expect(active.raw).toBe(text); expect((await loadActiveStudio(cache))?.film).toEqual(film);
    expect(isLocked(active.film, active.film.assets[0])).toBe(true);
    expect(promptContext(active.film, active.film.shots[0])).toBe(film.prompts[0].context);
    expect(shotRow(active.film, active.film.shots[0]).state).toBe('prompt-ready');
});
test.each(['bob', 'alice'])('old response cannot replace the new session’s film (%s)', async user => {
    const pending = deferred<unknown>(); const client = { request: jest.fn().mockReturnValue(pending.promise) };
    const storage = createMemoryStorage(), cache = createCache(storage);
    const opening = openCloudFilm(client, id, cache);
    await wipeCache(); await bindCacheUser(user);
    expect(getOpenedFilm()).toBeNull(); expect(await loadActiveStudio(cache)).toBeNull();
    await openCloudFilm(api(response('B')), id, cache);
    pending.resolve(response('A'));
    expect(await opening).toEqual({ ok: false, reason: 'switched' });
    expect(getOpenedFilm()?.film.name).toBe('B');
    expect(await loadStudio(cache, 'alice')).toBeNull(); expect(await loadStudio(cache, 'bob')).toBeNull();
});
test('wipe and a different account clear an already opened film', async () => {
    await openCloudFilm(api(response()), id); await wipeCache(); expect(getOpenedFilm()).toBeNull();
    await bindCacheUser('alice'); await openCloudFilm(api(response()), id); await bindCacheUser('bob');
    expect(getOpenedFilm()).toBeNull(); expect(await loadActiveStudio()).toBeNull();
});
test('an import write completing after a wipe cannot resurrect or alter the memory slot', async () => {
    const wait = deferred<void>(); const storage = createMemoryStorage(); const set = storage.set;
    storage.set = async (key, value) => { await wait.promise; await set(key, value); };
    const importing = saveStudio(raw('Imported'), createCache(storage), 'alice');
    await openCloudFilm(api(response()), id); await wipeCache(); await bindCacheUser('bob');
    await openCloudFilm(api(response('Bob')), id); wait.resolve(); await importing;
    expect(getOpenedFilm()?.film.name).toBe('Bob');
});
test('aborted screen operation cannot populate the slot', async () => {
    const pending = deferred<unknown>(), controller = new AbortController();
    const result = openCloudFilm({ request: jest.fn().mockReturnValue(pending.promise) }, id, undefined, controller.signal);
    controller.abort(); pending.resolve(response());
    expect(await result).toEqual({ ok: false, reason: 'switched' }); expect(getOpenedFilm()).toBeNull();
});

test('a swallowed storage failure fails saveStudio and rejects replaceActiveStudio with the translated message', async () => {
    const storage = createMemoryStorage(); storage.set = jest.fn().mockRejectedValue(new Error('disk full'));
    const cache = createCache(storage);
    expect(await saveStudio(raw(), cache, 'alice')).toEqual({ ok: false, error: t('filmWorkspace.saveFailed') });
    await expect(replaceActiveStudio(baseFilm(), cache)).rejects.toThrow(t('filmWorkspace.saveFailed'));
});
test.each(['clear', 'account', 'open'])('a late cloud save after %s cannot repopulate the old film', async action => {
    const pending = deferred<unknown>();
    const saving = saveActiveStudioToCloud({ request: jest.fn().mockReturnValue(pending.promise) }, baseFilm(), 'first');
    if (action === 'clear') clearOpenedFilm();
    if (action === 'account') { await wipeCache(); await bindCacheUser('alice'); }
    if (action === 'open') await openCloudFilm(api(response('Other')), id);
    pending.resolve({ project: row() }); await saving;
    if (action === 'open') expect(getOpenedFilm()?.film.name).toBe('Other');
    else expect(getOpenedFilm()).toBeNull();
});
test('cloud completion keeps newer local text while advancing the cloud revision', async () => {
    const pending = deferred<unknown>(); const film = baseFilm();
    const saving = saveActiveStudioToCloud({ request: jest.fn().mockReturnValue(pending.promise) }, film, 'first');
    await replaceActiveStudio({ ...film, name: 'Newer' });
    pending.resolve({ project: row({ revision: 3 }) }); await saving;
    expect(getOpenedFilm()).toMatchObject({ film: { name: 'Newer' }, raw: JSON.stringify({ ...film, name: 'Newer' }), cloud: { id, revision: 3 } });
});
test('module serialization makes a second pending save a PUT through the first POST link', async () => {
    const pending = deferred<unknown>();
    const request = jest.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ project: row({ revision: 2 }) });
    const first = saveActiveStudioToCloud({ request }, baseFilm(), 'first');
    const second = saveActiveStudioToCloud({ request }, { ...baseFilm(), name: 'Second' }, 'second');
    expect(request).toHaveBeenCalledTimes(1);
    pending.resolve({ project: row() }); await first; await second;
    expect(request.mock.calls.map(c => c[1].method)).toEqual(['POST', 'PUT']);
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ expected_revision: 1, studio_json: JSON.stringify({ ...baseFilm(), name: 'Second' }) });
    expect(getOpenedFilm()?.film.name).toBe('Second');
});
test('a retry of identical text keeps its original idempotency key', async () => {
    const request = jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ project: row() });
    await expect(saveActiveStudioToCloud({ request }, baseFilm(), 'original')).rejects.toThrow('network');
    await saveActiveStudioToCloud({ request }, baseFilm(), 'new-key');
    expect(request.mock.calls.map(c => c[1].headers['Idempotency-Key'])).toEqual(['original', 'original']);
});
test('identical concurrent saves share the first result', async () => {
    const pending = deferred<unknown>(); const request = jest.fn().mockReturnValue(pending.promise);
    const first = saveActiveStudioToCloud({ request }, baseFilm(), 'first');
    const second = saveActiveStudioToCloud({ request }, baseFilm(), 'second');
    pending.resolve({ project: row() }); expect(await first).toEqual(await second); expect(request).toHaveBeenCalledTimes(1);
});

test('an unsuccessful open preserves the previously opened film', async () => {
    await openCloudFilm(api(response('Kept')), id);
    expect(await openCloudFilm(api({}), id)).toEqual({ ok: false, reason: 'invalid' });
    expect(getOpenedFilm()?.film.name).toBe('Kept');
});

const secondId = '22222222-2222-4222-8222-222222222222';
const failure = (status: number, code?: string, retryAfterSeconds?: number) => ({ status, body: { error: { code } }, retryAfterSeconds });
const cloudRow = () => parseCloudFilms({ projects: [row()] })[0];
const open = async (revision = 1) => openCloudFilm(api({ ...response('B'), project: row({ revision }) }), id);
const preparedCopy = async (cache = createCache(createMemoryStorage())) => {
    const p = await prepareKeepOnPhone('alice', undefined, cache);
    if (p.kind !== 'kept' && p.kind !== 'memoryOnly') throw new Error(p.kind);
    return p;
};
test.each([[409, undefined, undefined, 'conflict'], [429, 'LIMIT_REACHED', undefined, 'limit'], [429, 'RATE_LIMITED', 12, 'rateLimited'], [429, undefined, undefined, 'rateLimited'], [0, undefined, undefined, 'offline'], [503, undefined, undefined, 'unavailable']])('save error %p/%p is classified', async (status, code, seconds, kind) => {
    expect(await cloudSaveError(failure(status as number, code as string, seconds as number))).toEqual({ kind, ...(kind === 'rateLimited' ? { seconds: seconds ?? 60 } : {}) });
});
test('PUT 404 needs a successful list proving absence', async () => {
    expect(await cloudSaveError(failure(404), api({ projects: [] }), id)).toEqual({ kind: 'removedElsewhere' });
    expect(await cloudSaveError(failure(404), api({ projects: [row()] }), id)).toEqual({ kind: 'unavailable' });
    expect(await cloudSaveError(failure(404), { request: jest.fn().mockRejectedValue(failure(0)) }, id)).toEqual({ kind: 'unavailable' });
    expect(await cloudSaveError(failure(404))).toEqual({ kind: 'unavailable' });
});
test.each([{ removed: true }, { removed: true, idempotent: true }])('DELETE %p confirms removal but only commitUnlink unlinks', async body => {
    await open(); const cache = createCache(createMemoryStorage()), p = await preparedCopy(cache);
    const client = api(body); expect(await removeCloudFilm(client, cloudRow())).toBe('removed');
    expect(JSON.parse(client.request.mock.calls[0][1].body)).toEqual({ expected_revision: 1 });
    expect(getActiveCloudLink()).toEqual({ id, revision: 1 });
    await commitUnlink(id, p); clearOpenedFilm(); expect((await loadActiveStudio(cache))?.film.name).toBe('B');
});
test.each([[404, 'unavailable'], [503, 'unavailable'], [409, 'changed']])('failed DELETE %p preserves link and restores A after Replace', async (status, reason) => {
    const cache = createCache(createMemoryStorage()); await saveStudio(raw('A'), cache, 'alice'); await open();
    expect(await prepareKeepOnPhone('alice', undefined, cache)).toEqual({ kind: 'localConflict', localName: 'A' });
    const p = await prepareKeepOnPhone('alice', 'replace', cache);
    if (p.kind !== 'kept') throw Error(p.kind);
    expect((await loadStudio(cache, 'alice'))?.film.name).toBe('B');
    expect(await removeCloudFilm({ request: jest.fn().mockRejectedValue(failure(status as number)) }, cloudRow())).toBe(reason);
    expect(await restorePhoneSlot(p)).toBe(true); expect((await loadStudio(cache, 'alice'))?.film.name).toBe('A');
    expect(getActiveCloudLink()).toEqual({ id, revision: 1 }); expect(getOpenedFilm()?.film.name).toBe('B');
});
test('unreadable slot is never overwritten, including removed elsewhere recovery', async () => {
    await open(); const storage = createMemoryStorage(); storage.get = jest.fn().mockRejectedValue(Error('unreadable')); storage.set = jest.fn();
    const client = api({ projects: [] }); expect(await cloudSaveError(failure(404), client, id)).toEqual({ kind: 'removedElsewhere' });
    expect(await prepareKeepOnPhone('alice', undefined, createCache(storage))).toEqual({ kind: 'unreadable' });
    expect(storage.set).not.toHaveBeenCalled(); expect(client.request).toHaveBeenCalledTimes(1); expect(getActiveCloudLink()).toEqual({ id, revision: 1 });
});
test('readChecked leaves an expired entry stored and marks it present', async () => {
    const storage = createMemoryStorage(), cache = createCache(storage, () => 0); await cache.write(POLICIES.filmStudio, raw('A'), 'alice');
    const keys = await storage.keys(); const expired = createCache(storage, () => POLICIES.filmStudio.maxAgeMs + 1);
    expect(await expired.readChecked!(POLICIES.filmStudio, 'alice')).toEqual({ state: 'present', value: null }); expect(await storage.keys()).toEqual(keys);
});
test('Keep preserves local A and keeps B in memory only after confirmed unlink', async () => {
    const cache = createCache(createMemoryStorage()); await saveStudio(raw('A'), cache, 'alice'); await open();
    const p = await prepareKeepOnPhone('alice', 'keep', cache); if (p.kind !== 'memoryOnly') throw Error(p.kind);
    expect(getActiveCloudLink()).toEqual({ id, revision: 1 });
    await commitUnlink(id, p); await replaceActiveStudio({ ...getOpenedFilm()!.film, name: 'Edited B' }, cache);
    expect((await loadActiveStudio(cache))?.film.name).toBe('Edited B');
    clearOpenedFilm(); expect((await loadActiveStudio(cache))?.film.name).toBe('A');
});
test('failed local persistence keeps the exact open link', async () => {
    await open(); const storage = createMemoryStorage(); storage.set = jest.fn().mockRejectedValue(Error('full'));
    expect(await prepareKeepOnPhone('alice', undefined, createCache(storage))).toEqual({ kind: 'notKept' }); expect(getActiveCloudLink()).toEqual({ id, revision: 1 });
});
test('edit during held persistence is written a second time and survives restart', async () => {
    await open(); const held = deferred<void>(), started = deferred<void>(), storage = createMemoryStorage(), set = storage.set;
    storage.set = jest.fn().mockImplementationOnce(async (key, value) => { started.resolve(); await held.promise; return set(key, value); }).mockImplementation(set);
    const cache = createCache(storage), preparing = prepareKeepOnPhone('alice', undefined, cache);
    await started.promise;
    await replaceActiveStudio({ ...getOpenedFilm()!.film, name: 'Edited' }, cache); held.resolve();
    const p = await preparing; if (p.kind !== 'kept') throw Error(p.kind);
    expect(storage.set).toHaveBeenCalledTimes(2); await commitUnlink(id, p); clearOpenedFilm(); expect((await loadActiveStudio(cache))?.film.name).toBe('Edited');
});
test('delayed revision 2 reply is adopted even after list fetch shows revision 2', async () => {
    await open(); const held = deferred<unknown>(); const saving = saveActiveStudioToCloud({ request: jest.fn().mockReturnValue(held.promise) }, getOpenedFilm()!.film, 'k');
    await fetchCloudFilms(api({ projects: [row({ revision: 2 })] })); held.resolve({ project: row({ revision: 2 }) }); await saving;
    expect(getActiveCloudLink()).toEqual({ id, revision: 2 });
});
test.each([{ revision: 1 }, { revision: 3 }, { id: secondId, revision: 2 }])('stale or foreign reply %p is ignored', async reply => {
    await open(); await saveActiveStudioToCloud(api({ project: row(reply) }), getOpenedFilm()!.film, 'k'); expect(getActiveCloudLink()).toEqual({ id, revision: 1 });
});
test('held reply cannot reinstall link after confirmed DELETE and unlink', async () => {
    await open(); const p = await preparedCopy(), deletion = deferred<unknown>(), reply = deferred<unknown>();
    const removing = removeCloudFilm({ request: jest.fn().mockReturnValue(deletion.promise) }, cloudRow());
    const saving = saveActiveStudioToCloud({ request: jest.fn().mockReturnValue(reply.promise) }, getOpenedFilm()!.film, 'k');
    deletion.resolve({ removed: true }); expect(await removing).toBe('removed'); await commitUnlink(id, p);
    reply.resolve({ project: row({ revision: 2 }) }); await saving; expect(getActiveCloudLink()).toBeNull(); expect(getOpenedFilm()).toBeNull();
});
test.each([false, true])('removal replays unconfirmed PUT with original key; conflict=%p', async conflict => {
    await open(); const request = jest.fn().mockRejectedValueOnce(failure(0)).mockRejectedValueOnce(failure(0));
    await expect(saveActiveStudioToCloud({ request }, getOpenedFilm()!.film, 'same-key')).rejects.toMatchObject({ status: 0 });
    if (conflict) request.mockRejectedValueOnce(failure(409)); else request.mockResolvedValueOnce({ project: row({ revision: 2 }) }).mockResolvedValueOnce({ removed: true });
    expect(await removeCloudFilm({ request }, cloudRow())).toBe(conflict ? 'changed' : 'removed');
    expect(request.mock.calls.slice(0, 3).map(c => c[1].headers['Idempotency-Key'])).toEqual(['same-key', 'same-key', 'same-key']);
    if (conflict) expect(request).toHaveBeenCalledTimes(3); else expect(JSON.parse(request.mock.calls[3][1].body)).toEqual({ expected_revision: 2 });
});
test('removal waits SAVE_SETTLE_MS then returns busy without DELETE', async () => {
    jest.useFakeTimers(); await open(); const held = deferred<unknown>(), request = jest.fn().mockReturnValue(held.promise);
    const saving = saveActiveStudioToCloud({ request }, getOpenedFilm()!.film, 'k'); const removing = removeCloudFilm({ request }, cloudRow());
    await jest.advanceTimersByTimeAsync(SAVE_SETTLE_MS); expect(await removing).toBe('busy'); expect(request).toHaveBeenCalledTimes(1);
    held.resolve({ project: row({ revision: 2 }) }); await saving; jest.useRealTimers();
});
test('Save as a new film POST retains origin until adoption; queued save PUTs new id', async () => {
    await open(3); const held = deferred<unknown>(), request = jest.fn().mockReturnValueOnce(held.promise).mockResolvedValueOnce({ project: row({ id: secondId, revision: 2 }) });
    const film = getOpenedFilm()!.film, saving = saveActiveStudioToCloud({ request }, film, 'new', { asNew: true });
    const queued = saveActiveStudioToCloud({ request }, { ...film, name: 'Next' }, 'next');
    expect(getActiveCloudLink()).toEqual({ id, revision: 3 }); expect(request.mock.calls[0][1].method).toBe('POST'); expect(JSON.parse(request.mock.calls[0][1].body)).not.toHaveProperty('expected_revision');
    held.resolve({ project: row({ id: secondId }) }); await saving; await queued;
    expect(request.mock.calls[1][0]).toBe(cloudFilmPath(secondId)); expect(JSON.parse(request.mock.calls[1][1].body).expected_revision).toBe(1);
    expect(getActiveCloudLink()).toEqual({ id: secondId, revision: 2 });
});
test.each([503, 0])('failed asNew status %p retains origin and retry key, and is not replayed by removal', async status => {
    await open(3); const film = getOpenedFilm()!.film, request = jest.fn().mockRejectedValue(failure(status));
    await expect(saveActiveStudioToCloud({ request }, film, 'original-key', { asNew: true })).rejects.toMatchObject({ status });
    await expect(saveActiveStudioToCloud({ request }, film, 'second-key', { asNew: true })).rejects.toMatchObject({ status });
    expect(request.mock.calls.map(c => c[1].headers['Idempotency-Key'])).toEqual(Array(4).fill('original-key'));
    expect(getActiveCloudLink()).toEqual({ id, revision: 3 });
    const next = api({ project: row({ revision: 4 }) }); await saveActiveStudioToCloud(next, film, 'ordinary'); expect(next.request.mock.calls[0][0]).toBe(cloudFilmPath(id));
    const deletion = api({ removed: true }); await removeCloudFilm(deletion, cloudRow()); expect(deletion.request.mock.calls[0][1].method).toBe('DELETE');
});
test.each(['open', 'unlink'])('held asNew reply is ignored after %s', async action => {
    await open(3); const p = await preparedCopy(), held = deferred<unknown>();
    const saving = saveActiveStudioToCloud({ request: jest.fn().mockReturnValue(held.promise) }, getOpenedFilm()!.film, 'k', { asNew: true });
    if (action === 'open') await open(4); else await commitUnlink(id, p);
    held.resolve({ project: row({ id: secondId }) }); await saving;
    expect(getActiveCloudLink()).toEqual(action === 'open' ? { id, revision: 4 } : null);
});


test('oversized UTF-8 text is rejected before sending', async () => {
    const client = api({});
    await expect(saveActiveStudioToCloud(client, { ...web.emptyFilm(), script: '界'.repeat(340000) }, 'too-big')).rejects.toMatchObject({ code: 'tooLarge' });
    expect(client.request).not.toHaveBeenCalled(); expect(await cloudSaveError({ code: 'tooLarge' })).toEqual({ kind: 'tooLarge' });
});
test('legacy caches without readChecked cannot authorize a local overwrite', async () => {
    await open(); const cache = createCache(createMemoryStorage()); const { readChecked: _checked, ...legacy } = cache;
    expect(await prepareKeepOnPhone('alice', undefined, legacy)).toEqual({ kind: 'unreadable' });
});
test('a PUT conflict can be saved as new and the next save uses the new revision', async () => {
    await open(3); const film = getOpenedFilm()!.film;
    await expect(saveActiveStudioToCloud({ request: jest.fn().mockRejectedValue(failure(409)) }, film, 'put')).rejects.toMatchObject({ status: 409 });
    const request = jest.fn().mockResolvedValueOnce({ project: row({ id: secondId }) }).mockResolvedValueOnce({ project: row({ id: secondId, revision: 2 }) });
    await saveActiveStudioToCloud({ request }, film, 'post', { asNew: true });
    expect(getActiveCloudLink()).toEqual({ id: secondId, revision: 1 });
    await saveActiveStudioToCloud({ request }, { ...film, name: 'Edited' }, 'put-new');
    expect(request.mock.calls[0][0]).toBe(CLOUD_FILMS_PATH); expect(request.mock.calls[1][0]).toBe(cloudFilmPath(secondId));
    expect(JSON.parse(request.mock.calls[1][1].body).expected_revision).toBe(1);
});

test('Replace rollback survives a same-owner generation change but never writes for another owner', async () => {
    const cache = createCache(createMemoryStorage()); await saveStudio(raw('A'), cache, 'alice'); await open();
    const p = await prepareKeepOnPhone('alice', 'replace', cache); if (p.kind !== 'kept') throw Error(p.kind);
    await open(2); expect(await restorePhoneSlot(p)).toBe(true);
    expect((await loadStudio(cache, 'alice'))?.film.name).toBe('A');
    expect(getActiveCloudLink()).toEqual({ id, revision: 2 });
    await saveStudio(raw('B'), cache, 'alice'); await bindCacheUser('bob');
    const write = jest.spyOn(cache, 'write'); await restorePhoneSlot(p);
    expect(write).not.toHaveBeenCalled();
});
test('generation change during Replace persistence restores A before reporting notKept', async () => {
    const cache = createCache(createMemoryStorage()); await saveStudio(raw('A'), cache, 'alice'); await open();
    const held = deferred<void>(), started = deferred<void>(), write = cache.write.bind(cache);
    jest.spyOn(cache, 'write').mockImplementationOnce(async (...args) => { await write(...args); started.resolve(); await held.promise; });
    const preparing = prepareKeepOnPhone('alice', 'replace', cache); await started.promise;
    await open(2); held.resolve(); expect(await preparing).toEqual({ kind: 'notKept' });
    expect((await loadStudio(cache, 'alice'))?.film.name).toBe('A');
    expect(getActiveCloudLink()).toEqual({ id, revision: 2 });
});
test('confirmed unlink detaches before a late generation change during the final write', async () => {
    const cache = createCache(createMemoryStorage()); await open(); const p = await preparedCopy(cache);
    await replaceActiveStudio({ ...getOpenedFilm()!.film, name: 'Edited' }, cache);
    const held = deferred<void>(), started = deferred<void>(), write = cache.write.bind(cache);
    jest.spyOn(cache, 'write').mockImplementationOnce(async (...args) => { started.resolve(); await held.promise; await write(...args); });
    const unlinking = commitUnlink(id, p); await started.promise;
    expect(getActiveCloudLink()).toBeNull();
    // A failed account open bumps generation while retaining the current in-memory film.
    await openCloudFilm({ request: jest.fn().mockRejectedValue(failure(503)) }, secondId);
    held.resolve(); expect(await unlinking).toBeNull();
    expect(getActiveCloudLink()).toBeNull(); expect(getOpenedFilm()?.film.name).toBe('Edited');
});
