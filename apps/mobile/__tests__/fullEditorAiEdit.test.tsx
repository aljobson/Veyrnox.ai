import { act } from 'react';
import { Alert, AccessibilityInfo, ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import type { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { emptyTimeline, timelineOf, type Timeline } from '../src/lib/nativeEditorModel';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
import { resetNetworkState, markOffline } from '../src/lib/networkState';
import { OFFLINE_PAID_MESSAGE } from '../src/lib/network';
void [AccessibilityInfo, ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View];
const projectId = '11111111-1111-4111-8111-111111111111', jobId = '33333333-3333-4333-8333-333333333333';
const mockRequest = jest.fn(), mockApi = { request: mockRequest }, mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
var mockListeners: Set<() => void>;
let mockSession: ReturnType<typeof useFullEditorSession>, mockOwner = 'owner';
jest.mock('../src/lib/editorFlag', () => ({ EDITOR_AI_EDIT_ENABLED: true, EDITOR_SPEECH_CUT_ENABLED: true }));
jest.mock('../src/lib/voiceoverRecorder', () => ({ VOICEOVER_AVAILABLE: false }));
jest.mock('../src/lib/appCache', () => {
    mockListeners = new Set<() => void>();
    return { getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockListeners.add(fn); return () => mockListeners.delete(fn); } };
});
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true), removeDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}), copy: jest.fn().mockResolvedValue(null), backup: jest.fn().mockResolvedValue(null) } }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn().mockResolvedValue(12) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'request-key-123456' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, usePreventRemove: () => () => {}, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: () => ({ current: () => true }) }) }));
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: () => null }));
jest.mock('../src/components/chat/MakePanel', () => ({ MakePanel: () => null }));
jest.mock('../src/components/editor/useFullEditorSession', () => ({ useFullEditorSession: (args: any) => {
    mockSession = jest.requireActual('../src/components/editor/useFullEditorSession').useFullEditorSession(args); return mockSession;
} }));
const seed = (): Timeline => ({ ...emptyTimeline(), seq: 1, media: { [`j-${jobId}`]: { id: `j-${jobId}`, kind: 'video', name: 'My private take', frames: 360, hasAudio: true } },
    video: [{ id: 'v1', mediaId: `j-${jobId}`, start: 0, in: 0, len: 360, trackId: 'video-0', rate: 1, volume: 1, transition: 0 }] });
const aiResult = { status: 'completed', plan: { commands: [{ op: 'split', kind: 'video', id: 'v1', frame: 60 }, { op: 'setVolume', kind: 'video', id: 'v1', volume: .5 }] }, credits: 7, summary: 'Two edits', skipped: [] };
const speechResult = { id: 'analysis', status: 'completed', analysis: { version: 1, assetId: jobId, duration: 12, provider: 'fal-scribe-v2', language: 'en', transcript: 'Hello world', chunks: [{ start: 1, end: 2, text: 'Hello' }, { start: 5, end: 7, text: 'world' }] } };
let root: Root, price: number, unavailable: boolean, resultError: ApiError | null, head: any;
const tl = () => timelineOf(mockSession.currentDocument()?.timeline);
const nodes = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function');
const visible = (value: string) => root.container.queryAll(n => n.children.includes(value)).length > 0;
async function press(label: string) { const matches = nodes(label); expect(matches).toHaveLength(1); await act(async () => matches[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); }
async function render() { await act(async () => root.render(<FullEditorScreen projectId={projectId} />)); }
async function open(mode: 'ai' | 'speech') {
    await press(t('editorSimple.aiEdit')); await press(t(mode === 'ai' ? 'editorAi.describe' : 'editorSpeech.silences'));
    if (mode === 'ai') await act(async () => root.container.queryAll(n => n.props.accessibilityLabel === t('editorAi.instruction') && typeof n.props.onChangeText === 'function')[0].props.onChangeText('Split and lower volume'));
}
const sendLabel = (mode: string) => mode === 'ai' ? t('editorAi.send', { price: t('editorAi.price', { n: price }) }) : t('editorSpeech.start');
const posts = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'POST');
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); resetNetworkState();
    price = 7; unavailable = false; resultError = null; mockOwner = 'owner'; head = { revision: 4, document: { schema_version: 3, project_id: projectId, timeline: seed() } };
    mockRequest.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
        if (path.endsWith('/quote')) { if (unavailable) throw new ApiError(501, 'unavailable'); return { credits: price, max_seconds: 60, languages: ['en'], max_commands: 20, max_instruction_chars: 500 }; }
        if (init?.method === 'POST') { if (resultError) throw resultError; return path.includes('speech-analyses') ? speechResult : aiResult; }
        if (init?.method === 'PUT') return { revision: JSON.parse(init.body as string).expected_revision + 1 };
        if (path.endsWith('/document')) return head;
        return { project: { id: projectId, workspace_id: 'workspace', name: 'Cut' } };
    }); root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });
