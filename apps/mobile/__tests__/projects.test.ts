import { ApiError, type ApiClient } from '../src/lib/api';
import {
    fetchHistory,
    fetchProject,
    fetchProjects,
    fetchWorkspaces,
    mergeVersions,
    parseHistory,
    parseProject,
    parseProjects,
    parseWorkspaces,
    projectsErrorMessage,
    versionLabel,
} from '../src/lib/projects';

const apiWith = (result: unknown) => {
    const request = jest.fn(async (_p: string) => {
        if (result instanceof Error) throw result;
        return result;
    });
    return { api: { request } as unknown as ApiClient, request };
};

const ws = { id: 'w1', organisation_id: 'o1', name: 'Studio', is_default: true };
const proj = { id: 'p1', workspace_id: 'w1', owner_id: 'u1', name: 'Spring reel', version: 7, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-18T09:00:00Z' };

describe('parseWorkspaces', () => {
    test('reads workspaces and the default flag, dropping rows without an id', () => {
        const r = parseWorkspaces({ workspaces: [ws, { ...ws, id: '' }, { id: 'w2', name: '', is_default: false }] });
        expect(r).toEqual([{ id: 'w1', name: 'Studio', isDefault: true }, { id: 'w2', name: 'Workspace', isDefault: false }]);
    });
    test('an unusable body is an empty list', () => {
        expect(parseWorkspaces(null)).toEqual([]);
        expect(parseWorkspaces({ workspaces: 'x' })).toEqual([]);
    });
});

describe('parseProjects and parseProject', () => {
    test('reads a project and tolerates a missing name or numbers', () => {
        expect(parseProjects({ projects: [proj] })[0]).toEqual({ id: 'p1', workspaceId: 'w1', name: 'Spring reel', version: 7, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-18T09:00:00Z' });
        const bare = parseProjects({ projects: [{ id: 'p2' }] })[0];
        expect(bare).toMatchObject({ id: 'p2', name: 'Untitled project', version: 0, updatedAt: null });
    });
    test('drops rows without an id; parseProject unwraps one row', () => {
        expect(parseProjects({ projects: [{ name: 'x' }] })).toEqual([]);
        expect(parseProject({ project: proj })?.id).toBe('p1');
        expect(parseProject({})).toBeNull();
    });
});

describe('parseHistory', () => {
    test('reads versions and the cursor for the next page', () => {
        const h = parseHistory({ versions: [{ revision: 7, actor_id: 'u1', created_at: '2026-10-18T09:00:00Z', restored_from: null }, { revision: 6, created_at: '2026-10-17T09:00:00Z', restored_from: 3 }], next_before: 6 });
        expect(h.versions).toEqual([
            { revision: 7, createdAt: '2026-10-18T09:00:00Z', restoredFrom: null },
            { revision: 6, createdAt: '2026-10-17T09:00:00Z', restoredFrom: 3 },
        ]);
        expect(h.nextBefore).toBe(6);
    });
    test('no cursor means the last page; bad rows are dropped', () => {
        const h = parseHistory({ versions: [{ revision: 'x' }, { revision: 2, created_at: null }], next_before: null });
        expect(h.versions).toHaveLength(1);
        expect(h.nextBefore).toBeNull();
        expect(parseHistory(null)).toEqual({ versions: [], nextBefore: null });
    });
});

describe('mergeVersions', () => {
    test('appends only revisions not already shown, so a repeated page adds nothing', () => {
        const a = [{ revision: 7, createdAt: null, restoredFrom: null }];
        const r = mergeVersions(a, [{ revision: 7, createdAt: null, restoredFrom: null }, { revision: 6, createdAt: null, restoredFrom: null }]);
        expect(r.versions.map((v) => v.revision)).toEqual([7, 6]);
        expect(r.added).toBe(true);
        expect(mergeVersions(a, a).added).toBe(false);
    });
});

describe('versionLabel', () => {
    test('names the revision, and says when it was a restore', () => {
        expect(versionLabel({ revision: 7, createdAt: null, restoredFrom: null })).toBe('Version 7');
        expect(versionLabel({ revision: 6, createdAt: null, restoredFrom: 3 })).toBe('Version 6, restored from version 3');
    });
});

describe('requests', () => {
    test('workspaces, projects (workspace id encoded), one project, history with a cursor', async () => {
        const a = apiWith({ workspaces: [ws] });
        expect(await fetchWorkspaces(a.api)).toHaveLength(1);
        expect(a.request).toHaveBeenCalledWith('/api/v1/workspaces');
        const b = apiWith({ projects: [proj] });
        await fetchProjects(b.api, 'w/1');
        expect(b.request).toHaveBeenCalledWith('/api/v1/projects?workspace_id=w%2F1');
        const c = apiWith({ project: proj });
        await fetchProject(c.api, 'p/1');
        expect(c.request).toHaveBeenCalledWith('/api/v1/projects/p%2F1');
        const d = apiWith({ versions: [], next_before: null });
        await fetchHistory(d.api, 'p1');
        expect(d.request).toHaveBeenLastCalledWith('/api/v1/projects/p1/history');
        await fetchHistory(d.api, 'p1', 6);
        expect(d.request).toHaveBeenLastCalledWith('/api/v1/projects/p1/history?before=6');
    });
});

describe('projectsErrorMessage', () => {
    // These routes return {error:{code,message}} (an object), so the client's code is 'unknown': wording follows the status.
    const e = (status: number) => projectsErrorMessage(new ApiError(status, 'unknown', { error: { code: 'NOT_FOUND', message: 'x' } }));
    test('404 means projects are not available or the project is gone', () => {
        expect(e(404)).toMatch(/not available/);
    });
    test('401, 403, 429, 5xx, offline and anything else', () => {
        expect(e(403)).toMatch(/permission/);
        expect(e(429)).toMatch(/Try again in a moment/);
        expect(e(502)).toMatch(/busy/);
        expect(e(503)).toMatch(/busy/);
        expect(projectsErrorMessage(new ApiError(0, 'network'))).toMatch(/connection/);
        expect(projectsErrorMessage(new Error('x'))).toMatch(/Something went wrong/);
    });
});
