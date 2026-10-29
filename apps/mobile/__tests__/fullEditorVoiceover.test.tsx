import { act } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import type { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { emptyTimeline, timelineOf } from '../src/lib/nativeEditorModel';
import { t } from '../src/lib/i18n';

const projectId = '11111111-1111-4111-8111-111111111111', uuid = '22222222-2222-4222-8222-222222222222';
let mockSession: ReturnType<typeof useFullEditorSession>, mockNoToken = false, mockInvalidToken = false;
let mockSheetMounted = false, mockHead: any;
const mockRequest = jest.fn(), mockCopy = jest.fn(), mockPicked = jest.fn(), mockBackup = jest.fn();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() }, mockApi = { request: mockRequest };
const mockRecorder = { record: jest.fn(), stop: jest.fn(), prepareToRecordAsync: jest.fn(), uri: 'file://native.wav' };
const mockPlayer = { pause: jest.fn(), play: jest.fn(), addListener: () => ({ remove() {} }), currentTime: 0, duration: 4 };
const mockRead = jest.fn(), mockProbe = jest.fn(), mockDiscard = jest.fn(), mockMode = jest.fn();
jest.mock('../src/lib/voiceoverRecorder', () => ({ get VOICEOVER_AVAILABLE() { return require('react-native').Platform.OS === 'ios'; }, VOICEOVER_OPTIONS: {}, useAudioRecorder: () => mockRecorder, useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }), useAudioPlayer: () => mockPlayer, getRecordingPermissionsAsync: async () => ({ granted: true }), requestRecordingPermissionsAsync: jest.fn(), setAudioModeAsync: (...args: any[]) => mockMode(...args) }));
jest.mock('../src/lib/editorVoiceoverTakes', () => ({ adoptTake: () => 'file://take.wav', discardTake: (...args: any[]) => mockDiscard(...args) }));
jest.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' }, File: class { open() { return { readBytes: mockRead, close() {} }; } } }));
jest.mock('../src/components/editor/useVoiceoverRecorder', () => ({ useVoiceoverRecorder: (props: any) => {
    require('react').useEffect(() => { mockSheetMounted = true; return () => { mockSheetMounted = false; }; }, []);
    return jest.requireActual('../src/components/editor/useVoiceoverRecorder').useVoiceoverRecorder(props);
} }));
jest.mock('../src/components/editor/useFullEditorSession', () => ({ useFullEditorSession: (args: any) => {
    mockSession = jest.requireActual('../src/components/editor/useFullEditorSession').useFullEditorSession(args);
    return { ...mockSession, preparePicked: (...values: any[]) => mockPicked(...values), beginImport: () => {
        if (mockNoToken) return null;
        const token = mockSession.beginImport(); return token && { ...token, valid: () => !mockInvalidToken && token.valid() };
    } };
} }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {}, userDocStorage: { get: async () => null, set: async () => {}, remove: async () => {}, keys: async () => [] } }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true), removeDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}), copy: (...args: any[]) => mockCopy(...args), backup: (...args: any[]) => mockBackup(...args) } }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: (...args: any[]) => mockProbe(...args) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '22222222-2222-4222-8222-222222222222' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({ Stack: { Screen: ({ options }: any) => options?.headerRight?.() ?? null }, usePreventRemove: () => () => {}, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: () => ({ current: () => true }) }) }));
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: () => null }));
jest.mock('../src/components/chat/MakePanel', () => ({ MakePanel: () => null }));
let root: Root;
const tl = () => timelineOf(mockSession.currentDocument()?.timeline);
const puts = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'PUT');
const button = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === label && typeof node.props.onClick === 'function')[0];
async function press(label: string) { const node = button(label); expect(node).toBeDefined(); await act(async () => node.props.onClick({ nativeEvent: {} })); }
async function open() { await act(async () => root.render(<FullEditorScreen projectId={projectId} />)); await press(t('editor.audio')); }
async function take() { await press(t('editorVoiceover.open')); await press(t('editorVoiceover.record')); await press(t('editorVoiceover.stop')); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); mockNoToken = false; mockInvalidToken = false;
    mockHead = { revision: 4, document: { schema_version: 3, project_id: projectId, timeline: emptyTimeline() } };
    mockSheetMounted = false; mockRead.mockReset().mockResolvedValue(Uint8Array.from([... 'RIFF1234WAVE'].map(c => c.charCodeAt(0))));
    mockProbe.mockReset().mockResolvedValue(4); mockCopy.mockReset().mockResolvedValue({ file: 'file://durable.wav', type: 'audio/wav', size: 128000, seconds: 4, verified: true }); mockBackup.mockReset().mockResolvedValue(null);
    mockPicked.mockReset().mockImplementation((...args: Parameters<typeof mockSession.preparePicked>) => mockSession.preparePicked(...args));
    mockRecorder.prepareToRecordAsync.mockResolvedValue(undefined); mockRecorder.stop.mockResolvedValue(undefined); mockMode.mockResolvedValue(undefined);
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(message => { if (message === t('editorVoiceover.added')) expect(mockSheetMounted).toBe(false); });
    Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true });
    mockRequest.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return { revision: JSON.parse(init.body as string).expected_revision + 1 };
        if (path.endsWith('/document')) return mockHead;
        return { project: { id: projectId, workspace_id: 'workspace', name: 'Cut' } };
    }); root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

