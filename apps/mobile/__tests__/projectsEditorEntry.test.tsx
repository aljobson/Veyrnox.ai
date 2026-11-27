import { act } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Detail from '../src/app/(app)/projects/[id]';
import List from '../src/app/(app)/projects/index';
import * as flag from '../src/lib/editorFlag';
void [ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View];
// The first native render includes Expo's lazily loaded platform implementation.
jest.setTimeout(30000);
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockRemove = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/lib/editorDeviceMedia', () => ({ removeProjectMedia: (...args: unknown[]) => mockRemove(...args) }));
jest.mock('../src/lib/editorFontFiles', () => ({ removeProjectFonts: jest.fn().mockResolvedValue(undefined) }));
let mockHeader: any;
jest.mock('expo-router', () => ({ Stack: { Screen: ({ options }: any) => { mockHeader = options; return options.headerRight?.() ?? null; } }, useLocalSearchParams: () => ({ id: 'project' }), useRouter: () => ({ push: mockPush, back: mockBack }), usePreventRemove: () => () => {}, useIsFocused: () => true, useFocusEffect: (callback: () => void) => require('react').useEffect(() => { callback(); }, []) }));
jest.mock('../src/lib/editorFlag', () => ({ __esModule: true, EDITOR_ENABLED: false }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: mockBeginSessionTask }) }));
const mockBeginSessionTask = () => ({ current: () => true });
let listProjects: unknown[] = [];
const requests: { path: string; method: string }[] = [];
const mockApi = { request: async (path: string, init: { method?: string } = {}) => {
    requests.push({ path, method: init.method ?? 'GET' });
    if (path.includes('/history')) return { versions: [] };
    if (path.includes('/document')) return { revision: 0, document: { schema_version: 1, project_id: 'project', brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 } } };
    if (path === '/api/v1/workspaces') return { workspaces: [{ id: 'workspace' }] };
    if (path.startsWith('/api/v1/project-folders?')) return { folders: [] };
    if (path.includes('?workspace_id=')) return { projects: listProjects };
    if (init.method === 'DELETE') return {};
    return { project: { id: 'project', name: 'Project' } };
} };
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockPush.mockClear(); mockRemove.mockClear(); requests.length = 0; listProjects = []; });
afterEach(async () => { await act(async () => root.unmount()); });
const controls = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && ['Open in editor', 'New edit'].includes(n.props.accessibilityLabel));
test('flag off preserves both screens without editor controls', async () => {
    Object.assign(flag, { EDITOR_ENABLED: false });
    await act(async () => root.render(<Detail />)); expect(controls()).toHaveLength(0);
    expect(root.container.queryAll(n => n.children.includes('Saved versions'))).toHaveLength(1);
    await act(async () => root.render(<List />)); expect(controls()).toHaveLength(0); expect(mockHeader).toEqual({ title: 'Projects' });
});
test('flag on detail routes to its editor, list header starts a new edit', async () => {
    Object.assign(flag, { EDITOR_ENABLED: true });
    await act(async () => root.render(<Detail />));
    await act(async () => controls()[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/editor/[projectId]', params: { projectId: 'project' } });
    await act(async () => root.render(<List />));
    await act(async () => controls()[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockPush).toHaveBeenCalledWith('/editor/new');
});

test('confirmed successful deletion starts best-effort media cleanup before navigating back', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => root.render(<Detail />));
    let button = root.container.queryAll(n => n.children.includes('Delete'))[0];
    while (button && typeof button.props.onClick !== 'function') button = button.parent!;
    await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    const action = alert.mock.calls.at(-1)![2]!.find(item => item.style === 'destructive')!;
    await act(async () => action.onPress!());
    expect(mockRemove).toHaveBeenCalledWith('project'); expect(mockBack).toHaveBeenCalled();
    expect(mockRemove.mock.invocationCallOrder.at(-1)).toBeLessThan(mockBack.mock.invocationCallOrder.at(-1)!);
    alert.mockRestore();
});

test('the project list exposes a confirmed delete action without opening an empty project', async () => {
    listProjects = [{ id: 'blank', workspace_id: 'workspace', name: 'Untitled edit', version: 1 }];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => root.render(<List />));
    const button = root.container.queryAll(n => n.props.accessibilityLabel === 'Delete Untitled edit' && typeof n.props.onClick === 'function')[0];
    expect(button).toBeDefined();
    await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    const action = alert.mock.calls.at(-1)![2]!.find(item => item.style === 'destructive')!;
    await act(async () => action.onPress!());
    expect(requests).toContainEqual({ path: '/api/v1/projects/blank', method: 'DELETE' });
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Delete Untitled edit')).toHaveLength(0);
    alert.mockRestore();
});
