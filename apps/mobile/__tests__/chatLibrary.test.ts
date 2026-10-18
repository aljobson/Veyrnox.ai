import { ApiError, type ApiClient } from '../src/lib/api';
import {
    MAX_FOLDER_NAME,
    MAX_PERSONA_NAME,
    MAX_PERSONA_TEXT,
    chatLibraryErrorMessage,
    createFolder,
    createPersona,
    deleteFolder,
    deletePersona,
    fetchFolders,
    fetchPersonas,
    folderCounts,
    moveThread,
    parseFolders,
    parsePersonas,
    renameFolder,
    startFromPersona,
    updatePersona,
    validateFolderName,
    validatePersonaForm,
} from '../src/lib/chatLibrary';

const apiWith = (result: unknown) => {
    const request = jest.fn(async (_p: string, _i?: RequestInit) => {
        if (result instanceof Error) throw result;
        return result;
    });
    return { api: { request } as unknown as ApiClient, request };
};
const body = (r: jest.Mock, i = 0) => JSON.parse(String((r.mock.calls[i][1] as RequestInit).body));

const persona = { id: 'p1', name: 'Editor', instructions: 'Be concise.', model_id: 'claude-sonnet', thinking: false, web: true };

describe('parsePersonas', () => {
    test('reads the list and whether the feature is on', () => {
        const r = parsePersonas({ enabled: true, personas: [persona] });
        expect(r.enabled).toBe(true);
        expect(r.personas[0]).toEqual({ id: 'p1', name: 'Editor', instructions: 'Be concise.', modelId: 'claude-sonnet', thinking: false, web: true });
    });
    test('off, missing or unusable means no personas and the screen shows nothing', () => {
        expect(parsePersonas({ enabled: false, personas: [persona] })).toEqual({ enabled: false, personas: [] });
        expect(parsePersonas(null)).toEqual({ enabled: false, personas: [] });
    });
    test('drops entries without an id, name or instructions; a missing model is null', () => {
        const r = parsePersonas({ enabled: true, personas: [{ ...persona, id: '' }, { ...persona, name: '' }, { ...persona, instructions: 5 }, { ...persona, model_id: undefined }] });
        expect(r.personas).toHaveLength(1);
        expect(r.personas[0].modelId).toBeNull();
    });
});

describe('parseFolders and folderCounts', () => {
    test('reads folders with counts and drops bad rows', () => {
        const f = parseFolders({ folders: [{ id: 'f1', name: 'Work', count: 3 }, { id: '', name: 'x', count: 1 }, { id: 'f2', name: 'Home', count: 'x' }] });
        expect(f).toEqual([{ id: 'f1', name: 'Work', count: 3 }, { id: 'f2', name: 'Home', count: 0 }]);
    });
    test('counts chats per folder id, with null for no folder', () => {
        const c = folderCounts([{ folder_id: 'f1' }, { folder_id: 'f1' }, { folder_id: null }, {}]);
        expect(c.get('f1')).toBe(2);
        expect(c.get(null)).toBe(2);
    });
});

describe('validatePersonaForm', () => {
    const ok = { name: ' Editor ', instructions: ' Be concise. ', modelId: null, thinking: false, web: false };
    test('trims and accepts a good form', () => {
        expect(validatePersonaForm(ok)).toEqual({ ok: true, value: { name: 'Editor', instructions: 'Be concise.', model_id: null, thinking: false, web: false } });
    });
    test('needs a name and instructions within the limits', () => {
        expect(validatePersonaForm({ ...ok, name: '  ' })).toMatchObject({ ok: false });
        expect(validatePersonaForm({ ...ok, name: 'x'.repeat(MAX_PERSONA_NAME + 1) })).toMatchObject({ ok: false });
        expect(validatePersonaForm({ ...ok, instructions: '' })).toMatchObject({ ok: false });
        expect(validatePersonaForm({ ...ok, instructions: 'x'.repeat(MAX_PERSONA_TEXT + 1) })).toMatchObject({ ok: false });
    });
    test('the token estimate the server uses is respected (4 characters a token, at most 1000)', () => {
        expect(validatePersonaForm({ ...ok, instructions: 'x'.repeat(4000) })).toMatchObject({ ok: true });
    });
    test('a model id must look like one', () => {
        expect(validatePersonaForm({ ...ok, modelId: 'claude-sonnet' })).toMatchObject({ ok: true });
        expect(validatePersonaForm({ ...ok, modelId: 'Bad Id!' })).toMatchObject({ ok: false });
    });
});

describe('validateFolderName', () => {
    test('trims, needs text and at most 60 characters', () => {
        expect(validateFolderName('  Work ')).toEqual({ ok: true, value: 'Work' });
        expect(validateFolderName('   ')).toMatchObject({ ok: false });
        expect(validateFolderName('x'.repeat(MAX_FOLDER_NAME + 1))).toMatchObject({ ok: false });
    });
});

