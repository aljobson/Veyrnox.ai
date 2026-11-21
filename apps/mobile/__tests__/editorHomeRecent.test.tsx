import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import EditorHome from '../src/app/(app)/(tabs)/editor';
import { notifyProjectsChanged } from '../src/lib/projectsChanged';

jest.setTimeout(30000);
const mockPush = jest.fn();
let mockEditorEnabled = true;
const mockReact = jest.requireActual<typeof import('react')>('react');
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }), useFocusEffect: (callback: () => void | (() => void)) => mockReact.useEffect(() => callback(), [callback]) }));
jest.mock('../src/lib/editorFlag', () => ({ __esModule: true, get EDITOR_ENABLED() { return mockEditorEnabled; } }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/components/editor/BestCutEntry', () => {
    const React = jest.requireActual<typeof import('react')>('react');
    const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
    return { BestCutEntry: () => React.createElement(Text, { testID: 'editor-home-best-cut' }, 'Best Cut entry') };
});
let projects: unknown[] = [];
const requests: string[] = [];
const mockApi = { request: async (path: string) => {
    requests.push(path);
    if (path === '/api/v1/workspaces') return { workspaces: [{ id: 'w1', name: 'Studio', is_default: true }] };
    return { projects };
} };
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, workspace_id: 'w1', name, version: 1, created_at: '2026-11-15T17:38:00Z', updated_at: '2026-11-15T17:38:00Z', ...extra });
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); requests.length = 0; mockPush.mockClear(); mockEditorEnabled = true; });
afterEach(async () => { await act(async () => root.unmount()); });
const text = () => root.container.queryAll(n => Array.isArray(n.children) && n.children.some(c => typeof c === 'string')).map(n => n.children.filter(c => typeof c === 'string').join(''));
const listLoads = () => requests.filter(p => p.includes('?workspace_id=')).length;

test('rows show the latest saved version and sort by last saved', async () => {
    projects = [
        row('a', 'OLD ONE', { latest_revision: 2, saved_at: '2026-11-10T09:00:00Z' }),
        row('b', 'SMART CUT', { latest_revision: 19, saved_at: '2026-11-16T12:00:00Z' }),
        row('c', 'NO SAVES'),
    ];
    await act(async () => root.render(<EditorHome />));
    const lines = text();
    expect(lines.findIndex(l => l === 'SMART CUT')).toBeLessThan(lines.findIndex(l => l === 'OLD ONE'));
    expect(lines.find(l => l.startsWith('Version 19'))).toBeTruthy();
    expect(lines.find(l => /^Version 2 /.test(l))).toBeTruthy();
    expect(lines.filter(l => /^Version 1 /.test(l)).length).toBe(1);
    expect(root.container.queryAll(node => node.props.testID === 'editor-home-best-cut')).toHaveLength(1);
});

test('a save that finishes after the focus fetch refreshes the list without clearing rows', async () => {
    projects = [row('a', 'FIRST', { latest_revision: 1, saved_at: '2026-11-16T10:00:00Z' })];
    await act(async () => root.render(<EditorHome />));
    expect(listLoads()).toBe(1);
    projects = [row('b', 'NEW EDIT', { latest_revision: 3, saved_at: '2026-11-16T13:49:00Z' }), ...projects];
    await act(async () => { notifyProjectsChanged(); });
    expect(listLoads()).toBe(2);
    const lines = text();
    expect(lines).toContain('NEW EDIT');
    expect(lines).toContain('FIRST');
    expect(lines.find(l => /^Version 3 /.test(l))).toBeTruthy();
});

test('a quiet refresh that fails keeps the rows and shows the retry', async () => {
    projects = [row('a', 'KEEP ME', { latest_revision: 4, saved_at: '2026-11-16T10:00:00Z' })];
    await act(async () => root.render(<EditorHome />));
    const failing = jest.spyOn(mockApi, 'request').mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    await act(async () => { notifyProjectsChanged(); });
    failing.mockRestore();
    const lines = text();
    expect(lines).toContain('KEEP ME');
    expect(lines.some(l => /busy|try again/i.test(l))).toBe(true);
});

test('Studio keeps native workspaces reachable when Professional Editor is off', async () => {
    mockEditorEnabled = false;
    await act(async () => root.render(<EditorHome />));
    const lines = text();
    expect(requests).toHaveLength(0);
    expect(lines).toContain('Studio');
    expect(lines).toContain('Projects');
    expect(lines).toContain('Beat maker');
    expect(lines).toContain('Smart Cut');
    expect(lines).not.toContain('Professional editor');
    expect(lines).not.toContain('Editor is not available in this build.');
    const refreshables = root.container.queryAll(node => Object.hasOwn(node.props, 'refreshing'));
    expect(refreshables).toHaveLength(1);
    expect(refreshables[0]?.props.refreshing).toBe(false);
    expect(refreshables[0]?.props.onRefresh).toBeUndefined();

});
