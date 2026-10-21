import { cleanProjectName, createProject, deleteProject, renameProject, restoreVersion } from '../src/lib/projects';
import type { ApiClient } from '../src/lib/api';

function fakeApi() {
    const calls: { path: string; init?: RequestInit }[] = [];
    const api = { request: async (path: string, init?: RequestInit) => { calls.push({ path, init }); return { project: { id: 'p1', name: 'Film', version: 2 } }; } } as unknown as ApiClient;
    return { api, calls };
}

describe('project names', () => {
    test('trims and accepts 1 to 120 characters', () => {
        expect(cleanProjectName('  My film ')).toBe('My film');
        expect(cleanProjectName('a'.repeat(120))).toHaveLength(120);
    });
    test('refuses empty, too long and control characters', () => {
        expect(cleanProjectName('   ')).toBeNull();
        expect(cleanProjectName('a'.repeat(121))).toBeNull();
        expect(cleanProjectName('bad\u0007name')).toBeNull();
    });
});

describe('project writes', () => {
    test('create sends the workspace, the name and an idempotency key', async () => {
        const { api, calls } = fakeApi();
        const made = await createProject(api, 'w1', 'Film', 'retry-once-attempt');
        expect(made?.id).toBe('p1');
        expect(calls[0].path).toBe('/api/v1/projects');
        expect(calls[0].init?.method).toBe('POST');
        expect((calls[0].init?.headers as Record<string, string>)['Idempotency-Key']).toBe('retry-once-attempt');
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ workspace_id: 'w1', name: 'Film' });
    });
    test('rename and delete carry the version being looked at', async () => {
        const { api, calls } = fakeApi();
        await renameProject(api, 'p1', 'New', 3);
        await deleteProject(api, 'p1', 3);
        expect(calls[0].init?.method).toBe('PATCH');
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: 'New', version: 3 });
        expect(calls[1].init?.method).toBe('DELETE');
        expect(JSON.parse(String(calls[1].init?.body))).toEqual({ version: 3 });
    });
    test('restore names the current and the wanted revision', async () => {
        const { api, calls } = fakeApi();
        await restoreVersion(api, 'p1', 5, 2);
        expect(calls[0].path).toBe('/api/v1/projects/p1/document');
        expect(calls[0].init?.method).toBe('PUT');
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ expected_revision: 5, restore_revision: 2 });
    });
});