for (const mode of ['ai', 'speech'] as const) {
    test(`${mode}: quote price visible before Send; refreshed and changed price require reconfirmation`, async () => {
        await render(); price = 11; await open(mode);
        expect(visible(t(mode === 'ai' ? 'editorAi.price' : 'editorSpeech.price', { n: 11 }))).toBe(true); expect(posts()).toHaveLength(0);
        const all = root.container.queryAll(() => true);
        expect(all.findIndex(n => n.children.includes(t(mode === 'ai' ? 'editorAi.price' : 'editorSpeech.price', { n: 11 })))).toBeLessThan(all.findIndex(n => n.props.accessibilityLabel === sendLabel(mode)));
        resultError = new ApiError(409, 'price_changed', { credits: 13 }); await press(sendLabel(mode)); price = 13;
        expect(visible(t(mode === 'ai' ? 'editorAi.price' : 'editorSpeech.price', { n: 13 }))).toBe(true); expect(posts()).toHaveLength(1);
        resultError = null; await press(sendLabel(mode)); expect(JSON.parse(posts()[1][1].body).expectedCredits).toBe(13);
    });
    test(`${mode}: confirmed refund displays not charged and leaves timeline unchanged`, async () => {
        resultError = new ApiError(422, 'plan_unusable', { refunded: true }); await render(); const before = tl(); await open(mode); await press(sendLabel(mode));
        expect(visible(t(mode === 'ai' ? 'editorAi.notCharged' : 'editorSpeech.notCharged'))).toBe(true); expect(tl()).toEqual(before); expect(mockSession.history.canUndo).toBe(false);
    });
    test(`${mode}: Apply creates exactly one Undo; undo, redo and replacement increment revision`, async () => {
        await render(); const before = tl(), revision = mockSession.getEditRevision(); await open(mode); await press(sendLabel(mode));
        expect(tl()).toEqual(before); await press(t('editorAi.apply')); const after = tl(); expect(after).not.toEqual(before); expect(mockSession.getEditRevision()).toBe(revision + 1);
        await act(async () => mockSession.travel('undo')); expect(tl()).toEqual(before); expect(mockSession.history.canUndo).toBe(false); expect(mockSession.getEditRevision()).toBe(revision + 2);
        await act(async () => mockSession.travel('redo')); expect(tl()).toEqual(after); expect(mockSession.getEditRevision()).toBe(revision + 3);
        await act(async () => mockSession.markDocument({ ...mockSession.currentDocument()!, timeline: seed() }, false)); expect(mockSession.getEditRevision()).toBe(revision + 4);
    });
    test(`${mode}: stale Apply refuses same-looking document with a newer editRevision`, async () => {
        await render(); await open(mode); await press(sendLabel(mode)); const before = tl();
        await act(async () => mockSession.markDocument({ ...mockSession.currentDocument()!, timeline: before })); const revision = mockSession.getEditRevision();
        await press(t('editorAi.apply')); expect(tl()).toEqual(before); expect(mockSession.getEditRevision()).toBe(revision); expect(visible(t('editorAi.stale'))).toBe(true);
    });
    test(`${mode}: offline never starts and explains refusal`, async () => {
        await render(); await open(mode); markOffline(); await press(sendLabel(mode)); expect(posts()).toHaveLength(0); expect(visible(OFFLINE_PAID_MESSAGE)).toBe(true);
    });
}
test('501 hides both AI Edit rows', async () => {
    unavailable = true; await render(); await press(t('editorSimple.aiEdit'));
    expect(nodes(t('editorAi.describe'))).toHaveLength(0); expect(nodes(t('editorSpeech.silences'))).toHaveLength(0); expect(nodes(t('editorSpeech.retakes'))).toHaveLength(0);
});
test.each(['f-local', 'e-device', 'p-project'])('speech unsupported source %s explains why and disables Start', async id => {
    const tl = seed(), media = Object.values(tl.media)[0]; tl.media = { [id]: { ...media, id } }; tl.video[0].mediaId = id; head.document.timeline = tl;
    await render(); await open('speech'); expect(visible(t(id.startsWith('p-') ? 'editorSpeech.unsupported' : 'editorSpeech.uploadFirst'))).toBe(true);
    expect(nodes(t('editorSpeech.start'))[0].props.accessibilityState.disabled).toBe(true); expect(posts()).toHaveLength(0);
});
test('speech preview removal checkboxes are advisory; Discard never touches history', async () => {
    await render(); const before = tl(); await open('speech'); await press(sendLabel('speech'));
    const boxes = root.container.queryAll(n => n.props.accessibilityRole === 'checkbox' && typeof n.props.onClick === 'function'); expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) await act(async () => box.props.onClick({ nativeEvent: {} }));
    expect(nodes(t('editorAi.apply'))[0].props.accessibilityState.disabled).toBe(true); await press(t('editorAi.discard')); expect(tl()).toEqual(before); expect(mockSession.history.canUndo).toBe(false);
});

test('Use saved replaces the baseline and increments editRevision, clearing history', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(); await act(async () => mockSession.markDocument({ ...mockSession.currentDocument()!, brief: 'local' }));
    const revision = mockSession.getEditRevision(); head = { revision: 8, document: { ...head.document, brief: 'remote' } };
    await act(async () => mockSession.sync.useSaved());
    const confirmation = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(b => b.style === 'destructive' || b.text === t('projects.restore'))!;
    await act(async () => confirmation.onPress!());
    expect(mockSession.currentDocument()?.brief).toBe('remote'); expect(mockSession.getEditRevision()).toBe(revision + 1); expect(mockSession.history.canUndo).toBe(false);
});

test('speech reports transcribing with a live region; closing cancels polling', async () => {
    await render(); await open('speech');
    mockRequest.mockImplementationOnce(async () => ({ id: 'analysis', status: 'queued' }))
        .mockImplementationOnce(async () => ({ id: 'analysis', status: 'queued', progress: 'transcribing' }));
    await press(sendLabel('speech'));
    expect(visible(t('editorSpeech.transcribing'))).toBe(true);
    expect(root.container.queryAll(n => n.props.accessibilityLiveRegion === 'polite').length).toBeGreaterThan(0);
    const poll = mockRequest.mock.calls.find(([path]) => path.includes('/speech-analyses/by-key/'))!; expect(poll[1].signal.aborted).toBe(false);
    await press(t('editorSimple.close')); expect(poll[1].signal.aborted).toBe(true);
});
