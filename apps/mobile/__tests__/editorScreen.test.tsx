import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import Editor from '../src/app/(app)/editor/[projectId]';
import NewEditor from '../src/app/(app)/editor/new';
import * as flag from '../src/lib/editorFlag';
import { resetNetworkState } from '../src/lib/network';
import { encodeCuts } from '../src/lib/smartCutHandoff';

jest.setTimeout(30000);
const id = '11111111-1111-1111-1111-111111111111';
const copyId = '22222222-2222-2222-2222-222222222222';
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };
const mockFullEditor = jest.fn((_props: unknown) => null);
let mockParams: Record<string, string> = { projectId: id };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => mockParams, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/editorFlag', () => ({ __esModule: true, EDITOR_ENABLED: true, FULL_EDITOR_ENABLED: false }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'u', subscribeCacheUser: () => () => {} }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: () => null }));
jest.mock('../src/components/editor/FullEditorScreen', () => ({ FullEditorScreen: (props: unknown) => mockFullEditor(props) }));
let root: Root;
const visible = (text: string) => root.container.queryAll(node => node.children.includes(text)).length > 0;
async function press(label: string) {
    const nodes = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label);
    expect(nodes).toHaveLength(1);
    await act(async () => { nodes[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); resetNetworkState();
    Object.assign(flag, { EDITOR_ENABLED: true, FULL_EDITOR_ENABLED: false }); mockParams = { projectId: id };
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'POST') return { project: { id: copyId, workspace_id: 'w', name: 'Project' } };
        if (path === '/api/v1/workspaces') return { workspaces: [{ id: 'w', is_default: true }] };
        return { project: { id, workspace_id: 'w', name: 'Project' } };
    });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
test('flag off has no WebView or API requests for either route', async () => {
    Object.assign(flag, { EDITOR_ENABLED: false }); await act(async () => root.render(<Editor />));
    expect(visible('The editor is not available yet')).toBe(true);
    expect(mockFullEditor).not.toHaveBeenCalled(); expect(mockRequest).not.toHaveBeenCalled();
    await act(async () => root.render(<NewEditor />)); expect(visible('The editor is not available yet')).toBe(true); expect(mockRequest).not.toHaveBeenCalled();
});
test.each([false, true])('enabled editor is native regardless of full-editor flag %s and forwards all route params', async full => {
    Object.assign(flag, { FULL_EDITOR_ENABLED: full });
    const cuts = [{ jobId: copyId, start: 1, end: 3 }];
    mockParams = { projectId: id, jobId: copyId, bestCut: '1', add: '1', cuts: encodeCuts(cuts) };
    await act(async () => root.render(<Editor />));
    expect(mockFullEditor).toHaveBeenCalledWith({ projectId: id, jobId: copyId, cuts, startBestCut: true, startAdd: true });
});
test('absent or invalid optional params preserve native editor defaults', async () => {
    mockParams = { projectId: id, bestCut: '0', cuts: 'invalid' };
    await act(async () => root.render(<Editor />));
    expect(mockFullEditor).toHaveBeenCalledWith({ projectId: id, jobId: undefined, cuts: null, startBestCut: false, startAdd: false });
});
test('new empty project creates in default workspace with a stable key and routes to the editor', async () => {
    await act(async () => root.render(<NewEditor />)); await press('Empty project');
    const post = mockRequest.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ workspace_id: 'w', name: 'Untitled edit' });
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/editor/[projectId]', params: { projectId: copyId } });
});

test('direct New edit creates a blank project and opens the editor without an intermediate choice', async () => {
    mockParams = { blank: '1', add: '1' };
    await act(async () => root.render(<NewEditor />));
    const post = mockRequest.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ workspace_id: 'w', name: 'Untitled edit' });
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/editor/[projectId]', params: { projectId: copyId, add: '1' } });
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Empty project')).toHaveLength(0);
});
