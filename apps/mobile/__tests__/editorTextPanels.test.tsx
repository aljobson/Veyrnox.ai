import { act } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
import { TEXT_DEFAULTS, validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { TITLE_STYLES, insertTitlePreset } from '../../../app/veyrnox/_lib/editorPresets.mjs';
import { ANIMATION_CATALOG, LOOP_CATALOG, resetAnimationCatalog } from '../../../app/veyrnox/_lib/editorAnimationCatalog.mjs';
import { SERVER_PLAIN_TEXT_STYLE } from '../src/lib/editorServerExport';
import { TextPanel } from '../src/components/editor/tools/TextPanel';
import { AnimationPanel } from '../src/components/editor/tools/AnimationPanel';
import { exportRefusal } from '../src/lib/editorExportRefusal';
import { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
jest.mock('../src/lib/voiceoverRecorder', () => ({ VOICEOVER_AVAILABLE: false }));

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
const labelled = (label: string) => root.container.queryAll((node) => node.props.accessibilityLabel === label);


async function savedTimeline() { await act(async () => jest.advanceTimersByTimeAsync(900)); return JSON.parse(puts().at(-1)![1].body).document.timeline; }
// Observe the real session and real S1 document gate, without replacing either.
let mockSession: ReturnType<typeof useFullEditorSession>;
jest.mock('../src/components/editor/useFullEditorSession', () => {
    const actual = jest.requireActual('../src/components/editor/useFullEditorSession');
    return { ...actual, useFullEditorSession: (...args: any[]) => { mockSession = actual.useFullEditorSession(...args); return mockSession; } };
});
test('empty Text panel shows all 16 catalog buttons and no style controls', async () => {
    await render(); await press('Text');
    for (const p of TITLE_STYLES) expect(labelled(p.name).length).toBeGreaterThan(0);
    expect(labelled('Font')).toHaveLength(0);
});
test.each(['Delete', 'Duplicate'])('inserting Lower third selects it for %s after video selection', async command => {
    const tl = webSequenceV3(); serverDocument = { ...envelope(tl), project_id: projectId }; await render();
    await act(async () => root.container.queryAll(n => n.props.testID === 'clip-v1')[0].props.onAccessibilityTap());
    await press('Text'); await act(async () => mockSession.frameStore.set(40)); await press('Lower third');
    const inserted = insertTitlePreset(tl, 'Lower third', 40);
    expect(mockSession.currentDocument()!.timeline).toEqual(inserted);
    expect(mockSession.selection).toEqual({ track: 'text', id: `t${inserted.seq}` });
    expect(mockSession.selections).toEqual([mockSession.selection]);
    expect(mockSession.tool).toBe('text');
    await press(command);
    const next: any = mockSession.currentDocument()!.timeline;
    expect(next.video).toEqual(tl.video);
    expect(next.text).toHaveLength(command === 'Delete' ? tl.text.length : tl.text.length + 2);
    expect(validateSequence(next)).toBeNull();
});
test('locked preset refusal preserves document, undo, dirty and both selections', async () => {
    const tl = webSequenceV3(); tl.tracks.find(t => t.kind === 'text')!.locked = true;
    serverDocument = { ...envelope(tl), project_id: projectId }; await render();
    await act(async () => root.container.queryAll(n => n.props.testID === 'clip-v1')[0].props.onAccessibilityTap()); await press('Text');
    const before = { document: mockSession.currentDocument(), history: mockSession.history, dirty: mockSession.dirty,
        selection: mockSession.selection, selections: mockSession.selections };
    await press('Lower third');
    expect({ document: mockSession.currentDocument(), history: mockSession.history, dirty: mockSession.dirty,
        selection: mockSession.selection, selections: mockSession.selections }).toEqual(before);
    expect(mockSession.problem).toBeTruthy(); expect(puts()).toHaveLength(0);
});
async function textPanel(style: any) {
    const tl = webSequenceV3(); tl.text[0].style = style;
    await act(async () => root.render(<TextPanel timeline={tl} selection={{ track: 'text', id: 't3' }} selected={tl.text[0]}
        addText={jest.fn()} updateSelectedText={jest.fn()} patchSelected={jest.fn()} />));
}
test.each([undefined, SERVER_PLAIN_TEXT_STYLE, TEXT_DEFAULTS])('warning uses stored structural identity: %j', async style => {
    await textPanel(style);
    expect(visible(exportRefusal('text.style'))).toBe(style === TEXT_DEFAULTS);
});
test('text controls have names, and custom font explains the fallback', async () => {
    await textPanel({ ...TEXT_DEFAULTS, font: `VXFont_${'a'.repeat(64)}` });
    for (const label of ['Font', 'Text colour hex colour', 'Outline colour hex colour', 'Outline width', 'Background colour hex colour',
        'Background opacity', 'Italic', 'Underline', 'Letter spacing', 'Line height', 'Shadow colour hex colour',
        'Shadow opacity', 'Shadow blur', 'Shadow X', 'Shadow Y']) expect(labelled(label).length).toBeGreaterThan(0);
    expect(visible('Custom font')).toBe(true);
    expect(visible('This title uses a custom font from the website. The phone shows a standard font.')).toBe(true);
});
test('audio selection keeps animation untouched and has no Apply', async () => {
    const tl = webSequenceV3(), audio = { ...tl.video[0], id: 'a1', trackId: 'audio-0' };
    await act(async () => root.render(<AnimationPanel selection={{ track: 'audio', id: 'a1' }} selected={audio} />));
    expect(visible('Animation works on video clips, titles and captions.')).toBe(true); expect(labelled('Apply')).toHaveLength(0);
    expect(audio.animation).toEqual(tl.video[0].animation);
});
test('all catalog labels exist; Loop Pulse Apply preserves channels and Clear resets', async () => {
    const tl = webSequenceV3(); serverDocument = { ...envelope(tl), project_id: projectId }; await render();
    await act(async () => root.container.queryAll(n => n.props.testID === 'clip-v1')[0].props.onAccessibilityTap()); await press('Animation');
    for (const p of ANIMATION_CATALOG) { expect(labelled(p.name).length).toBeGreaterThan(0); expect(visible(p.description)).toBe(true); }
    await press('Loop');
    for (const p of LOOP_CATALOG) { expect(labelled(p.name).length).toBeGreaterThan(0); expect(visible(p.description)).toBe(true); }
    await press('Pulse'); expect(mockSession.dirty).toBe(false); await press('Apply');
    const next = await savedTimeline(); expect(next.video[0].animation).toEqual({ ...tl.video[0].animation, combo: 'pulse', period: 60, amount: .5 });
    await press('Clear animation'); expect(mockSession.currentDocument()!.timeline).toEqual(resetAnimationCatalog(next, { track: 'video', id: 'v1' }));
});
test('one Undo reverses the entire preset insertion', async () => {
    const tl = webSequenceV3(); serverDocument = { ...envelope(tl), project_id: projectId }; await render();
    await press('Text'); await press('Lower third'); expect(mockSession.history.canUndo).toBe(true);
    await press('Undo'); expect(mockSession.currentDocument()!.timeline).toEqual(tl); expect(mockSession.history.canUndo).toBe(false);
});
test('all text section headings are exposed as headers and custom font chip cannot be pressed', async () => {
    await textPanel({ ...TEXT_DEFAULTS, font: `VXFont_${'a'.repeat(64)}` });
    for (const label of ['Text', 'Text styles', 'Text style', 'Typography']) {
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.children.includes(label)).length).toBeGreaterThan(0);
    }
    const chip = labelled('Custom font').find(n => n.props.accessibilityState?.selected);
    expect(chip?.props.accessibilityState).toEqual({ selected: true, disabled: true }); expect(chip?.props.onClick).toBeUndefined();
});
test('trimmed animation notice disappears when restart is selected, then Apply resets the phase', async () => {
    const tl = webSequenceV3(); tl.video[0].animation = { ...tl.video[0].animation, offset: 12, span: 120 };
    serverDocument = { ...envelope(tl), project_id: projectId }; await render();
    await act(async () => root.container.queryAll(n => n.props.testID === 'clip-v1')[0].props.onAccessibilityTap()); await press('Animation');
    const note = 'This trimmed clip keeps its original animation phase. Choose restart to begin at its current start.';
    expect(visible(note)).toBe(true);
    const restart = labelled("Restart animation at this clip's start").find(n => typeof n.props.onChange === 'function')!;
    await act(async () => restart.props.onChange({ nativeEvent: { value: true } })); expect(visible(note)).toBe(false); await press('Apply');
    const next: any = mockSession.currentDocument()!.timeline; expect(next.video[0].animation).toMatchObject({ offset: 0, span: 90 });
});