describe('requests', () => {
    test('fetchPersonas and fetchFolders read the lists', async () => {
        const a = apiWith({ enabled: true, personas: [persona] });
        expect((await fetchPersonas(a.api)).personas).toHaveLength(1);
        expect(a.request).toHaveBeenCalledWith('/api/v1/chat/personas');
        const b = apiWith({ folders: [{ id: 'f1', name: 'Work', count: 1 }] });
        expect(await fetchFolders(b.api)).toHaveLength(1);
        expect(b.request).toHaveBeenCalledWith('/api/v1/chat/folders');
    });
    test('createPersona POSTs the validated body; updatePersona PATCHes the whole persona; deletePersona DELETEs', async () => {
        const a = apiWith({ persona });
        await createPersona(a.api, { name: 'Editor', instructions: 'Be concise.', model_id: null, thinking: false, web: false });
        expect(a.request.mock.calls[0][0]).toBe('/api/v1/chat/personas');
        expect((a.request.mock.calls[0][1] as RequestInit).method).toBe('POST');
        expect(body(a.request)).toEqual({ name: 'Editor', instructions: 'Be concise.', model_id: null, thinking: false, web: false });
        const b = apiWith({ persona });
        await updatePersona(b.api, 'p/1', { name: 'E', instructions: 'I', model_id: 'm', thinking: true, web: false });
        expect(b.request.mock.calls[0][0]).toBe('/api/v1/chat/personas/p%2F1');
        expect((b.request.mock.calls[0][1] as RequestInit).method).toBe('PATCH');
        const c = apiWith({ ok: true });
        await deletePersona(c.api, 'p1');
        expect((c.request.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
    });
    test('folder create, rename, delete', async () => {
        const a = apiWith({ folder: { id: 'f1', name: 'Work', count: 0 } });
        await createFolder(a.api, 'Work');
        expect(body(a.request)).toEqual({ name: 'Work' });
        await renameFolder(a.api, 'f1', 'Home');
        expect(a.request.mock.calls[1][0]).toBe('/api/v1/chat/folders/f1');
        expect(body(a.request, 1)).toEqual({ name: 'Home' });
        await deleteFolder(a.api, 'f1');
        expect((a.request.mock.calls[2][1] as RequestInit).method).toBe('DELETE');
    });
    test('moveThread sends folder_id alone, and null takes a chat out of its folder', async () => {
        const a = apiWith({ ok: true });
        await moveThread(a.api, 't1', 'f1');
        expect(body(a.request)).toEqual({ folder_id: 'f1' });
        await moveThread(a.api, 't1', null);
        expect(body(a.request, 1)).toEqual({ folder_id: null });
        expect(a.request.mock.calls[0][0]).toBe('/api/v1/chat/threads/t1');
    });
});

describe('startFromPersona', () => {
    test('makes the chat on the persona model, then sets its instructions', async () => {
        const request = jest.fn(async (path: string, init?: RequestInit) => (init?.method === 'POST' ? { thread: { id: 't9' } } : { ok: true }));
        const id = await startFromPersona({ request } as unknown as ApiClient, { id: 'p1', name: 'E', instructions: 'Be concise.', modelId: 'claude-sonnet', thinking: false, web: false }, 'default-model');
        expect(id).toBe('t9');
        expect(JSON.parse(String((request.mock.calls[0][1] as RequestInit).body))).toEqual({ model_id: 'claude-sonnet' });
        expect(request.mock.calls[1][0]).toBe('/api/v1/chat/threads/t9');
        expect(JSON.parse(String((request.mock.calls[1][1] as RequestInit).body))).toEqual({ system_prompt: 'Be concise.' });
    });
    test('a persona with no model uses the model the person picked', async () => {
        const request = jest.fn(async (_p: string, init?: RequestInit) => (init?.method === 'POST' ? { thread: { id: 't9' } } : { ok: true }));
        await startFromPersona({ request } as unknown as ApiClient, { id: 'p1', name: 'E', instructions: 'I', modelId: null, thinking: false, web: false }, 'picked');
        expect(JSON.parse(String((request.mock.calls[0][1] as RequestInit).body))).toEqual({ model_id: 'picked' });
    });
    test('if setting the instructions fails the half-made chat is deleted and the error is raised', async () => {
        const request = jest.fn(async (_p: string, init?: RequestInit) => {
            if (init?.method === 'POST') return { thread: { id: 't9' } };
            if (init?.method === 'PATCH') throw new ApiError(502, 'internal');
            return { ok: true };
        });
        await expect(startFromPersona({ request } as unknown as ApiClient, { id: 'p1', name: 'E', instructions: 'I', modelId: null, thinking: false, web: false }, 'm')).rejects.toBeInstanceOf(ApiError);
        expect(request.mock.calls.some(([p, i]) => p === '/api/v1/chat/threads/t9' && (i as RequestInit).method === 'DELETE')).toBe(true);
    });
});

describe('chatLibraryErrorMessage', () => {
    const e = (status: number, code: string) => chatLibraryErrorMessage(new ApiError(status, code));
    test('names what to change', () => {
        expect(e(400, 'invalid_persona_name')).toMatch(/name/);
        expect(e(400, 'invalid_instructions')).toMatch(/instructions/);
        expect(e(400, 'invalid_name')).toMatch(/name/);
        expect(e(409, 'FOLDER_LIMIT')).toMatch(/too many folders/i);
        expect(e(409, 'persona_exists')).toMatch(/already have a persona/);
        expect(e(404, 'personas_unavailable')).toMatch(/not available/);
        expect(e(404, 'persona_not_found')).toMatch(/no longer/);
        expect(e(404, 'folder_not_found')).toMatch(/no longer/);
    });
    test('offline, busy and the rest', () => {
        expect(e(0, 'network')).toMatch(/connection/);
        expect(e(503, 'temporarily_unavailable')).toMatch(/try again/i);
        expect(chatLibraryErrorMessage(new Error('x'))).toMatch(/Something went wrong/);
    });
});
