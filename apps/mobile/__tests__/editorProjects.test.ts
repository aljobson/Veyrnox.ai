import { ApiError, type ApiClient } from '../src/lib/api';
import { conflictCopyName, createProject, defaultWorkspace, editorErrorKey, getDocument, putDocument, resolveAsset } from '../src/lib/editorProjects';
import { resetNetworkState, isOffline } from '../src/lib/network';
const id = '11111111-1111-1111-1111-111111111111';
const doc = { schema_version: 1 as const, project_id: id, brief: '' };
let request: jest.Mock, api: ApiClient;
beforeEach(() => { resetNetworkState(); request = jest.fn(); api = { request } as unknown as ApiClient; });
test('default workspace else first', async () => {
    request.mockResolvedValue({ workspaces: [{ id: 'first' }, { id: 'default', is_default: true }] });
    expect((await defaultWorkspace(api))?.id).toBe('default');
    request.mockResolvedValue({ workspaces: [{ id: 'first' }] });
    expect((await defaultWorkspace(api))?.id).toBe('first');
});
test('exact create body and headers, trim and preflight rejection', async () => {
    request.mockResolvedValue({ project: { id } });
    await createProject(api, 'workspace', '  Name  ', 'create-key');
    expect(request.mock.calls).toEqual([['/api/v1/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'create-key' }, body: '{"workspace_id":"workspace","name":"Name"}' }]]);
    for (const name of ['', 'a'.repeat(121), 'bad\nname', '\tname']) await expect(createProject(api, 'workspace', name, 'key')).rejects.toMatchObject({ status: 400 });
    expect(request).toHaveBeenCalledTimes(1);
});
test('get and put paths encode every id and put contains only the agreed body', async () => {
    const odd = 'a/b?c', document = { ...doc, project_id: odd };
    request.mockResolvedValue({ revision: 4, document });
    await getDocument(api, odd);
    request.mockResolvedValue({ revision: 5 });
    await putDocument(api, odd, 4, document, 'save-key');
    expect(request.mock.calls).toEqual([
        ['/api/v1/projects/a%2Fb%3Fc/document'],
        ['/api/v1/projects/a%2Fb%3Fc/document', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'save-key' }, body: JSON.stringify({ expected_revision: 4, document }) }],
    ]);
});
test('copy name matches the web suffix and maximum', () => {
    expect(conflictCopyName('a'.repeat(120))).toBe('a'.repeat(108) + ' — edit copy');
    expect(conflictCopyName('  ')).toBe('Project — edit copy');
});
test('assets resolve with stem and clamp expiry', async () => {
    request.mockResolvedValue({ url: 'https://asset.test/file', mime_type: 'audio/wav', expires_in: 3600 });
    expect(await resolveAsset(api, `j-${id}--vocals`, 1000)).toEqual({ url: 'https://asset.test/file', mime: 'audio/wav', expiresAt: 901000 });
    expect(request).toHaveBeenCalledWith(`/api/v1/jobs/${id}/asset?stem=vocals`);
    request.mockResolvedValue({ url: 'https://asset.test/file', mime_type: 'video/mp4' });
    expect((await resolveAsset(api, `j-${id}`, 1000)).expiresAt).toBe(901000);
});
test.each([{ url: 'http://asset.test', mime_type: 'video/mp4' }, { url: 'https://asset.test', mime_type: 'text/html' }])('reject unsafe asset %o', async asset => {
    request.mockResolvedValue(asset); await expect(resolveAsset(api, `j-${id}`, 0)).rejects.toMatchObject({ code: 'unavailable' });
});
test.each([[404, 'unavailable'], [429, 'rate_limited'], [0, 'offline']])('asset status %s maps to %s', async (status, code) => {
    request.mockRejectedValue(new ApiError(Number(status), status === 0 ? 'network' : 'unknown'));
    await expect(resolveAsset(api, `j-${id}`, 0)).rejects.toMatchObject({ code });
    expect(isOffline()).toBe(status === 0);
});
test('quiet error mapping', () => {
    for (const status of [403, 404, 503]) expect(editorErrorKey(status)).toBe('editor.unavailable');
    expect(editorErrorKey(400)).toBe('editor.rejected');
});

test('a v4 Oddlings head degrades to editor unavailable', async () => {
    request.mockResolvedValue({ revision: 1, document: { schema_version: 4, project_id: id, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 }, oddlings: { version: 1, items: [], draft: null } } });
    await expect(getDocument(api, id)).rejects.toMatchObject({ status: 503 });
    expect(editorErrorKey(503)).toBe('editor.unavailable');
});
