import { act } from 'react';
import { Alert, AppState, ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { usePreventRemove } from 'expo-router';
import Editor from '../src/app/(app)/editor/[projectId]';
import NewEditor from '../src/app/(app)/editor/new';
import * as flag from '../src/lib/editorFlag';
import { ApiError } from '../src/lib/api';
import { readDraft, removeDraft, writeDraft } from '../src/lib/editorDrafts';
import { resetNetworkState } from '../src/lib/network';
import type { ProjectDocument } from '../src/lib/editorBridge';

// Resolve native lazy exports before interaction timeouts start.
void [ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View];

// The first native render includes Expo's lazily loaded platform implementation.
jest.setTimeout(30000);
const id = '11111111-1111-1111-1111-111111111111';
const copyId = '22222222-2222-2222-2222-222222222222';
const doc: ProjectDocument = { schema_version: 1, project_id: id, brief: 'saved', canvas: { aspect_ratio: '16:9', frame_rate: 30 } };
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockDisable = jest.fn();
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };
let mockProps: any, mockMounts: number, mockOwner: string, mockUserListener: () => void;
let mockWorkingDoc = doc, mockAutoFlush = true;
let mockPosts: any[] = [];
let mockParams: Record<string, string> = { projectId: id };
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `test-key-${++mockUuid}` }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => mockParams, useRouter: () => mockRouter, useIsFocused: () => true, usePreventRemove: jest.fn(() => mockDisable) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/editorFlag', () => ({ __esModule: true, EDITOR_ENABLED: true }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn(), writeDraft: jest.fn(), removeDraft: jest.fn() }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockUserListener = fn; return () => {}; } }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: () => null }));
jest.mock('react-native-webview', () => {
    const React = jest.requireActual('react');
    return { WebView: React.forwardRef((props: any, ref: any) => {
        mockProps = props;
        React.useEffect(() => { mockMounts++; }, []);
        React.useImperativeHandle(ref, () => ({ postMessage: (raw: string) => {
            const msg = JSON.parse(raw); mockPosts.push(msg);
            if (msg.type === 'load') mockWorkingDoc = msg.document;
            if (msg.type === 'flush' && mockAutoFlush) void props.onMessage({ nativeEvent: { url: props.source.baseUrl, data: JSON.stringify({ v: 1, type: 'flushed', nonce: msg.nonce, projectId: id, document: mockWorkingDoc }) } });
        } }));
        return null;
    }) };
});
let root: Root, appState: (state: AppStateStatus) => void, serverRevision: number;
const puts = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'PUT');
const prevented = () => jest.mocked(usePreventRemove).mock.calls.at(-1)![0];
const removeCallback = () => jest.mocked(usePreventRemove).mock.calls.at(-1)![1]!;
const visible = (text: string) => root.container.queryAll(node => node.children.includes(text)).length > 0;
async function press(label: string) {
    const nodes = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label);
    expect(nodes).toHaveLength(1);
    await act(async () => { nodes[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
async function message(msg: object, origin?: string) {
    await act(async () => { await mockProps.onMessage({ nativeEvent: { url: origin ?? mockProps.source.baseUrl, data: JSON.stringify({ v: 1, ...msg }) } }); });
}
async function hello(protocol = 1) {
    await message({ type: 'hello', protocol, engine: { kind: 'stub', version: '1' }, caps: { secureContext: true, webcodecs: true, offscreenCanvas: false } });
}
async function change(brief = 'mine', origin?: string) {
    mockWorkingDoc = { ...doc, brief };
    await message({ type: 'changed', projectId: id, document: mockWorkingDoc }, origin);
}
async function advance(ms: number) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
async function render() { await act(async () => root.render(<Editor />)); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers(); jest.setSystemTime(0); jest.clearAllMocks(); resetNetworkState();
    Object.assign(flag, { EDITOR_ENABLED: true }); mockParams = { projectId: id };
    mockProps = undefined; mockMounts = 0; mockOwner = 'u'; mockPosts = []; mockAutoFlush = true; mockWorkingDoc = doc; serverRevision = 4;
    jest.mocked(readDraft).mockResolvedValue(null); jest.mocked(writeDraft).mockResolvedValue(true); jest.mocked(removeDraft).mockResolvedValue();
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return { revision: serverRevision + 1 };
        if (init?.method === 'POST') return { project: { id: copyId, workspace_id: 'w', name: 'Project — edit copy' } };
        if (path.endsWith('/document')) return { revision: serverRevision, document: doc, created_at: '2026-10-21' };
        if (path === '/api/v1/workspaces') return { workspaces: [{ id: 'w', is_default: true }] };
        return { project: { id, workspace_id: 'w', name: 'Project' } };
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, fn) => { appState = fn; return { remove: jest.fn() }; });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('flag off has no WebView or API requests for either route', async () => {
    Object.assign(flag, { EDITOR_ENABLED: false }); await render();
    expect(visible('The editor is not available yet')).toBe(true); expect(mockProps).toBeUndefined(); expect(mockRequest).not.toHaveBeenCalled();
    await act(async () => root.render(<NewEditor />)); expect(visible('The editor is not available yet')).toBe(true); expect(mockRequest).not.toHaveBeenCalled();
});
test('hello gates init and load, then 3s quiet saves with the loaded revision', async () => {
    await render(); expect(mockPosts).toEqual([]);
    await change(); expect(writeDraft).not.toHaveBeenCalled();
    await hello(); expect(mockPosts.map(m => m.type)).toEqual(['init', 'load']);
    expect(mockPosts[1]).toMatchObject({ revision: 4, document: doc });
    await change(); await advance(2999); expect(puts()).toHaveLength(0);
    await advance(1); expect(puts()).toHaveLength(1);
    expect(JSON.parse(puts()[0][1].body)).toMatchObject({ expected_revision: 4, document: { brief: 'mine' } });
    expect(removeDraft).toHaveBeenCalledWith(id);
});
test('wrong-origin and foreign-project edits cannot write drafts or change state', async () => {
    await render(); await hello(); await change('evil', 'https://other.test');
    await message({ type: 'changed', projectId: copyId, document: { ...doc, project_id: copyId } });
    await advance(3000); expect(writeDraft).not.toHaveBeenCalled(); expect(puts()).toHaveLength(0);
});
test('protocol mismatch sends nothing; malformed hello times out with retry', async () => {
    await render(); await hello(2); expect(visible('Update the app to use the editor')).toBe(true); expect(mockPosts).toEqual([]);
});
test('invalid hello times out after fifteen seconds', async () => {
    await render(); await message({ type: 'hello', protocol: '1' }); await advance(15000);
    expect(visible('The editor could not start')).toBe(true); expect(mockPosts).toEqual([]);
});
test('both process death callbacks remount; latest document survives and second kill stops', async () => {
    await render(); await hello(); await change();
    await act(async () => mockProps.onContentProcessDidTerminate()); await advance(0);
    expect(mockMounts).toBe(2); await hello(); expect(mockPosts.filter(m => m.type === 'load').at(-1).document.brief).toBe('mine');
    await act(async () => mockProps.onRenderProcessGone()); await advance(0);
    expect(mockMounts).toBe(2); expect(visible('The phone closed the editor to free memory. Your changes are kept.')).toBe(true);
});
test('WebView privacy and navigation restrictions', async () => {
    await render(); expect(mockProps).toMatchObject({ incognito: true, domStorageEnabled: false, allowFileAccess: false, setSupportMultipleWindows: false, javaScriptCanOpenWindowsAutomatically: false });
    expect(mockProps.source.html).toContain('Developer stub'); expect(mockProps.injectedJavaScript).toBeUndefined();
    expect(mockProps.onShouldStartLoadWithRequest({ url: 'about:blank' })).toBe(true);
    expect(mockProps.onShouldStartLoadWithRequest({ url: mockProps.source.baseUrl })).toBe(true);
    expect(mockProps.onShouldStartLoadWithRequest({ url: 'https://evil.test' })).toBe(false);
});
test('Done flushes latest typing and a failed save offers Leave/Stay', async () => {
    await render(); await hello(); mockWorkingDoc = { ...doc, brief: 'typed within debounce' };
    mockRequest.mockRejectedValueOnce(new ApiError(0, 'network'));
    await press('Done');
    expect(writeDraft).toHaveBeenCalledWith(expect.objectContaining({ document: mockWorkingDoc }));
    expect(puts()).toHaveLength(1); expect(Alert.alert).toHaveBeenCalledWith('Leave? Your changes stay on this phone', undefined, expect.any(Array), expect.any(Object));
    await act(async () => jest.mocked(Alert.alert).mock.calls.at(-1)![2]![0].onPress!());
    expect(prevented()).toBe(true); expect(mockRouter.back).not.toHaveBeenCalled();
});
test('storage failure never claims the unsaved changes are kept', async () => {
    await render(); await hello(); jest.mocked(writeDraft).mockResolvedValue(false);
    await change(); expect(visible('These changes are not saved anywhere yet')).toBe(true);
    mockRequest.mockRejectedValueOnce(new ApiError(0, 'network')); await press('Done');
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)![0]).toBe('Leave? These changes will be lost');
});
test('409 offers both choices and copy saves revision zero with a rewritten project id', async () => {
    await render(); await hello(); await change(); mockRequest.mockRejectedValueOnce(new ApiError(409, 'conflict')); await advance(3000);
    expect(visible('Use the saved version')).toBe(true); expect(visible('Keep mine as a copy')).toBe(true);
    await press('Keep mine as a copy');
    expect(JSON.parse(puts().at(-1)![1].body)).toEqual({ expected_revision: 0, document: { ...doc, brief: 'mine', project_id: copyId } });
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/editor/[projectId]', params: { projectId: copyId } });
});
test('older-base draft conflicts before any engine load; copy retries reuse both keys', async () => {
    serverRevision = 5;
    jest.mocked(readDraft).mockResolvedValue({ owner: 'u', projectId: id, baseRevision: 4, document: { ...doc, brief: 'unsaved' }, updatedAt: 1 });
    await render(); expect(mockProps).toBeUndefined(); expect(visible('Keep mine as a copy')).toBe(true);
    const usual = mockRequest.getMockImplementation()!;
    let failed = false;
    mockRequest.mockImplementation(async (path, init) => { if (init?.method === 'PUT' && !failed) { failed = true; throw new ApiError(0, 'network'); } return usual(path, init); });
    await press('Keep mine as a copy'); await press('Keep mine as a copy');
    const creates = mockRequest.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(creates).toHaveLength(1); expect(puts()).toHaveLength(2);
    expect(puts()[0][1]).toEqual(puts()[1][1]); expect(JSON.parse(puts()[0][1].body).expected_revision).toBe(0);
});
test('same-base draft offers restore even with an old timestamp, no load until chosen', async () => {
    jest.mocked(readDraft).mockResolvedValue({ owner: 'u', projectId: id, baseRevision: 4, document: { ...doc, brief: 'unsaved' }, updatedAt: 1 });
    await render(); expect(mockProps).toBeUndefined(); expect(visible('Restore unsaved changes')).toBe(true);
    await press('Restore unsaved changes'); await hello();
    expect(mockPosts.find(m => m.type === 'load').document.brief).toBe('unsaved');
});
test('conflict use-saved needs a second confirmation before removing the draft', async () => {
    jest.mocked(readDraft).mockResolvedValue({ owner: 'u', projectId: id, baseRevision: 3, document: { ...doc, brief: 'unsaved' }, updatedAt: 1 });
    await render(); await press('Use the saved version'); expect(removeDraft).not.toHaveBeenCalled();
    await act(async () => jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1].onPress!());
    expect(removeDraft).toHaveBeenCalledWith(id); await hello(); expect(mockPosts.find(m => m.type === 'load').document).toEqual(doc);
});
test('future-base draft is removed instead of silently rebased', async () => {
    jest.mocked(readDraft).mockResolvedValue({ owner: 'u', projectId: id, baseRevision: 6, document: { ...doc, brief: 'future' }, updatedAt: 1 });
    await render(); expect(removeDraft).toHaveBeenCalledWith(id); await hello(); expect(mockPosts.find(m => m.type === 'load').document).toEqual(doc);
});
test('offline autosave probes itself after 5 then 10 seconds, with no external online signal', async () => {
    await render(); await hello(); await change();
    mockRequest.mockRejectedValueOnce(new ApiError(0, 'network')).mockRejectedValueOnce(new ApiError(0, 'network'));
    await advance(3000); expect(puts()).toHaveLength(1);
    await advance(5000); expect(puts()).toHaveLength(2);
    await advance(10000); expect(puts()).toHaveLength(3); expect(visible('Saved')).toBe(true);
    expect(new Set(puts().map(([, init]) => init.headers['Idempotency-Key'])).size).toBe(1);
});
test.each(['active', 'button'])('%s retries offline immediately', async trigger => {
    await render(); await hello(); await change(); mockRequest.mockRejectedValueOnce(new ApiError(0, 'network')); await advance(3000);
    if (trigger === 'active') await act(async () => appState('active')); else await press('Retry now');
    expect(puts()).toHaveLength(2);
});
test('rate limit holds active, Retry, and leave saves until sixty seconds', async () => {
    await render(); await hello(); await change(); mockRequest.mockRejectedValueOnce(new ApiError(429, 'rate', { retryAfterSeconds: 60 })); await advance(3000);
    await advance(1000); await act(async () => appState('active')); await advance(1000);
    const button = root.container.queryAll(n => n.props.accessibilityRole === 'button' && String(n.props.accessibilityLabel).startsWith('Try again'))[0];
    expect(button.props.accessibilityState.disabled).toBe(true);
    await press('Done'); expect(puts()).toHaveLength(1);
    await act(async () => jest.mocked(Alert.alert).mock.calls.at(-1)![2]![0].onPress!());
    await advance(57900); expect(puts()).toHaveLength(1); await advance(100); expect(puts()).toHaveLength(2);
});
test('guard flushes debounce text before repeating navigation, while prevention stays on', async () => {
    await render(); await hello(); mockWorkingDoc = { ...doc, brief: '100ms typing' };
    expect(prevented()).toBe(true);
    const repeat = jest.fn(() => expect(prevented()).toBe(false));
    await act(async () => removeCallback()({ data: { action: { type: 'GO_BACK' } }, repeat }));
    expect(writeDraft).toHaveBeenCalledWith(expect.objectContaining({ document: mockWorkingDoc })); expect(puts()).toHaveLength(1); expect(repeat).toHaveBeenCalledTimes(1);
});
test('guard awaits an in-flight save and then saves the newly flushed snapshot', async () => {
    await render(); await hello(); await change();
    let finish!: (value: object) => void;
    mockRequest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await advance(3000);
    mockWorkingDoc = { ...doc, brief: 'typed during save' };
    const repeat = jest.fn();
    await act(async () => removeCallback()({ data: { action: { type: 'GO_BACK' } }, repeat }));
    expect(prevented()).toBe(true); expect(repeat).not.toHaveBeenCalled(); expect(puts()).toHaveLength(1);
    serverRevision = 5;
    await act(async () => finish({ revision: 5 }));
    expect(puts()).toHaveLength(2); expect(JSON.parse(puts()[1][1].body).expected_revision).toBe(5); expect(repeat).toHaveBeenCalledTimes(1);
});
test('account teardown skips prompts and ignores outstanding responses', async () => {
    await render(); await hello(); await change();
    await act(async () => { mockOwner = 'other'; mockUserListener(); });
    expect(mockDisable).toHaveBeenCalledTimes(1); expect(mockRouter.back).toHaveBeenCalledTimes(1); expect(Alert.alert).not.toHaveBeenCalled();
    const count = jest.mocked(writeDraft).mock.calls.length;
    await change('late'); await advance(3000); expect(writeDraft).toHaveBeenCalledTimes(count); expect(puts()).toHaveLength(0);
});
test('new empty project creates in default workspace with a stable key and routes to the editor', async () => {
    await act(async () => root.render(<NewEditor />)); await press('Empty project');
    const post = mockRequest.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ workspace_id: 'w', name: 'Untitled edit' });
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/editor/[projectId]', params: { projectId: copyId } });
});

