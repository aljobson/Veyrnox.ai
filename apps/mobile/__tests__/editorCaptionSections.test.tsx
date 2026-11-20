import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import { nearLimit } from './fixtures/editorNearLimit';
import { documentProblem } from '../src/lib/editorDocumentGate';
import { act, useLayoutEffect, useState } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { CaptionsPanel, TranscriptPanel } from '../src/components/editor/tools/CaptionsPanels';
import { useCaptionActions, type CaptionActions } from '../src/components/editor/tools/useCaptionActions';
import { createFrameStore } from '../src/components/editor/editorFrameStore';
import { emptyTimeline, duplicateSelections, removeSelections, type Selection, type Timeline } from '../src/lib/nativeEditorModel';
import { importCaptionText } from '../src/lib/editorCaptionEdit';
import { envelope, webSequenceV3 } from './fixtures/webSequenceV3';
import { legacyPhoneCaptions } from './fixtures/legacyPhoneCaptions';
import type { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { utf8Bytes, type ProjectDocument } from '../src/lib/editorBridge';
// Allow cold React Native module rendering on shared CI hosts; interactions still use act, not sleeps.
jest.setTimeout(30000);
const mockPick = jest.fn(), mockShare = jest.fn();
jest.mock('../src/lib/editorCaptionFiles', () => ({ pickCaptionFile: (...args: unknown[]) => mockPick(...args), shareCaptionFile: (...args: unknown[]) => mockShare(...args) }));
let mockOwner = 'owner';
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: () => () => {} }));
let doc: ProjectDocument, history: Timeline[], selected: Selection | null, selections: Selection[], message: string | null;
let epoch = 0;
let tokenLive = true, accept = true, actions: CaptionActions, refresh: () => void, root: Root;
const store = createFrameStore();
const body = '1\n00:00:00,000 --> 00:00:02,000\nHello world';
function Harness({ transcript = false }: { transcript?: boolean }) {
    const [, render] = useState(0);
    useLayoutEffect(() => { refresh = () => render(n => n + 1); });
    const timeline = doc.timeline as Timeline;
    const handlers = useCaptionActions({ timeline, selection: selected, currentDocument: () => doc, getEpoch: () => epoch,
        beginImport: () => ({ valid: () => tokenLive, end: () => {} }),
        applyTimeline: next => { if (!accept) { message = 'This project is too large to save.'; return false; }
            history.push(next); doc = { ...doc, timeline: next }; refresh(); return true; },
        setProblem: next => { message = next; }, setSelection: next => { selected = next; refresh(); },
        setSelections: next => { selections = next; }, frameStore: store });
    useLayoutEffect(() => { actions = handlers; });
    const props = { timeline, selection: selected, selections, selected: timeline.text.find(c => c.id === selected?.id), captionActions: handlers,
        addCaption: () => {}, updateSelectedText: () => {}, selectClip: (next: Selection) => { selected = next; selections = [next]; refresh(); }, setFrame: store.set };
    return transcript ? <TranscriptPanel {...props} /> : <CaptionsPanel {...props} />;
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); doc = envelope(emptyTimeline()); history = []; selected = null;
    epoch = 0; selections = []; message = null; tokenLive = true; accept = true; mockOwner = 'owner'; mockPick.mockReset(); mockShare.mockReset(); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
