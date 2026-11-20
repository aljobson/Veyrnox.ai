jest.mock('../src/lib/voiceoverRecorder', () => ({ VOICEOVER_AVAILABLE: false }));
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
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}), copy: jest.fn().mockResolvedValue(null), backup:
    jest.fn().mockResolvedValue(null) } }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn().mockResolvedValue(4) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'native-save-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: { Screen: ({ options }: any) => { mockStackOptions(options); return options?.headerRight?.() ?? null; } }, usePreventRemove: () => () => {}, useRouter:
    () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => { mockScreenRender(); return { api: mockApi, beginSessionTask: mockBeginSessionTask }; } }));
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: ({ media, localUri }: any) => require('react').createElement(require('react-native').View, {
    accessibilityLabel: `Real preview ${media.name}`, testID: localUri }) }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: ({ onPick }: any) => require('react').createElement(require('react-native').Pressable, { accessibilityRole: 'button',
    accessibilityLabel: 'Choose Library item', onPress: () => onPick({ jobId: '22222222-2222-2222-2222-222222222222', name: 'Library shot', createdAt: '2026-10-23T00:00:00Z' }) }) }));

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
        if (init?.method === 'PUT') return { revision: JSON.parse(init.body as string).expected_revision + 1 };
        if (path.endsWith('/media-info')) return { seconds: 4 };
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
    await act(async () => root.render(<FullEditorScreen projectId={projectId} jobId={jobId} startAdvanced />));
    await act(async () => Promise.resolve());
}
async function renderSimple() {
    await act(async () => root.render(<FullEditorScreen projectId={projectId} />));
    await act(async () => Promise.resolve());
}
const labelled = (label: string) => root.container.queryAll((node) => node.props.accessibilityLabel === label);

