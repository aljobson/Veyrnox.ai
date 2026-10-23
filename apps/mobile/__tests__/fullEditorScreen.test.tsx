import { act } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import * as ImagePicker from 'expo-image-picker';

void [ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View];

const projectId = '11111111-1111-1111-1111-111111111111';
const document = { schema_version: 1 as const, project_id: projectId, brief: 'Opening scene', canvas: { aspect_ratio: '16:9', frame_rate: 30 } };
let serverDocument: any = document;
const mockRouter = { back: jest.fn() };
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };

jest.mock('expo-crypto', () => ({ randomUUID: () => 'native-save-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: { Screen: ({ options }: any) => options?.headerRight?.() ?? null }, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: ({ onPick }: any) => require('react').createElement(require('react-native').Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Choose Library item', onPress: () => onPick({ jobId: '22222222-2222-2222-2222-222222222222', name: 'Library shot', createdAt: '2026-10-23T00:00:00Z' }) }) }));

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

async function render(jobId?: string) {
    await act(async () => root.render(<FullEditorScreen projectId={projectId} jobId={jobId} />));
    await act(async () => Promise.resolve());
}

test('opens a native project workspace without loading a website', async () => {
    await render();
    expect(visible('Native cut')).toBe(true);
    expect(visible('Saved · v4')).toBe(true);
    expect(visible('PREVIEW')).toBe(true);
    expect(visible('TIMELINE')).toBe(true);
    expect(root.container.queryAll((node) => node.type === 'WebView')).toHaveLength(0);
    for (const label of ['Media', 'Audio', 'Generate', 'Templates', 'Elements', 'Text', 'Captions', 'Transcript', 'Scenes', 'Clips', 'Assistant', 'Effects', 'Transitions', 'Filters', 'Animation', 'Plugins', 'Brand kit', 'Review', 'Adjust']) expect(root.container.queryAll((node) => node.props.accessibilityLabel === label).length).toBeGreaterThan(0);
    for (const label of ['Undo', 'Redo', 'Select multiple', 'Duplicate', 'Split', 'Copy', 'Paste at playhead', 'Delete', 'Group', 'Ungroup', 'Add video track', 'Add audio track', 'Add text track', 'Add marker', 'Add text', 'Export', 'Credits']) expect(root.container.queryAll((node) => node.props.accessibilityLabel === label).length).toBeGreaterThan(0);
});

test('adds a native text layer and autosaves it to the shared project document', async () => {
    serverDocument = { ...document, schema_version: 2, timeline: { schemaVersion: 2, fps: 30, seq: 0, aspect: 'source', media: {}, video: [], audio: [], text: [] } };
    await render();
    await press('Add text');
    expect(visible('Your title')).toBe(true);
    await act(async () => jest.advanceTimersByTimeAsync(900));
    expect(puts()).toHaveLength(1);
    const body = JSON.parse(puts()[0][1].body);
    expect(body).toMatchObject({ expected_revision: 4, document: { schema_version: 3, timeline: { text: [{ id: 't1', text: 'Your title', trackId: 'text-0' }] } } });
    expect(visible('Saved · v5')).toBe(true);
});

test('splits a clip, copies it and pastes it at the playhead', async () => {
    serverDocument = { ...document, schema_version: 3, timeline: { schemaVersion: 3, fps: 30, seq: 1, aspect: '16:9', background: '#000000', media: { media1: { id: 'media1', kind: 'video', name: 'Scene one', frames: 60 } }, video: [{ id: 'v1', mediaId: 'media1', start: 0, in: 0, len: 60, trackId: 'video-0' }], audio: [], text: [], tracks: [{ id: 'video-0', kind: 'video', name: 'Video 1', locked: false, muted: false, hidden: false }, { id: 'audio-0', kind: 'audio', name: 'Audio 1', locked: false, muted: false, hidden: false }, { id: 'text-0', kind: 'text', name: 'Text 1', locked: false, muted: false, hidden: false }], markers: [] } };
    await render();
    await press('video Scene one');
    await press('Next frame');
    await press('Split');
    await press('Copy');
    await press('Paste at playhead');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(saved.video).toHaveLength(3);
    expect(saved.video.map((clip: any) => clip.len)).toEqual([1, 59, 1]);
});

test('adds native timeline tracks and review markers', async () => {
    serverDocument = { ...document, schema_version: 3, timeline: { schemaVersion: 3, fps: 30, seq: 0, aspect: '16:9', background: '#000000', media: {}, video: [], audio: [], text: [], tracks: [], markers: [] } };
    await render();
    await press('Add video track');
    await press('Add marker');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(saved.tracks.filter((track: any) => track.kind === 'video')).toHaveLength(2);
    expect(saved.markers).toEqual([{ id: 'm2', frame: 0, label: 'Marker 1', color: '#3ee6c4' }]);
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

test('adds existing project media to the timeline and selects the new clip', async () => {
    serverDocument = { ...document, schema_version: 3, timeline: { schemaVersion: 3, fps: 30, seq: 0, aspect: '16:9', background: '#000000', media: { media1: { id: 'media1', kind: 'video', name: 'Existing shot', frames: 60, hasAudio: true, width: 1920, height: 1080 } }, video: [], audio: [], text: [], tracks: [], markers: [] } };
    await render();
    await press('Add Existing shot to timeline');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(saved.video).toEqual([expect.objectContaining({ id: 'v1', mediaId: 'media1', trackId: 'video-0' })]);
    expect(root.container.queryAll((node) => node.props.accessibilityLabel === 'video Existing shot' && node.props.accessibilityState?.selected)).toHaveLength(1);
});

test('chooses a Library asset inside the editor and adds it to the project', async () => {
    await render();
    await press('Library video');
    await press('Choose Library item');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(saved.media['j-22222222-2222-2222-2222-222222222222']).toMatchObject({ name: 'Library shot', kind: 'video' });
    expect(saved.video).toEqual([expect.objectContaining({ mediaId: 'j-22222222-2222-2222-2222-222222222222' })]);
});

test('chooses device media and adds it to the project without leaving the editor', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///device/shot.mp4', fileName: 'Device shot.mp4', mimeType: 'video/mp4', duration: 2000, width: 1080, height: 1920 }] });
    await render();
    await press('Photos & videos');
    await act(async () => Promise.resolve());
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(Object.values(saved.media)).toContainEqual(expect.objectContaining({ name: 'Device shot.mp4', kind: 'video', frames: 60, width: 1080, height: 1920 }));
    expect(saved.video).toHaveLength(1);
});

test('keeps the Library item selected while a new project opens in the full native editor', async () => {
    await render('33333333-3333-3333-3333-333333333333');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(saved.media['j-33333333-3333-3333-3333-333333333333']).toBeDefined();
    expect(saved.video).toEqual([expect.objectContaining({ mediaId: 'j-33333333-3333-3333-3333-333333333333' })]);
});