async function press(label: string) {
    const nodes = root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function');
    expect(nodes).toHaveLength(1); await act(async () => nodes[0].props.onClick({ nativeEvent: {} }));
}
test('successful import commits once and selects in both selection stores', async () => {
    mockPick.mockResolvedValue({ text: body, name: 'a.srt' }); await act(async () => root.render(<Harness />)); await press('Import captions');
    expect(history).toHaveLength(1); expect((doc.timeline as Timeline).text).toHaveLength(1); expect(selections).toEqual([selected]); expect(message).toContain('1');
});
test.each(['size', 'parse', 'gate'])('%s refusal leaves document and history unchanged', async kind => {
    mockPick.mockResolvedValue(kind === 'size' ? { refused: 'fileTooLarge' } : { text: kind === 'parse' ? '' : body, name: 'a.srt' });
    accept = kind !== 'gate'; const before = doc; await act(async () => root.render(<Harness />)); await press('Import captions');
    expect(doc).toBe(before); expect(history).toHaveLength(0); expect(message).toBeTruthy();
});
test.each(['edit', 'replace', 'unmount', 'owner'])('pending pick handles %s safely', async change => {
    let resolve!: (value: unknown) => void; mockPick.mockReturnValue(new Promise(r => { resolve = r; }));
    await act(async () => root.render(<Harness />)); let pending!: Promise<void>;
    await act(async () => { pending = actions.pick(); });
    if (change === 'edit') { doc = { ...doc, timeline: { ...(doc.timeline as Timeline), background: '#ffffff' } }; }
    if (change === 'replace') { tokenLive = false; doc = envelope(emptyTimeline()); }
    if (change === 'owner') mockOwner = 'another';
    if (change === 'unmount') await act(async () => root.unmount());
    await act(async () => { resolve({ text: body, name: 'a.srt' }); await pending; });
    expect(history).toHaveLength(change === 'edit' ? 1 : 0);
    if (change === 'edit') expect((doc.timeline as Timeline).background).toBe('#ffffff');
});
function timed() {
    const result = importCaptionText(emptyTimeline(), 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<00:00:00.000>Hello <00:00:01.000>world', 'a.vtt');
    if ('timeline' in result) doc = envelope(result.timeline);
}
test('transcript selection replaces video multiselection; refused cut keeps range', async () => {
    timed(); selected = { track: 'video', id: 'v1' }; selections = [selected];
    await act(async () => root.render(<Harness transcript />)); await press('Word 1: Hello');
    const id = (doc.timeline as Timeline).text[0].id;
    expect(selected).toEqual({ track: 'text', id }); expect(selections).toEqual([selected]);
    expect(duplicateSelections(doc.timeline as Timeline, selections)?.timeline.text).toHaveLength(2);
    expect(removeSelections(doc.timeline as Timeline, selections, 'none').text).toHaveLength(0);
    await press('Word 2: world'); accept = false; await press('Cut selected words');
    expect(history).toHaveLength(0); expect(root.container.queryAll(n => n.props.accessibilityState?.selected).length).toBeGreaterThan(0);
});
test('word section is caption-only, all buttons named, trimmed start increments one frame', async () => {
    timed(); const tl = doc.timeline as Timeline; selected = { track: 'text', id: tl.text[0].id };
    tl.text[0] = { ...tl.text[0], len: 30, text: 'Hello', words: [{ text: 'Hello', start: -270, len: 300 }] };
    await act(async () => root.render(<Harness />)); await press('Word 1: Hello'); await press('Increase Word start');
    expect((doc.timeline as Timeline).text[0].words![0].start).toBe(-269);
    const controls = root.container.queryAll(n => typeof n.props.onClick === 'function');
    expect(controls.every(n => !!n.props.accessibilityLabel)).toBe(true);
    (doc.timeline as Timeline).text[0].caption = false; await act(async () => refresh());
    expect(root.container.queryAll(n => n.children.includes('Word timing'))).toHaveLength(0);
});

// Exercise the real session and command wiring in addition to the isolated asynchronous hook cases.
let mockSession: ReturnType<typeof useFullEditorSession>;
jest.mock('../src/components/editor/useFullEditorSession', () => ({ useFullEditorSession: (args: unknown) => {
    mockSession = jest.requireActual('../src/components/editor/useFullEditorSession').useFullEditorSession(args);
    return mockSession;
} }));
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockBeginSessionTask = () => ({ current: () => true });
jest.mock('../src/lib/voiceoverRecorder', () => ({ VOICEOVER_AVAILABLE: false }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true),
    removeDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}),
    copy: jest.fn().mockResolvedValue(null), backup: jest.fn().mockResolvedValue(null) } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'native-save-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, usePreventRemove: () => () => {}, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: mockBeginSessionTask }) }));
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: () => null }));
async function screen(timeline: Timeline, document = envelope(timeline)) {
    mockRequest.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return { revision: JSON.parse(init.body as string).expected_revision + 1 };
        if (path.endsWith('/document')) return { revision: 4, document };
        return { project: { id: document.project_id, workspace_id: 'workspace', name: 'Caption test' } };
    });
    await act(async () => root.render(<FullEditorScreen projectId={document.project_id} startAdvanced />));
}
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function')[0];
const visible = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
test('real screen import creates exactly one undo entry; undo restores empty captions', async () => {
    mockPick.mockResolvedValue({ text: body, name: 'a.srt' }); await screen(emptyTimeline());
    await press('Captions'); await press('Import captions');
    expect(button('Undo').props.accessibilityState.disabled).toBe(false);
    await press('Undo'); expect(button('Undo').props.accessibilityState.disabled).toBe(true);
    expect(button('Share SRT')).toBeUndefined();
    await press('Redo'); expect(button('Share SRT')).toBeDefined();
});
test.each(['size', 'parse', 'gate'])('real screen %s refusal leaves undo and saved state unchanged', async reason => {
    const tl = emptyTimeline();
    const huge = Array.from({ length: 150 }, (_, i) => `${i + 1}\n00:00:00,000 --> 00:00:01,000\n${'x'.repeat(200)}`).join('\n\n');
    mockPick.mockResolvedValue(reason === 'size' ? { refused: 'fileTooLarge' } : { text: reason === 'parse' ? '' : huge, name: 'a.srt' });
    await screen(tl); await press('Captions'); await press('Import captions');
    expect(button('Undo').props.accessibilityState.disabled).toBe(true); expect(visible('Saved · v4')).toBe(true);
    expect(mockRequest.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
});
test('real screen transcript selection directs Duplicate and Delete to the caption', async () => {
    const tl = webSequenceV3(); tl.text[0].wordsEstimated = false;
    await screen(tl); await press('Transcript'); await press('Word 1: Hello'); await press('Duplicate');
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Word 3: Hello').length).toBeGreaterThan(0);
    await press('Delete'); expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Word 3: Hello')).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Word 1: Hello').length).toBeGreaterThan(0);
});

