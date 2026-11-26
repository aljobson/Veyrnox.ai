jest.mock('../src/lib/voiceoverRecorder', () => ({ VOICEOVER_AVAILABLE: false }));
var mockSceneState: any;
jest.mock('../src/components/editor/tools/useEditorSceneAnalysis', () => ({
    sceneAnalysisBlocker: () => null,
    useEditorSceneAnalysis: ({ runKey }: { runKey: string }) => ({ ...mockSceneState, resultKey: mockSceneState?.status === 'done' ? runKey : undefined }),
}));
var mockClipState: any;
var mockAppendFoundClips = jest.fn();
jest.mock('../src/components/editor/tools/useEditorClipFinder', () => ({
    clipFinderBlocker: (media: { width?: number; height?: number } | undefined) => media?.width && media.height
        && (Math.max(media.width, media.height) > 1280 || Math.min(media.width, media.height) > 720) ? 'resolution' : null,
    useEditorClipFinder: ({ runKey }: { runKey: string }) => ({ ...mockClipState,
        resultKey: mockClipState?.resultKey === 'current' ? runKey : mockClipState?.resultKey }),
}));
jest.mock('../src/lib/editorClipAnalysis', () => ({
    appendSelectedClipFinderRows: (...args: unknown[]) => mockAppendFoundClips(...args),
}));
var mockFrameStore: any;
jest.mock('../src/components/editor/editorFrameStore', () => {
    const actual = jest.requireActual('../src/components/editor/editorFrameStore');
    return { ...actual, createFrameStore: (...args: unknown[]) => (mockFrameStore = actual.createFrameStore(...args)) };
});
import { act } from 'react';
import { AccessibilityInfo, ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import * as ImagePicker from 'expo-image-picker';

void [ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View];

const projectId = '11111111-1111-1111-1111-111111111111';
const document = { schema_version: 1 as const, project_id: projectId, brief: 'Opening scene', canvas: { aspect_ratio: '16:9', frame_rate: 30 } };
let serverDocument: any = document;
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockBeginSessionTask = () => ({ current: () => true });
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };
const mockScreenRender = jest.fn();
const mockStackOptions = jest.fn();

jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true), removeDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}), copy: jest.fn().mockResolvedValue(null), backup: jest.fn().mockResolvedValue(null) } }));
jest.mock('../src/lib/editorPickedFileReady', () => ({ waitForEditorPickedFile: jest.fn().mockResolvedValue('ready') }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn().mockResolvedValue(4) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'native-save-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-image-picker', () => ({
    launchImageLibraryAsync: jest.fn(),
    UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible', Current: 'current' },
    VideoExportPreset: { Passthrough: 'passthrough' },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: { Screen: ({ options }: any) => { mockStackOptions(options); return options?.headerRight?.() ?? null; } }, usePreventRemove: () => () => {}, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => { mockScreenRender(); return { api: mockApi, beginSessionTask: mockBeginSessionTask }; } }));
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: ({ media, localUri }: any) => require('react').createElement(require('react-native').View, { accessibilityLabel: `Real preview ${media.name}`, testID: localUri }) }));
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
    require('../src/lib/editorPickedFileReady').waitForEditorPickedFile.mockResolvedValue('ready');
    mockSceneState = { availability: 'available', status: 'idle', progress: 0, rows: [], error: undefined, detect: jest.fn(), cancel: jest.fn(), toggle: jest.fn(), clear: jest.fn() };
    mockClipState = { availability: 'available', status: 'idle', progress: 0, rows: [], error: undefined, hadAudio: true, resultKey: undefined,
        find: jest.fn(), cancel: jest.fn(), toggle: jest.fn(), clear: jest.fn(() => { mockClipState.status = 'idle'; mockClipState.rows = []; mockClipState.resultKey = undefined; }) };
    mockAppendFoundClips.mockReset();
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return { revision: JSON.parse(init.body as string).expected_revision + 1 };
        if (init?.method === 'PATCH') return { project: { id: projectId, workspace_id: 'workspace', name: JSON.parse(init.body as string).name, version: 2 } };
        if (path.endsWith('/media-info')) return { seconds: 4 };
        if (path.endsWith('/document')) return { revision: 4, document: serverDocument };
        return { project: { id: projectId, workspace_id: 'workspace', name: 'Native cut', version: 1 } };
    });
    serverDocument = document;
    root = createRoot();
});

afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
});

async function render(jobId?: string) {
    await act(async () => root.render(<FullEditorScreen projectId={projectId} jobId={jobId} startAdvanced />));
    await act(async () => Promise.resolve());
}
async function renderSimple() {
    await act(async () => root.render(<FullEditorScreen projectId={projectId} />));
    await act(async () => Promise.resolve());
}
const labelled = (label: string) => root.container.queryAll((node) => node.props.accessibilityLabel === label);

test('opens in the simple view with the ByeCut-style five-tab dock and full toolbars hidden', async () => {
    await renderSimple();
    expect(visible('Native cut')).toBe(true);
    expect(visible('PREVIEW')).toBe(true);
    for (const label of ['AI Edit', 'Cut', 'Sound', 'Text', 'Layers', 'Undo', 'Redo', 'Export']) expect(labelled(label).length).toBeGreaterThan(0);
    for (const label of ['Media', 'Audio', 'Captions', 'Markers', 'Snap']) expect(labelled(label)).toHaveLength(0);
    for (const label of ['Filters', 'Transitions', 'Polish']) expect(labelled(label)).toHaveLength(1);
    for (const label of ['Back', 'Choose cover', 'Rename Native cut', 'Go to start', 'Zoom out', 'Zoom in', 'Rotation +90°', 'Fit', 'Canvas · 9:16'])
        expect(labelled(label)).toHaveLength(1);
    for (const label of ['Add video track', 'Add audio track', 'Add text track']) expect(labelled(label)).toHaveLength(0);
    for (const label of ['Previous frame', 'Next frame', 'Go to end']) expect(labelled(label)).toHaveLength(0);
    expect(labelled('Export')).toHaveLength(1);
    expect(labelled('Canvas · 16:9')).toHaveLength(1);
    expect(root.container.queryAll((node) => node.props.testID === 'editor-tool-rail')).toHaveLength(0);
});

