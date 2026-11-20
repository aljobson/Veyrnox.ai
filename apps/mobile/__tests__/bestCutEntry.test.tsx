import { act } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import * as SecureStore from 'expo-secure-store';
import { BestCutEntry } from '../src/components/editor/BestCutEntry';
import { rawText, t } from '../src/lib/i18n';

void [ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View];
jest.setTimeout(30000);
const mockPush = jest.fn(), mockRequest = jest.fn();
const mockApi = { request: mockRequest };
let mockCurrent = true;
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'creation-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: () => ({ current: () => mockCurrent }) }) }));
jest.mock('../src/components/editor/useBestCutAvailability', () => ({ useBestCutAvailability: () => ({ quote: { credits: 1, max_seconds: 60, languages: ['en'] } }) }));

let root: Root;
const workspaces = { workspaces: [{ id: 'other' }, { id: 'workspace', is_default: true }] };
const project = { project: { id: 'project' } };
const creates = () => mockRequest.mock.calls.filter(([path, init]) => path === '/api/v1/projects' && init?.method === 'POST');
const modals = () => root.container.queryAll(n => typeof n.props.onRequestClose === 'function' && n.props.visible);
const buttons = (scope: TestInstance, key: string) => scope.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === rawText(t(key)) && typeof n.props.onClick === 'function');
const confirm = () => buttons(modals()[0], 'bestCut.title')[0];
async function press(node: TestInstance) {
    await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
async function show() {
    await act(async () => root.render(<BestCutEntry />));
    await press(buttons(root.container, 'bestCut.title')[0]);
}
async function agree() {
    const control = root.container.queryAll(n => n.props.accessibilityLabel === rawText(t('bestCut.agree')) && typeof n.props.onChange === 'function')[0];
    expect(control).toBeDefined();
    await act(async () => control.props.onChange({ nativeEvent: { value: true } }));
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); mockCurrent = true; root = createRoot();
    mockRequest.mockImplementation(async (path: string) => path === '/api/v1/workspaces' ? workspaces : project);
});
afterEach(async () => {
    await act(async () => root.unmount());
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

test('entry opens consent without fetching workspaces, creating a project or navigating', async () => {
    await show();
    expect(creates()).toHaveLength(0); expect(mockPush).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled(); expect(modals()).toHaveLength(1);
    for (const key of ['bestCut.intro', 'bestCut.consent', 'bestCut.metadata']) {
        // The consent prints the brand as the bold wordmark (a nested run), so its text is read as one joined string.
        const text = (n: any): string => n.children.map((c: any) => typeof c === 'string' ? c : text(c)).join('');
        expect(modals()[0].queryAll(n => text(n) === t(key).replace('Veyrnox.ai', 'VEYRNOX.ai')).length).toBeGreaterThan(0);
    }
});

test.each(['notNow', 'requestClose'])('%s dismisses without creating or navigating', async reason => {
    await show();
    expect(creates()).toHaveLength(0);
    expect(modals()).toHaveLength(1);
    if (reason === 'notNow') await press(buttons(modals()[0], 'bestCut.notNow')[0]);
    else await act(async () => modals()[0].props.onRequestClose());
    expect(modals()).toHaveLength(0); expect(mockRequest).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});

test('confirmation is disabled until agreement; reopening starts with no agreement', async () => {
    await show();
    expect(confirm().props.accessibilityState.disabled).toBe(true);
    await press(confirm()); expect(mockRequest).not.toHaveBeenCalled();
    await agree(); expect(confirm().props.accessibilityState.disabled).toBe(false);
    await press(buttons(modals()[0], 'bestCut.notNow')[0]);
    await press(buttons(root.container, 'bestCut.title')[0]);
    expect(confirm().props.accessibilityState.disabled).toBe(true);
});

test('agree and confirm create exactly one project in the default workspace and open Best Cut', async () => {
    await show(); await agree(); await press(confirm());
    expect(creates()).toHaveLength(1);
    expect(JSON.parse(creates()[0][1].body)).toEqual({ workspace_id: 'workspace', name: t('bestCut.title') });
    expect(creates()[0][1].headers['Idempotency-Key']).toBe('creation-key');
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/editor/[projectId]', params: { projectId: 'project', bestCut: '1' } });
    expect(modals()).toHaveLength(0);
});

test('pending confirmation ignores dismissals and repeated confirmation through both awaits', async () => {
    const workspaceWait = deferred<typeof workspaces>(), projectWait = deferred<typeof project>();
    mockRequest.mockImplementation((path: string) => path === '/api/v1/workspaces' ? workspaceWait.promise : projectWait.promise);
    await show(); await agree(); await press(confirm());
    async function tryDismiss() {
        expect(confirm().props.accessibilityState.disabled).toBe(true);
        const cancel = buttons(modals()[0], 'bestCut.notNow')[0];
        expect(cancel.props.accessibilityState.disabled).toBe(true);
        await press(cancel); await act(async () => modals()[0].props.onRequestClose()); await press(confirm());
        expect(modals()).toHaveLength(1); expect(mockPush).not.toHaveBeenCalled();
    }
    await tryDismiss(); expect(creates()).toHaveLength(0);
    await act(async () => workspaceWait.resolve(workspaces));
    await tryDismiss(); expect(creates()).toHaveLength(1);
    await act(async () => projectWait.resolve(project));
    expect(creates()).toHaveLength(1); expect(mockPush).toHaveBeenCalledTimes(1); expect(modals()).toHaveLength(0);
});

test('creation failure closes consent and shows an error without navigating or persisting agreement', async () => {
    mockRequest.mockImplementation(async (path: string) => {
        if (path === '/api/v1/workspaces') return workspaces;
        throw new Error('creation failed');
    });
    await show(); await agree(); await press(confirm());
    expect(creates()).toHaveLength(1); expect(mockPush).not.toHaveBeenCalled(); expect(modals()).toHaveLength(0);
    expect(root.container.queryAll(n => n.children.includes(t('common.error'))).length).toBeGreaterThan(0);
    await press(buttons(root.container, 'bestCut.title')[0]);
    expect(confirm().props.accessibilityState.disabled).toBe(true);
});

test.each(['workspaces', 'project'])('session change while awaiting %s stops subsequent work', async stage => {
    const wait = deferred<typeof workspaces | typeof project>();
    mockRequest.mockImplementation(async (path: string) => {
        if (path === '/api/v1/workspaces') return stage === 'workspaces' ? wait.promise : workspaces;
        return wait.promise;
    });
    await show(); await agree(); await press(confirm());
    mockCurrent = false;
    await act(async () => wait.resolve(stage === 'workspaces' ? workspaces : project));
    expect(creates()).toHaveLength(stage === 'workspaces' ? 0 : 1); expect(mockPush).not.toHaveBeenCalled();
    expect(modals()).toHaveLength(0); // A stale session must never leave the dialog stuck busy.
});
