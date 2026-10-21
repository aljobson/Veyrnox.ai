import { act } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Detail from '../src/app/(app)/projects/[id]';
import List from '../src/app/(app)/projects/index';
import * as flag from '../src/lib/editorFlag';
void [ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View];
// The first native render includes Expo's lazily loaded platform implementation.
jest.setTimeout(30000);
const mockPush = jest.fn();
let mockHeader: any;
jest.mock('expo-router', () => ({ Stack: { Screen: ({ options }: any) => { mockHeader = options; return options.headerRight?.() ?? null; } }, useLocalSearchParams: () => ({ id: 'project' }), useRouter: () => ({ push: mockPush }) }));
jest.mock('../src/lib/editorFlag', () => ({ __esModule: true, EDITOR_ENABLED: false }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
const mockApi = { request: async (path: string) => {
    if (path.includes('/history')) return { versions: [] };
    if (path === '/api/v1/workspaces') return { workspaces: [{ id: 'workspace' }] };
    if (path.includes('?workspace_id=')) return { projects: [] };
    return { project: { id: 'project', name: 'Project' } };
} };
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockPush.mockClear(); });
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