test('initial network failure cannot promise an unverified durable copy', async () => {
    mockRequest.mockRejectedValueOnce(new ApiError(0, 'network'));
    await render();
    expect(visible('No connection. Check your internet and try again.')).toBe(true);
    expect(visible('You are offline; changes are kept on this phone')).toBe(false);
});


test('409 waits for pending debounce text before hiding the engine and copying', async () => {
    await render(); await hello(); await change();
    mockWorkingDoc = { ...doc, brief: 'typed while PUT was pending' };
    mockAutoFlush = false;
    mockRequest.mockRejectedValueOnce(new ApiError(409, 'conflict'));
    await advance(3000);
    const flush = mockPosts.find(m => m.type === 'flush');
    expect(flush).toBeDefined();
    expect(visible('Keep mine as a copy')).toBe(false);
    await message({ type: 'flushed', nonce: flush.nonce, projectId: id, document: mockWorkingDoc });
    expect(writeDraft).toHaveBeenLastCalledWith(expect.objectContaining({ document: mockWorkingDoc }));
    expect(visible('Keep mine as a copy')).toBe(true);
    await press('Keep mine as a copy');
    expect(JSON.parse(puts().at(-1)![1].body)).toEqual({ expected_revision: 0, document: { ...mockWorkingDoc, project_id: copyId } });
});
test.each([3, 4])('a leftover draft matching the saved head at base %s is removed silently', async baseRevision => {
    // Identity does not depend on JSON key order.
    const sameDocument = { brief: doc.brief, canvas: doc.canvas, project_id: id, schema_version: 1 as const };
    jest.mocked(readDraft).mockResolvedValue({ owner: 'u', projectId: id, baseRevision, document: sameDocument, updatedAt: 1 });
    await render();
    expect(removeDraft).toHaveBeenCalledWith(id);
    expect(visible('Keep mine as a copy')).toBe(false); expect(visible('Restore unsaved changes')).toBe(false);
    await hello(); expect(mockPosts.find(m => m.type === 'load')).toMatchObject({ document: doc, revision: 4 });
    await advance(3000); expect(puts()).toHaveLength(0);
});
test.each(['autosave', 'Done'])('%s saves native-held changes after two kills without reopening the engine', async trigger => {
    await render(); await hello(); await change();
    await act(async () => mockProps.onContentProcessDidTerminate()); await hello();
    await act(async () => mockProps.onRenderProcessGone());
    expect(mockMounts).toBe(2);
    if (trigger === 'autosave') await advance(3000); else await press('Done');
    expect(puts()).toHaveLength(1); expect(JSON.parse(puts()[0][1].body).document.brief).toBe('mine');
    expect(mockMounts).toBe(2); expect(Alert.alert).not.toHaveBeenCalled();
    if (trigger === 'Done') expect(mockRouter.back).toHaveBeenCalledTimes(1);
    else expect(visible('Saved')).toBe(true);
});
