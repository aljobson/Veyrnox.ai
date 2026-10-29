jest.mock('../src/lib/voiceoverRecorder', () => ({ VOICEOVER_AVAILABLE: false }));
import { act } from 'react';
import { AccessibilityInfo, Platform, Alert, AppState, Text, View, Pressable } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import type { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { addPending, readPending, markPlaced } from '../src/lib/editorGenerationReturns';
import { emptyTimeline, timelineOf, type Timeline } from '../src/lib/nativeEditorModel';
import { readDraft } from '../src/lib/editorDrafts';
import { waitForJob, type CatalogModel, type JobState } from '../src/lib/media';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
import { formatTimecode } from '../src/lib/editorTimeline';

void [Text, View, Pressable];
const projectId = '11111111-1111-1111-1111-111111111111', jobId = '22222222-2222-2222-2222-222222222222';
let mockOwner = 'owner', mockSession: ReturnType<typeof useFullEditorSession>, mockMake: any;
const mockListeners = new Set<() => void>(), mockStorage = new Map<string, string>();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() }, mockRequest = jest.fn(), mockPut = jest.fn();
const mockApi = { request: mockRequest }, mockBegin = () => { const owner = mockOwner; return { current: () => owner === mockOwner }; };
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockListeners?.add(fn); return () => mockListeners?.delete(fn); }, userDocStorage: {
    get: async (key: string) => mockStorage.get(key) ?? null, set: async (key: string, value: string) => { mockStorage.set(key, value); }, remove: async (key: string) => { mockStorage.delete(key); }, keys: async () => [...mockStorage.keys()],
} }));
jest.mock('../src/components/editor/useFullEditorSession', () => ({ useFullEditorSession: (args: any) => { mockSession = jest.requireActual('../src/components/editor/useFullEditorSession').useFullEditorSession(args); return mockSession; } }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true), removeDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}), copy: jest.fn().mockResolvedValue(null), backup: jest.fn().mockResolvedValue(null) } }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn().mockResolvedValue(4) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'save-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({ Stack: { Screen: ({ options }: any) => options?.headerRight?.() ?? null }, usePreventRemove: () => () => {}, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: mockBegin }) }));
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: () => null }));
jest.mock('../src/components/chat/MakePanel', () => ({ MakePanel: (props: any) => { mockMake = props; return props.visible ? require('react').createElement(require('react-native').Text, {}, props.resultNote) : null; } }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), waitForJob: jest.fn() }));
let root: Root, head: { revision: number; document: any };
let polls: Map<string, { finish(state: JobState): void; signal: AbortSignal }>, active: Set<(state: any) => void>;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const model = (kind = 'video') => ({ name: 'Generated result', modality: `text-to-${kind}` } as CatalogModel);
const item = (placed = false) => ({ jobId, kind: 'video' as const, frame: 42, name: 'Generated result', createdAt: Date.now(), placed });
const tl = () => timelineOf(mockSession.currentDocument()?.timeline);
const generated = () => [...tl().video, ...tl().audio].filter(clip => clip.mediaId === `j-${jobId}`);
const hasText = (text: string) => root.container.queryAll(node => node.children.includes(text)).length > 0;
const tick = async (ms: number) => { await act(async () => jest.advanceTimersByTimeAsync(ms)); };
async function press(label: string, last = false) {
    const nodes = root.container.queryAll(node => node.props.accessibilityLabel === label && typeof node.props.onClick === 'function');
    expect(nodes.length).toBeGreaterThan(0);
    await act(async () => (last ? nodes.at(-1)! : nodes[0]).props.onClick({ nativeEvent: {} }));
}
async function open() { await act(async () => root.render(<FullEditorScreen projectId={projectId} />)); }
async function generate(kind = 'video', frame = 42) {
    await act(async () => mockSession.setFrame(frame));
    if (kind === 'audio') { await press('Audio'); await press(t('editor.generatevoiceormusic')); }
    else { await press('Generate'); await press('Generate', true); }
    await act(async () => mockMake.onJobStarted(jobId, model(kind)));
}
async function finish(state: JobState = 'succeeded') { await act(async () => polls.get(jobId)!.finish(state)); }
async function foreground() { await act(async () => active.forEach(fn => fn('active'))); }
async function conflict() {
    mockPut.mockRejectedValueOnce(new ApiError(409, 'conflict'));
    await act(async () => { await mockSession.save(); });
    expect(mockSession.sync.sheet).toBe('conflict');
}
async function useSaved(timeline: Timeline) {
    head = { revision: 8, document: { ...head.document, timeline } };
    await act(async () => mockSession.sync.useSaved());
    const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    if (buttons) await act(async () => buttons.find(button => button.style === 'destructive')!.onPress!());
}
function gesture(edge?: 'in' | 'out') {
    const node = root.container.queryAll(node => node.props.testID === (edge ? `trim-v1-${edge}` : 'clip-v1'))[0];
    const event = (x: number) => ({ nativeEvent: { pageX: x, pageY: 40, locationY: 10 } });
    return { grant: () => node.props.onResponderGrant(event(10)), move: () => node.props.onResponderMove(event(30)), release: () => node.props.onResponderRelease(event(30)) };
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks();
    mockOwner = 'owner'; mockMake = null; mockStorage.clear(); polls = new Map(); active = new Set();
    head = { revision: 4, document: { schema_version: 3, project_id: projectId, timeline: emptyTimeline() } };
    jest.mocked(readDraft).mockReset().mockResolvedValue(null);
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, fn) => { active.add(fn); return { remove: () => { active.delete(fn); } }; });
    Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true });
    mockPut.mockReset().mockResolvedValue({ revision: 5 });
    mockRequest.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return mockPut(path, init);
        if (path.endsWith('/document')) return head;
        if (path.endsWith('/media-info')) return { seconds: 4 };
        if (path.endsWith('/asset')) return { url: 'https://example.com/a.wav', mime_type: 'audio/wav' };
        return { project: { id: projectId, workspace_id: 'workspace', name: 'Cut' } };
    });
    jest.mocked(waitForJob).mockImplementation((_api, id, onState, signal) => new Promise(resolve => { polls.set(id, { finish: state => { onState(state); resolve(state); }, signal }); }));
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