test('real envelope gate refuses an otherwise valid import without history or dirty changes', async () => {
    const document = nearLimit(true), timeline = document.timeline as Timeline; timeline.seq = 28;
    expect(documentProblem(document)).toBeNull();
    expect(importCaptionText(timeline, body, 'a.srt')).toHaveProperty('timeline');
    mockPick.mockResolvedValue({ text: body, name: 'a.srt' }); await screen(timeline, document);
    await press('Captions'); await press('Import captions');
    expect(button('Undo').props.accessibilityState.disabled).toBe(true); expect(visible('Saved · v4')).toBe(true);
    expect(button('Share SRT')).toBeUndefined();
    expect(mockRequest.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
});
test('busy share guard prevents overlapping writes', async () => {
    timed(); let resolve!: () => void; mockShare.mockReturnValue(new Promise<void>(r => { resolve = r; }));
    await act(async () => root.render(<Harness />)); let pending!: Promise<void>;
    await act(async () => { pending = actions.share('srt'); });
    await act(async () => actions.share('vtt')); expect(mockShare).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); await pending; }); expect(actions.busy).toBe(false);
});

test('multiword lyric refusal displays the actual token in a translated sentence', async () => {
    timed(); await act(async () => root.render(<Harness />));
    await act(async () => { actions.align('Hello missing world', 'all'); });
    expect(message).toBe('No timed word matches “missing”. Correct the transcript or the lyrics first.');
    expect(history).toHaveLength(0);
});