test('renames the project from the editable simple header', async () => {
    await renderSimple();
    await press('Rename Native cut');
    const input = labelled('Project name');
    expect(input).toHaveLength(1);
    await act(async () => input[0].props.onChangeText('Morning routine'));
    await press('Save');
    expect(visible('Morning routine')).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith(`/api/v1/projects/${projectId}`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Morning routine', version: 1 }) }));
});

test('the five-tab dock opens AI, Cut, Sound, Text and Layers without hiding the dock', async () => {
    await renderSimple();
    await press('AI Edit');
    for (const label of ['Smart Cut', 'Make a clip with AI', 'Voice or music with AI', 'Captions']) expect(labelled(label).length).toBeGreaterThan(0);
    await press('Close');
    await press('Cut');
    for (const label of ['Add', 'Filters', 'Transitions', 'Polish']) expect(labelled(label).length).toBeGreaterThan(0);
    await press('Add');
    for (const label of ['Library video', 'Library image', 'Library audio', 'Photos & videos', 'Files']) expect(labelled(label).length).toBeGreaterThan(0);
    await press('Close');
    await press('Sound');
    for (const label of ['Music', 'Clean Voice']) expect(labelled(label)).toHaveLength(1);
    await press('Text');
    for (const label of ['Edit Text', 'Title', 'Captions', 'Report Issue', 'Open Settings']) expect(labelled(label)).toHaveLength(1);
    await press('Layers');
    for (const label of ['Photo', 'Video', 'All layers']) expect(labelled(label)).toHaveLength(1);
    await press('Cut');
    expect(labelled('Add')).toHaveLength(1);
});

test('chooses a project cover frame, title and colour and autosaves them', async () => {
    serverDocument = { ...document, schema_version: 3, timeline: { schemaVersion: 3, fps: 30, seq: 1, aspect: '16:9', background: '#000000',
        media: { media1: { id: 'media1', kind: 'video', name: 'Cover clip', frames: 120 } },
        video: [{ id: 'v1', mediaId: 'media1', start: 0, in: 0, len: 120, trackId: 'video-0' }], audio: [], text: [], tracks: [
            { id: 'video-0', kind: 'video', name: 'Video 1', locked: false, muted: false, hidden: false },
            { id: 'audio-0', kind: 'audio', name: 'Audio 1', locked: false, muted: false, hidden: false },
            { id: 'text-0', kind: 'text', name: 'Text 1', locked: false, muted: false, hidden: false }], markers: [] } };
    await renderSimple();
    await press('Choose cover');
    expect(visible('Choose Cover')).toBe(true);
    await press('Frame at 00:03');
    const input = labelled('Cover text');
    expect(input).toHaveLength(1);
    await act(async () => input[0].props.onChangeText('Track session'));
    await press('Colour #FFE66D');
    await press('Save');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const body = JSON.parse(puts().at(-1)![1].body);
    expect(body.document.cover).toEqual({ frame: 119, text: 'Track session', text_color: '#FFE66D' });
});

test('opens a native project workspace without loading a website', async () => {
    await render();
    expect(visible('Native cut')).toBe(true);
    expect(visible('Saved · v4')).toBe(true);
    expect(visible('PREVIEW')).toBe(true);
    expect(visible('TIMELINE')).toBe(true);
    expect(root.container.queryAll((node) => node.type === 'WebView')).toHaveLength(0);
    for (const label of ['Canvas', 'Media', 'Audio', 'Generate', 'Text', 'Captions', 'Transcript', 'Scenes', 'Clip Finder', 'Effects', 'Transitions', 'Filters', 'Animation', 'Markers', 'Brand kit', 'Adjust']) expect(root.container.queryAll((node) => node.props.accessibilityLabel === label).length).toBeGreaterThan(0);
    const railLabels = root.container.queryAll(node => node.props.accessibilityRole === 'button' && typeof node.props.accessibilityLabel === 'string')
        .map(node => node.props.accessibilityLabel);
    expect(railLabels.slice(railLabels.indexOf('Scenes'), railLabels.indexOf('Scenes') + 2)).toEqual(['Scenes', 'Clip Finder']);
    for (const label of ['Templates', 'Elements', 'Clips', 'Assistant', 'Plugins', 'Review']) expect(root.container.queryAll(node => node.props.accessibilityLabel === label)).toHaveLength(0);
    expect(visible('Detected cuts')).toBe(false);
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
    await act(async () => root.container.queryAll(node => node.props.testID === 'clip-v1')[0].props.onAccessibilityTap());
    await press('Next frame');
    await press('Split');
    await press('Copy');
    await press('Paste at playhead');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(saved.video).toHaveLength(3);
    expect(saved.video.map((clip: any) => clip.len)).toEqual([1, 59, 1]);
});

test('applies all selected scene cuts as one edit and one Undo restores the clip', async () => {
    serverDocument = { ...document, schema_version: 3, timeline: { schemaVersion: 3, fps: 30, seq: 1, aspect: '16:9', background: '#000000', media: { media1: { id: 'media1', kind: 'video', name: 'Scene one', frames: 60 } },
        video: [{ id: 'v1', mediaId: 'media1', start: 0, in: 0, len: 60, trackId: 'video-0' }], audio: [], text: [], tracks: [
            { id: 'video-0', kind: 'video', name: 'Video 1', locked: false, muted: false, hidden: false },
            { id: 'audio-0', kind: 'audio', name: 'Audio 1', locked: false, muted: false, hidden: false },
            { id: 'text-0', kind: 'text', name: 'Text 1', locked: false, muted: false, hidden: false }], markers: [] } };
    mockSceneState = { ...mockSceneState, status: 'done', progress: 1, rows: [
        { frame: 20, time: 2 / 3, kind: 'hard', ticked: true }, { frame: 40, time: 4 / 3, kind: 'hard', ticked: true }] };
    await render();
    await act(async () => root.container.queryAll(node => node.props.testID === 'clip-v1')[0].props.onAccessibilityTap());
    await press('Scenes');
    expect(root.container.queryAll(node => String(node.props.testID || '').startsWith('analysis-mark-'))).toHaveLength(2);
    await press('Split at 2 cuts');
    expect(root.container.queryAll(node => String(node.props.testID || '').startsWith('clip-v'))).toHaveLength(3);
    await press('Undo');
    expect(root.container.queryAll(node => String(node.props.testID || '').startsWith('clip-v'))).toHaveLength(1);
});

const clipFinderDocument = (locked = false, width = 1280, height = 720) => ({ ...document, schema_version: 3, timeline: { schemaVersion: 3, fps: 30, seq: 1, aspect: '16:9', background: '#000000',
    media: { media1: { id: 'media1', kind: 'video', name: 'Interview', frames: 900, hasAudio: true, width, height } },
    video: [{ id: 'v1', mediaId: 'media1', start: 0, in: 0, len: 300, trackId: 'video-0' }], audio: [], text: [], tracks: [
        { id: 'video-0', kind: 'video', name: 'Video 1', locked, muted: false, hidden: false },
        { id: 'video-1', kind: 'video', name: 'Video 2', locked: false, muted: false, hidden: false },
        { id: 'audio-0', kind: 'audio', name: 'Audio 1', locked: false, muted: false, hidden: false },
        { id: 'text-0', kind: 'text', name: 'Text 1', locked: false, muted: false, hidden: false }], markers: [] } });
const foundRows = [
    { id: 'pick-1', rank: 1, start: 2, end: 4, startFrame: 60, endFrame: 120, seconds: 2, reasons: ['speech-rich'], ticked: true },
    { id: 'pick-2', rank: 2, start: 5, end: 8, startFrame: 150, endFrame: 240, seconds: 3, reasons: ['good-length'], ticked: true },
];
async function openClipFinder(locked = false, width = 1280, height = 720) {
    serverDocument = clipFinderDocument(locked, width, height);
    await render();
    await act(async () => root.container.queryAll(node => node.props.testID === 'clip-v1')[0].props.onAccessibilityTap());
    await press('Clip Finder');
}

test('Clip Finder analyses a selected clip even when its source track is locked', async () => {
    await openClipFinder(true);
    expect(labelled('Find clips')[0].props.accessibilityState.disabled).toBe(false);
    await press('Find clips');
    expect(mockClipState.find).toHaveBeenCalledTimes(1);
});

test('Clip Finder explains and blocks the 720p resolution boundary before analysis', async () => {
    await openClipFinder(false, 1920, 480);
    expect(visible('Clip Finder handles videos up to 720p.')).toBe(true);
    expect(labelled('Find clips')[0].props.accessibilityState.disabled).toBe(true);
    expect(mockClipState.find).not.toHaveBeenCalled();
});

test('an active scene analysis blocks Clip Finder without starting a second native generation', async () => {
    mockSceneState = { ...mockSceneState, status: 'analyzing', progress: 0.4 };
    serverDocument = clipFinderDocument();
    await render();
    await act(async () => root.container.queryAll(node => node.props.testID === 'clip-v1')[0].props.onAccessibilityTap());
    await press('Scenes');
    expect(labelled('Cancel')).toHaveLength(1);
    await press('Clip Finder');
    expect(visible('Scenes: Reading video… 40%')).toBe(true);
    expect(labelled('Find clips')[0].props.accessibilityState.disabled).toBe(true);
    await act(async () => labelled('Find clips')[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockClipState.find).not.toHaveBeenCalled();
});

test('an active Clip Finder analysis blocks Scenes without starting a second native generation', async () => {
    mockClipState = { ...mockClipState, status: 'reading-sound', progress: 0.7 };
    await openClipFinder();
    expect(labelled('Cancel')).toHaveLength(1);
    await press('Scenes');
    expect(visible('Clip Finder: Reading sound')).toBe(true);
    expect(labelled('Detect scenes')[0].props.accessibilityState.disabled).toBe(true);
    await act(async () => labelled('Detect scenes')[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockSceneState.detect).not.toHaveBeenCalled();
});

test('Clip Finder preview seeks to its start and stops playback at the bounded end', async () => {
    mockClipState = { ...mockClipState, status: 'done', progress: 1, rows: [foundRows[0]], resultKey: 'current' };
    await openClipFinder();
    await press('Preview suggestion 1');
    expect(visible('00:00:02:00')).toBe(true);
    expect(labelled('Pause')).toHaveLength(1);
    await act(async () => mockFrameStore.set(foundRows[0].endFrame));
    expect(labelled('Play')).toHaveLength(1);
    expect(labelled('Preview suggestion 1')).toHaveLength(1);
});

test('Clip Finder appends selected suggestions in one edit, selects the first, clears bands, and one Undo restores the source', async () => {
    mockClipState = { ...mockClipState, status: 'done', progress: 1, rows: foundRows, resultKey: 'current' };
    mockAppendFoundClips.mockImplementation((before: any) => ({ ...before, seq: before.seq + 1, video: [...before.video,
        { id: 'found-1', mediaId: 'media1', start: 300, in: 60, len: 60, trackId: 'video-1' },
        { id: 'found-2', mediaId: 'media1', start: 360, in: 150, len: 90, trackId: 'video-1' }] }));
    await openClipFinder();
    expect(root.container.queryAll(node => String(node.props.testID || '').startsWith('clip-range-'))).not.toHaveLength(0);
    await press('Add 2 clips to timeline');
    expect(mockAppendFoundClips).toHaveBeenCalledTimes(1);
    expect(root.container.queryAll(node => node.props.testID === 'clip-found-1' && node.props.accessibilityState?.selected)).toHaveLength(1);
    expect(root.container.queryAll(node => String(node.props.testID || '').startsWith('clip-range-'))).toHaveLength(0);
    expect(mockClipState.clear).toHaveBeenCalledTimes(1);
    await press('Undo');
    expect(root.container.queryAll(node => String(node.props.testID || '').startsWith('clip-v'))).toHaveLength(1);
});

test('Clip Finder rejects an old Apply handler when the live edit revision changes in the same batch', async () => {
    mockClipState = { ...mockClipState, status: 'done', progress: 1, rows: [foundRows[0]], resultKey: 'current' };
    await openClipFinder();
    const marker = labelled('Add marker')[0], apply = labelled('Add 1 clip to timeline')[0];
    await act(async () => {
        marker.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 });
        apply.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 });
    });
    expect(mockAppendFoundClips).not.toHaveBeenCalled();
    expect(mockClipState.clear).toHaveBeenCalledTimes(1);
});

