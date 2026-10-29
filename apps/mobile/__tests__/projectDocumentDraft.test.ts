jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `key-${++n}` }; });
import { ApiError } from '../src/lib/api';
import type { ProjectDocument } from '../src/lib/editorBridge';
import { applyEditable, cleanBrief, documentProblem, documentStatus, fetchVersion, isDirty, parseRestored, readEditable, REVISION_CAP, saveKeyFor, serverCode, type Editable } from '../src/lib/projectDocumentDraft';

const id = 'project';
const v1: ProjectDocument = { schema_version: 1, project_id: id, brief: 'Hello', canvas: { aspect_ratio: '16:9', frame_rate: 30 } };
const timeline = { video: [{ id: 'c1', media: 'j-x', start: 0, len: 120 }], audio: [], nested: { keep: [1, 2, 3] } };
const v2: ProjectDocument = { schema_version: 2, project_id: id, brief: '', canvas: { aspect_ratio: '9:16', frame_rate: 24 }, timeline };
const v3: ProjectDocument = { ...v2, schema_version: 3 };
const edit: Editable = { brief: 'New', aspectRatio: '1:1', frameRate: 60 };
const limited = (code: string) => new ApiError(429, 'unknown', { error: { code, message: 'x' } });

test('readEditable reads brief and canvas and refuses values outside the sets', () => {
    expect(readEditable(v1)).toEqual({ brief: 'Hello', aspectRatio: '16:9', frameRate: 30 });
    expect(readEditable({ ...v1, canvas: { aspect_ratio: '4:3', frame_rate: 30 } })).toBeNull();
    expect(readEditable({ ...v1, canvas: { aspect_ratio: '16:9', frame_rate: '30' } })).toBeNull();
    expect(readEditable({ ...v1, canvas: undefined })).toBeNull();
});

test('applyEditable returns a new document and keeps the timeline byte for byte on schema 2 and 3', () => {
    for (const doc of [v2, v3]) {
        const before = JSON.stringify(doc.timeline);
        const next = applyEditable(doc, edit);
        expect(next).not.toBe(doc);
        expect(JSON.stringify(next.timeline)).toBe(before);
        expect(next.timeline).toBe(doc.timeline);
        expect(next.schema_version).toBe(doc.schema_version);
        expect(next.project_id).toBe(id);
        expect(next.brief).toBe('New');
        expect(next.canvas).toEqual({ aspect_ratio: '1:1', frame_rate: 60 });
    }
    const one = applyEditable(v1, edit);
    expect(Object.hasOwn(one, 'timeline')).toBe(false);
    expect(v1.brief).toBe('Hello');
});

test('cleanBrief removes U+0000 and cuts to 6000 UTF-16 units', () => {
    expect(cleanBrief('a\u0000b')).toBe('ab');
    expect(cleanBrief('x'.repeat(6001))).toHaveLength(6000);
});

test('documentProblem refuses a document over 32,768 UTF-8 bytes', () => {
    const base = JSON.stringify({ ...v1, brief: '' }).length;
    expect(documentProblem({ ...v1, brief: 'x'.repeat(32768 - base) })).toBeNull();
    expect(documentProblem({ ...v1, brief: 'x'.repeat(32769 - base) })).toBe('too_big');
});

test('saveKeyFor reuses the key for an identical body and makes a new one for a changed body', () => {
    const first = saveKeyFor(null, 'a');
    expect(saveKeyFor(first, 'a')).toBe(first);
    const changed = saveKeyFor(first, 'b');
    expect(changed.body).toBe('b');
    expect(changed.key).not.toBe(first.key);
});

test('serverCode reads body.error.code only when it is a string', () => {
    expect(serverCode(limited('LIMIT_REACHED'))).toBe('LIMIT_REACHED');
    expect(serverCode(new ApiError(429, 'rate_limited', { error: 'rate_limited' }))).toBeNull();
    expect(serverCode(new ApiError(429, 'unknown', { error: { code: 5 } }))).toBeNull();
    expect(serverCode(null)).toBeNull();
});

test('documentStatus maps every branch, first match wins', () => {
    expect(documentStatus(new ApiError(401, 'account_changed'), 0)).toBe('dropped');
    expect(documentStatus(new ApiError(503, 'invalid_response'), 0)).toBe('unsupported');
    expect(documentStatus(new ApiError(0, 'network'), 0)).toBe('offline');
    expect(documentStatus(new ApiError(409, 'unknown'), 0)).toBe('conflict');
    expect(documentStatus(new ApiError(400, 'unknown'), 0)).toBe('rejected');
    expect(documentStatus(limited('LIMIT_REACHED'), 999)).toBe('daily_limit');
    expect(documentStatus(limited('LIMIT_REACHED'), REVISION_CAP)).toBe('revision_limit');
    expect(documentStatus(limited('RATE_LIMITED'), REVISION_CAP)).toBe('paused');
    expect(documentStatus(new ApiError(429, 'unknown'), 0)).toBe('paused');
    for (const status of [401, 403, 404, 503]) expect(documentStatus(new ApiError(status, 'unknown'), 0)).toBe('unavailable');
    expect(documentStatus(new ApiError(500, 'unknown'), 0)).toBe('failed');
    expect(documentStatus(new Error('x'), 0)).toBe('failed');
});

test('fetchVersion checks the revision before sending and validates the reply', async () => {
    const request = jest.fn(async () => ({ revision: 2, document: v1, created_at: '2026-10-01T00:00:00Z' }));
    const api = { request } as never;
    await expect(fetchVersion(api, 'a b', 2)).rejects.toMatchObject({ code: 'invalid_response' });
    expect(request).toHaveBeenLastCalledWith('/api/v1/projects/a%20b/document?revision=2');
    await expect(fetchVersion(api, id, 2)).resolves.toEqual({ revision: 2, document: v1, createdAt: '2026-10-01T00:00:00Z' });
    request.mockClear();
    for (const bad of [0, -1, 1.5]) await expect(fetchVersion(api, id, bad)).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce({ revision: 2, document: { ...v1, schema_version: 4 } } as never);
    await expect(fetchVersion(api, id, 2)).rejects.toMatchObject({ code: 'invalid_response' });
});

test('parseRestored accepts only a newer revision with a valid document', () => {
    expect(parseRestored({ revision: 4, document: v2 }, id, 3)).toEqual({ revision: 4, document: v2 });
    expect(parseRestored({ revision: 3, document: v2 }, id, 3)).toBeNull();
    expect(parseRestored({ revision: 4 }, id, 3)).toBeNull();
    expect(parseRestored({ revision: 4, document: { ...v2, schema_version: 4 } }, id, 3)).toBeNull();
    expect(parseRestored(null, id, 3)).toBeNull();
});

test('isDirty compares by document identity, ignoring key order', () => {
    const head = { revision: 1, document: { canvas: { frame_rate: 30, aspect_ratio: '16:9' }, brief: 'Hello', project_id: id, schema_version: 1 } as ProjectDocument };
    expect(isDirty(head, { brief: 'Hello', aspectRatio: '16:9', frameRate: 30 })).toBe(false);
    expect(isDirty(head, { brief: 'Hello!', aspectRatio: '16:9', frameRate: 30 })).toBe(true);
    expect(isDirty(head, { brief: 'Hello', aspectRatio: '16:9', frameRate: 60 })).toBe(true);
});