test('share takes no import lock and a save completes while sharing is pending', async () => {
    let resolve!: () => void; mockShare.mockReturnValue(new Promise<void>(r => { resolve = r; }));
    await screen(webSequenceV3()); await press('Captions');
    await act(async () => { button('Share SRT').props.onClick({ nativeEvent: {} }); });
    expect(mockSession.sync.imports).toBe(0);
    const snapshot = mockShare.mock.calls[0][0].body;
    await act(async () => { const document = mockSession.currentDocument()!, timeline = document.timeline as Timeline;
        mockSession.markDocument({ ...document, timeline: { ...timeline, text: timeline.text.map(c => ({ ...c, text: 'Changed during share', words: [] })) } }); });
    await act(async () => { await mockSession.save(); });
    expect(mockSession.dirty).toBe(false); expect(mockSession.revision).toBe(5);
    expect(snapshot).toContain('Hello world'); expect(snapshot).not.toContain('Changed during share');
    expect(mockShare.mock.calls[0][0].body).toBe(snapshot);
    await act(async () => { resolve(); });
    expect(mockSession.problem).toBeNull(); expect(mockSession.sync.imports).toBe(0);
});
test.each(['owner', 'unmount', 'document', 'epoch'])('share silently drops a stale %s without importDropped', async change => {
    timed(); let resolve!: (status: string) => void; mockShare.mockReturnValue(new Promise(r => { resolve = r; }));
    await act(async () => root.render(<Harness />)); let pending!: Promise<void>;
    await act(async () => { pending = actions.share('srt'); });
    const live = mockShare.mock.calls[0][1]; expect(live()).toBe(true);
    if (change === 'owner') mockOwner = 'another';
    if (change === 'unmount') await act(async () => root.unmount());
    if (change === 'document') doc = { ...doc, brief: 'changed' };
    if (change === 'epoch') epoch++;
    expect(live()).toBe(false);
    await act(async () => { resolve('unavailable'); await pending; });
    expect(message).toBeNull();
});
test('pre-S4 phone rows stay visible and chosen captions convert in one undo step', async () => {
    const timeline = legacyPhoneCaptions(); await screen(timeline); await press('Transcript');
    expect(button('00:00:00:00 Legacy first line')).toBeDefined();
    expect(button('00:00:02:00 Legacy second line')).toBeDefined();
    await press('00:00:00:00 Legacy first line');
    expect(mockSession.selection).toEqual({ track: 'text', id: 't1' });
    await act(async () => {
        mockSession.setSelection({ track: 'text', id: 't1' });
        mockSession.setSelections([{ track: 'text', id: 't1' }, { track: 'text', id: 't2' }]);
    });
    await press('Treat as captions');
    expect((mockSession.currentDocument()!.timeline as Timeline).text.map(c => c.caption)).toEqual([true, true, undefined]);
    await press('Undo'); expect(mockSession.currentDocument()!.timeline).toEqual(timeline);
    expect(button('Undo').props.accessibilityState.disabled).toBe(true);
});
test('legacy conversion is refused by the real S1 envelope gate without an undo step', async () => {
    const document = nearLimit(true);
    // Fill the envelope to its accepted boundary so adding caption flags crosses it.
    document.brief += 'x'.repeat(32768 - utf8Bytes(JSON.stringify(document)));
    expect(documentProblem(document)).toBeNull();
    await screen(document.timeline as Timeline, document); await press('Transcript');
    await act(async () => { mockSession.setSelection({ track: 'text', id: 't1' }); mockSession.setSelections([{ track: 'text', id: 't1' }]); });
    await press('Treat as captions');
    expect(mockSession.currentDocument()).toEqual(document); expect(mockSession.history.canUndo).toBe(false);
});
test('pasting long caption text keeps the 1000 character slice and clears stale words', async () => {
    await screen(webSequenceV3()); await press('Captions');
    await act(async () => { mockSession.setSelection({ track: 'text', id: 't3' }); });
    const input = root.container.queryAll(n => n.props.accessibilityLabel === 'Words' && typeof n.props.onChangeText === 'function')[0];
    await act(async () => input.props.onChangeText('x'.repeat(1200)));
    const caption = (mockSession.currentDocument()!.timeline as Timeline).text[0];
    expect(caption.text).toBe('x'.repeat(1000)); expect(caption.words).toEqual([]);
    await press('Undo'); expect((mockSession.currentDocument()!.timeline as Timeline).text[0].text).toBe('Hello world');
});

test('legacy conversion on a locked track keeps the document and history unchanged', async () => {
    const timeline = legacyPhoneCaptions(); timeline.tracks.find(t => t.kind === 'text')!.locked = true;
    await screen(timeline); await press('Transcript'); await press('00:00:00:00 Legacy first line');
    await press('Treat as captions');
    expect(mockSession.currentDocument()!.timeline).toEqual(timeline);
    expect(mockSession.history.canUndo).toBe(false); expect(mockSession.problem).toBe('Unlock the caption track first.');
});
