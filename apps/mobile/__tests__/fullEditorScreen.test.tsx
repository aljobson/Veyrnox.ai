import { act } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';

void [ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View];

const projectId = '11111111-1111-1111-1111-111111111111';
const document = { schema_version: 1 as const, project_id: projectId, brief: 'Opening scene', canvas: { aspect_ratio: '16:9', frame_rate: 30 } };
let serverDocument: any = document;
const mockRouter = { back: jest.fn() };
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };

jest.mock('expo-crypto', () => ({ randomUUID: () => 'native-save-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({ Stack: { Screen: ({ options }: any) => options?.headerRight?.() ?? null }, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));

let root: Root;
const visible = (text: string) => root.container.queryAll((node) => node.children.includes(text)).length > 0;
const puts = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'PUT');
async function press(label: string) {
    const nodes = root.container.queryAll((node) => node.props.accessibilityLabel === label && typeof node.props.onClick === 'function');
    expect(nodes).toHaveLength(1);
    await act(async () => nodes[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return { revision: 5 };
        if (path.endsWith('/document')) return { revision: 4, document: serverDocument };
        return { project: { id: projectId, workspace_id: 'workspace', name: 'Native cut' } };
    });
    serverDocument = document;
    root = createRoot();
});

afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
});

async function render() {
    await act(async () => root.render(<FullEditorScreen projectId={projectId} />));
    await act(async () => Promise.resolve());
}

test('opens a native project workspace without loading a website', async () => {
    await render();
    expect(visible('Native cut')).toBe(true);
    expect(visible('Saved · v4')).toBe(true);
    expect(visible('PREVIEW')).toBe(true);
    expect(visible('TIMELINE')).toBe(true);
    expect(root.container.queryAll((node) => node.type === 'WebView')).toHaveLength(0);
    for (const label of ['Media', 'Audio', 'Text', 'Captions', 'Adjust']) expect(root.container.queryAll((node) => node.props.accessibilityLabel === label).length).toBeGreaterThan(0);
    for (const label of ['Undo', 'Redo', 'Duplicate', 'Add text', 'Delete']) expect(root.container.queryAll((node) => node.props.accessibilityLabel === label).length).toBeGreaterThan(0);
});

test('adds a native text layer and autosaves it to the shared project document', async () => {
    serverDocument = { ...document, schema_version: 2, timeline: { schemaVersion: 2, fps: 30, seq: 0, aspect: 'source', media: {}, video: [], audio: [], text: [] } };
    await render();
    await press('Add text');
    expect(visible('Your title')).toBe(true);
    await act(async () => jest.advanceTimersByTimeAsync(900));
    expect(puts()).toHaveLength(1);
    const body = JSON.parse(puts()[0][1].body);
    expect(body).toMatchObject({ expected_revision: 4, document: { schema_version: 2, timeline: { text: [{ id: 't1', text: 'Your title' }] } } });
    expect(visible('Saved · v5')).toBe(true);
});

test('updates canvas settings natively and saves before Done exits', async () => {
    await render();
    await press('Adjust');
    await press('9:16');
    await press('Done');
    expect(JSON.parse(puts()[0][1].body).document.canvas.aspect_ratio).toBe('9:16');
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('keeps the user in the editor when saving fails', async () => {
    serverDocument = { ...document, schema_version: 2, timeline: { schemaVersion: 2, fps: 30, seq: 0, aspect: 'source', media: {}, video: [], audio: [], text: [] } };
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') throw new Error('offline');
        if (path.endsWith('/document')) return { revision: 4, document: serverDocument };
        return { project: { id: projectId, name: 'Native cut' } };
    });
    await render();
    await press('Add text');
    await press('Done');
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(visible('Not saved yet, will retry')).toBe(true);
});
