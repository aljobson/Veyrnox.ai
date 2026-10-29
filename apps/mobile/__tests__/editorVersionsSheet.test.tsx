import { act } from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { EditorVersionsSheet } from '../src/components/editor/EditorVersionsSheet';
import { ApiError } from '../src/lib/api';
import { readDraft, writeDraft, removeDraft, type EditorDraft } from '../src/lib/editorDrafts';
import { t } from '../src/lib/i18n';
const id = '11111111-1111-1111-1111-111111111111';
const doc = { schema_version: 1 as const, project_id: id, brief: 'head' };
let mockGen = 0, mockKey = 0, mockOwner = 'A';
const mockListeners = new Set<() => void>(), mockRequest = jest.fn();
const mockApi = { request: mockRequest }, mockRouter = { back: jest.fn() };
const mockBegin = () => { const gen = mockGen; return { current: () => gen === mockGen }; };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `key-${++mockKey}` }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: mockBegin }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockListeners?.add(fn); return () => mockListeners?.delete(fn); } }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn(), writeDraft: jest.fn(), removeDraft: jest.fn() }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}) } }));
let root: Root, session: ReturnType<typeof useFullEditorSession>, stored: EditorDraft | null;
let head = { revision: 4, document: doc }, background: (state: AppStateStatus) => void;
function Harness() {
    session = useFullEditorSession({ projectId: id });
    return <EditorVersionsSheet sync={session.sync} api={session.api} projectId={id} />;
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = async (ms: number) => { await act(async () => jest.advanceTimersByTimeAsync(ms)); };
const puts = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'PUT');
const text = (value: string) => root.container.queryAll(node => node.children.includes(value));
async function press(label: string) {
    const button = root.container.queryAll(node => node.props.accessibilityLabel === label && typeof node.props.onClick === 'function')[0];
    expect(button).toBeTruthy(); await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
const row = press;
async function open() { await act(async () => root.render(<Harness />)); await act(async () => session.sync.openVersions()); }
async function restore() {
    await act(async () => session.sync.restore(2));
    const button = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(b => b.text === t('projects.restore'))!;
    await act(async () => button.onPress!());
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks();
    mockGen = 0; mockKey = 0; mockOwner = 'A'; stored = null; head = { revision: 4, document: doc };
    Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { background = listener; return { remove: jest.fn() }; });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.mocked(readDraft).mockImplementation(async () => stored);
    jest.mocked(writeDraft).mockImplementation(async draft => { stored = draft; return true; });
    jest.mocked(removeDraft).mockImplementation(async () => { stored = null; });
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return { revision: 5, document: { ...doc, brief: 'restored' } };
        if (path.includes('/history?')) return { versions: [{ revision: 2, created_at: '2026-10-01T00:00:00Z' }], next_before: null };
        if (path.endsWith('/history')) return { versions: [{ revision: 4, created_at: '2026-10-02T00:00:00Z', restored_from: 2 }], next_before: 4 };
        if (path.includes('/document?revision=')) return { revision: Number(path.split('=').at(-1)), document: doc };
        if (path.endsWith('/document')) return head;
        return { project: { id, workspace_id: 'workspace', name: 'Cut' } };
    }); root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

