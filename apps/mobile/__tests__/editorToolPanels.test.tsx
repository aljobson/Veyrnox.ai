jest.mock('../src/lib/voiceoverRecorder', () => ({ VOICEOVER_AVAILABLE: false }));
import { act } from 'react';
import { AccessibilityInfo, ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { validProjectDocument } from '../../../lib/projectDocument.js';

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


async function savedTimeline() { await act(async () => jest.advanceTimersByTimeAsync(900)); return JSON.parse(puts().at(-1)![1].body).document.timeline; }
test.each(['normal', 'left'])('style-less web text accepts %s with complete web defaults', async value => {
    const tl = webSequenceV3(); delete tl.text[0].style; serverDocument = { ...envelope(tl), project_id: projectId }; await render();
    await press('Captions'); await press('00:00:00:00 Hello world'); await press('Text'); await press(value);
    const next = await savedTimeline(); expect(validateSequence(next)).toBeNull(); expect(next.text[0].style.strokeWidth).toBe(2);
});
test('animation edits keep combo and timing extras', async () => {
    const tl = webSequenceV3(); serverDocument = { ...envelope(tl), project_id: projectId }; await render();
    await press('Captions'); await press('00:00:00:00 Hello world'); await press('Animation');
    const zoom = root.container.queryAll(n => n.props.accessibilityLabel === 'Zoom' && typeof n.props.onClick === 'function');
    await act(async () => zoom[0].props.onClick({ nativeEvent: {} })); await press('Apply');
    const next = await savedTimeline(); expect(next.text[0].animation).toEqual({ ...tl.text[0].animation, in: 'zoom' }); expect(validateSequence(next)).toBeNull();
});
test('changing caption text clears stale word timing', async () => {
    serverDocument = { ...envelope(webSequenceV3()), project_id: projectId }; await render(); await press('Captions'); await press('00:00:00:00 Hello world');
    const input = root.container.queryAll(n => n.props.accessibilityLabel === 'Words' && typeof n.props.onChangeText === 'function')[0];
    await act(async () => input.props.onChangeText('New words'));
    const next = await savedTimeline(); expect(next.text[0].words).toEqual([]); expect(validateSequence(next)).toBeNull();
});
test.each([1, 2])('first canvas edit promotes schema %s envelope', async version => {
    serverDocument = { ...document, schema_version: version, ...(version === 2 ? { timeline: null } : {}) }; await render();
    await press('Adjust'); await press('9:16'); const next = await savedTimeline(); expect(validateSequence(next)).toBeNull();
    const saved = JSON.parse(puts().at(-1)![1].body).document;
    expect(saved.schema_version).toBe(3); expect(validProjectDocument(saved, projectId)).toBe(true);
});

import { MediaPanel } from '../src/components/editor/tools/MediaPanel';
import { AudioPanel } from '../src/components/editor/tools/AudioPanel';
import { TextPanel } from '../src/components/editor/tools/TextPanel';
import { CaptionsPanel, TranscriptPanel } from '../src/components/editor/tools/CaptionsPanels';
import { EffectsPanel, TransitionsPanel, FiltersPanel } from '../src/components/editor/tools/LookPanels';
import { AnimationPanel } from '../src/components/editor/tools/AnimationPanel';
import { MarkersPanel } from '../src/components/editor/tools/MarkersPanel';
import { AdjustPanel } from '../src/components/editor/tools/AdjustPanel';
import { ToolRail } from '../src/components/editor/tools/ToolRail';
import { tools } from '../src/components/editor/tools/editorTools';
import type { ToolPanelProps } from '../src/components/editor/tools/types';
import { t } from '../src/lib/i18n';
const panelCases = [
    [MediaPanel, 'Project media', 'Library video'], [AudioPanel, 'Audio', 'Generate voice or music'],
    [TextPanel, 'Text', 'Add text'], [CaptionsPanel, 'Captions', 'Add caption at playhead'],
    [TranscriptPanel, 'Transcript', '00:00:00:00 Hello world'], [EffectsPanel, 'Effects', 'None'],
    [TransitionsPanel, 'Transitions', 'Dissolve'], [FiltersPanel, 'Filters', 'Brightness'],
    [AnimationPanel, 'Animation', 'Zoom'], [MarkersPanel, 'Markers', 'Add marker'], [AdjustPanel, 'Source', 'Move left'],
] as const;
function panelFixture(): ToolPanelProps {
    const timeline = webSequenceV3(), noop = () => {};
    return { timeline, selection: { track: 'video', id: 'v1' }, selected: timeline.video[0], selections: [],
        selectedMedia: timeline.media.m, selectedTrack: timeline.tracks[0], patchSelected: noop, applyTimeline: () => true,
        availableMedia: Object.values(timeline.media), addMediaToTimeline: noop, libraryPending: false, replacing: false,
        setLibraryKind: noop, choosePhotos: async () => {}, chooseFiles: async () => {}, selectClip: noop, openVoiceover: noop,
        openGenerate: noop, addTimelineTrack: noop, addText: noop, addCaption: noop, updateSelectedText: noop,
        setFrame: noop, setPlaying: noop, addTimelineMarker: noop, currentDocument: () => envelope(timeline), document: envelope(timeline),
        markDocument: () => ({ status: 'accepted' }), canvas: { aspect_ratio: '16:9', frame_rate: 30 }, updateCanvas: noop, updateTrack: noop,
        canMove: () => true, moveSelection: noop, removeSelection: noop, adjustStart: noop, adjustLength: noop,
        speedActions: { changeSpeed: noop, toggleReverse: noop, changeCurve: noop, insertFreeze: noop, freezeLength: noop, removeFreeze: noop } };
}
test.each(panelCases)('%s retains its accessible heading and a representative control', async (Panel, header, label) => {
    await act(async () => root.render(<Panel {...panelFixture()} />));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.children.includes(header)).length).toBeGreaterThan(0);
    expect(labelled(label).length).toBeGreaterThan(0);
});
test('tool rail preserves order and selected state', async () => {
    await act(async () => root.render(<ToolRail tool="animation" setTool={() => {}} />));
    const buttons = root.container.queryAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onClick === 'function');
    expect(buttons.map(n => n.props.accessibilityLabel)).toEqual(tools.map(tool => tool.label));
    expect(buttons.filter(n => n.props.accessibilityState.selected).map(n => n.props.accessibilityLabel)).toEqual([t('editor.animation')]);
});
