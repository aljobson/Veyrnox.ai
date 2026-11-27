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
    projectSavedAt,
    projectVersion,
    projectsErrorMessage,
    versionLabel,
    editingTimeSavedClock,
    createProjectFolder,
    deleteProjectFolder,
    fetchProjectFolders,
    folderLabel,
    moveProjectToFolder,
    parseProjectFolders,
    renameProjectFolder,
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
        expect(parseProjects({ projects: [proj] })[0]).toEqual({ id: 'p1', workspaceId: 'w1', folderId: null, name: 'Spring reel', version: 7, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-18T09:00:00Z', latestRevision: null, savedAt: null, editingTimeSavedSeconds: null });
        const bare = parseProjects({ projects: [{ id: 'p2' }] })[0];
        expect(bare).toMatchObject({ id: 'p2', name: 'Untitled project', version: 0, updatedAt: null });
    });
    test('reads the latest saved revision and its time, and rejects malformed ones', () => {
        const saved = parseProject({ ...proj, latest_revision: 19, saved_at: '2026-11-16T12:00:00Z', editing_time_saved_seconds: 3723 });
        expect(saved).toMatchObject({ latestRevision: 19, savedAt: '2026-11-16T12:00:00Z', editingTimeSavedSeconds: 3723 });
        expect(projectVersion(saved!)).toBe(19);
        expect(projectSavedAt(saved!)).toBe('2026-11-16T12:00:00Z');
        const odd = parseProject({ ...proj, latest_revision: 0, saved_at: '' });
        expect(odd).toMatchObject({ latestRevision: null, savedAt: null });
        expect(parseProject({ ...proj, latest_revision: 1.5 })?.latestRevision).toBeNull();
        expect(parseProject({ ...proj, editing_time_saved_seconds: -1 })?.editingTimeSavedSeconds).toBeNull();
        expect(editingTimeSavedClock(3723)).toBe('1:02:03');
        expect(editingTimeSavedClock(65)).toBe('1:05');
    });
    test('falls back to the row version and dates when nothing was saved yet', () => {
        const row = parseProject(proj)!;
        expect(projectVersion(row)).toBe(7);
        expect(projectSavedAt(row)).toBe('2026-10-18T09:00:00Z');
        expect(projectSavedAt({ savedAt: null, updatedAt: null, createdAt: '2026-10-01T10:00:00Z' })).toBe('2026-10-01T10:00:00Z');
    });
    test('drops rows without an id; parseProject unwraps one row', () => {
        expect(parseProjects({ projects: [{ name: 'x' }] })).toEqual([]);
        expect(parseProject({ project: proj })?.id).toBe('p1');
        expect(parseProject({})).toBeNull();
    });
});

describe('project folders', () => {
    const root = { id: 'f1', workspace_id: 'w1', parent_id: null, name: 'Clients', version: 2 };
    const child = { id: 'f2', workspace_id: 'w1', parent_id: 'f1', name: 'Acme', version: 1 };
    test('parses a bounded folder tree and renders a breadcrumb label', () => {
        const folders = parseProjectFolders({ folders: [root, child, { name: 'missing id' }] });
        expect(folders).toHaveLength(2);
        expect(folderLabel(folders[1], folders)).toBe('Clients / Acme');
    });
    test('fetches, creates, renames, deletes and moves using the public folder contracts', async () => {
        const listed = apiWith({ folders: [root] });
        expect(await fetchProjectFolders(listed.api, 'w/1')).toHaveLength(1);
        expect(listed.request).toHaveBeenCalledWith('/api/v1/project-folders?workspace_id=w%2F1');
        const made = apiWith({ folder: root, idempotent: false });
        await createProjectFolder(made.api, 'w1', null, 'Clients', 'folder-key-123');
        expect(made.request).toHaveBeenCalledWith('/api/v1/project-folders', expect.objectContaining({ method: 'POST', body: JSON.stringify({ workspace_id: 'w1', parent_id: null, name: 'Clients' }) }));
        const renamed = apiWith({ folder: { ...root, name: 'Accounts', version: 3 } });
        expect((await renameProjectFolder(renamed.api, 'f1', 'Accounts', 2))?.name).toBe('Accounts');
        expect(renamed.request).toHaveBeenCalledWith('/api/v1/project-folders/f1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Accounts', version: 2 }) }));
        const removed = apiWith({ folder: root });
        await deleteProjectFolder(removed.api, 'f1', 2);
        expect(removed.request).toHaveBeenCalledWith('/api/v1/project-folders/f1', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ version: 2 }) }));
        const moved = apiWith({ project: { ...proj, folder_id: 'f1', version: 8 } });
        expect((await moveProjectToFolder(moved.api, 'p1', 'f1', 7))?.folderId).toBe('f1');
        expect(moved.request).toHaveBeenCalledWith('/api/v1/projects/p1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ folder_id: 'f1', version: 7 }) }));
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
    test('folder codes use actionable localized messages', () => {
        const message = (code: string, status = 409) => projectsErrorMessage(new ApiError(status, 'unknown', { error: { code, message: 'hidden' } }));
        expect(message('NAME_CONFLICT')).toMatch(/already exists/);
        expect(message('FOLDER_NOT_EMPTY')).toMatch(/subfolders/);
        expect(message('FOLDER_DEPTH_LIMIT')).toMatch(/four levels/);
        expect(message('LIMIT_REACHED', 429)).toMatch(/200-folder/);
    });
});

describe('projectDates', () => {
    test('shows dates without the rename-only version and without a leading separator', () => {
        const { projectDates } = require('../src/lib/projects');
        const line = projectDates({ createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-02T10:00:00Z' });
        expect(line).not.toMatch(/^[\s·]/);
        expect(line).not.toMatch(/ersion/);
        expect(line).toMatch(/updated/);
        expect(projectDates({ createdAt: null, updatedAt: '2026-11-02T10:00:00Z' })).toMatch(/^updated/);
        expect(projectDates({ createdAt: null, updatedAt: null })).toBe('');
    });
});
