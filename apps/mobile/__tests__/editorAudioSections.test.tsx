import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import type { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { act, useLayoutEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { createRoot, type Root } from 'test-renderer';
import { AudioSettingsSection } from '../src/components/editor/tools/AudioSettingsSection';
import { OriginalAudioSection } from '../src/components/editor/tools/OriginalAudioSection';
import { useAudioSettingsActions } from '../src/components/editor/tools/useAudioSettingsActions';
import { useOriginalAudio } from '../src/components/editor/tools/useOriginalAudio';
import { TranscriptPanel } from '../src/components/editor/tools/CaptionsPanels';
import { createFrameStore } from '../src/components/editor/editorFrameStore';
import { insertMediaAt } from '../src/lib/editorInsertMedia';
import { originalAudioMedia } from '../src/lib/editorOriginalAudio';
import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
import { documentProblem } from '../src/lib/editorDocumentGate';
import { type Timeline } from '../src/lib/nativeEditorModel';
import type { InsertResult } from '../src/components/editor/useEditorGenerationReturns';
// Match the existing screen suites' allowance for cold React Native rendering on shared hosts.
jest.setTimeout(30000);
const mockEnsure = jest.fn(async (_id: string) => 'file://sound');
const mockPlay = jest.fn(async (_uri: string) => {}), mockStop = jest.fn(), mockRelease = jest.fn();
jest.mock('../src/lib/editorOriginalAudioFiles', () => ({
    ensureOriginalAudioFile: (id: string) => mockEnsure(id), createAudition: () => ({ play: mockPlay, stop: mockStop, release: mockRelease }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'new') }));
let root: Root, timeline: Timeline, commits: Timeline[], message: string | null, dirty: boolean, localUris: Record<string, string>;
let actions: ReturnType<typeof useAudioSettingsActions>;
const store = createFrameStore();
function Harness({ catalog = false, playing = false, insertResult }: { catalog?: boolean; playing?: boolean; insertResult?: InsertResult }) {
    const [, render] = useState(0), [uris, setUris] = useState<Record<string, string>>({});
    const clip = timeline.video[0] ?? timeline.audio[0];
    const handlers = useAudioSettingsActions({ timeline, selection: { track: timeline.video.length ? 'video' : 'audio', id: clip.id }, frameStore: store,
        applyTimeline: next => { if (documentProblem(envelope(next))) return false;
            commits.push(next); timeline = next; dirty = true; render(n => n + 1); return true; }, setProblem: next => { message = next; } });
    const original = useOriginalAudio({ timeline, localMediaUris: uris, setLocalMediaUris: setUris, frameStore: store, playing,
        setProblem: next => { message = next; }, insertMedia: (media, at, _select, onPlaced) => {
            if (insertResult) return insertResult;
            const result = insertMediaAt(timeline, media, at); if ('error' in result) return result.error;
            timeline = result.timeline; commits.push(timeline); onPlaced(result.trimmed); render(n => n + 1); return 'placed';
        } });
    useLayoutEffect(() => { actions = handlers; localUris = uris; });
    return catalog ? <OriginalAudioSection actions={original} /> :
        <AudioSettingsSection clip={clip} media={timeline.media.m} track={timeline.video.length ? 'video' : 'audio'} actions={handlers} />;
}
beforeEach(() => { jest.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); timeline = webSequenceV3();
    commits = []; message = null; dirty = false; store.set(30); jest.clearAllMocks(); jest.mocked(randomUUID).mockReset().mockReturnValue('new'); });
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
async function press(label: string) {
    const node = root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function')[0];
    expect(node).toBeDefined(); await act(async () => node.props.onClick());
}
const named = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label);
test('disclosures expose expanded and respect sound/freeze visibility', async () => {
    await act(async () => root.render(<Harness />));
    expect(named('Equaliser')[0].props.accessibilityState.expanded).toBe(false);
    await press('Equaliser'); expect(named('Equaliser')[0].props.accessibilityState.expanded).toBe(true);
    expect(named('Low')).toHaveLength(1); expect(named('Audio processing')).toHaveLength(1); expect(named('Audio effects')).toHaveLength(1);
    timeline = { ...timeline, media: { m: { ...timeline.media.m, kind: 'image', hasAudio: false } } };
    await act(async () => root.render(<Harness />)); expect(named('Audio processing')).toHaveLength(0); expect(named('Audio effects')).toHaveLength(0);
    timeline = webSequenceV3(); timeline.video[0].freezeFrame = 100;
    await act(async () => root.render(<Harness />)); expect(named('Audio processing')).toHaveLength(0);
});
test('refused noise edit leaves document, undo and dirty unchanged', async () => {
    await act(async () => root.render(<Harness />)); const before = JSON.stringify(timeline);
    await act(async () => actions.patch({ audioProcessing: { pitch: 0, voice: 'none', noiseReduction: .5, noiseStart: 30, noiseLength: .3, gateDb: -96 } }));
    expect(JSON.stringify(timeline)).toBe(before); expect(commits).toEqual([]); expect(dirty).toBe(false);
    expect(message).toBe('Choose a noise sample inside this file.');
});
test.each([
    ['dropped', "This sound couldn't be prepared. Try again."],
    [{ status: 'not-live' }, "This sound couldn't be prepared. Try again."],
    [{ status: 'refused', reason: 'invalid' }, "That change can't be kept in this project."],
    [{ status: 'refused', reason: 'tooLarge' }, 'This project is too large to save. Remove some clips or keyframes first.'],
] as const)('announces insertion failure %j even when the insert callback sets no problem', async (insertResult, expected) => {
    const before = JSON.stringify(timeline);
    await act(async () => root.render(<Harness catalog insertResult={insertResult} />));
    await press('Insert Soft keys');
    expect(message).toBe(expected);
    expect(JSON.stringify(timeline)).toBe(before); expect(commits).toEqual([]); expect(localUris).toEqual({});
    expect(named('Insert Soft keys')[0].props.accessibilityState.disabled).toBe(false);
});
test('preview wording follows the selected lane and is absent for images', async () => {
    const videoNote = 'The phone preview plays volume and fades. EQ, pan, voice, noise and effects are saved but not heard on the phone yet.';
    const audioNote = "Sounds on audio tracks don't play in the phone preview yet.";
    const catalogNote = `${audioNote} Use Preview to hear one.`;
    const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
    await screen(); await act(async () => mockSession.setSelection({ track: 'video', id: 'v1' })); await press('Adjust');
    expect(text(videoNote).length).toBeGreaterThan(0); expect(text(audioNote)).toHaveLength(0);
    await press('Audio'); expect(text(catalogNote).length).toBeGreaterThan(0);
    await press('Insert Tap click'); await press('Adjust');
    expect(text(catalogNote)).toHaveLength(0);
    expect(text(audioNote).length).toBeGreaterThan(0); expect(text(videoNote)).toHaveLength(0);
    await act(async () => {
        const doc = mockSession.currentDocument()!, tl = doc.timeline as Timeline;
        expect(mockSession.markDocument({ ...doc, timeline: { ...tl, media: { ...tl.media,
            still: { id: 'still', kind: 'image', name: 'Still image', hasAudio: false, frames: 90, width: 640, height: 360 } },
            video: [...tl.video, { id: 'v12', mediaId: 'still', trackId: 'video-0', start: 300, in: 0, len: 90, volume: 1, transition: 0 }], seq: 12 } })).toEqual({ status: 'accepted' });
        mockSession.setSelection({ track: 'video', id: 'v12' });
    });
    expect(text(videoNote)).toHaveLength(0); expect(text(audioNote)).toHaveLength(0);
});
test('playhead shortens sample for tap-click and refuses below the minimum', async () => {
    timeline.media.m = { ...originalAudioMedia('tap-click', 'm') };
    timeline.video = []; timeline.audio = [{ id: 'a1', mediaId: 'm', trackId: 'audio-0', start: 0, in: 0, len: 6, volume: 1 }]; timeline.text = [];
    store.set(1); await act(async () => root.render(<Harness />)); await act(async () => actions.usePlayhead());
    expect(timeline.audio[0].audioProcessing?.noiseLength).toBe(.2);
    expect(timeline.audio[0].audioProcessing?.noiseStart).toBe(0);
    timeline.media.m = { ...timeline.media.m, originalAudio: undefined, frames: 1 }; timeline.audio[0].len = 1; store.set(0);
    await act(async () => root.render(<Harness />)); const before = JSON.stringify(timeline), count = commits.length;
    await act(async () => actions.usePlayhead()); expect(JSON.stringify(timeline)).toBe(before); expect(commits).toHaveLength(count);
    expect(message).toBe('Choose a noise sample inside this file.');
});
test('catalog filters and inserts one document, preview stops on stop, playback and unmount', async () => {
    await act(async () => root.render(<Harness catalog />));
    expect(root.container.queryAll(n => String(n.props.accessibilityLabel ?? '').startsWith('Insert ') && n.props.onClick)).toHaveLength(10);
    await press('Music'); expect(root.container.queryAll(n => String(n.props.accessibilityLabel ?? '').startsWith('Insert ') && n.props.onClick)).toHaveLength(4);
    await press('All');
    const search = named('Search sounds').find(n => n.props.onChangeText)!;
    await act(async () => search.props.onChangeText('button'));
    expect(root.container.queryAll(n => String(n.props.accessibilityLabel ?? '').startsWith('Insert ') && n.props.onClick)).toHaveLength(1);
    await press('Preview Tap click'); expect(mockPlay).toHaveBeenCalledTimes(1); await press('Stop preview'); expect(mockStop).toHaveBeenCalled();
    await press('Insert Tap click'); expect(commits).toHaveLength(1);
    expect(timeline.media['l-new']).toEqual(originalAudioMedia('tap-click', 'l-new')); expect(timeline.audio).toHaveLength(1);
    await act(async () => root.render(<Harness catalog playing />)); expect(mockStop).toHaveBeenCalled();
    await act(async () => root.unmount()); expect(mockRelease).toHaveBeenCalled();
});
test.each([[240, 'text'], [500, 'text'], [240, 'audio'], [500, 'audio']] as const)(
    'announces actual placement at frame %s when %s extends the timeline', async (frame, extension) => {
        if (extension === 'text') timeline.text[0].len = 600;
        else { timeline.audio = [{ id: 'a11', mediaId: 'm', start: 540, len: 60, in: 0, volume: 1, trackId: 'audio-0' }]; timeline.seq = 11; }
        store.set(frame); await act(async () => root.render(<Harness catalog />));
        await press('Insert Soft keys'); expect(timeline.audio.find(c => c.mediaId === 'l-new')!.start).toBe(0);
        expect(message).toBe('Added Soft keys at 00:00:00:00, shortened to end with the video.');
    });