test('approved readiness getter is false before the initial draft decision and true after', async () => {
    const draft = deferred<null>(); jest.mocked(readDraft).mockReturnValueOnce(draft.promise);
    await addPending(projectId, item()); await open(); expect(mockSession.sync.draftDecided).toBe(false); expect(mockSession.document).not.toBeNull(); expect(waitForJob).not.toHaveBeenCalled();
    await act(async () => draft.resolve(null)); expect(mockSession.sync.draftDecided).toBe(true); expect(waitForJob).toHaveBeenCalledTimes(1);
});
test.each(['video', 'audio'])('Generate opens without navigation and stores the open-time frame for %s placement', async kind => {
    await open(); await generate(kind, 42); expect(mockRouter.push).not.toHaveBeenCalled(); expect(mockPut).not.toHaveBeenCalled();
    expect(mockMake.initialKind).toBe(kind); expect((await readPending(projectId))[0].frame).toBe(42);
    await act(async () => mockSession.setFrame(99)); await finish();
    expect(tl()[kind as 'video' | 'audio']).toContainEqual(expect.objectContaining({ mediaId: `j-${jobId}`, start: 42 }));
});
test.each(['account change', 'unmount'])('a job finishing after %s changes nothing', async reason => {
    await open(); await generate(); const poll = polls.get(jobId)!;
    if (reason === 'unmount') await act(async () => root.unmount());
    else await act(async () => { mockOwner = 'other'; mockListeners.forEach(fn => fn()); });
    expect(poll.signal.aborted).toBe(true); await act(async () => poll.finish('succeeded')); await tick(1000);
    expect(mockPut).not.toHaveBeenCalled(); expect(JSON.parse([...mockStorage.values()][0]).items[0].placed).toBe(false);
});
test('a stored item from an earlier visit is placed when the editor opens', async () => {
    await addPending(projectId, item()); await open(); await finish(); expect(generated()).toHaveLength(1); expect(generated()[0].start).toBe(42);
});
test('a locked track leaves not-added; Add at playhead uses the current frame and Dismiss removes it', async () => {
    head.document.timeline.tracks[0].locked = true;
    await addPending(projectId, item()); await open(); await press('Generate'); await finish();
    expect(hasText(t('editorAi.notAdded'))).toBe(true); expect(generated()).toHaveLength(0);
    await act(async () => { const timeline = tl(); timeline.tracks[0].locked = false; mockSession.markDocument({ ...mockSession.currentDocument()!, timeline }); mockSession.setFrame(77); });
    await press(t('editorAi.addAtPlayhead')); expect(generated()[0].start).toBe(77);
    await act(async () => mockSession.travel('undo')); expect(hasText(t('editorAi.removed'))).toBe(true);
    await press(t('editorAi.dismiss')); expect(await readPending(projectId)).toEqual([]);
});
test('failed removes the item and shows job.failed with its name', async () => {
    await open(); await generate(); await finish('failed');
    expect(await readPending(projectId)).toEqual([]); expect(hasText(`Generated result: ${t('job.failed')}`)).toBe(true);
});
test('H1 the record survives insertion and is removed only after the save that holds the clip commits', async () => {
    const saved = deferred<{ revision: number }>(); mockPut.mockReturnValueOnce(saved.promise);
    await open(); await generate(); await finish(); expect(generated()).toHaveLength(1);
    expect((await readPending(projectId))[0].placed).toBe(true);
    await tick(900); expect(await readPending(projectId)).toHaveLength(1);
    await act(async () => saved.resolve({ revision: 5 })); expect(await readPending(projectId)).toEqual([]);
});
test('H1 a PUT that fails keeps the record and the clip is not inserted twice on the next trigger', async () => {
    mockPut.mockRejectedValue(new ApiError(503, 'offline'));
    await open(); await generate(); await finish(); await tick(900); await foreground();
    expect(await readPending(projectId)).toHaveLength(1); expect(generated()).toHaveLength(1);
});
test('H1 unmount before the 900 ms save keeps the record and the next open places it once', async () => {
    await open(); await generate(); await finish();
    // The recovered draft holds the sole insertion; placed history prevents making a second copy.
    const recovered = mockSession.currentDocument()!;
    await act(async () => root.unmount()); expect(await readPending(projectId)).toHaveLength(1);
    jest.mocked(readDraft).mockResolvedValueOnce({ owner: 'owner', projectId, baseRevision: 4, document: recovered, updatedAt: Date.now() });
    root = createRoot(); await open(); await act(async () => mockSession.sync.recover());
    expect(generated()).toHaveLength(1); expect(waitForJob).toHaveBeenCalledTimes(1);
});
test('H1 Undo before the save leaves a Removed row, not a second insert', async () => {
    await open(); await generate(); await finish(); await act(async () => mockSession.travel('undo')); await foreground();
    expect(generated()).toHaveLength(0); expect(hasText(t('editorAi.removed'))).toBe(true); expect(await readPending(projectId)).toHaveLength(1);
});
test('H1 AI-06 Delete before save leaves Removed and is not acknowledged although timeline.media still holds the id', async () => {
    await open(); await generate(); await finish();
    await act(async () => mockSession.setSelection({ track: 'video', id: generated()[0].id })); await press('Delete'); await tick(900); await foreground();
    expect(tl().media[`j-${jobId}`]).toBeDefined(); expect(generated()).toHaveLength(0); expect(await readPending(projectId)).toHaveLength(1); expect(hasText(t('editorAi.removed'))).toBe(true);
});
test('H1a AI-05 after insertion, conflict and Use saved lacking the result shows Removed without reinserting', async () => {
    await open(); await generate(); await finish(); await conflict(); await useSaved(emptyTimeline());
    expect(generated()).toHaveLength(0); expect(hasText(t('editorAi.removed'))).toBe(true); expect(await readPending(projectId)).toHaveLength(1);
});
test('H1a conflict and Use saved holding the result never duplicates and acknowledges the clean saved revision', async () => {
    await open(); await generate(); await finish(); const timeline = tl(); await conflict(); await useSaved(timeline);
    expect(generated()).toHaveLength(1); expect(await readPending(projectId)).toEqual([]);
});
test('H1a AI-05 a placed record whose clip is missing on the next open shows Removed, not a new insert', async () => {
    await addPending(projectId, item()); await markPlaced(projectId, jobId); await open(); await press('Generate');
    expect(hasText(t('editorAi.removed'))).toBe(true); expect(waitForJob).not.toHaveBeenCalled(); expect(generated()).toHaveLength(0);
});
test('an existing result clip is not added twice and an already saved clip acknowledges a leftover record', async () => {
    const timeline = emptyTimeline(); timeline.media[`j-${jobId}`] = { id: `j-${jobId}`, kind: 'video', frames: 120 };
    timeline.video.push({ id: 'v1', mediaId: `j-${jobId}`, start: 0, len: 120, trackId: 'video-0' }); head.document.timeline = timeline;
    await addPending(projectId, item()); await open(); expect(generated()).toHaveLength(1); expect(await readPending(projectId)).toEqual([]); expect(waitForJob).not.toHaveBeenCalled();
});
test.each(['drag', 'trim', 'long-press wait'])('H2 AI-02 completion during %s is inserted after release and survives the gesture snapshot', async mode => {
    const timeline = emptyTimeline(); timeline.seq = 1; timeline.media.source = { id: 'source', kind: 'video', frames: 300 };
    timeline.video.push({ id: 'v1', mediaId: 'source', start: 0, len: 120, in: 0, trackId: 'video-0' }); head.document.timeline = timeline;
    await open(); await generate(); await act(async () => { mockSession.setSelection({ track: 'video', id: 'v1' }); mockSession.setSelections([{ track: 'video', id: 'v1' }]); });
    const g = gesture(mode === 'trim' ? 'out' : undefined); await act(async () => g.grant());
    if (mode !== 'long-press wait') await tick(300);
    await finish(); expect(generated()).toHaveLength(0); expect(await readPending(projectId)).toHaveLength(1);
    await tick(1200); expect(await readPending(projectId)).toHaveLength(1); expect(mockPut).not.toHaveBeenCalled();
    await act(async () => g.release()); expect(generated()).toHaveLength(1);
    expect(mode === 'trim' ? tl().video[0].len : tl().video[0].start).toBeGreaterThan(mode === 'trim' ? 120 : 0);
    await tick(900); expect(generated()).toHaveLength(1); expect(await readPending(projectId)).toEqual([]);
});
test('H3 completion while conflict is open neither inserts nor acknowledges, then uses the chosen document', async () => {
    await open(); await generate(); await act(async () => mockSession.markDocument({ ...mockSession.currentDocument()!, brief: 'edit' }));
    const poll = polls.get(jobId)!; await conflict(); expect(poll.signal.aborted).toBe(true); await act(async () => poll.finish('succeeded'));
    expect(generated()).toHaveLength(0); expect(await readPending(projectId)).toHaveLength(1);
    await useSaved(emptyTimeline()); await finish(); expect(generated()).toHaveLength(1);
});
test('H3 a watcher is aborted on closing and stays paused when the next open presents Recovery', async () => {
    await open(); await generate(); const poll = polls.get(jobId)!;
    await act(async () => root.unmount()); expect(poll.signal.aborted).toBe(true);
    jest.mocked(readDraft).mockResolvedValueOnce({ owner: 'owner', projectId, baseRevision: 4, document: { ...head.document, brief: 'draft' }, updatedAt: Date.now() });
    root = createRoot(); await open(); expect(mockSession.sync.sheet).toBe('recovery'); await act(async () => poll.finish('succeeded'));
    expect(generated()).toHaveLength(0); expect(waitForJob).toHaveBeenCalledTimes(1); expect(await readPending(projectId)).toHaveLength(1);
});
test('H3 a hand-back whose import token goes stale during libraryMedia is not applied and stays pending', async () => {
    const length = deferred<{ seconds: number }>(), original = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path, init) => path.endsWith('/media-info') ? length.promise : original(path, init));
    await open(); await generate();
    const begin = mockSession.sync.beginImport; let valid = true;
    jest.spyOn(mockSession.sync, 'beginImport').mockImplementation(() => { const token = begin(); return token && { ...token, valid: () => valid && token.valid() }; });
    await act(async () => mockSession.setTool('audio'));
    await finish(); valid = false; await act(async () => length.resolve({ seconds: 4 }));
    expect(generated()).toHaveLength(0); expect(await readPending(projectId)).toHaveLength(1);
});
test('H4 after jumping to marker 18000 Generate stores 17999 and the note shows its timecode', async () => {
    head.document.timeline.markers = [{ id: 'marker', frame: 18000, label: 'End', color: '#fff' }];
    await open(); await press('Markers'); await press(t('editor.goto', { value1: 'End' })); await press('Generate'); await press('Generate', true);
    expect(mockMake.resultNote).toBe(t('editorAi.note', { time: formatTimecode(17999, 30) }));
    await act(async () => mockMake.onJobStarted(jobId, model())); expect((await readPending(projectId))[0].frame).toBe(17999);
});


