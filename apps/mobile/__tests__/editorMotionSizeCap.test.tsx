import { act } from 'react';
import { Text as StatusText } from '../src/components/ui/Text';
import { AccessibilityInfo } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { useMotionActions } from '../src/components/editor/tools/useMotionActions';
import { timelineOf, type Timeline } from '../src/lib/nativeEditorModel';
import { utf8Bytes, type ProjectDocument } from '../src/lib/editorBridge';
import { documentProblem } from '../src/lib/editorDocumentGate';
import { motionKeyAdd } from '../src/lib/editorMotionEdit';
import { t } from '../src/lib/i18n';
import { nearLimit } from './fixtures/editorNearLimit';
import { envelope, webSequenceV3 } from './fixtures/webSequenceV3';
const mockRequest = jest.fn(), mockApi = { request: mockRequest }, mockRouter = { back: jest.fn() }, mockBegin = () => ({ current: () => true });
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen') }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: mockBegin }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true), removeDraft: jest.fn() }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}) } }));
let root: Root, session: ReturnType<typeof useFullEditorSession>, actions: ReturnType<typeof useMotionActions>;
function Harness() {
    session = useFullEditorSession({ projectId: envelope(null).project_id });
    actions = useMotionActions({ timeline: timelineOf(session.document?.timeline), selection: session.selection, frameStore: session.frameStore,
        applyTimeline: timeline => session.markDocument({ ...session.currentDocument()!, timeline }).status === 'accepted',
        setProblem: session.setProblem, setPlaying: session.setPlaying, setFrame: session.setFrame });
    return session.problem ? <StatusText variant="inherit" accessibilityRole="alert">{session.problem}</StatusText> : null;
}
beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks(); root = createRoot();
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });
async function open(doc: ProjectDocument) {
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/document') ? { document: doc, revision: 1 } : { project: { name: 'Test' } });
    await act(async () => root.render(<Harness />));
    await act(async () => { session.setSelection({ track: 'video', id: 'v1' }); session.setSelections([{ track: 'video', id: 'v1' }]); });
}
test('one key over the sequence cap leaves document, undo, dirty and revision unchanged and announces tooLarge', async () => {
    const doc = nearLimit(false), tl = doc.timeline as Timeline;
    tl.video = [{ id: 'v1', mediaId: 'm', start: 0, len: 90, in: 0, volume: 1, transition: 0, trackId: 'video-0' }];
    tl.text[27].text = tl.text[27].text.slice(0, -(utf8Bytes(JSON.stringify(tl)) - 29960));
    expect(utf8Bytes(JSON.stringify(tl))).toBe(29960); expect(documentProblem(doc)).toBeNull();
    expect(motionKeyAdd(tl, { track: 'video', id: 'v1' }, 0)).toEqual({ refused: 'tooLarge' });
    await open(doc); const before = session.currentDocument(), revision = session.getEditRevision();
    await act(async () => { actions.add(); });
    expect(session.currentDocument()).toBe(before); expect(session.history).toEqual({ canUndo: false, canRedo: false });
    expect(session.dirty).toBe(false); expect(session.getEditRevision()).toBe(revision); expect(session.problem).toBe(t('editorEditGate.tooLarge'));
    await act(async () => jest.advanceTimersByTimeAsync(500));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(t('editorEditGate.tooLarge'));
});
test('locked and no-op actions do not change state, history, dirty, revision or keys', async () => {
    const tl = webSequenceV3(); tl.tracks[0].locked = true; await open(envelope(tl));
    let before = session.currentDocument(), revision = session.getEditRevision();
    await act(async () => { actions.transform('x', .7); });
    expect(session.currentDocument()).toBe(before); expect(session.history.canUndo).toBe(false); expect(session.dirty).toBe(false);
    expect(session.getEditRevision()).toBe(revision); expect(session.problem).toBe(t('editorMotion.locked'));
    await act(async () => session.markDocument(envelope({ ...tl, tracks: tl.tracks.map(track => ({ ...track, locked: false })) }), false));
    before = session.currentDocument(); revision = session.getEditRevision(); const history = session.history, dirty = session.dirty;
    await act(async () => { actions.transform('x', .35); actions.position(.35, .5); });
    expect(session.currentDocument()).toBe(before); expect(session.history).toEqual(history); expect(session.dirty).toBe(dirty);
    expect(session.getEditRevision()).toBe(revision);
});
