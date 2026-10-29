import { act } from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { ApiError } from '../src/lib/api';
import { readDraft, writeDraft, removeDraft, type EditorDraft } from '../src/lib/editorDrafts';
import { editorDeviceMedia } from '../src/lib/editorDeviceMedia';
import { markOffline, resetNetworkState } from '../src/lib/networkState';
import { libraryMedia, LIBRARY_STOPPED } from '../src/lib/editorLibraryLength';
import { t } from '../src/lib/i18n';
import { timelineOf } from '../src/lib/nativeEditorModel';

const id = '11111111-1111-1111-1111-111111111111', copyId = '33333333-3333-3333-3333-333333333333';
const doc = { schema_version: 1 as const, project_id: id, brief: 'head' };
let mockOwner = 'A', mockGen = 0, mockKey = 0;
const mockListeners = new Set<() => void>(), mockRequest = jest.fn(), mockOwnerChange = jest.fn(), mockCopy = jest.fn();
const mockApi = { request: mockRequest };
const mockRouter = { back: jest.fn() };
const mockBegin = () => { const gen = mockGen; return { current: () => gen === mockGen }; };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `key-${++mockKey}` }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: mockBegin }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockListeners?.add(fn); return () => mockListeners?.delete(fn); } }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn(), writeDraft: jest.fn(), removeDraft: jest.fn() }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn(), files: jest.fn(), copy: jest.fn(), backup: jest.fn() } }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn().mockResolvedValue(4) }));
let root: Root, session: ReturnType<typeof useFullEditorSession>, stored: EditorDraft | null;
let background: (state: AppStateStatus) => void, head: { revision: number; document: typeof doc };
function Harness({ jobId }: { jobId?: string }) { session = useFullEditorSession({ projectId: id, jobId, onOwnerChange: mockOwnerChange, onCopy: mockCopy }); return null; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = async (ms: number) => { await act(async () => jest.advanceTimersByTimeAsync(ms)); };
const edit = async (brief = 'edit') => { await act(async () => session.markDocument({ ...session.currentDocument()!, brief })); };
const puts = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'PUT');
const posts = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'POST');
async function open(jobId?: string) { await act(async () => root.render(<Harness jobId={jobId} />)); }
async function confirm() { const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!; await act(async () => buttons.find(b => b.style === 'destructive' || b.text === t('projects.restore'))!.onPress!()); }
async function useSaved() { await act(async () => session.sync.useSaved()); await confirm(); }
async function conflict() { mockRequest.mockImplementationOnce(async () => { throw new ApiError(409, 'conflict'); }); await act(async () => session.save()); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers(); jest.clearAllMocks(); resetNetworkState();
    mockOwner = 'A'; mockGen = 0; mockKey = 0; stored = null; head = { revision: 4, document: doc };
    Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { background = listener; return { remove: jest.fn() }; });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.mocked(readDraft).mockImplementation(async () => stored);
    jest.mocked(writeDraft).mockImplementation(async value => { stored = value; return true; });
    jest.mocked(removeDraft).mockImplementation(async () => { stored = null; });
    jest.mocked(editorDeviceMedia.hydrate).mockResolvedValue({});
    jest.mocked(editorDeviceMedia.files).mockResolvedValue({});
    jest.mocked(editorDeviceMedia.copy).mockResolvedValue(null);
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return { revision: JSON.parse(init.body as string).expected_revision + 1 };
        if (init?.method === 'POST') return { project: { id: copyId } };
        if (path.endsWith('/document')) return head;
        if (path.endsWith('/media-info')) return { seconds: 4 };
        return { project: { id, workspace_id: 'workspace', name: 'Cut' } };
    });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