test('AI-06 an orphan media entry without a clip does not count as delivery', async () => {
    head.document.timeline.media[`j-${jobId}`] = { id: `j-${jobId}`, kind: 'video', frames: 120 };
    await addPending(projectId, item()); await open(); await finish(); expect(generated()).toHaveLength(1);
});
test('unknown length leaves an actionable not-added row', async () => {
    const original = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path, init) => path.endsWith('/media-info') ? Promise.resolve({}) : path.endsWith('/asset') ? Promise.resolve({ url: 'http://unsafe.example/a', mime_type: 'video/mp4' }) : original(path, init));
    await open(); await generate(); await finish(); expect(generated()).toHaveLength(0); expect(hasText(t('editorAi.notAdded'))).toBe(true);
});
test('the Make panel stays mounted after close and its delayed callback retains the original open frame', async () => {
    await open(); expect(mockMake).toBeNull(); await generate('video', 42);
    const callback = mockMake.onJobStarted; await act(async () => mockMake.onClose()); expect(mockMake.visible).toBe(false);
    await act(async () => mockSession.setFrame(90)); await press('Generate', true);
    await act(async () => callback('33333333-3333-3333-3333-333333333333', model()));
    expect((await readPending(projectId)).find(row => row.jobId.startsWith('3333'))?.frame).toBe(42);
});

