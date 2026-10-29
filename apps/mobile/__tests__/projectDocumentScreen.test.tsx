import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import Screen from '../src/app/(app)/projects/[id]';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { resetNetworkState } from '../src/lib/network';
import en from '../src/lib/i18n/messages/en/projectDocument';
import { ProjectDocumentCard } from '../src/components/projects/ProjectDocumentCard';
import { useProjectDocument } from '../src/components/projects/useProjectDocument';

jest.setTimeout(60000);
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `key-${++n}` }; });
const mockPush = jest.fn(), mockBack = jest.fn(), mockDisable = jest.fn();
const mockRemove = jest.fn().mockResolvedValue(undefined);
let mockFocused = true;
let mockFocus: (() => void) | null = null;
jest.mock('expo-router', () => ({
    Stack: { Screen: () => null },
    useLocalSearchParams: () => ({ id: 'project' }),
    useRouter: () => ({ push: mockPush, back: mockBack }),
    usePreventRemove: () => mockDisable,
    useIsFocused: () => mockFocused,
    useFocusEffect: (callback: () => void) => { mockFocus = callback; require('react').useEffect(() => { callback(); }, []); },
}));
jest.mock('../src/lib/editorFlag', () => ({ __esModule: true, EDITOR_ENABLED: true }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ removeProjectMedia: (...args: unknown[]) => mockRemove(...args) }));
const mockRequest = jest.fn();
const mockAuth: { api: unknown; beginSessionTask?: () => { current(): boolean } } = { api: { request: (...args: unknown[]) => mockRequest(...args) }, beginSessionTask: () => ({ current: () => true }) };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
// Render every row so ordering is observable without native virtualization.
jest.mock('react-native', () => {
    const rn = jest.requireActual('react-native');
    return Object.defineProperty(Object.create(rn), 'FlatList', { value: ({ data, renderItem, keyExtractor, onEndReached, ListHeaderComponent, ListFooterComponent, ListEmptyComponent }: any) => {
        const React = jest.requireActual('react');
        return React.createElement('FlatList', { data, onEndReached }, ListHeaderComponent, data.length ? data.map((item: any, index: number) =>
            React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item, index }))) : ListEmptyComponent, ListFooterComponent);
    } });
});
const native = jest.requireActual('react-native');
void [native.ActivityIndicator, native.Modal, native.Pressable, native.ScrollView, native.StyleSheet, native.Text, native.TextInput, native.View, native.Animated];

type Doc = Record<string, unknown>;
const doc = (brief: string, extra: Doc = {}): Doc => ({ schema_version: 1, project_id: 'project', brief, canvas: { aspect_ratio: '16:9', frame_rate: 30 }, ...extra });
const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const range = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => ({ revision: from - i, created_at: null }));
const limited = (code: string) => new ApiError(429, 'unknown', { error: { code }, retryAfterSeconds: 60 });

let head: { revision: number; document: Doc };
let history: (before: number | undefined) => Promise<unknown>;
let onPut: (body: any) => Promise<unknown>;
let onDelete: () => Promise<unknown>;
let onPatch: () => Promise<unknown>;
let onGetDocument: () => Promise<unknown>;
const calls: { path: string; method: string; body: any; key?: string }[] = [];
const puts = () => calls.filter(c => c.method === 'PUT');
const pageCalls = () => calls.filter(c => c.path.includes('/history'));
let root: Root;
let alert: jest.SpyInstance;

beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    resetNetworkState(); resetCacheUser(); await bindCacheUser('alice');
    calls.length = 0; mockPush.mockClear(); mockBack.mockClear(); mockDisable.mockClear(); mockRemove.mockClear();
    mockFocused = true; mockFocus = null;
    head = { revision: 3, document: doc('Hello') };
    history = async () => ({ versions: range(3, 1) });
    onPut = async (body) => ({ revision: body.expected_revision + 1, document: body.document ?? doc(`Old ${body.restore_revision}`) });
    onDelete = async () => ({}); onPatch = async () => ({ project: { id: 'project', name: 'Renamed', version: 2 } });
    onGetDocument = async () => head;
    mockRequest.mockImplementation(async (path: string, init: any = {}) => {
        const method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : undefined;
        calls.push({ path, method, body, key: init.headers?.['Idempotency-Key'] });
        if (path.includes('/history')) { const m = /before=(\d+)/.exec(path); return history(m ? Number(m[1]) : undefined); }
        const revision = /revision=(\d+)/.exec(path);
        if (revision) return { revision: Number(revision[1]), document: doc(`Old ${revision[1]}`), created_at: '2026-10-01T10:00:00Z' };
        if (path.endsWith('/document')) return method === 'PUT' ? onPut(body) : onGetDocument();
        if (method === 'DELETE') return onDelete();
        if (method === 'PATCH') return onPatch();
        return { project: { id: 'project', name: 'Project', version: 1 } };
    });
    alert = jest.spyOn(native.Alert, 'alert').mockImplementation(() => {});
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); jest.useRealTimers(); });

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
async function render() { await act(async () => root.render(<Screen />)); await flush(); }
async function wait(ms: number) { await act(async () => { jest.advanceTimersByTime(ms); }); await flush(); }
const field = () => root.container.queryAll(n => n.props.maxLength === 6000 && typeof n.props.onChangeText === 'function')[0];
async function type(text: string) { await act(async () => field().props.onChangeText(text)); }
const byLabel = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function');
async function press(label: string) { const node = byLabel(label)[0]; expect(node).toBeDefined(); await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); await flush(); }
async function pressText(text: string) {
    let node = root.container.queryAll(n => n.children.includes(text))[0];
    while (node && typeof node.props.onClick !== 'function') node = node.parent!;
    await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); await flush();
}
const disabled = (label: string) => byLabel(label).every(n => n.props.accessibilityState?.disabled === true);
const has = (text: string) => root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes(text))).length > 0;
const alertButton = (text: string) => alert.mock.calls.at(-1)![2]!.find((b: any) => b.text === text);
const list = () => root.container.queryAll(n => n.type === 'FlatList')[0];
const shown = () => list().props.data.map((v: any) => v.revision);
async function more() { await act(async () => { list().props.onEndReached(); }); await flush(); }

test('the brief loads, and typing then waiting 3 s sends one PUT against the head with an Idempotency-Key', async () => {
    await render();
    expect(field().props.value).toBe('Hello');
    await type('Hello world'); await wait(2999); expect(puts()).toHaveLength(0);
    await wait(1); expect(puts()).toHaveLength(1);
    expect(puts()[0].body).toEqual({ expected_revision: 3, document: doc('Hello world') });
    expect(puts()[0].key).toBeTruthy();
    expect(has('Saved as version 4')).toBe(true);
});

test('a failed PUT retried by Save now reuses the same key', async () => {
    onPut = async () => { throw new ApiError(500, 'unknown'); };
    await render(); await type('Changed'); await wait(3000);
    expect(has(en['projectDocument.notSaved'])).toBe(true);
    onPut = async (body) => ({ revision: 4, document: body.document });
    await press(en['projectDocument.retrySave']);
    expect(puts()).toHaveLength(2); expect(puts()[1].key).toBe(puts()[0].key);
});

test('409: Review latest, then Save my draft instead keeps the remote timeline; Use saved replaces the draft', async () => {
    const timeline = { video: [{ id: 'clip' }], audio: [] };
    onPut = async () => { throw new ApiError(409, 'unknown'); };
    await render(); await type('Mine'); await wait(3000);
    expect(has(en['projectDocument.newerSaved'])).toBe(true);
    head = { revision: 7, document: doc('Remote', { schema_version: 2, timeline }) };
    await press(en['projectDocument.reviewLatest']);
    expect(has('Remote')).toBe(true);
    onPut = async (body) => ({ revision: 8, document: body.document });
    await press(en['projectDocument.saveDraftInstead']);
    expect(puts().at(-1)!.body).toEqual({ expected_revision: 7, document: doc('Mine', { schema_version: 2, timeline }) });
    expect(field().props.value).toBe('Mine');
    onPut = async () => { throw new ApiError(409, 'unknown'); };
    await type('Again'); await wait(3000);
    head = { revision: 9, document: doc('Theirs') };
    await press(en['projectDocument.reviewLatest']);
    await press(en['projectDocument.useSaved']);
    expect(field().props.value).toBe('Theirs');
});

