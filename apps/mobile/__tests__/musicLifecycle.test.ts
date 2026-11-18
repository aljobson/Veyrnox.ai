import { ApiError, type ApiClient } from '../src/lib/api';
import { changeLifecycle, findLifecycle, routeRevision } from '../src/lib/music/lifecycle';
import { trashedRow } from './fixtures/music';
let request: jest.Mock, api: ApiClient;
beforeEach(() => { request = jest.fn(); api = { request } as unknown as ApiClient; });
test('trash retains returned revision for restore; never GETs trashed detail', async () => {
    request.mockResolvedValueOnce({ song: { ...trashedRow, revision: 4 }, idempotent: false });
    const trashed = await changeLifecycle(api, 'a/b', { revision: 3, lifecycle_status: 'active' }, 'trash');
    if (trashed.state !== 'saved') throw new Error('expected saved');
    request.mockResolvedValueOnce({ song: { ...trashedRow, revision: 5, lifecycle_status: 'active' }, idempotent: false });
    await changeLifecycle(api, 'a/b', trashed.value, 'restore');
    expect(request.mock.calls.map(([path, init]) => [path, init.method, JSON.parse(init.body)])).toEqual([
        ['/api/v1/music/songs/a%2Fb', 'PATCH', { action: 'trash', revision: 3 }],
        ['/api/v1/music/songs/a%2Fb', 'PATCH', { action: 'restore', revision: 4 }],
    ]);
});
test('409 revision_conflict refreshes active then trash projection, never detail', async () => {
    request.mockRejectedValueOnce(new ApiError(409, 'revision_conflict')).mockResolvedValueOnce({ songs: [] }).mockResolvedValueOnce({ songs: [trashedRow] });
    expect(await changeLifecycle(api, 's1', { revision: 1, lifecycle_status: 'active' }, 'trash')).toEqual({ state: 'conflict', value: { revision: 3, lifecycle_status: 'trashed' } });
    expect(request.mock.calls.slice(1)).toEqual([['/api/v1/music/songs?limit=50'], ['/api/v1/music/songs?limit=50&collection=trash']]);
});
test('unfindable revision gives go-back result; unavailable writes give off', async () => {
    request.mockRejectedValueOnce(new ApiError(409, 'revision_conflict')).mockResolvedValue({ songs: [] });
    expect(await changeLifecycle(api, 's1', { revision: 1, lifecycle_status: 'active' }, 'trash')).toEqual({ state: 'conflict', value: null });
    request.mockRejectedValueOnce(new ApiError(404, 'music_library_unavailable'));
    expect(await changeLifecycle(api, 's1', { revision: 1, lifecycle_status: 'active' }, 'trash')).toEqual({ state: 'off' });
});
test('route revision and older library rows without revision do not invent one', async () => {
    for (const value of ['', undefined, 'NaN', 'Infinity']) expect(routeRevision(value)).toBeNull();
    expect(routeRevision('4')).toEqual({ revision: 4, lifecycle_status: 'active' });
    request.mockResolvedValue({ songs: [{ id: 's1', title: 'Title' }] });
    expect(await findLifecycle(api, 's1')).toBeNull();
});