import { webSequenceV3 } from './fixtures/webSequenceV3';
import { SPEED_PRESETS } from '../../../app/veyrnox/_lib/editorSpeed.mjs';
async function setup(kind = 'video', freeze = false, locked = false) {
    const tl = webSequenceV3(); tl.media.m.kind = kind; tl.tracks[0].locked = locked;
    if (freeze) Object.assign(tl.video[0], { freezeFrame: 100, volume: 0 });
    tl.video.push({ id: 'v9', mediaId: 'm', start: 90, in: 0, len: 30, trackId: 'video-0' });
    serverDocument = { ...document, schema_version: 3, timeline: tl };
    await render();
    await act(async () => root.container.queryAll(n => n.props.testID === 'clip-v1')[0].props.onAccessibilityTap());
    await press('Adjust');
}
async function saved() {
    await act(async () => jest.advanceTimersByTimeAsync(900));
    return JSON.parse(puts().at(-1)![1].body).document.timeline;
}
test('moving video shows named controls; accelerate commits once with web points', async () => {
    await setup();
    for (const label of ['Constant', 'Smooth', 'Accelerate', 'Decelerate', 'Pulse', 'Reverse', 'Freeze frame (2 s)']) {
        expect(labelled(label).length).toBeGreaterThan(0);
    }
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.props.children === 'Speed')).toHaveLength(1);
    for (const node of root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')) expect(node.props.accessibilityLabel).toBeTruthy();
    await press('Accelerate'); const tl = await saved(); expect(puts()).toHaveLength(1);
    expect(tl.video[0].speedCurve).toEqual(SPEED_PRESETS.accelerate.map((p: any) => ({ frame: p.position * tl.video[0].len, rate: p.rate })));
});
test('images have no speed controls', async () => {
    await setup('image');
    for (const label of ['Constant', 'Accelerate', 'Reverse', 'Freeze frame (2 s)']) expect(labelled(label)).toHaveLength(0);
});
test('freeze shows help, length and remove without moving controls', async () => {
    await setup('video', true);
    expect(visible('This clip holds one source frame. Its source sound is muted.')).toBe(true);
    expect(labelled('Freeze length').length).toBeGreaterThan(0);
    expect(labelled('Remove freeze frame').length).toBeGreaterThan(0);
    for (const label of ['Constant', 'Accelerate', 'Reverse', 'Freeze frame (2 s)']) expect(labelled(label)).toHaveLength(0);
});
test.each(['Delete', 'Duplicate'])('freeze insertion selects both selection sets for ordinary %s', async action => {
    await setup(); await press('Freeze frame (2 s)');
    const inserted = await saved(), freeze = inserted.video.find((c: any) => c.freezeFrame !== undefined);
    expect(freeze).toBeDefined(); await press(action); const next = await saved();
    if (action === 'Delete') {
        expect(next.video.some((c: any) => c.freezeFrame !== undefined)).toBe(false);
        expect(next.video.find((c: any) => c.id === 'v1').start).toBe(0);
    } else expect(next.video.filter((c: any) => c.freezeFrame !== undefined)).toHaveLength(2);
});
test.each(['Remove freeze frame', 'Remove', 'Delete'])('locked freeze %s preserves history and selection', async label => {
    await setup('video', true, true); await press(label);
    await act(async () => jest.advanceTimersByTimeAsync(900)); expect(puts()).toHaveLength(0);
    expect(labelled('Undo')[0].props.accessibilityState.disabled).toBe(true);
    expect(labelled('Remove freeze frame').length).toBeGreaterThan(0);
});
test('outside freeze leaves document, dirty and undo untouched', async () => {
    await setup();
    await press('Enter timecode');
    const input = root.container.queryAll(n => n.props.accessibilityLabel === 'Enter timecode' && typeof n.props.onChangeText === 'function')[0];
    await act(async () => input.props.onChangeText('4'));
    const updated = root.container.queryAll(n => n.props.accessibilityLabel === 'Enter timecode' && typeof n.props.onSubmitEditing === 'function')[0];
    await act(async () => updated.props.onSubmitEditing()); await press('Freeze frame (2 s)');
    expect(visible('Move the playhead inside the video.')).toBe(true);
    await act(async () => jest.advanceTimersByTimeAsync(900)); expect(puts()).toHaveLength(0);
    expect(labelled('Undo')[0].props.accessibilityState.disabled).toBe(true);
    expect(labelled('Freeze frame (2 s)').length).toBeGreaterThan(0);
});
test.each(['slider', 'Length +1 frame', 'Increase Duration: 3.0 seconds', 'handle', 'drag'])('freeze %s ripples with ripple off', async entry => {
    await setup('video', true);
    let delta = 1;
    if (entry === 'slider') {
        const node = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessibilityLabel === 'Freeze length')[0];
        await act(async () => node.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    } else if (entry === 'handle' || entry === 'drag') {
        const node = root.container.queryAll(n => n.props.testID === 'trim-v1-out')[0];
        if (entry === 'handle') await act(async () => node.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
        else {
            delta = 10;
            const event = (pageX: number) => ({ nativeEvent: { pageX, pageY: 0, locationX: 0, locationY: 0 } });
            await act(async () => node.props.onResponderGrant(event(0)));
            await act(async () => node.props.onResponderMove(event(20)));
            await act(async () => node.props.onResponderRelease(event(20)));
        }
    } else { if (entry.startsWith('Increase')) delta = 30; await press(entry); }
    const next = await saved(); expect(next.video[0].len).toBe(90 + delta);
    expect(next.video.find((c: any) => c.id === 'v9').start).toBe(90 + delta);
});

test.each(['Remove freeze frame', 'Remove'])('%s closes the freeze gap and clears selection', async label => {
    await setup('video', true); await press(label); const next = await saved();
    expect(next.video.some((c: any) => c.id === 'v1')).toBe(false);
    expect(next.video.find((c: any) => c.id === 'v9').start).toBe(0);
    expect(next.video.find((c: any) => c.id === 'v2')).toEqual(serverDocument.timeline.video[1]);
    expect(labelled('Remove freeze frame')).toHaveLength(0);
    expect(labelled('Delete')[0].props.accessibilityState.disabled).toBe(true);
});