test('a 404 on load shows the quiet text and the versions list still renders', async () => {
    onGetDocument = async () => { throw new ApiError(404, 'unknown'); };
    await render();
    expect(has(en['projectDocument.notAvailable'])).toBe(true);
    expect(has('Version 2')).toBe(true); expect(has('404')).toBe(false);
});

test('version preview fetches ?revision=2, and Restore is disabled while dirty', async () => {
    await render();
    await press('Preview version 2');
    expect(calls.some(c => c.path === '/api/v1/projects/project/document?revision=2')).toBe(true);
    expect(has('Old 2')).toBe(true);
    expect(disabled('Restore version 2')).toBe(false);
    await type('Dirty');
    expect(disabled('Restore version 2')).toBe(true);
    expect(has(en['projectDocument.saveBeforeRestore'])).toBe(true);
    for (const node of byLabel('Restore version 2')) await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(puts().filter(c => c.body.restore_revision)).toHaveLength(0);
});

test('a history page failure shows Retry', async () => {
    history = async (before) => { if (before) throw new ApiError(500, 'unknown'); return { versions: range(3, 2), next_before: 2 }; };
    await render(); await more();
    expect(has(en['projectDocument.olderFailed'])).toBe(true);
    history = async (before) => ({ versions: before ? range(1, 1) : range(3, 2), next_before: null });
    await press(en['projectDocument.retry']);
    expect(shown()).toEqual([3, 2, 1]); expect(has(en['projectDocument.olderFailed'])).toBe(false);
});

test('after an account switch, a late result is dropped and nothing more is sent', async () => {
    const held = deferred<unknown>();
    onPut = () => held.promise;
    await render(); await type('Alice text'); await wait(3000);
    await act(async () => { await bindCacheUser('bob'); }); await flush();
    held.resolve({ revision: 4, document: doc('Alice text') }); await flush(); await wait(10000);
    expect(puts()).toHaveLength(1); expect(has('Alice text')).toBe(false); expect(has('Saved as version 4')).toBe(false);
});

test('rename answered 409 shows Reload latest, which re-fetches the project and keeps the typed name', async () => {
    onPatch = async () => { throw new ApiError(409, 'unknown'); };
    await render(); await pressText('Rename');
    const input = root.container.queryAll(n => n.props.accessibilityLabel === 'Project name' && n.props.onChangeText)[0];
    await act(async () => input.props.onChangeText('Typed name'));
    await pressText('Save');
    const gets = calls.filter(c => c.path === '/api/v1/projects/project').length;
    await press(en['projectDocument.reloadLatest']);
    expect(calls.filter(c => c.path === '/api/v1/projects/project').length).toBe(gets + 1);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Project name' && n.props.onChangeText)[0].props.value).toBe('Typed name');
});

test('R2: Open in editor 1 s after an edit sends one PUT and pushes only after it resolves', async () => {
    const held = deferred<unknown>();
    onPut = () => held.promise;
    await render(); await type('Before editor'); await wait(1000);
    await press('Open in editor');
    expect(puts()).toHaveLength(1); expect(mockPush).not.toHaveBeenCalled();
    held.resolve({ revision: 4, document: doc('Before editor') }); await flush();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/editor/[projectId]', params: { projectId: 'project' } });
    await wait(3000); expect(puts()).toHaveLength(1);
});

test('R2: a failed hand-off save offers Open without my changes, which pushes with the draft reset', async () => {
    onPut = async () => { throw new ApiError(500, 'unknown'); };
    await render(); await type('Lost'); await press('Open in editor');
    expect(alert.mock.calls.at(-1)![0]).toBe(en['projectDocument.latestNotSaved']);
    expect(alertButton(en['projectDocument.keepEditing']).style).toBe('cancel');
    await act(async () => alertButton(en['projectDocument.openWithout']).onPress()); await flush();
    expect(mockPush).toHaveBeenCalledTimes(1); expect(field().props.value).toBe('Hello');
    await wait(3000); expect(puts()).toHaveLength(1);
});

