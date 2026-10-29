import { act } from 'react';
import { AccessibilityInfo, Platform, Pressable, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import type { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { emptyTimeline, timelineOf } from '../src/lib/nativeEditorModel';
import { libraryMedia } from '../src/lib/editorLibraryLength';
import { probeDuration } from '../src/lib/editorMediaDuration';
import { t } from '../src/lib/i18n';
void [Pressable, Text, View];
const projectId = '11111111-1111-1111-1111-111111111111', jobId = '22222222-2222-2222-2222-222222222222';
let mockOwner = 'owner', mockSession: ReturnType<typeof useFullEditorSession>;
const mockListeners = new Set<() => void>(), mockRequest = jest.fn();
const mockApi = { request: mockRequest }, mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockBegin = () => { const owner = mockOwner; return { current: () => owner === mockOwner }; };
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockListeners?.add(fn); return () => mockListeners?.delete(fn); }, userDocStorage: { get: async () => null } }));
jest.mock('../src/components/editor/useFullEditorSession', () => ({ useFullEditorSession: (args: any) => { mockSession = jest.requireActual('../src/components/editor/useFullEditorSession').useFullEditorSession(args); return mockSession; } }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true), removeDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}) } }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn() }));
jest.mock('../src/lib/editorLibraryLength', () => ({ ...jest.requireActual('../src/lib/editorLibraryLength'), libraryMedia: jest.fn(jest.requireActual('../src/lib/editorLibraryLength').libraryMedia) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'save-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, usePreventRemove: () => () => {}, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: mockBegin }) }));
jest.mock('../src/components/chat/MakePanel', () => ({ MakePanel: () => null }));
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: () => null }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: ({ onPick }: any) => require('react').createElement(require('react-native').Pressable, { accessibilityLabel: 'Pick audio', onPress: () => onPick({ jobId: '22222222-2222-2222-2222-222222222222', name: 'Song' }) }) }));
let root: Root, stems: string[];
const tl = () => timelineOf(mockSession.currentDocument()?.timeline);
async function press(label: string) {
    const nodes = root.container.queryAll(node => node.props.accessibilityLabel === label && typeof node.props.onClick === 'function');
    expect(nodes).toHaveLength(1); await act(async () => nodes[0].props.onClick({ nativeEvent: {} }));
}
async function open() { await act(async () => root.render(<FullEditorScreen projectId={projectId} />)); await press('Library audio'); await press('Pick audio'); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); mockOwner = 'owner'; stems = ['vocals', 'drums'];
    jest.mocked(probeDuration).mockReset().mockResolvedValue(4);
    mockRequest.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return { revision: 5 };
        if (path.endsWith('/document')) return { revision: 4, document: { schema_version: 3, project_id: projectId, timeline: emptyTimeline() } };
        if (path.includes('/asset')) return { url: 'https://example.com/audio.wav', mime_type: 'audio/wav', output_stems: path.includes('?stem=') ? undefined : stems };
        return { project: { id: projectId, name: 'Cut', workspace_id: 'workspace' } };
    }); root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
test('picking a stem job in Library audio opens the sheet without calling libraryMedia', async () => {
    await open(); expect(libraryMedia).not.toHaveBeenCalled();
    expect(root.container.queryAll(node => node.children.includes(t('stems.title'))).length).toBeGreaterThan(0);
});
test('Add vocals adds the web stem id on audio at the current playhead and keeps the sheet open', async () => {
    await open(); await act(async () => mockSession.setFrame(18000)); await press(t('editorAi.addStem', { stem: t('stem.vocals') }));
    expect(tl().audio[0]).toMatchObject({ mediaId: `j-${jobId}--vocals`, start: 17999, len: 1 });
    expect(tl().media[`j-${jobId}--vocals`]).toMatchObject({ kind: 'audio', frames: 120 });
    await act(async () => mockSession.setFrame(60)); await press(t('editorAi.addStem', { stem: t('stem.drums') }));
    expect(tl().audio[1]).toMatchObject({ mediaId: `j-${jobId}--drums`, start: 60 });
});
test('an owner change during stem duration fetch adds nothing', async () => {
    let finish!: (value: number) => void; jest.mocked(probeDuration).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await open(); await press(t('editorAi.addStem', { stem: t('stem.vocals') }));
    await act(async () => { mockOwner = 'other'; mockListeners.forEach(fn => fn()); finish(4); });
    expect(mockSession.currentDocument()).toBeNull(); expect(mockRequest.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});
test('a plain audio job still imports through libraryMedia', async () => {
    stems = []; await open(); expect(libraryMedia).toHaveBeenCalledTimes(1); expect(tl().audio[0]).toMatchObject({ mediaId: `j-${jobId}`, start: 0, len: 120 });
});
test('an unknown stem length shows the existing error and adds nothing', async () => {
    jest.mocked(probeDuration).mockResolvedValueOnce(null); await open(); await press(t('editorAi.addStem', { stem: t('stem.vocals') }));
    expect(tl().audio).toHaveLength(0); expect(root.container.queryAll(node => node.children.includes(t('stems.error'))).length).toBeGreaterThan(0);
});


test('stem errors stay visible and are announced on iOS', async () => {
    const original = Platform.OS; Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    try {
        jest.mocked(probeDuration).mockResolvedValueOnce(null); await open(); announce.mockClear();
        await press(t('editorAi.addStem', { stem: t('stem.vocals') }));
        expect(root.container.queryAll(node => node.children.includes(t('stems.error'))).length).toBeGreaterThan(0);
        expect(announce).toHaveBeenCalledWith(t('stems.error'));
    } finally { announce.mockRestore(); Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); }
});