const twoClips = () => ({ ...document, schema_version: 3, timeline: { schemaVersion: 3, fps: 30, seq: 2, aspect: '16:9', background: '#000000', media: { media1: { id: 'media1', kind: 'video', name: 'Scene one', frames: 60 } }, video: [{ id: 'v1', mediaId: 'media1', start: 0, in: 0, len: 60, trackId: 'video-0' }, { id: 'v2', mediaId: 'media1', start: 60, in: 0, len: 30, trackId: 'video-0' }], audio: [], text: [], tracks: [{ id: 'video-0', kind: 'video', name: 'Video 1', locked: false, muted: false, hidden: false }, { id: 'audio-0', kind: 'audio', name: 'Audio 1', locked: false, muted: false, hidden: false }, { id: 'text-0', kind: 'text', name: 'Text 1', locked: false, muted: false, hidden: false }], markers: [] } });

test('simple view moves a selected clip later, disables it at the end, and Undo restores the order', async () => {
    serverDocument = twoClips();
    await renderSimple();
    expect(labelled('Move left')).toHaveLength(0);
    await act(async () => root.container.queryAll(node => node.props.testID === 'clip-v1')[0].props.onAccessibilityTap());
    expect(labelled('Move left')[0].props.accessibilityState.disabled).toBe(true);
    await press('Move right');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const starts = () => Object.fromEntries(JSON.parse(puts().at(-1)![1].body).document.timeline.video.map((clip: any) => [clip.id, clip.start]));
    expect(starts()).toEqual({ v1: 30, v2: 0 });
    expect(labelled('Move right')[0].props.accessibilityState.disabled).toBe(true);
    await press('Undo');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    expect(starts()).toEqual({ v1: 0, v2: 60 });
});