test('a project change retains the late submission for its original project and aborts its watcher', async () => {
    await open(); await generate(); const callback = mockMake.onJobStarted, poll = polls.get(jobId)!;
    const otherId = '44444444-4444-4444-4444-444444444444';
    head = { revision: 4, document: { schema_version: 3, project_id: otherId, timeline: emptyTimeline() } };
    await act(async () => root.render(<FullEditorScreen projectId={otherId} />));
    expect(poll.signal.aborted).toBe(true);
    await act(async () => { poll.finish('succeeded'); callback('33333333-3333-3333-3333-333333333333', model()); });
    expect(generated()).toHaveLength(0); expect(await readPending(projectId)).toHaveLength(2); expect(await readPending(otherId)).toEqual([]);
});


test('a locked result is not retried by edits or saves; Add at playhead still works after unlocking', async () => {
    head.document.timeline.tracks[0].locked = true;
    await open(); await generate(); await finish();
    expect(hasText(t('editorAi.notAdded'))).toBe(true);
    const calls = mockRequest.mock.calls.length;
    await act(async () => { const timeline = tl(); timeline.tracks[0].locked = false; mockSession.markDocument({ ...mockSession.currentDocument()!, timeline, brief: 'edit' }); });
    expect(waitForJob).toHaveBeenCalledTimes(1); expect(mockRequest).toHaveBeenCalledTimes(calls); expect(generated()).toHaveLength(0);
    await tick(900); expect(waitForJob).toHaveBeenCalledTimes(1); expect(generated()).toHaveLength(0);
    expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/media-info'))).toHaveLength(1);
    await act(async () => mockSession.setFrame(77)); await press(t('editorAi.addAtPlayhead'));
    expect(generated()).toHaveLength(1); expect(generated()[0].start).toBe(77);
});
test('a not-added result retries on AppState active', async () => {
    head.document.timeline.tracks[0].locked = true;
    await open(); await generate(); await finish(); await foreground();
    expect(waitForJob).toHaveBeenCalledTimes(2); await finish(); expect(hasText(t('editorAi.notAdded'))).toBe(true);
});
test('a paid submit resolving after unmount remains pending and is picked up on the next open', async () => {
    await open(); await act(async () => mockSession.setFrame(42)); await press('Generate'); await press('Generate', true);
    const callback = mockMake.onJobStarted, submit = deferred<string>();
    const completion = submit.promise.then(id => callback(id, model()));
    await act(async () => root.unmount());
    await act(async () => { submit.resolve(jobId); await completion; });
    expect(await readPending(projectId)).toEqual([expect.objectContaining({ jobId, frame: 42, placed: false })]);
    expect(waitForJob).not.toHaveBeenCalled(); expect(mockPut).not.toHaveBeenCalled();
    root = createRoot(); await open(); await finish(); expect(generated()).toHaveLength(1); expect(generated()[0].start).toBe(42);
});
test('a late submit after an account change is not recorded', async () => {
    await open(); await press('Generate'); await press('Generate', true); const callback = mockMake.onJobStarted;
    await act(async () => root.unmount()); mockOwner = 'other';
    await act(async () => callback(jobId, model())); expect(mockStorage.size).toBe(0);
});
test('the Generate note remains visible and is announced once on iOS', async () => {
    const original = Platform.OS; Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    try {
        await open(); await generate(); announce.mockClear(); await finish('failed');
        const note = `Generated result: ${t('job.failed')}`;
        expect(hasText(note)).toBe(true); expect(announce.mock.calls.filter(([text]) => text === note)).toHaveLength(1);
    } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); }
});

test('an unexpected reconcile rejection stays handled and the next trigger can retry', async () => {
    await addPending(projectId, item());
    const store = require('../src/lib/editorGenerationReturns') as typeof import('../src/lib/editorGenerationReturns');
    jest.spyOn(store, 'readPending').mockRejectedValueOnce(new Error('read interrupted'));
    await open(); expect(waitForJob).not.toHaveBeenCalled(); expect(await readPending(projectId)).toHaveLength(1);
    await foreground(); expect(waitForJob).toHaveBeenCalledTimes(1); await finish(); expect(generated()).toHaveLength(1);
});