test('R2: with the screen unfocused an edit plus 3 s sends no PUT', async () => {
    await render(); mockFocused = false; await act(async () => root.render(<Screen />));
    await type('Hidden'); await wait(3000); expect(puts()).toHaveLength(0);
});

test('R2: on return a clean draft adopts a newer head, a dirty one shows Review latest and keeps the draft', async () => {
    await render();
    head = { revision: 5, document: doc('From editor') };
    await act(async () => mockFocus!()); await flush();
    expect(field().props.value).toBe('From editor');
    await type('Mine now');
    head = { revision: 6, document: doc('Editor again') };
    await act(async () => mockFocus!()); await flush();
    expect(byLabel(en['projectDocument.reviewLatest'])).toHaveLength(1); expect(field().props.value).toBe('Mine now');
    await wait(3000); expect(puts()).toHaveLength(0);
});

test('R3: restore during a save is disabled until it settles, then sends the saved head and shows the reply; no later autosave', async () => {
    const held = deferred<unknown>();
    onPut = () => held.promise;
    await render(); await type('Saving'); await wait(3000);
    expect(disabled('Restore version 1')).toBe(true);
    held.resolve({ revision: 4, document: doc('Saving') }); await flush();
    expect(disabled('Restore version 1')).toBe(false);
    onPut = async (body) => ({ revision: 5, document: doc(`Old ${body.restore_revision}`) });
    await press('Restore version 1');
    await act(async () => alertButton('Restore').onPress()); await flush();
    expect(puts().at(-1)!.body).toEqual({ expected_revision: 4, restore_revision: 1 });
    expect(field().props.value).toBe('Old 1');
    await wait(3000); expect(puts()).toHaveLength(2);
});

test('R3: a restore answered 409 shows the conflict panel and is not retried', async () => {
    onPut = async () => { throw new ApiError(409, 'unknown'); };
    await render(); await pressText('Restore');
    await act(async () => alertButton('Restore').onPress()); await flush();
    expect(byLabel(en['projectDocument.reviewLatest'])).toHaveLength(1);
    await wait(120000); expect(puts()).toHaveLength(1);
});

test('PD-01: an account_changed save is dropped quietly and keeps the draft', async () => {
    onPut = async () => { throw new ApiError(401, 'account_changed'); };
    await render(); await type('Typed for Alice'); await wait(3000);
    for (const key of ['notSaved', 'saving', 'unsaved', 'notAvailable'] as const) expect(has(en[`projectDocument.${key}`])).toBe(false);
    expect(alert).not.toHaveBeenCalled();
    await wait(3000); for (const node of byLabel(en['projectDocument.saveNow'])) await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(puts()).toHaveLength(1); expect(field().props.value).toBe('Typed for Alice');
    await act(async () => { await bindCacheUser('bob'); }); await flush();
    expect(has('Typed for Alice')).toBe(false);
});

test('PD-01: a restore rejecting with account_changed shows no note and is not retried', async () => {
    onPut = async () => { throw new ApiError(401, 'account_changed'); };
    await render(); await pressText('Restore');
    await act(async () => alertButton('Restore').onPress()); await flush();
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert')).toHaveLength(0);
    await wait(120000); expect(puts()).toHaveLength(1);
});

test('PD-02: a revision-cap 429 stops autosave and keeps the draft', async () => {
    head = { revision: 1000, document: doc('Capped') };
    await render(); await act(async () => field().props.onChangeText('Edit')); await wait(3000);
    expect(puts()).toHaveLength(0); expect(has('This project has reached 1000 versions')).toBe(true);
    expect(disabled(en['projectDocument.saveNow'])).toBe(true); expect(disabled('Restore version 1')).toBe(true);
    expect(field().props.value).toBe('Capped');
});

test('PD-02: a daily-limit 429 stops autosave; Save now sends one PUT per tap', async () => {
    head = { revision: 999, document: doc('Near') };
    onPut = async () => { throw limited('LIMIT_REACHED'); };
    await render(); await type('Daily'); await wait(3000);
    expect(has(en['projectDocument.dailyLimit'])).toBe(true);
    await wait(600000); expect(puts()).toHaveLength(1);
    await press(en['projectDocument.retrySave']); expect(puts()).toHaveLength(2);
    await press(en['projectDocument.retrySave']); expect(puts()).toHaveLength(3);
    expect(field().props.value).toBe('Daily');
});