test('409 opens the sheet; Use saved confirms dirty discard, clears undo and sends no further PUT', async () => {
    await open(); await edit(); await conflict();
    expect(session.sync.sheet).toBe('conflict'); expect(session.dirty).toBe(true);
    await tick(30000); expect(puts()).toHaveLength(1);
    head = { revision: 8, document: { ...doc, brief: 'remote' } }; await useSaved();
    expect(session.document).toEqual(head.document); expect(session.revision).toBe(8);
    expect(session.history.canUndo).toBe(false); expect(session.dirty).toBe(false);
    await tick(1000); expect(puts()).toHaveLength(1); expect(stored).toBeNull();
});
test('Use saved inside the 400 ms window leaves no draft behind', async () => {
    await open(); head = { ...head, revision: 5 }; await tick(15000); await edit();
    await tick(100); await useSaved(); await tick(500);
    expect(stored).toBeNull(); expect(writeDraft).not.toHaveBeenCalled();
});
test('Use saved does not discard an edit that arrived after the confirmation', async () => {
    await open(); await edit(); await conflict();
    const response = deferred<typeof head>(); mockRequest.mockImplementationOnce(() => response.promise);
    await act(async () => session.sync.useSaved()); await confirm(); await edit('newer');
    head = { revision: 8, document: { ...doc, brief: 'remote' } };
    await act(async () => response.resolve(head));
    expect(session.document?.brief).toBe('newer'); expect(session.revision).toBe(4); expect(session.sync.sheet).toBe('conflict');
    await act(async () => session.sync.flushDraft()); expect(stored?.baseRevision).toBe(4);
});
test('Use saved completes while it holds its own replacement lock, and an owner change during its GET stops it', async () => {
    await open(); await edit(); await conflict();
    const response = deferred<typeof head>(); mockRequest.mockImplementationOnce(() => response.promise);
    await act(async () => session.sync.useSaved()); await confirm();
    expect(session.replacing).toBe(true);
    await act(async () => { mockGen++; mockOwner = 'B'; mockListeners.forEach(fn => fn()); response.resolve({ ...head, revision: 7 }); });
    expect(session.document).toBeNull(); expect(mockOwnerChange).toHaveBeenCalledTimes(1);
    expect(removeDraft).not.toHaveBeenCalled();
});
test('a PUT that times out is retried with the same key, expected revision and body; a newer edit gets a new key after it', async () => {
    await open(); await edit('first');
    mockRequest.mockImplementationOnce(async () => { throw new ApiError(0, 'network'); });
    await act(async () => session.save()); const first = puts()[0];
    await edit('second'); await tick(1);
    expect(puts()).toHaveLength(3); expect(puts()[1]).toEqual(first);
    const next = puts()[2][1]; expect(next.headers['Idempotency-Key']).not.toBe(first[1].headers['Idempotency-Key']);
    expect(JSON.parse(next.body)).toMatchObject({ expected_revision: 5, document: { brief: 'second' } });
});
test('status 0 retries after 5 s then 10 s; 403 pauses autosave even after an edit', async () => {
    await open(); await edit();
    mockRequest.mockImplementation(async () => { throw new ApiError(0, 'network'); });
    await act(async () => session.save()); await tick(4999); expect(puts()).toHaveLength(1);
    await tick(1); expect(puts()).toHaveLength(2); await tick(9999); expect(puts()).toHaveLength(2);
    mockRequest.mockImplementation(async () => { throw new ApiError(403, 'forbidden'); });
    await tick(1); expect(puts()).toHaveLength(3); await edit('later'); await tick(60000);
    expect(puts()).toHaveLength(3); expect(session.saveStatus).toBe(t('editor.unavailable'));
});
test('15 s watch ignores same head, opens for newer head, and does not run while a save is unknown', async () => {
    await open(); await tick(15000); expect(session.sync.sheet).toBeNull();
    head = { ...head, revision: 6 }; await tick(15000); expect(session.sync.sheet).toBe('conflict');
    await act(async () => session.sync.useSaved());
    await edit(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(429, 'limited', { retryAfterSeconds: 60 }); });
    await act(async () => session.save()); const calls = mockRequest.mock.calls.length;
    await tick(15000); expect(mockRequest).toHaveBeenCalledTimes(calls);
});
test('a watch GET started before a PUT and returning its revision before the PUT reply does not open conflict', async () => {
    await open(); const watch = deferred<typeof head>(), put = deferred<{ revision: number }>();
    mockRequest.mockImplementationOnce(() => watch.promise); await tick(15000);
    await edit(); mockRequest.mockImplementationOnce(() => put.promise);
    await act(async () => { void session.save(); });
    await act(async () => watch.resolve({ ...head, revision: 5 })); expect(session.sync.sheet).toBeNull();
    await act(async () => put.resolve({ revision: 5 })); expect(session.sync.sheet).toBeNull();
});
test('same-base draft offers Recover; Restore makes it dirty and saves it', async () => {
    stored = { owner: 'A', projectId: id, baseRevision: 4, document: { ...doc, brief: 'recovered' }, updatedAt: 1 };
    await open(); expect(session.document).toEqual(doc); expect(session.sync.sheet).toBe('recovery');
    await act(async () => session.sync.recover()); expect(session.saveStatus).toBe(t('editorSave.recovered'));
    await tick(900); expect(JSON.parse(puts()[0][1].body).document.brief).toBe('recovered');
});
test('older-base draft opens conflict and keeps its local base', async () => {
    stored = { owner: 'A', projectId: id, baseRevision: 2, document: { ...doc, brief: 'recovered' }, updatedAt: 1 };
    await open(); expect(session.sync.sheet).toBe('conflict'); expect(session.revision).toBe(2);
    await act(async () => session.sync.flushDraft()); expect(stored?.baseRevision).toBe(2);
});
test('backgrounding while Recovery is unanswered writes no draft and sends no PUT; reopening offers the original draft', async () => {
    stored = { owner: 'A', projectId: id, baseRevision: 4, document: { ...doc, brief: 'precious' }, updatedAt: 1 };
    const original = stored; await open(); await act(async () => background('background')); await tick(30000);
    expect(writeDraft).not.toHaveBeenCalled(); expect(puts()).toHaveLength(0); expect(stored).toEqual(original);
    await act(async () => root.unmount()); root = createRoot(); await open();
    expect(session.sync.sheet).toBe('recovery'); expect(stored).toEqual(original);
});
test('leaving while Recovery is unanswered keeps the draft without an Alert', async () => {
    stored = { owner: 'A', projectId: id, baseRevision: 4, document: { ...doc, brief: 'precious' }, updatedAt: 1 };
    await open(); let leave = false; await act(async () => { leave = await session.leaveEditor(); });
    expect(leave).toBe(true); expect(Alert.alert).not.toHaveBeenCalled(); expect(removeDraft).not.toHaveBeenCalled(); expect(writeDraft).not.toHaveBeenCalled();
});
test('leaving 100 ms after an edit offline waits for the draft and says leaveKept', async () => {
    await open(); await edit(); await tick(100); markOffline();
    const storage = deferred<boolean>(); jest.mocked(writeDraft).mockReturnValueOnce(storage.promise);
    await act(async () => { void session.leaveEditor(); }); expect(Alert.alert).not.toHaveBeenCalled();
    await act(async () => storage.resolve(true));
    expect(Alert.alert).toHaveBeenLastCalledWith(t('editor.leaveKept'), undefined, expect.any(Array), expect.any(Object)); expect(puts()).toHaveLength(0);
});
test('leaving when writeDraft fails says leaveLost', async () => {
    await open(); await edit(); markOffline(); jest.mocked(writeDraft).mockResolvedValue(false);
    await act(async () => { void session.leaveEditor(); });
    expect(Alert.alert).toHaveBeenLastCalledWith(t('editor.leaveLost'), undefined, expect.any(Array), expect.any(Object));
});
test('leaving while a save is in flight waits for it', async () => {
    await open(); await edit(); const response = deferred<{ revision: number }>(); mockRequest.mockImplementationOnce(() => response.promise);
    await act(async () => { void session.save(); }); let left: boolean | undefined;
    await act(async () => { void session.leaveEditor().then(value => { left = value; }); }); expect(left).toBeUndefined();
    await act(async () => response.resolve({ revision: 5 })); expect(left).toBe(true); expect(Alert.alert).not.toHaveBeenCalled();
});
test('account switch during a pending retry sends no PUT, writes no draft and tears down', async () => {
    await open(); await edit(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(0, 'network'); });
    await act(async () => session.save()); jest.mocked(writeDraft).mockClear();
    await act(async () => { mockGen++; mockOwner = 'B'; mockListeners.forEach(fn => fn()); }); await tick(60000);
    expect(puts()).toHaveLength(1); expect(writeDraft).not.toHaveBeenCalled(); expect(mockOwnerChange).toHaveBeenCalledTimes(1); expect(session.document).toBeNull();
});
test('a save failing with account_changed is quiet, schedules no retry and keeps the draft', async () => {
    await open(); await edit(); await act(async () => session.sync.flushDraft()); const draft = stored;
    mockRequest.mockImplementationOnce(async () => { throw new ApiError(401, 'account_changed'); }); await act(async () => session.save());
    await tick(60000); expect(puts()).toHaveLength(1); expect(stored).toEqual(draft); expect(removeDraft).not.toHaveBeenCalled(); expect(session.problem).toBeNull();
    expect(session.saveStatus).toBe(t('editor.unsavedchanges'));
});
test('Keep copy POST and PUT use frozen keys and body, copy device files, and navigate; a backup during a failed copy cannot change its retry', async () => {
    await open(); const mediaId = 'l-22222222-2222-2222-2222-222222222222';
    const timeline = timelineOf(undefined); timeline.media[mediaId] = { id: mediaId, kind: 'video', name: 'Local', frames: 60 };
    await act(async () => session.markDocument({ ...doc, schema_version: 3, timeline })); await conflict();
    jest.mocked(editorDeviceMedia.files).mockResolvedValue({ [mediaId]: { file: 'file://local', type: 'video/mp4', size: 1, seconds: 2 } });
    mockRequest.mockImplementationOnce(async () => ({ project: { id: copyId } })).mockImplementationOnce(async () => { throw new ApiError(0, 'network'); });
    await act(async () => session.sync.keepCopy()); const first = puts().at(-1);
    await act(async () => session.applyBackup(mediaId, { projectId: id, assetId: 'asset' }));
    await act(async () => session.sync.keepCopy());
    expect(puts().at(-1)).toEqual(first); expect(posts()).toHaveLength(1);
    expect(posts()[0][1].headers['Idempotency-Key']).toBeTruthy();
    expect(JSON.parse(first![1].body)).toMatchObject({ expected_revision: 0, document: { project_id: copyId } });
    expect(editorDeviceMedia.copy).toHaveBeenCalledWith(copyId, mediaId, 'file://local', 'video/mp4', 2);
    expect(mockCopy).toHaveBeenCalledWith(copyId); expect(stored).not.toBeNull();
});
test('a pending import blocks Keep copy until it lands, and the copied body contains its clip', async () => {
    await open(); await edit(); let token!: NonNullable<ReturnType<typeof session.beginImport>>;
    await act(async () => { token = session.beginImport()!; });
    head = { ...head, revision: 7 }; await tick(15000); expect(session.sync.sheet).toBe('conflict');
    await act(async () => session.sync.keepCopy()); expect(posts()).toHaveLength(0);
    await act(async () => { session.markDocument({ ...doc, brief: 'imported clip' }); token.end(); });
    await act(async () => session.sync.keepCopy()); expect(JSON.parse(puts()[0][1].body).document.brief).toBe('imported clip');
});
test('no import can start while a copy is in flight; a failed PUT resumes the frozen copy with the same keys', async () => {
    await open(); await edit(); await conflict(); const response = deferred<{ revision: number }>();
    mockRequest.mockImplementationOnce(async () => ({ project: { id: copyId } })).mockImplementationOnce(() => response.promise);
    await act(async () => { void session.sync.keepCopy(); }); expect(session.beginImport()).toBeNull();
    await act(async () => response.reject(new ApiError(503, 'unavailable'))); const first = puts().at(-1);
    await act(async () => session.sync.keepCopy()); expect(puts().at(-1)).toEqual(first); expect(posts()).toHaveLength(1); expect(mockCopy).toHaveBeenCalledWith(copyId);
});
test('Keep copy account_changed leaves the draft and schedules no retry or error', async () => {
    await open(); await edit(); await conflict(); await act(async () => session.sync.flushDraft()); const draft = stored;
    mockRequest.mockImplementationOnce(async () => ({ project: { id: copyId } })).mockImplementationOnce(async () => { throw new ApiError(401, 'account_changed'); });
    await act(async () => session.sync.keepCopy()); const count = puts().length; await tick(60000);
    expect(puts()).toHaveLength(count); expect(stored).toEqual(draft); expect(removeDraft).not.toHaveBeenCalled(); expect(session.problem).toBeNull(); expect(mockCopy).not.toHaveBeenCalled();
});
test('deferred backup after Use saved is drafted then PUT against the adopted head; no matching backup leaves it clean', async () => {
    await open(); const mediaId = 'l-22222222-2222-2222-2222-222222222222', timeline = timelineOf(undefined);
    timeline.media[mediaId] = { id: mediaId, kind: 'video', frames: 60 };
    await act(async () => session.markDocument({ ...doc, schema_version: 3, timeline })); await conflict();
    await act(async () => session.applyBackup(mediaId, { projectId: id, assetId: 'asset' }));
    head = { revision: 9, document: { ...doc, schema_version: 3, timeline } as any }; await useSaved();
    expect(session.dirty).toBe(true); expect(stored?.baseRevision).toBe(9); expect((stored?.document.timeline as any).media[mediaId].assetSource).toBeTruthy();
    const response = deferred<{ revision: number }>(); mockRequest.mockImplementationOnce(() => response.promise); await tick(900);
    expect(JSON.parse(puts().at(-1)![1].body)).toMatchObject({ expected_revision: 9, document: { timeline: { media: { [mediaId]: { assetSource: { assetId: 'asset' } } } } } });
    expect(stored).not.toBeNull(); await act(async () => response.resolve({ revision: 10 })); expect(stored).toBeNull();
});
test.each([false, true])('Library media-info account switch sends no asset request and shows no error (entry=%s)', async entry => {
    const response = deferred<unknown>();
    const base = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path, init) => path.endsWith('/media-info') ? response.promise : base(path, init));
    await open(entry ? 'job' : undefined);
    let result: unknown;
    if (!entry) {
        let token!: NonNullable<ReturnType<typeof session.beginImport>>;
        await act(async () => { token = session.beginImport()!; });
        void libraryMedia(session.api, { jobId: 'job', name: 'Job' }, 'video', () => token.valid()).then(value => { result = value; }).finally(token.end);
    }
    await act(async () => { mockGen++; mockOwner = 'B'; mockListeners.forEach(fn => fn()); response.reject(new ApiError(401, 'account_changed')); });
    if (!entry) expect(result).toBe(LIBRARY_STOPPED);
    expect(mockRequest.mock.calls.filter(([path]) => /\/asset(?:\?|$)/.test(path))).toHaveLength(0);
    expect(session.problem).toBeNull(); expect(puts()).toHaveLength(0);
});