test('existing caption selection cannot be treated as a legacy caption', async () => {
    const captionActions = { busy: false } as any;
    await act(async () => root.render(<TranscriptPanel timeline={{ ...timeline, text: [...timeline.text,
        { ...timeline.text[0], id: 'legacy', caption: false, words: undefined }] }} selection={{ track: 'text', id: 't3' }}
        selections={[{ track: 'text', id: 't3' }]} selectClip={() => {}} setFrame={() => {}} captionActions={captionActions} />));
    const button = named('Treat as captions')[0]; expect(button.props.accessibilityState.disabled).toBe(true);
});

// Observe the real session to verify gate, history and both selection representations.
let mockSession: ReturnType<typeof useFullEditorSession>;
jest.mock('../src/components/editor/useFullEditorSession', () => ({ useFullEditorSession: (args: unknown) => {
    mockSession = jest.requireActual('../src/components/editor/useFullEditorSession').useFullEditorSession(args); return mockSession;
} }));
const mockRequest = jest.fn(), mockApi = { request: mockRequest };
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockBeginSessionTask = () => ({ current: () => true });
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/voiceoverRecorder', () => ({ VOICEOVER_AVAILABLE: false }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true),
    removeDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}),
    copy: jest.fn().mockResolvedValue(null), backup: jest.fn().mockResolvedValue(null) } }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, usePreventRemove: () => () => {}, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: mockBeginSessionTask }) }));
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: () => null }));
async function screen(tl = webSequenceV3()) {
    const doc = envelope(tl);
    mockRequest.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return { revision: JSON.parse(init.body as string).expected_revision + 1 };
        if (path.endsWith('/document')) return { revision: 4, document: doc };
        return { project: { id: doc.project_id, workspace_id: 'workspace', name: 'Audio test' } };
    });
    await act(async () => root.render(<FullEditorScreen projectId={doc.project_id} startAdvanced />));
}
test('real screen refused noise edit leaves currentDocument, undo and dirty untouched', async () => {
    const tl = webSequenceV3(); tl.video[0].audioProcessing!.noiseStart = 30;
    await screen(tl); await act(async () => { mockSession.setSelection({ track: 'video', id: 'v1' }); });
    await press('Adjust'); await press('Audio processing');
    const before = JSON.stringify(mockSession.currentDocument());
    const slider = named('Noise reduction').find(n => n.props.onAccessibilityAction)!;
    await act(async () => slider.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(mockSession.problem).toBe('Choose a noise sample inside this file.');
    expect(JSON.stringify(mockSession.currentDocument())).toBe(before);
    expect(mockSession.history.canUndo).toBe(false); expect(mockSession.dirty).toBe(false);
});
test('real screen insert is one undo step, selects both representations and restores missing URI after hydrate', async () => {
    await screen(); await press('Audio'); await press('Insert Tap click');
    const tl = mockSession.currentDocument()!.timeline as Timeline, clip = tl.audio[0];
    expect(tl.media['l-new']).toEqual(originalAudioMedia('tap-click', 'l-new'));
    expect(mockSession.selection).toEqual({ track: 'audio', id: clip.id }); expect(mockSession.selections).toEqual([mockSession.selection]);
    expect(mockSession.localMediaUris['l-new']).toBe('file://sound');
    await act(async () => mockSession.setLocalMediaUris({}));
    expect(mockSession.localMediaUris['l-new']).toBe('file://sound');
    await press('Undo'); expect((mockSession.currentDocument()!.timeline as Timeline).audio).toHaveLength(0);
    expect(mockSession.history.canUndo).toBe(false);
});
test('real screen announces both placement and shortening inside a shorter video', async () => {
    await screen(); await act(async () => mockSession.frameStore.set(30));
    await press('Audio'); await press('Insert Soft keys');
    const tl = mockSession.currentDocument()!.timeline as Timeline, clip = tl.audio[0];
    expect(clip.start).toBe(30); expect(clip.len).toBe(210);
    expect(clip.len).toBeLessThan(tl.media[clip.mediaId!].frames!);
    expect(mockSession.problem).toBe('Added Soft keys at 00:00:01:00, shortened to end with the video.');
});
test('after tapping an existing caption word Treat as captions stays disabled', async () => {
    const tl = webSequenceV3(); tl.text[0].wordsEstimated = false; tl.text.push({ ...tl.text[0], id: 't11', caption: false, words: undefined }); tl.seq = 11;
    await screen(tl); await press('Transcript'); await press('Word 1: Hello');
    expect(named('Treat as captions')[0].props.accessibilityState.disabled).toBe(true);
});
test('all controls have names; short noise bounds are ordered; search has an empty state', async () => {
    await act(async () => root.render(<Harness />));
    for (const label of ['Equaliser', 'Audio processing', 'Audio effects']) await press(label);
    for (const node of root.container.queryAll(n => n.props.onClick || n.props.accessibilityRole === 'adjustable')) expect(node.props.accessibilityLabel).toBeTruthy();
    for (const node of root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')) {
        expect(node.props.accessibilityValue.min).toBeGreaterThanOrEqual(node.props.accessibilityLabel === 'Low' ||
            ['Mid', 'High'].includes(node.props.accessibilityLabel) ? -24 : node.props.accessibilityLabel === 'Pitch' ? -12 :
            node.props.accessibilityLabel === 'Noise gate' ? -96 : 0);
        expect(node.props.accessibilityValue.max).toBeGreaterThanOrEqual(node.props.accessibilityValue.min);
    }
    await act(async () => root.render(<Harness catalog />));
    await act(async () => named('Search sounds').find(n => n.props.onChangeText)!.props.onChangeText('no-such-preset'));
    expect(root.container.queryAll(n => n.children.includes('No sounds match.')).length).toBeGreaterThan(0);
});
test('pending audition is disabled and cancelled on playback or panel unmount', async () => {
    let resolve!: (uri: string) => void;
    mockEnsure.mockImplementationOnce(() => new Promise<string>(r => { resolve = r; }));
    await act(async () => root.render(<Harness catalog />));
    await press('Preview Tap click');
    expect(named('Insert Tap click')[0].props.accessibilityState.disabled).toBe(true);
    await act(async () => root.render(<Harness catalog playing />));
    await act(async () => { resolve('file://later'); }); expect(mockPlay).not.toHaveBeenCalled();
    mockEnsure.mockImplementationOnce(() => new Promise<string>(r => { resolve = r; }));
    await act(async () => root.render(<Harness catalog />)); await press('Preview Tap click');
    await act(async () => root.render(<Harness />)); await act(async () => { resolve('file://later'); });
    expect(mockPlay).not.toHaveBeenCalled();
});

test('moved insertion announces the exact frame, including a fractional second', async () => {
    timeline.video[1].len = 91; store.set(500);
    await act(async () => root.render(<Harness catalog />)); await press('Insert Tap click');
    expect(timeline.audio[0].start).toBe(235);
    expect(message).toBe('Added Tap click at 00:00:07:25.');
});

test('real screen re-adding an existing original sound from Media announces shortening', async () => {
    await screen(); await press('Audio'); await press('Insert Soft keys');
    await act(async () => mockSession.frameStore.set(30));
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility'); announce.mockClear();
    await press('Media'); await press('Add Soft keys to timeline');
    expect(announce.mock.calls).toEqual([['Music trimmed to fit your video.']]);
    await press('Add Soft keys to timeline');
    const tl = mockSession.currentDocument()!.timeline as Timeline;
    expect(tl.audio).toHaveLength(3);
    expect(tl.audio[1]).toMatchObject({ mediaId: 'l-new', start: 30, len: 210 });
    expect(tl.audio[2]).toMatchObject({ mediaId: 'l-new', start: 30, len: 210 });
    expect(mockSession.problem).toBe('Music trimmed to fit your video.');
    expect(announce.mock.calls).toEqual([['Music trimmed to fit your video.'], ['Music trimmed to fit your video.']]);
});
test.each(['drag', 'trim'])('real screen queues original audio during a clip %s and announces only after placement', async mode => {
    const tl = webSequenceV3(); tl.video = [{ id: 'v1', mediaId: 'm', start: 0, in: 0, len: 120, trackId: 'video-0' }]; tl.text = [];
    let finish!: (uri: string) => void;
    mockEnsure.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await screen(tl); await act(async () => { mockSession.setSnap(false); mockSession.setZoom(1); mockSession.frameStore.set(30); });
    await press('Audio'); await press('Insert Soft keys');
    await act(async () => {
        mockSession.setSelection({ track: 'video', id: 'v1' }); mockSession.setSelections([{ track: 'video', id: 'v1' }]);
    });
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility'); announce.mockClear();
    const node = () => root.container.queryAll(n => n.props.testID === (mode === 'trim' ? 'trim-v1-out' : 'clip-v1'))[0];
    const event = (x: number) => ({ nativeEvent: { pageX: x, pageY: 40, locationY: 10 } });
    await act(async () => node().props.onResponderGrant(event(10)));
    await act(async () => jest.advanceTimersByTimeAsync(300));
    await act(async () => node().props.onResponderMove(event(40)));
    await act(async () => finish('file://queued-sound'));
    expect((mockSession.currentDocument()!.timeline as Timeline).audio).toHaveLength(0);
    expect(mockSession.localMediaUris['l-new']).toBeUndefined(); expect(announce).not.toHaveBeenCalled();
    await act(async () => node().props.onResponderRelease(event(40)));
    const placed = mockSession.currentDocument()!.timeline as Timeline;
    expect(placed.video[0]).toMatchObject(mode === 'trim' ? { start: 0, len: 150 } : { start: 30, len: 120 });
    expect(placed.audio).toEqual([expect.objectContaining({ mediaId: 'l-new', start: 30, len: 120 })]);
    expect(mockSession.localMediaUris['l-new']).toBe('file://queued-sound');
    expect(announce.mock.calls.filter(([text]) => text.startsWith('Added '))).toEqual([['Added Soft keys at 00:00:01:00, shortened to end with the video.']]);
    await press('Undo'); expect((mockSession.currentDocument()!.timeline as Timeline).audio).toHaveLength(0);
    expect((mockSession.currentDocument()!.timeline as Timeline).video).toEqual(placed.video);
});
test('real screen announces two consecutive catalog placements with identical sentences once each', async () => {
    await screen(); await press('Audio');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility'); announce.mockClear();
    const placements = () => announce.mock.calls.filter(([text]) => text.startsWith('Added '));
    jest.mocked(randomUUID).mockReturnValueOnce('first').mockReturnValueOnce('second');
    await press('Insert Soft keys');
    expect(placements()).toEqual([['Added Soft keys at 00:00:00:00, shortened to end with the video.']]);
    await press('Insert Soft keys');
    expect((mockSession.currentDocument()!.timeline as Timeline).audio.map(c => c.mediaId)).toEqual(['l-first', 'l-second']);
    expect(placements()).toEqual([
        ['Added Soft keys at 00:00:00:00, shortened to end with the video.'],
        ['Added Soft keys at 00:00:00:00, shortened to end with the video.'],
    ]);
});
test('real screen audio-only insertion at frame 17,900 does not claim a trim to video', async () => {
    const tl = webSequenceV3(), media = originalAudioMedia('soft-keys', 'existing');
    tl.video = []; tl.text = []; tl.media = { existing: media };
    tl.audio = [{ id: 'a1', mediaId: media.id, trackId: 'audio-0', start: 0, in: 0, len: media.frames!, volume: 1 }];
    await screen(tl); await act(async () => mockSession.frameStore.set(17900));
    await press('Audio'); await press('Insert Soft keys');
    const inserted = (mockSession.currentDocument()!.timeline as Timeline).audio[1];
    expect(inserted).toMatchObject({ mediaId: 'l-new', start: 17900, len: 100 });
    expect(mockSession.problem).toBe('Added Soft keys at 00:09:56:20.');
});