test('PD-02: three RATE_LIMITED replies in a row hold autosave until Save now', async () => {
    onPut = async () => { throw limited('RATE_LIMITED'); };
    await render(); await type('Busy'); await wait(3000);
    expect(has(en['projectDocument.paused'])).toBe(true);
    await wait(60000); await wait(60000); expect(puts()).toHaveLength(3);
    expect(has(en['projectDocument.held'])).toBe(true);
    await wait(600000); expect(puts()).toHaveLength(3);
    await press(en['projectDocument.retrySave']); expect(puts()).toHaveLength(4);
    expect(field().props.value).toBe('Busy');
});

test('PD-03: an Oddlings project cannot be restored from the phone', async () => {
    head = { revision: 3, document: { schema_version: 4, project_id: 'project', oddlings: {} } };
    await render();
    expect(has(en['projectDocument.unsupported'])).toBe(true); expect(disabled('Restore version 1')).toBe(true);
    await press('Preview version 1');
    expect(disabled('Restore version 1')).toBe(true);
    for (const node of byLabel('Restore version 1')) await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(puts()).toHaveLength(0);
});

test('PD-03: a load failing with 503 disables Restore with a reload Retry', async () => {
    onGetDocument = async () => { throw new ApiError(503, 'unknown'); };
    await render();
    expect(disabled('Restore version 1')).toBe(true); expect(has(en['projectDocument.loadFailed'])).toBe(true);
    onGetDocument = async () => head;
    await press(en['projectDocument.reloadText']);
    expect(disabled('Restore version 1')).toBe(false); expect(puts()).toHaveLength(0);
});

test('PD-04: deleting a project with a dirty draft goes back without the leave Alert', async () => {
    await render(); await type('Unsaved'); await pressText('Delete');
    await act(async () => alertButton('Delete').onPress()); await flush();
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(1);
    await wait(3000); expect(puts()).toHaveLength(0);
    expect(alert.mock.calls.some(c => JSON.stringify(c).includes(en['projectDocument.keepEditing']))).toBe(false);
    expect(mockDisable.mock.invocationCallOrder[0]).toBeLessThan(mockBack.mock.invocationCallOrder[0]);
    expect(mockRemove.mock.invocationCallOrder[0]).toBeLessThan(mockBack.mock.invocationCallOrder[0]);
});

test('PD-04: a failing DELETE keeps the draft and the next 3 s sends one PUT', async () => {
    onDelete = async () => { throw new ApiError(500, 'unknown'); };
    await render(); await type('Kept'); await pressText('Delete');
    await act(async () => alertButton('Delete').onPress()); await flush();
    expect(field().props.value).toBe('Kept'); expect(mockBack).not.toHaveBeenCalled();
    await wait(3000); expect(puts()).toHaveLength(1);
});

test('PD-05: typing during a pending restore is locked out and not lost later', async () => {
    const held = deferred<unknown>();
    onPut = () => held.promise;
    await render(); await pressText('Restore');
    await act(async () => alertButton('Restore').onPress()); await flush();
    expect(field().props.editable).toBe(false);
    await act(async () => field().props.onChangeText('Sneaky')); expect(field().props.value).toBe('Hello');
    held.resolve({ revision: 4, document: doc('Restored') }); await flush();
    expect(field().props.value).toBe('Restored'); expect(has(en['projectDocument.restoring'])).toBe(false);
    onPut = async (body) => ({ revision: 5, document: body.document });
    await type('After'); await wait(3000);
    expect(puts().at(-1)!.body.expected_revision).toBe(4);
});

test('PD-05: a restore that rejects unlocks the field with the earlier draft intact', async () => {
    onPut = async () => { throw new ApiError(500, 'unknown'); };
    await render(); await pressText('Restore');
    await act(async () => alertButton('Restore').onPress()); await flush();
    expect(field().props.editable).toBe(true); expect(field().props.value).toBe('Hello');
});