test('swipe-back is on when idle and off while a clip is touched or selected', async () => {
    serverDocument = twoClips();
    await renderSimple();
    const clipNode = () => root.container.queryAll(node => node.props.testID === 'clip-v1')[0];
    const enabled = () => mockStackOptions.mock.calls.at(-1)![0].gestureEnabled;
    expect(enabled()).toBe(true);
    const touch = { nativeEvent: { pageX: 10, pageY: 10, locationX: 10, locationY: 10 } };
    await act(async () => clipNode().props.onResponderGrant(touch));
    expect(enabled()).toBe(false);
    await act(async () => clipNode().props.onResponderTerminate());
    expect(enabled()).toBe(true);
    await act(async () => clipNode().props.onAccessibilityTap());
    expect(enabled()).toBe(false);
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

test('opens canvas settings from the ratio badge and exposes one-tap clip rotation', async () => {
    serverDocument = twoClips();
    await renderSimple();
    await press('Canvas · 16:9');
    await press('9:16');
    await act(async () => root.container.queryAll(node => node.props.testID === 'clip-v1')[0].props.onAccessibilityTap());
    await press('Rotation +90°');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document;
    expect(saved.canvas.aspect_ratio).toBe('9:16');
    expect(saved.timeline.video.find((clip: any) => clip.id === 'v1').transform.rotation).toBe(90);
    expect(labelled('Flip horizontally')).toHaveLength(1);
    expect(labelled('Flip vertically')).toHaveLength(1);
});

test('offers and persists all four ByeCut canvas aspect presets', async () => {
    await renderSimple();
    await press('Canvas · 16:9');
    for (const ratio of ['16:9', '9:16', '1:1', '4:5']) expect(labelled(ratio)).toHaveLength(1);
    await press('4:5');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    expect(JSON.parse(puts().at(-1)![1].body).document.canvas.aspect_ratio).toBe('4:5');
});

test('keeps the user in the editor when saving fails', async () => {
    serverDocument = { ...document, schema_version: 2, timeline: { schemaVersion: 2, fps: 30, seq: 0, aspect: 'source', media: {}, video: [], audio: [], text: [] } };
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') throw new Error('offline');
        if (path.endsWith('/media-info')) return { seconds: 4 };
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
    expect(root.container.queryAll((node) => node.props.testID === 'clip-v1' && node.props.accessibilityState?.selected)).toHaveLength(1);
});

test('chooses a Library asset inside the editor and adds it to the project', async () => {
    await render();
    await press('Library video');
    await press('Choose Library item');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(saved.media['j-22222222-2222-2222-2222-222222222222']).toMatchObject({ name: 'Library shot', kind: 'video' });
    expect(saved.video).toEqual([expect.objectContaining({ mediaId: 'j-22222222-2222-2222-2222-222222222222', len: 120 })]);
});

test('chooses device media and adds it to the project without leaving the editor', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///device/shot.mp4', fileName: 'Device shot.mp4', mimeType: 'video/mp4', duration: 2000, width: 1080, height: 1920 }] });
    await render();
    await press('Photos & videos');
    await act(async () => Promise.resolve());
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
        preferredAssetRepresentationMode: 'current',
        videoExportPreset: 'passthrough',
    }));
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(Object.values(saved.media)).toContainEqual(expect.objectContaining({ name: 'Device shot.mp4', kind: 'video', frames: 60, width: 1080, height: 1920 }));
    expect(saved.video).toHaveLength(1);
    expect(root.container.queryAll((node) => node.props.accessibilityLabel === 'Real preview Device shot.mp4' && node.props.testID === 'file:///device/shot.mp4')).toHaveLength(1);
});

test('keeps the Library item selected while a new project opens in the full native editor', async () => {
    await render('33333333-3333-3333-3333-333333333333');
    await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(saved.media['j-33333333-3333-3333-3333-333333333333']).toBeDefined();
    expect(saved.video).toEqual([expect.objectContaining({ mediaId: 'j-33333333-3333-3333-3333-333333333333', len: 120 })]);
});

test('B1: flag off Export opens the private on-device MP4 flow without a server render (QA F09)', async () => {
    await render(); await press('Export');
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(visible('Export on this device')).toBe(true);
    expect(visible('Makes a private MP4 on this device for supported projects up to 30 seconds. No upload or credits.')).toBe(true);
    expect(visible('Use cloud export instead')).toBe(true);
    expect(mockRequest.mock.calls.some(([path]) => path.includes('/editor/server-render'))).toBe(false);
});

