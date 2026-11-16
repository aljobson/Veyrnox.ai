import { notifyProjectsChanged, projectsChangedGeneration, subscribeProjectsChanged } from '../src/lib/projectsChanged';
import { createProject, deleteProject, renameProject, restoreVersion } from '../src/lib/projects';
import { createProject as createEditorProject, putDocument } from '../src/lib/editorProjects';
import { ApiError, type ApiClient } from '../src/lib/api';

const apiWith = (result: unknown) => ({ request: jest.fn(async () => { if (result instanceof Error) throw result; return result; }) }) as unknown as ApiClient;

describe('projects changed emitter', () => {
    test('calls subscribers, stops after unsubscribe and counts changes', () => {
        const fn = jest.fn();
        const off = subscribeProjectsChanged(fn);
        const before = projectsChangedGeneration();
        notifyProjectsChanged();
        expect(fn).toHaveBeenCalledTimes(1);
        expect(projectsChangedGeneration()).toBe(before + 1);
        off();
        notifyProjectsChanged();
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('writes that change the project list notify once on success only', () => {
    const run = async (call: (api: ApiClient) => Promise<unknown>, ok: unknown) => {
        const fn = jest.fn();
        const off = subscribeProjectsChanged(fn);
        await call(apiWith(ok));
        const successes = fn.mock.calls.length;
        await call(apiWith(new ApiError(409, 'conflict'))).catch(() => undefined);
        off();
        return { successes, total: fn.mock.calls.length };
    };
    const project = { project: { id: 'p1', name: 'x', version: 1 } };
    test.each([
        ['createProject (library)', (api: ApiClient) => createProject(api, 'w1', 'x', 'key'), project],
        ['renameProject', (api: ApiClient) => renameProject(api, 'p1', 'y', 1), project],
        ['deleteProject', (api: ApiClient) => deleteProject(api, 'p1', 1), {}],
        ['restoreVersion', (api: ApiClient) => restoreVersion(api, 'p1', 3, 1, 'key'), { revision: 4 }],
        ['createProject (editor)', (api: ApiClient) => createEditorProject(api, 'w1', 'x', 'key'), project],
        ['putDocument', (api: ApiClient) => putDocument(api, 'p1', 2, {} as never, 'key'), { revision: 3 }],
    ])('%s', async (_name, call, ok) => {
        expect(await run(call, ok)).toEqual({ successes: 1, total: 1 });
    });
});