test('PD-06: an autosave that starts while the Delete Alert is open is awaited before DELETE', async () => {
    const held = deferred<unknown>();
    onPut = () => held.promise;
    await render(); await type('Racing'); await pressText('Delete');
    const destroy = alertButton('Delete');
    await wait(3000); expect(puts()).toHaveLength(1);
    let done!: Promise<unknown>;
    await act(async () => { done = destroy.onPress(); }); await flush();
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(0);
    held.resolve({ revision: 4, document: doc('Racing') }); await act(async () => { await done; }); await flush();
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(1);
    await wait(3000); expect(puts()).toHaveLength(1);
    expect(mockRemove.mock.invocationCallOrder[0]).toBeLessThan(mockBack.mock.invocationCallOrder[0]);
});

test('PD-06: the Delete callback does nothing while a restore is in flight', async () => {
    const held = deferred<unknown>();
    onPut = () => held.promise;
    await render(); await pressText('Delete'); const destroy = alertButton('Delete');
    await pressText('Restore'); await act(async () => alertButton('Restore').onPress()); await flush();
    await act(async () => destroy.onPress()); await flush();
    held.resolve({ revision: 4, document: doc('Old 1') }); await flush();
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(0);
});

// History sequencing: a refresh starts after each successful save.
function heldHistory() {
    const pending: { before?: number; d: ReturnType<typeof deferred<unknown>> }[] = [];
    history = (before) => { const d = deferred<unknown>(); pending.push({ before, d }); return d.promise; };
    return pending;
}
async function startWithPage(pending: ReturnType<typeof heldHistory>) {
    head = { revision: 100, document: doc('Hello') };
    await render(); pending.shift()!.d.resolve({ versions: range(100, 51), next_before: 51 }); await flush();
    expect(shown()[0]).toBe(100);
}
async function saveOnce(text: string) { await type(text); await wait(3000); }

test('PD-07: a pagination page that resolves after a save\'s history refresh keeps the new revision', async () => {
    for (const outcome of ['resolve', 'reject'] as const) {
        const pending = heldHistory();
        await startWithPage(pending);
        await more(); const page = pending.shift()!; expect(page.before).toBe(51);
        await saveOnce(`Saved ${outcome}`);
        pending.shift()!.d.resolve({ versions: range(101, 52), next_before: 52 }); await flush();
        if (outcome === 'resolve') page.d.resolve({ versions: range(50, 1), next_before: null }); else page.d.reject(new ApiError(500, 'unknown'));
        await flush();
        expect(shown()[0]).toBe(101); expect(shown()).toHaveLength(50); expect(has(en['projectDocument.olderFailed'])).toBe(false);
        await more(); expect(pending.at(-1)!.before).toBe(52);
        await act(async () => root.unmount()); root = createRoot(); calls.length = 0;
    }
});

test('more() during a history refresh sends no page request', async () => {
    const pending = heldHistory();
    await startWithPage(pending);
    await saveOnce('Saved'); const refresh = pending.shift()!;
    await more(); expect(pageCalls().some(c => c.path.includes('before=51'))).toBe(false);
    refresh.d.resolve({ versions: range(101, 52), next_before: 52 }); await flush();
    await more(); const pages = pageCalls().filter(c => c.path.includes('before='));
    expect(pages.map(c => c.path)).toEqual(['/api/v1/projects/project/history?before=52']);
    pending.shift()!.d.resolve({ versions: range(51, 1), next_before: null }); await flush();
    expect(shown()).toEqual(range(101, 1).map(v => v.revision));
    expect(shown().filter((r: number) => r === 51)).toHaveLength(1);
});

test('a refresh during more() drops the old page', async () => {
    for (const outcome of ['resolve', 'reject'] as const) {
        const pending = heldHistory();
        await startWithPage(pending);
        await more(); const page = pending.shift()!;
        await saveOnce(`Saved ${outcome}`);
        pending.shift()!.d.resolve({ versions: range(101, 52), next_before: 52 }); await flush();
        if (outcome === 'resolve') page.d.resolve({ versions: range(50, 1), next_before: 1 }); else page.d.reject(new ApiError(500, 'unknown'));
        await flush();
        expect(shown()).toEqual(range(101, 52).map(v => v.revision)); expect(has(en['projectDocument.olderFailed'])).toBe(false);
        await more(); expect(pending.at(-1)!.before).toBe(52);
        await act(async () => root.unmount()); root = createRoot(); calls.length = 0;
    }
});