test('a backup completing after another edit survives undo and redo without inserting media into older snapshots', async () => {
    const { editorDeviceMedia } = require('../src/lib/editorDeviceMedia');
    editorDeviceMedia.copy.mockResolvedValueOnce({ file: 'file:///durable/clip.mp4', type: 'video/mp4', size: 100, seconds: 2, verified: true });
    let finish!: (source: { projectId: string; assetId: string }) => void;
    editorDeviceMedia.backup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///device/clip.mp4', fileName: 'Clip', mimeType: 'video/mp4', duration: 2000, width: 1920, height: 1080 }] });
    await render(); await press('Photos & videos'); await press('Add text');
    await act(async () => finish({ projectId, assetId: '22222222-2222-4222-8222-222222222222' }));
    const saved = async () => { await act(async () => jest.advanceTimersByTimeAsync(900)); return JSON.parse(puts().at(-1)![1].body).document; };
    const backedUp = await saved(); expect(backedUp.timeline.text).toHaveLength(1);
    expect(backedUp.timeline.media['l-native-save-key'].assetSource).toEqual({ projectId, assetId: '22222222-2222-4222-8222-222222222222' });
    await press('Undo'); expect((await saved()).timeline.media['l-native-save-key'].assetSource.assetId).toBe('22222222-2222-4222-8222-222222222222');
    await press('Undo'); expect((await saved()).timeline?.media?.['l-native-save-key']).toBeUndefined();
    await press('Redo'); expect((await saved()).timeline.media['l-native-save-key'].assetSource.assetId).toBe('22222222-2222-4222-8222-222222222222');
    await press('Redo'); const restored = await saved(); expect(restored.timeline.text).toHaveLength(1); expect(restored.timeline.media['l-native-save-key'].assetSource.assetId).toBe('22222222-2222-4222-8222-222222222222');
});

test.each([4, 20])('Files import probes %s seconds before adding its media and clip', async seconds => {
    const picker = require('expo-document-picker');
    const { editorDeviceMedia } = require('../src/lib/editorDeviceMedia');
    const { probeDuration } = require('../src/lib/editorMediaDuration');
    editorDeviceMedia.copy.mockResolvedValueOnce({ file: 'file:///durable/from-files.mp4', type: 'video/mp4', size: 100, seconds, verified: true });
    probeDuration.mockResolvedValueOnce(seconds);
    picker.getDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///picked/from-files.mp4', name: 'Files clip', mimeType: 'video/mp4' }] });
    await render(); await press('Files'); await act(async () => jest.advanceTimersByTimeAsync(900));
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(probeDuration).toHaveBeenCalledWith('file:///picked/from-files.mp4');
    expect(saved.media['l-native-save-key'].frames).toBe(seconds * 30); expect(saved.video[0].len).toBe(seconds * 30);
});

test('an unavailable iCloud pick stays outside the timeline and retries the same held asset once it is ready', async () => {
    const picker = require('expo-document-picker');
    const { editorDeviceMedia } = require('../src/lib/editorDeviceMedia');
    const { waitForEditorPickedFile } = require('../src/lib/editorPickedFileReady');
    let finishWait!: (value: string) => void;
    waitForEditorPickedFile.mockImplementationOnce(() => new Promise(resolve => { finishWait = resolve; })).mockResolvedValueOnce('ready');
    editorDeviceMedia.copy.mockResolvedValueOnce({ file: 'file:///durable/cloud.mp4', type: 'video/mp4', size: 100, seconds: 4, verified: true });
    picker.getDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cache/cloud.mp4', name: 'Cloud clip', mimeType: 'video/mp4' }] });
    await render(); await press('Files'); await act(async () => Promise.resolve());
    expect(visible('Preparing…')).toBe(true);
    await act(async () => finishWait('unavailable'));
    expect(visible('This file is still unavailable. Retry it, or choose it again from Files.')).toBe(true);
    expect(puts()).toHaveLength(0);
    await press('Retry now'); await act(async () => Promise.resolve()); await act(async () => jest.advanceTimersByTimeAsync(900));
    expect(waitForEditorPickedFile).toHaveBeenCalledTimes(2);
    expect(editorDeviceMedia.copy).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(puts().at(-1)![1].body).document.timeline;
    expect(Object.values(saved.media)).toContainEqual(expect.objectContaining({ name: 'Cloud clip' }));
    expect(saved.video).toHaveLength(1);
});

test('an account change during duration probing cannot copy a pick into the next account', async () => {
    const cache = require('../src/lib/appCache'); const { editorDeviceMedia } = require('../src/lib/editorDeviceMedia');
    const picker = require('expo-document-picker'); const { probeDuration } = require('../src/lib/editorMediaDuration');
    let owner = 'first-owner'; const getOwner = jest.spyOn(cache, 'getCacheUser').mockImplementation(() => owner);
    let finish!: (seconds: number) => void;
    probeDuration.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    picker.getDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///picked/old-owner.mp4', name: 'Old pick', mimeType: 'video/mp4' }] });
    await render(); await press('Files'); owner = 'next-owner'; await act(async () => finish(4));
    expect(editorDeviceMedia.copy).not.toHaveBeenCalled(); expect(puts()).toHaveLength(0); getOwner.mockRestore();
});

const savedTimeline = async () => {
    await act(async () => jest.advanceTimersByTimeAsync(900));
    return JSON.parse(puts().at(-1)![1].body).document.timeline;
};
function deferLength() {
    const previous = mockRequest.getMockImplementation()!;
    let finish!: (answer: unknown) => void;
    mockRequest.mockImplementation((path, init) => path.endsWith('/media-info') ? new Promise(resolve => { finish = resolve; }) : previous(path, init));
    return (answer: unknown) => finish(answer);
}