test.each(['ios', 'android'] as const)('Audio tool recording availability on %s', async os => {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true }); await open(); expect(!!button(t('editorVoiceover.open'))).toBe(os === 'ios');
});
test.each([false, true])('captures frame 77 at open, stops playback (%s), inserts/selects/saves and announces after unmount', async playing => {
    await open(); await act(async () => { mockSession.setFrame(77); mockSession.setPlaying(playing); }); await take();
    expect(mockSession.playing).toBe(false);
    await act(async () => mockSession.setFrame(120));
    await press(t('editorVoiceover.add'));
    expect(mockPicked).toHaveBeenCalledWith({ uri: 'file://take.wav', mimeType: 'audio/wav', duration: 4000 }, `l-${uuid}`, 'audio', true);
    expect(mockCopy).toHaveBeenCalledWith(projectId, `l-${uuid}`, 'file://take.wav', 'audio/wav', 4);
    expect(tl().audio).toHaveLength(1); expect(tl().audio[0]).toMatchObject({ start: 77, len: 120, mediaId: `l-${uuid}` });
    expect(tl().media[`l-${uuid}`]).toEqual({ id: `l-${uuid}`, kind: 'audio', name: expect.stringMatching(/^Voiceover /), frames: 120, hasAudio: true, width: 0, height: 0 });
    expect(mockSession.selection).toEqual({ track: 'audio', id: tl().audio[0].id }); expect(mockSession.selections).toEqual([mockSession.selection]);
    expect(mockDiscard).toHaveBeenCalledWith('file://take.wav'); expect(mockSheetMounted).toBe(false);
    expect(jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.filter(([message]) => message === t('editorVoiceover.added'))).toHaveLength(1);
    await act(async () => jest.advanceTimersByTimeAsync(900));
    expect(JSON.parse(puts().at(-1)![1].body).document.timeline).toMatchObject({ media: tl().media, audio: tl().audio });
});
test.each(['copy', 'no-token', 'invalid-token', 'header', 'probe', 'locked'] as const)('%s prevents placement and keeps review available', async reason => {
    if (reason === 'locked') mockHead.document.timeline.tracks.filter((track: any) => track.kind === 'audio').forEach((track: any) => { track.locked = true; });
    await open(); await take();
    if (reason === 'copy') mockCopy.mockResolvedValue(null);
    if (reason === 'no-token') mockNoToken = true;
    if (reason === 'invalid-token') mockInvalidToken = true;
    if (reason === 'header') mockRead.mockResolvedValue(new Uint8Array(12));
    if (reason === 'probe') mockProbe.mockResolvedValue(null);
    await press(t('editorVoiceover.add')); expect(tl().audio).toHaveLength(0); expect(mockSheetMounted).toBe(true);
    expect(button(t('editorVoiceover.add')).props.accessibilityState?.disabled).not.toBe(true);
    if (reason === 'header' || reason === 'probe') expect(root.container.queryAll(node => node.children.includes(t('editorVoiceover.unreadable'))).length).toBeGreaterThan(0);
    if (reason === 'locked') expect(root.container.queryAll(node => node.children.includes(t('editor.unlockoraddatrackfirst', { value1: 'audio' }))).length).toBeGreaterThan(0);
});
test('existing three-argument imports still fall back to guessed length when probing and copying fail', async () => {
    await open(); mockProbe.mockResolvedValue(null); mockCopy.mockResolvedValue(null);
    let seconds: number | null = null;
    await act(async () => { seconds = await mockSession.preparePicked({ uri: 'file://picked.mp3' }, `l-${uuid}`, 'audio'); });
    expect(seconds).toBe(10); expect(mockSession.localMediaUris[`l-${uuid}`]).toBe('file://picked.mp3');
    await act(async () => { seconds = await mockSession.preparePicked({ uri: 'file://temp.wav' }, 'l-another', 'audio', true); });
    expect(seconds).toBeNull(); expect(mockSession.localMediaUris['l-another']).toBeUndefined();
});