test('two quick refreshes: only the last one commits', async () => {
    for (const order of ['BA', 'AB'] as const) {
        const pending = heldHistory();
        await startWithPage(pending);
        await saveOnce('One'); const a = pending.shift()!;
        await saveOnce('Two'); const b = pending.shift()!;
        const first = order === 'BA' ? b : a, second = order === 'BA' ? a : b;
        first.d.resolve(first === b ? { versions: range(102, 53), next_before: 53 } : { versions: range(100, 51), next_before: 51 }); await flush();
        if (order === 'AB') { await more(); expect(pageCalls().filter(c => c.path.includes('before='))).toHaveLength(0); }
        second.d.resolve(second === b ? { versions: range(102, 53), next_before: 53 } : { versions: range(100, 51), next_before: 51 }); await flush();
        expect(shown()[0]).toBe(102);
        await more(); expect(pending.at(-1)!.before).toBe(53);
        await act(async () => root.unmount()); root = createRoot(); calls.length = 0;
    }
});

test('fail closed: with no session fence nothing is sent or written and the card shows the failure state', async () => {
    const fence = mockAuth.beginSessionTask;
    delete mockAuth.beginSessionTask;
    try {
        function Probe() { return <ProjectDocumentCard doc={useProjectDocument({ api: mockAuth.api as never, id: 'project', onSaved: () => undefined, onRestored: () => undefined })} />; }
        await act(async () => root.render(<Probe />)); await flush(); await wait(60000);
        expect(calls.filter(c => c.path.endsWith('/document'))).toHaveLength(0);
        expect(has(en['projectDocument.notAvailable'])).toBe(true);
        await act(async () => root.render(<Screen />)); await flush(); await wait(60000);
        expect(calls.filter(c => c.method !== 'GET')).toHaveLength(0);
    } finally {
        mockAuth.beginSessionTask = fence;
    }
});

test('a locked aspect ratio and frame rate are each one disabled element to the screen reader', async () => {
    const held = deferred<unknown>();
    onPut = () => held.promise;
    await render();
    const wrappers = () => root.container.queryAll(n => n.props.accessible === true && n.props.importantForAccessibility === 'no-hide-descendants');
    expect(wrappers()).toHaveLength(0);
    await pressText('Restore'); await act(async () => alertButton('Restore').onPress()); await flush();
    const locked = wrappers();
    expect(locked.map(n => n.props.accessibilityLabel)).toEqual([en['projectDocument.aspectRatio'], en['projectDocument.frameRate']]);
    for (const n of locked) expect(n.props.accessibilityState).toEqual({ disabled: true });
    expect(locked.map(n => n.props.accessibilityValue.text)).toEqual([en['projectDocument.landscape'], '30 fps']);
    held.resolve({ revision: 4, document: doc('Restored') }); await flush();
    expect(wrappers()).toHaveLength(0);
});

test('a restore answered RATE_LIMITED is tried again with the same key once the pause ends', async () => {
    let first = true;
    onPut = async (body) => { if (first) { first = false; throw limited('RATE_LIMITED'); } return { revision: 4, document: doc(`Old ${body.restore_revision}`) }; };
    await render(); await pressText('Restore');
    await act(async () => alertButton('Restore').onPress()); await flush();
    expect(has(en['projectDocument.paused'])).toBe(true); expect(puts()).toHaveLength(1);
    await wait(59000); expect(puts()).toHaveLength(1);
    await wait(1000); expect(puts()).toHaveLength(2);
    expect(puts()[1].body).toEqual(puts()[0].body); expect(puts()[1].key).toBe(puts()[0].key);
    expect(field().props.value).toBe(`Old ${puts()[0].body.restore_revision}`);
    expect(has(en['projectDocument.paused'])).toBe(false);
});