test('copyChanged flushes a newer edit and leaves the frozen copy available without navigating', async () => {
    await open(); await edit(); await conflict(); const response = deferred<{ revision: number }>();
    mockRequest.mockImplementationOnce(async () => ({ project: { id: copyId } })).mockImplementationOnce(() => response.promise);
    await act(async () => { void session.sync.keepCopy(); }); await edit('unexpected edit');
    await act(async () => response.resolve({ revision: 1 }));
    expect(mockCopy).not.toHaveBeenCalled(); expect(session.sync.sheet).toBe('conflict');
    expect(session.problem).toBe(t('editorSave.copyChanged')); expect(stored?.document.brief).toBe('unexpected edit');
    const first = puts().at(-1); await act(async () => session.sync.keepCopy());
    expect(puts().at(-1)).toEqual(first); expect(mockCopy).not.toHaveBeenCalled();
});
test('failed copy creation retries its original name and create key', async () => {
    await open(); await edit(); await conflict();
    mockRequest.mockImplementationOnce(async () => { throw new ApiError(0, 'network'); }); await act(async () => session.sync.keepCopy());
    const first = posts()[0]; await act(async () => session.sync.keepCopy()); expect(posts()[1]).toEqual(first);
    expect(mockCopy).toHaveBeenCalledWith(copyId);
});
test('Recovery Discard confirms before removal and runs the deferred entry import on the head', async () => {
    stored = { owner: 'A', projectId: id, baseRevision: 4, document: { ...doc, brief: 'draft' }, updatedAt: 1 };
    await open('job'); expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/media-info'))).toBe(false);
    await act(async () => session.sync.discard()); expect(removeDraft).not.toHaveBeenCalled(); await confirm();
    expect(removeDraft).toHaveBeenCalled(); expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/media-info'))).toBe(true);
    expect(session.document?.brief).toBe('head'); expect(session.dirty).toBe(true);
});
test('a clean adopted head without matching deferred backup stays clean and sends no PUT', async () => {
    await open(); head = { ...head, revision: 8 }; await tick(15000);
    await act(async () => session.applyBackup('missing-media', { projectId: id, assetId: 'asset' }));
    await act(async () => session.sync.useSaved()); await tick(900);
    expect(session.dirty).toBe(false); expect(session.revision).toBe(8); expect(puts()).toHaveLength(0);
});