test('marker rename makes one history entry at end editing', async () => {
    await render(); await press('Add marker'); await press('Markers');
    const input = root.container.queryAll(node => node.props.accessibilityLabel === 'Rename Marker 1' && typeof node.props.onEndEditing === 'function')[0];
    expect(input.props.onChangeText).toBeUndefined();
    await act(async () => input.props.onEndEditing({ nativeEvent: { text: 'Beat' } }));
    expect((await savedTimeline()).markers[0].label).toBe('Beat');
    await press('Undo'); expect((await savedTimeline()).markers[0].label).toBe('Marker 1');
});
test('a deferred Library import preserves intervening text and allocates a fresh sequence id', async () => {
    const finish = deferLength(); await render(); await press('Library video'); await press('Choose Library item');
    for (const label of ['Library video', 'Library image', 'Library audio']) expect(root.container.queryAll(n => n.props.accessibilityLabel === label && n.props.accessibilityState?.disabled)).toHaveLength(1);
    await press('Add text'); await act(async () => finish({ seconds: 4 }));
    const tl = await savedTimeline(); expect(tl.text[0].id).toBe('t1'); expect(tl.video[0]).toMatchObject({ id: 'v2', len: 120 }); expect(tl.seq).toBe(2);
});
test('an unknown Library length adds nothing and shows the problem', async () => {
    const { probeDuration } = require('../src/lib/editorMediaDuration'); const previous = mockRequest.getMockImplementation()!;
    probeDuration.mockResolvedValueOnce(null);
    mockRequest.mockImplementation((path, init) => path.endsWith('/media-info') ? Promise.resolve({}) : path.endsWith('/asset') ? Promise.resolve({ url: 'https://example.com/media.mp4', mime_type: 'video/mp4' }) : previous(path, init));
    await render(); await press('Library video'); await press('Choose Library item'); await act(async () => jest.advanceTimersByTimeAsync(900));
    expect(puts()).toHaveLength(0); expect(visible('Could not determine the media length. Nothing was added.')).toBe(true);
});
test.each(['unmount', 'account'])('Library import discards a result after %s', async reason => {
    const cache = require('../src/lib/appCache'); let owner = 'first'; const spy = jest.spyOn(cache, 'getCacheUser').mockImplementation(() => owner);
    try {
        const finish = deferLength(); await render(); await press('Library video'); await press('Choose Library item');
        if (reason === 'unmount') await act(async () => root.unmount()); else owner = 'second';
        await act(async () => finish({ seconds: 4 })); await act(async () => jest.advanceTimersByTimeAsync(900)); expect(puts()).toHaveLength(0);
    } finally { spy.mockRestore(); }
});
test('entry import caps a 601 second source to the sequence limit without losing source length', async () => {
    const finish = deferLength(); await render('33333333-3333-3333-3333-333333333333'); await act(async () => finish({ seconds: 601 }));
    const tl = await savedTimeline(); expect(tl.video[0].len).toBe(18000); expect(tl.media[tl.video[0].mediaId].frames).toBe(18030);
});
test.each(['unmount', 'account'])('entry import discards a result after %s', async reason => {
    const cache = require('../src/lib/appCache'); let owner = 'first'; const spy = jest.spyOn(cache, 'getCacheUser').mockImplementation(() => owner);
    try {
        const finish = deferLength(); await render('33333333-3333-3333-3333-333333333333');
        if (reason === 'unmount') await act(async () => root.unmount()); else owner = 'second';
        await act(async () => finish({ seconds: 4 })); await act(async () => jest.advanceTimersByTimeAsync(900)); expect(puts()).toHaveLength(0);
    } finally { spy.mockRestore(); }
});
test('entry import of unknown length adds nothing', async () => {
    const finish = deferLength(); await render('33333333-3333-3333-3333-333333333333'); await act(async () => finish({}));
    await act(async () => jest.advanceTimersByTimeAsync(900)); expect(puts()).toHaveLength(0); expect(visible('Could not determine the media length. Nothing was added.')).toBe(true);
});

