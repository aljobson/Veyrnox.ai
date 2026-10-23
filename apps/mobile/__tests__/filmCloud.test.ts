import { CLOUD_FILMS_PATH, cloudFilmPath, cloudStatus, fetchCloudFilm, fetchCloudFilms, getOpenedFilm, loadActiveStudio, openCloudFilm, parseCloudFilms, replaceActiveStudio, saveActiveStudioToCloud } from '../src/lib/filmCloud';
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createCache, createMemoryStorage } from '../src/lib/cache';
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