test('invalid local documents are refused before a save or copy PUT', async () => {
    await open(); await edit('x'.repeat(6001)); await act(async () => session.save());
    expect(puts()).toHaveLength(0); expect(session.saveStatus).toBe(t('editor.rejected'));
    head = { ...head, revision: 8 }; await tick(15000); await act(async () => session.sync.keepCopy());
    expect(puts()).toHaveLength(0); expect(posts()).toHaveLength(0);
});

test('fix-1 HIGH-1: Recovery Restore never removes the stored draft; the rewrite replaces it', async () => {
    stored = { owner: 'A', projectId: id, baseRevision: 4, document: { ...doc, brief: 'recovered' }, updatedAt: 1 }; const original = stored;
    const write = deferred<void>(); jest.mocked(writeDraft).mockImplementationOnce(async value => { await write.promise; stored = value; return true; });
    await open(); await act(async () => session.sync.recover());
    expect(removeDraft).not.toHaveBeenCalled(); expect(stored).toEqual(original); expect(writeDraft).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve()); expect(stored?.document.brief).toBe('recovered'); expect(removeDraft).not.toHaveBeenCalled();
});
test('fix-1 HIGH-2: a failed draft read keeps drafting and saving, warns, and leaving offline still asks', async () => {
    jest.mocked(readDraft).mockRejectedValueOnce(new Error('io')); await open();
    expect(session.problem).toBe(t('editorSave.draftUnreadable'));
    await edit(); await tick(900); expect(writeDraft).toHaveBeenCalled(); expect(puts()).toHaveLength(1); expect(session.dirty).toBe(false);
    markOffline(); await edit('offline'); await act(async () => { void session.leaveEditor(); });
    expect(Alert.alert).toHaveBeenLastCalledWith(t('editor.leaveKept'), undefined, expect.any(Array), expect.any(Object));
});
test('fix-1 HIGH-3: a backup that finishes while Versions is open is applied, drafted and saved after Close', async () => {
    await open(); const mediaId = 'l-22222222-2222-2222-2222-222222222222', timeline = timelineOf(undefined);
    timeline.media[mediaId] = { id: mediaId, kind: 'video', frames: 60 };
    await act(async () => session.markDocument({ ...doc, schema_version: 3, timeline })); await tick(900); expect(session.dirty).toBe(false);
    await act(async () => session.sync.openVersions()); await act(async () => session.applyBackup(mediaId, { projectId: id, assetId: 'asset' }));
    expect(session.dirty).toBe(false);
    await act(async () => session.sync.closeVersions()); expect(session.dirty).toBe(true);
    await tick(400); expect((stored?.document.timeline as any).media[mediaId].assetSource).toEqual({ projectId: id, assetId: 'asset' }); await tick(500);
    expect(JSON.parse(puts().at(-1)![1].body)).toMatchObject({ expected_revision: 5, document: { timeline: { media: { [mediaId]: { assetSource: { assetId: 'asset' } } } } } });
});
test.each([401, 408, 413])('fix-1 MEDIUM-1: save status %s is shown and retried instead of sticking', async status => {
    await open(); await edit(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(status, 'x'); });
    await act(async () => session.save()); expect(session.saveStatus).toBe(t('editor.retry')); expect(session.sync.retryVisible).toBe(true);
    await tick(5000); expect(puts()).toHaveLength(2); expect(session.dirty).toBe(false); expect(session.sync.canStart).toBe(true);
});
test('fix-1 MEDIUM-2: a session generation change before the cache owner changes stops drafts and saves', async () => {
    await open(); await edit(); await act(async () => { mockGen++; }); await tick(60000);
    expect(puts()).toHaveLength(0); expect(writeDraft).not.toHaveBeenCalled(); expect(session.sync.live()).toBe(false);
});