test('Adjust length uses source bounds, clamps fades, and offers a fine frame step', async () => {
    const { emptyTimeline } = require('../src/lib/nativeEditorModel');
    serverDocument = { ...document, schema_version: 3, timeline: { ...emptyTimeline(), media: { m: { id: 'm', kind: 'video', frames: 90 } }, video: [{ id: 'v1', mediaId: 'm', trackId: 'video-0', start: 0, in: 0, len: 90, fadeOut: 80 }] } };
    await render(); await act(async () => root.container.queryAll(n => n.props.testID === 'clip-v1')[0].props.onAccessibilityTap()); await press('Adjust');
    await press('Decrease Duration: 3.0 seconds'); const first = await savedTimeline(); expect(first.video[0]).toMatchObject({ len: 60, fadeOut: 60 });
    await press('Length +1 frame'); expect((await savedTimeline()).video[0].len).toBe(61);
    await press('Increase Duration: 2.0 seconds'); expect((await savedTimeline()).video[0].len).toBe(90);
});
test('curve and freeze clips enable Adjust duration controls', async () => {
    const { emptyTimeline } = require('../src/lib/nativeEditorModel');
    serverDocument = { ...document, schema_version: 3, timeline: { ...emptyTimeline(), media: { m: { id: 'm', kind: 'video', frames: 90 } }, video: [{ id: 'v1', mediaId: 'm', trackId: 'video-0',
        start: 0, in: 0, len: 90, speedCurve: [] }] } };
    await render(); await act(async () => root.container.queryAll(n => n.props.testID === 'clip-v1')[0].props.onAccessibilityTap()); await press('Adjust');
    expect(visible('Trim this clip on the web editor.')).toBe(false);
    for (const label of ['Decrease Duration: 3.0 seconds', 'Increase Duration: 3.0 seconds', 'Length +1 frame', 'Length −1 frame']) expect(root.container.queryAll(n => n.props.accessibilityLabel
        === label && n.props.accessibilityState?.disabled)).toHaveLength(0);
    for (const fields of [{ freezeFrame: 0 }, { words: [], keyframes: [] }]) {
        await act(async () => root.unmount()); root = createRoot();
        const clip = serverDocument.timeline.video[0]; delete clip.speedCurve; delete clip.freezeFrame; Object.assign(clip, fields);
        await render(); await act(async () => root.container.queryAll(n => n.props.testID === 'clip-v1')[0].props.onAccessibilityTap()); await press('Adjust');
        expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Length −1 frame' && n.props.accessibilityState?.disabled)).toHaveLength(0);
    }
});
test('a track locked while Library length resolves is rechecked at completion', async () => {
    const finish = deferLength(); await render(); await press('Library video'); await press('Choose Library item'); await press('Adjust');
    const locks = root.container.queryAll(n => n.props.accessibilityLabel === 'Lock' && typeof n.props.onClick === 'function');
    await act(async () => locks[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    await act(async () => finish({ seconds: 4 })); expect((await savedTimeline()).video).toHaveLength(0);
});


function playbackDocument() {
    const { emptyTimeline } = require('../src/lib/nativeEditorModel');
    serverDocument = { ...document, schema_version: 3, timeline: {
        ...emptyTimeline(), seq: 2,
        media: { first: { id: 'first', kind: 'image', name: 'First', frames: 60 }, second: { id: 'second', kind: 'image', name: 'Second', frames: 60 } },
        video: [{ id: 'v1', mediaId: 'first', start: 0, len: 30, trackId: 'video-0' }, { id: 'v2', mediaId: 'second', start: 30, len: 30, trackId: 'video-0' }],
        text: [{ id: 't1', text: 'First caption', start: 0, len: 30, trackId: 'text-0' }, { id: 't2', text: 'Second caption', start: 30, len: 30, trackId: 'text-0' }],
    } };
}
const playhead = () => root.container.queryAll(n => n.props.testID === 'timeline-ruler')[0].props.accessibilityValue.text;
async function seekTime(text: string) {
    await press('Enter timecode');
    const input = () => root.container.queryAll(n => n.props.accessibilityLabel === 'Enter timecode' && typeof n.props.onChangeText === 'function')[0];
    await act(async () => input().props.onChangeText(text));
    await act(async () => input().props.onSubmitEditing());
}

test('playback updates timecode, caption and media without rendering the screen per frame; pause, seek and end stop still work', async () => {
    playbackDocument(); await render();
    expect(playhead()).toBe('00:00:00:00');
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Real preview First')).toHaveLength(1);
    await press('Play');
    const renders = mockScreenRender.mock.calls.length;
    for (let i = 0; i < 31; i++) await act(async () => jest.advanceTimersByTime(33));
    expect(playhead()).toBe('00:00:01:01');
    expect(mockScreenRender).toHaveBeenCalledTimes(renders);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Real preview Second')).toHaveLength(1);
    expect(root.container.queryAll(n => n.children.includes('Second caption')).length).toBeGreaterThan(0);
    await press('Pause');
    await act(async () => jest.advanceTimersByTime(200));
    expect(playhead()).toBe('00:00:01:01');
    const pausedRenders = mockScreenRender.mock.calls.length;
    await seekTime('00:00:15');
    expect(playhead()).toBe('00:00:00:15');
    expect(mockScreenRender).toHaveBeenCalledTimes(pausedRenders);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Real preview First')).toHaveLength(1);
    await press('Go to end'); expect(playhead()).toBe('00:00:01:29');
    await press('Play'); await act(async () => jest.advanceTimersByTime(33));
    expect(playhead()).toBe('00:00:00:00');
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Play')).toHaveLength(1);
    await act(async () => jest.advanceTimersByTime(100)); expect(playhead()).toBe('00:00:00:00');
});

test('invalid timecode announces once and does not move the playhead', async () => {
    playbackDocument(); await render();
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announce.mockClear();
    try {
        await seekTime('1:75');
        expect(playhead()).toBe('00:00:00:00');
        expect(announce).toHaveBeenCalledTimes(1);
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
    } finally { announce.mockRestore(); }
});

test('split, paste, text, markers and media insertion read the position after seeking', async () => {
    playbackDocument(); await render();
    await act(async () => root.container.queryAll(n => n.props.testID === 'clip-v1')[0].props.onAccessibilityTap());
    await seekTime('00:00:10'); await press('Split'); await press('Copy');
    await seekTime('00:00:20'); await press('Paste at playhead');
    await seekTime('00:01:10'); await press('Add text');
    await seekTime('00:01:15'); await press('Add marker');
    await press('Media'); await seekTime('00:01:20'); await press('Add First to timeline');
    const tl = await savedTimeline();
    expect(tl.video.some((clip: any) => clip.start === 0 && clip.len === 10)).toBe(true);
    expect(tl.video.some((clip: any) => clip.start === 20 && clip.len === 10)).toBe(true);
    // The playhead (frame 40) is past the last video frame (70 when the title was added: the paste at the playhead inserts, so it pushes later video right), so the title is pulled back inside the video.
    const title = tl.text.find((clip: any) => clip.text === 'Your title');
    expect(title.start).toBe(0);
    expect(title.start + title.len).toBeLessThanOrEqual(70);
    expect(tl.markers[0].frame).toBe(45);
    expect(tl.video.at(-1).start).toBe(50);
});

test('a deferred media insertion uses the frame at completion after another seek', async () => {
    playbackDocument(); const finish = deferLength(); await render();
    await seekTime('00:00:10'); await press('Library video'); await press('Choose Library item');
    await seekTime('00:01:20'); await act(async () => finish({ seconds: 4 }));
    expect((await savedTimeline()).video.at(-1).start).toBe(50);
});


test('timeline follow-scroll responds to subscribed playback frames', async () => {
    playbackDocument(); await render();
    const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
    try {
        const scroller = root.container.queryAll(n => n.props.scrollEventThrottle === 16 && typeof n.props.onLayout === 'function')[0];
        await act(async () => scroller.props.onLayout({ nativeEvent: { layout: { width: 40 } } }));
        await press('Play'); scroll.mockClear();
        const renders = mockScreenRender.mock.calls.length;
        for (let i = 0; i < 20; i++) await act(async () => jest.advanceTimersByTime(33));
        expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ x: 26 }));
        expect(mockScreenRender).toHaveBeenCalledTimes(renders);
    } finally { scroll.mockRestore(); }
});