test('lists current and restored-from, loads older, previews clip count and confirms Restore', async () => {
    await open(); expect(text('Version 4 (current)').length).toBeGreaterThan(0);
    expect(root.container.queryAll(node => node.children.some(child => typeof child === 'string' && child.includes('Restored from version 2'))).length).toBeGreaterThan(0);
    await press('Load older'); await row('Version 2'); expect(text('0 clips').length).toBeGreaterThan(0);
    await press('Restore'); expect(Alert.alert).toHaveBeenCalledWith(t('projects.restoreversion'), t('projects.thissavesanewversioncopiedfrom'), expect.any(Array));
    await act(async () => jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1].onPress!());
    expect(JSON.parse(puts()[0][1].body)).toEqual({ expected_revision: 4, restore_revision: 2 });
    expect(puts()[0][1].headers['Idempotency-Key']).toBeTruthy(); expect(session.document?.brief).toBe('restored'); expect(session.revision).toBe(5);
});
test('Restore is disabled while dirty or while an import runs and is rechecked at confirmation', async () => {
    await open(); await press('Load older'); await row('Version 2');
    await act(async () => session.markDocument({ ...doc, brief: 'edit' }));
    expect(text(t('editorSave.saveFirst')).length).toBeGreaterThan(0);
    await press('Restore'); expect(Alert.alert).not.toHaveBeenCalled();
    await act(async () => root.unmount()); root = createRoot(); stored = null; await open();
    let token!: NonNullable<ReturnType<typeof session.beginImport>>;
    await act(async () => { token = session.beginImport()!; session.sync.restore(2); }); expect(Alert.alert).not.toHaveBeenCalled();
    await act(async () => { token.end(); session.sync.restore(2); }); expect(Alert.alert).toHaveBeenCalledTimes(1);
    await act(async () => { token = session.beginImport()!; });
    await act(async () => jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1].onPress!()); expect(puts()).toHaveLength(0);
    await act(async () => token.end());
});
test('a restore timeout shows Retry restore; retry reuses key, expected revision and restore revision and adopts reply', async () => {
    await open(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(0, 'network'); }); await restore();
    expect(text(t('editorSave.restoreUnknown')).length).toBeGreaterThan(0); expect(session.sync.restoreUnknown).toBe(true);
    const first = puts()[0]; await press('Retry restore'); expect(puts()[1]).toEqual(first);
    expect(session.revision).toBe(5); expect(session.document?.brief).toBe('restored'); expect(session.dirty).toBe(false); expect(session.sync.sheet).toBeNull();
});
test('Close retains ambiguous restore: unchanged head proves nothing; automatic same-key replay adopts the late idempotent commit', async () => {
    await open(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(0, 'network'); }); await restore();
    const first = puts()[0]; await press('Close'); expect(session.saveStatus).toBe(t('editorSave.restoreUnknown'));
    await act(async () => background('active')); expect(session.sync.restoreUnknown).toBe(true); expect(session.revision).toBe(4);
    mockRequest.mockImplementationOnce(async () => ({ revision: 5, document: { ...doc, brief: 'late restored' }, idempotent: true }));
    await tick(5000); expect(puts()[1]).toEqual(first); expect(session.document?.brief).toBe('late restored'); expect(session.revision).toBe(5); expect(session.sync.sheet).toBeNull();
});
test('ambiguous restore clears only when a GET shows a revision above op.current and opens conflict without moving base', async () => {
    await open(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(503, 'unavailable'); }); await restore();
    await press('Close'); head = { revision: 6, document: { ...doc, brief: 'remote' } };
    await act(async () => background('active')); expect(session.sync.restoreUnknown).toBe(false);
    expect(session.sync.sheet).toBe('conflict'); expect(session.revision).toBe(4); expect(session.document).toEqual(doc);
    await tick(10000); expect(puts()).toHaveLength(1);
});
test('same-key replay answered 409 clears retained restore and opens conflict', async () => {
    await open(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(0, 'network'); }); await restore(); const first = puts()[0];
    mockRequest.mockImplementationOnce(async () => { throw new ApiError(409, 'conflict'); }); await press('Retry restore');
    expect(puts()[1]).toEqual(first); expect(session.sync.restoreUnknown).toBe(false); expect(session.sync.sheet).toBe('conflict'); expect(session.revision).toBe(4);
});
test('restore retry account_changed is quiet, does not remove the draft and schedules no further retry', async () => {
    await open(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(0, 'network'); }); await restore();
    const draft = { owner: 'A', projectId: id, baseRevision: 4, document: { ...doc, brief: 'stored' }, updatedAt: 1 }; stored = draft;
    mockRequest.mockImplementationOnce(async () => { throw new ApiError(401, 'account_changed'); }); await press('Retry restore');
    await tick(60000); expect(puts()).toHaveLength(2); expect(stored).toEqual(draft); expect(removeDraft).not.toHaveBeenCalled(); expect(session.problem).toBeNull(); expect(session.sync.restoreUnknown).toBe(false);
});
test('a restore reply over a newer edit opens conflict without moving base; flush and reopen still show conflict', async () => {
    await open(); const response = deferred<typeof head>(); mockRequest.mockImplementationOnce(() => response.promise); await restore();
    await act(async () => session.markDocument({ ...doc, brief: 'new local edit' }));
    head = { revision: 5, document: { ...doc, brief: 'restored on server' } }; await act(async () => response.resolve(head));
    expect(session.revision).toBe(4); expect(session.document?.brief).toBe('new local edit'); expect(session.sync.sheet).toBe('conflict');
    await act(async () => background('background')); expect(stored?.baseRevision).toBe(4);
    await act(async () => root.unmount()); root = createRoot(); await act(async () => root.render(<Harness />));
    expect(session.sync.sheet).toBe('conflict'); expect(session.revision).toBe(4);
});
test('replacement excludes new imports; an older Library token is dropped after restore rather than overwriting it', async () => {
    await open(); let token!: NonNullable<ReturnType<typeof session.beginImport>>;
    await act(async () => { token = session.beginImport()!; token.end(); });
    const response = deferred<typeof head>(); mockRequest.mockImplementationOnce(() => response.promise); await restore();
    expect(session.beginImport()).toBeNull(); await act(async () => response.resolve({ revision: 5, document: doc }));
    let valid = true; await act(async () => { valid = token.valid(); });
    expect(valid).toBe(false); expect(session.problem).toBe(t('editorSave.importDropped')); expect(session.revision).toBe(5);
});
test('invalid restore reply and unchanged refetched head retain the operation for same-key retry', async () => {
    await open(); mockRequest.mockImplementationOnce(async () => ({ revision: 5, document: { invalid: true } })); await restore();
    expect(session.sync.restoreUnknown).toBe(true); expect(session.revision).toBe(4);
    const first = puts()[0]; await tick(5000); expect(puts()[1]).toEqual(first); expect(session.revision).toBe(5);
});
test('late history and preview replies after owner change are dropped quietly', async () => {
    await open(); await press('Load older');
    const response = deferred<typeof head>(); mockRequest.mockImplementationOnce(() => response.promise);
    const node = root.container.queryAll(item => item.props.accessibilityLabel === 'Version 2' && typeof item.props.onClick === 'function')[0];
    await act(async () => { void node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); mockGen++; mockOwner = 'B'; mockListeners.forEach(fn => fn()); });
    await act(async () => response.resolve({ revision: 2, document: doc }));
    expect(text('0 clips')).toHaveLength(0); expect(session.problem).toBeNull();
});