test.each([[403, 'editor.unavailable'], [429, 'editor.paused'], [0, 'editor.offline']])('project bar shows mapped save failure %s without changing its height', async (status, key) => {
    const { ApiError } = require('../src/lib/api');
    const { t } = require('../src/lib/i18n');
    const { styles } = require('../src/components/editor/fullEditorStyles');
    const base = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path, init) => init?.method === 'PUT' ? Promise.reject(new ApiError(status, 'failure')) : base(path, init));
    await render(); await press('Add text'); await act(async () => jest.advanceTimersByTimeAsync(900));
    expect(root.container.queryAll(node => StyleSheet.flatten(node.props.style)?.fontSize === styles.status.fontSize && node.children.includes(t(key))).length).toBeGreaterThan(0);
    expect(StyleSheet.flatten(styles.projectBar)).toMatchObject({ minHeight: 58, paddingVertical: 8 });
    // The 44 pt button fits the existing bar, including its padding and border.
    expect(root.container.queryAll(node => {
        const style = StyleSheet.flatten(node.props.style);
        return style?.minHeight === 44 && style?.marginVertical === -2;
    }).length).toBeGreaterThan(0);
});
test('project bar shows recovered changes until a clean save includes its revision', async () => {
    const { readDraft } = require('../src/lib/editorDrafts');
    const { styles } = require('../src/components/editor/fullEditorStyles');
    readDraft.mockResolvedValueOnce({ owner: 'owner', projectId, baseRevision: 4, document: { ...document, brief: 'Recovered' }, updatedAt: 1 });
    await render(); await press('Restore unsaved changes');
    expect(root.container.queryAll(node => StyleSheet.flatten(node.props.style)?.fontSize === styles.status.fontSize && node.children.includes('Recovered changes, not saved yet')).length).toBeGreaterThan(0);
    await act(async () => jest.advanceTimersByTimeAsync(900));
    expect(root.container.queryAll(node => StyleSheet.flatten(node.props.style)?.fontSize === styles.status.fontSize && node.children.includes('Saved · v5')).length).toBeGreaterThan(0);
});

test('Add text at the end of the video puts the title inside the video and does not make the project longer', async () => {
    playbackDocument(); await render();
    await seekTime('00:00:02'); await press('Add text');
    const tl = await savedTimeline();
    const title = tl.text.find((item: any) => item.id === 't3');
    const videoEnd = Math.max(...tl.video.map((clip: any) => clip.start + clip.len));
    expect(title.start).toBeGreaterThanOrEqual(0);
    expect(title.start + title.len).toBeLessThanOrEqual(videoEnd);
    expect(Math.max(...[...tl.video, ...tl.text].map((clip: any) => clip.start + clip.len))).toBe(videoEnd);
});

const tracks = [{ id: 'video-0', kind: 'video', name: 'Video 1', locked: false, muted: false, hidden: false }, { id: 'audio-0', kind: 'audio', name: 'Audio 1', locked: false, muted: false, hidden: false }, { id: 'text-0', kind: 'text', name: 'Text 1', locked: false, muted: false, hidden: false }];
const cutTimeline = { schemaVersion: 3, fps: 30, seq: 2, aspect: '16:9', background: '#000000', media: { media1: { id: 'media1', kind: 'video', name: 'Scene one', frames: 60 }, song: { id: 'song', kind: 'audio', name: 'Song', frames: 60 } }, video: [{ id: 'v1', mediaId: 'media1', start: 0, in: 0, len: 60, trackId: 'video-0' }], audio: [{ id: 'a1', mediaId: 'song', start: 0, in: 0, len: 60, trackId: 'audio-0', volume: 1 }], text: [], tracks, markers: [] };

test('the simple Cut screen has a Close gaps toggle (ripple), off by default', async () => {
    serverDocument = { ...document, schema_version: 3, timeline: cutTimeline };
    await renderSimple();
    await act(async () => root.container.queryAll(node => node.props.testID === 'clip-v1')[0].props.onAccessibilityTap());
    const toggle = () => root.container.queryAll(node => node.props.accessibilityLabel === 'Close gaps')[0];
    expect(toggle()).toBeDefined();
    expect(toggle().props.accessibilityState?.selected).toBe(false);
    await press('Close gaps');
    expect(toggle().props.accessibilityState?.selected).toBe(true);
});

test('a selected audio clip has a Volume button in the simple view that opens its volume control', async () => {
    serverDocument = { ...document, schema_version: 3, timeline: cutTimeline };
    await renderSimple();
    expect(labelled('Volume')).toHaveLength(0);
    await act(async () => root.container.queryAll(node => node.props.testID === 'clip-a1')[0].props.onAccessibilityTap());
    await press('Volume');
    expect(visible('Volume')).toBe(true);
    expect(labelled('Volume').length).toBeGreaterThan(0);
});

describe('opening a project that does not load', () => {
    const loaders = () => root.container.queryAll((node) => node.props.accessibilityRole === 'progressbar');
    const documentCalls = () => mockRequest.mock.calls.filter(([path]) => String(path).endsWith('/document') && !path.includes('?')).length;
    const defaultImpl = (path: string) => (path.endsWith('/document') ? { revision: 4, document: serverDocument } : path.endsWith('/media-info') ? { seconds: 4 } : { project: { id: projectId, workspace_id: 'workspace', name: 'Native cut' } });

    test('a load that never answers switches from the spinner to an error with Retry and Back after 15 seconds', async () => {
        let hang = true;
        mockRequest.mockImplementation(async (path: string) => (hang && path.endsWith('/document') ? new Promise(() => {}) : defaultImpl(path)));
        await renderSimple();
        expect(loaders()).toHaveLength(1);
        expect(visible('Check your connection and try again.')).toBe(false);
        await act(async () => { jest.advanceTimersByTime(14000); });
        expect(loaders()).toHaveLength(1);
        await act(async () => { jest.advanceTimersByTime(1500); });
        expect(loaders()).toHaveLength(0);
        expect(visible('Check your connection and try again.')).toBe(true);
        expect(labelled('Retry now')).toHaveLength(1);
        expect(labelled('Back')).toHaveLength(1);
        hang = false;
        await press('Retry now');
        await act(async () => Promise.resolve());
        expect(documentCalls()).toBe(2);
        expect(visible('Native cut')).toBe(true);
        expect(visible('Check your connection and try again.')).toBe(false);
    });

    test('a rejected load shows the error without a spinner, and Back leaves', async () => {
        mockRequest.mockImplementation(async (path: string) => { if (path.endsWith('/document')) throw new Error('offline'); return defaultImpl(path); });
        await renderSimple();
        expect(loaders()).toHaveLength(0);
        expect(visible('Check your connection and try again.')).toBe(true);
        await press('Back');
        expect(mockRouter.back).toHaveBeenCalledTimes(1);
    });

    test('the timeline opens when only the project name or the media list fails', async () => {
        mockRequest.mockImplementation(async (path: string) => { if (path.endsWith('/document')) return defaultImpl(path); if (path.includes('/assets')) throw new Error('slow'); throw new Error('project lookup failed'); });
        await renderSimple();
        expect(root.container.queryAll((node) => node.props.testID === 'editor-timeline-section')).toHaveLength(1);
        expect(visible('Check your connection and try again.')).toBe(false);
    });
});