test('failed head refetch after invalid restore reply cannot resolve the ambiguous operation', async () => {
    await open(); mockRequest.mockImplementationOnce(async () => ({})).mockImplementationOnce(async () => { throw new ApiError(404, 'missing'); });
    await restore(); expect(session.sync.restoreUnknown).toBe(true); expect(session.revision).toBe(4);
    await tick(5000); expect(puts()).toHaveLength(2); expect(session.revision).toBe(5);
});
test('automatic restore retry waits for a running import and then replays the retained request', async () => {
    await open(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(0, 'network'); }); await restore();
    let token!: NonNullable<ReturnType<typeof session.beginImport>>; await act(async () => { token = session.beginImport()!; });
    await tick(5000); expect(puts()).toHaveLength(1); await act(async () => token.end()); await tick(1000);
    expect(puts()).toHaveLength(2); expect(puts()[1]).toEqual(puts()[0]); expect(session.revision).toBe(5);
});

test('account_changed from history quietly drops a retained restore without retry or draft removal', async () => {
    await open(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(0, 'network'); }); await restore();
    await press('Close'); mockRequest.mockImplementationOnce(async () => { throw new ApiError(401, 'account_changed'); });
    await act(async () => session.sync.openVersions()); await tick(60000);
    expect(puts()).toHaveLength(1); expect(session.sync.restoreUnknown).toBe(false); expect(session.sync.sheet).toBeNull();
    expect(session.problem).toBeNull(); expect(removeDraft).not.toHaveBeenCalled();
});

test('fix-1 MEDIUM-1: a restore refused with 413 clears the operation, shows a problem and lets autosave run', async () => {
    await open(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(413, 'too_large'); }); await restore();
    expect(session.sync.restoreUnknown).toBe(false); expect(session.sync.canStart).toBe(true); expect(session.problem).toBeTruthy();
    await press('Close'); await act(async () => session.markDocument({ ...doc, brief: 'edit' })); await tick(900); expect(puts()).toHaveLength(2);
});
test('fix-1 MEDIUM-1: a restore that answers 408 is kept as unknown and replayed with the same key', async () => {
    await open(); mockRequest.mockImplementationOnce(async () => { throw new ApiError(408, 'timeout'); }); await restore();
    expect(session.sync.restoreUnknown).toBe(true); const first = puts()[0];
    await tick(5000); expect(puts()[1]).toEqual(first); expect(session.revision).toBe(5);
});
test('fix-1 LOW: an invalid restore reply followed by a newer head adopts it when the local document is unchanged', async () => {
    await open(); head = { revision: 6, document: { ...doc, brief: 'remote' } };
    mockRequest.mockImplementationOnce(async () => ({ revision: 5, document: { invalid: true } })); await restore();
    expect(session.sync.restoreUnknown).toBe(false); expect(session.sync.sheet).toBeNull(); expect(session.revision).toBe(6); expect(session.document?.brief).toBe('remote');
});
