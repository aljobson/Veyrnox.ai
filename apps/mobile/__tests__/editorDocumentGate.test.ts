import { Alert, AccessibilityInfo } from 'react-native';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { documentProblem } from '../src/lib/editorDocumentGate';
import { utf8Bytes, type ProjectDocument } from '../src/lib/editorBridge';
import { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { writeDraft } from '../src/lib/editorDrafts';
import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
import { nearLimit } from './fixtures/editorNearLimit';
import { emptyTimeline } from '../src/lib/nativeEditorModel';
const mockRequest = jest.fn(), mockApi = { request: mockRequest }, mockRouter = { back: jest.fn() };
const mockBegin = () => ({ current: () => true });
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen') }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: mockBegin }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true), removeDraft: jest.fn() }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}) } }));
let root: Root, session: ReturnType<typeof useFullEditorSession>;
function Harness() { session = useFullEditorSession({ projectId: envelope(null).project_id }); return null; }
async function open(doc: ProjectDocument) {
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/document') ? { document: doc, revision: 1 } : { project: { name: 'Test' } });
    await act(async () => root.render(createElement(Harness)));
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {}); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });
test('pure gate validates timelines, versions and exact UTF-8 envelope size', () => {
    const doc = envelope(webSequenceV3()); expect(documentProblem(doc)).toBeNull();
    expect(documentProblem({ ...doc, timeline: { ...webSequenceV3(), fps: 29 } })).toBe('invalid');
    for (const schema_version of [1, 2] as const) expect(documentProblem({ ...doc, schema_version })).toBe('invalid');
    expect(documentProblem({ ...doc, timeline: null })).toBe('invalid');
    expect(documentProblem({ ...doc, schema_version: 2, timeline: null })).toBeNull();
    const base = envelope(emptyTimeline()), size = utf8Bytes(JSON.stringify(base));
    const large = { ...base, brief: 'x'.repeat(32769 - size) };
    expect(utf8Bytes(JSON.stringify(large))).toBe(32769); expect(documentProblem(large)).toBe('tooLarge');
    expect(documentProblem({ ...base, brief: '😀'.repeat(8200) })).toBe('tooLarge');
});
test('refusal does not change current document, freshness, history, selection, dirty or draft', async () => {
    const doc = envelope(webSequenceV3()); await open(doc);
    await act(async () => session.setSelection({ track: 'video', id: 'v1' }));
    const revision = session.getEditRevision(); let accepted: unknown;
    await act(async () => { accepted = session.markDocument({ ...doc, timeline: { ...webSequenceV3(), fps: 29 } }); });
    expect(accepted).toEqual({ status: 'refused', reason: 'invalid' }); expect(session.currentDocument()).toEqual(doc); expect(session.getEditRevision()).toBe(revision);
    expect(session.history).toEqual({ canUndo: false, canRedo: false }); expect(session.dirty).toBe(false);
    expect(session.selection).toEqual({ track: 'video', id: 'v1' }); expect(session.problem).toBe("That change can't be kept in this project.");
    await act(async () => jest.advanceTimersByTimeAsync(500)); expect(writeDraft).not.toHaveBeenCalled();
});
test('repair then undo to a legacy snapshot then redo is transactional', async () => {
    const valid = envelope(webSequenceV3()), legacy = { ...valid, timeline: { ...webSequenceV3(), fps: 29 } };
    await open(legacy); await act(async () => { expect(session.markDocument(valid)).toEqual({ status: 'accepted' }); });
    await act(async () => session.travel('undo')); expect(session.currentDocument()).toEqual(legacy);
    expect(session.history).toEqual({ canUndo: false, canRedo: true });
    await act(async () => session.travel('redo')); expect(session.currentDocument()).toEqual(valid);
    expect(session.history).toEqual({ canUndo: true, canRedo: false });
});
test('redo restores an invalid snapshot that was previously live', async () => {
    const valid = envelope(webSequenceV3()), baseline = { ...valid, timeline: { ...webSequenceV3(), fps: 29 } };
    const localInvalid = { ...baseline, brief: 'Local invalid edit' };
    await open(baseline);
    await act(async () => { expect(session.markDocument(localInvalid)).toEqual({ status: 'accepted' }); });
    const committed = session.currentDocument();
    await act(async () => session.travel('undo'));
    expect(session.currentDocument()).toEqual(baseline);
    await act(async () => { expect(session.markDocument(valid, false)).toEqual({ status: 'accepted' }); });
    const revision = session.getEditRevision();
    await act(async () => session.travel('redo'));
    expect(session.currentDocument()).toBe(committed); expect(session.getEditRevision()).toBe(revision + 1);
    expect(session.problem).toBeNull();
    expect(session.history).toEqual({ canUndo: true, canRedo: false });
});
test('undo restores a previously live invalid snapshot after repair', async () => {
    const valid = envelope(webSequenceV3()), baseline = { ...valid, timeline: { ...webSequenceV3(), fps: 29 } };
    await open(baseline);
    await act(async () => { session.markDocument({ ...baseline, brief: 'Local invalid edit' }); });
    const committed = session.currentDocument();
    await act(async () => { session.markDocument(valid); });
    await act(async () => session.travel('undo'));
    expect(session.currentDocument()).toBe(committed);
    expect(session.history).toEqual({ canUndo: true, canRedo: true });
    expect(session.problem).toBeNull();
});
test('a successful save makes its earlier history known baseline snapshots', async () => {
    const valid = envelope(webSequenceV3()), baseline = { ...valid, timeline: { ...webSequenceV3(), fps: 29 } };
    const earlier = { ...baseline, brief: 'Earlier edit' };
    await open(baseline);
    await act(async () => { session.markDocument(earlier); session.markDocument(valid); });
    mockRequest.mockResolvedValueOnce({ revision: 2 });
    await act(async () => { expect(await session.save()).toBe(true); });
    await act(async () => session.travel('undo'));
    expect(session.currentDocument()).toEqual(earlier); expect(session.problem).toBeNull();
    await act(async () => session.travel('redo'));
    expect(session.currentDocument()).toEqual(valid);
});
test('a save finishing after an undo preserves the new branch\'s previously live snapshots', async () => {
    const valid = envelope(webSequenceV3()), baseline = { ...valid, timeline: { ...webSequenceV3(), fps: 29 } };
    await open(baseline);
    let finish!: (value: unknown) => void;
    const request = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path, init) => init?.method === 'PUT' ? new Promise(resolve => { finish = resolve; }) : request(path, init));
    await act(async () => { session.markDocument(valid); });
    let saving!: Promise<boolean>;
    await act(async () => { saving = session.save(); });
    await act(async () => session.travel('undo'));
    expect(session.currentDocument()).toEqual(baseline);
    const repaired = { ...valid, brief: 'New repair' };
    await act(async () => { session.markDocument({ ...baseline, brief: 'New invalid edit' }); });
    const committed = session.currentDocument();
    await act(async () => { session.markDocument(repaired); });
    await act(async () => { finish({ document: valid, revision: 2 }); await saving; });
    expect(session.revision).toBe(2);
    await act(async () => session.travel('undo'));
    expect(session.currentDocument()).toBe(committed);
    expect(session.problem).toBeNull();
    await act(async () => session.travel('redo'));
    expect(session.currentDocument()).toEqual(repaired);
});
test('draft flush retains a completed backup while a versions sheet holds unsaved edits', async () => {
    const doc = envelope(webSequenceV3()); await open(doc);
    const edited = { ...doc, brief: 'Unsaved edits' };
    await act(async () => { session.markDocument(edited); session.sync.openVersions(); });
    const source = { projectId: doc.project_id, assetId: '22222222-2222-4222-8222-222222222222' };
    await act(async () => session.applyBackup('m', source));
    expect(session.sync.sheet).toBe('versions'); expect(session.currentDocument()).toEqual(edited);
    await act(async () => jest.advanceTimersByTimeAsync(400));
    const draft = jest.mocked(writeDraft).mock.calls.at(-1)![0].document;
    expect(draft).toEqual({ ...edited, timeline: { ...webSequenceV3(), media: { m: { ...webSequenceV3().media.m, assetSource: source } } } });
    expect(documentProblem(draft)).toBeNull(); expect(session.currentDocument()).toEqual(edited);
});
test('a timeline just over 30000 UTF-8 bytes is tooLarge even when the envelope is under 32768', () => {
    const doc = nearLimit(false), tl = doc.timeline as ReturnType<typeof emptyTimeline>;
    tl.media.m.name += '😀'.repeat(10);
    expect(new TextEncoder().encode(JSON.stringify(tl)).byteLength).toBe(30000);
    expect(documentProblem(doc)).toBeNull();
    tl.media.m.name += 'x';
    expect(new TextEncoder().encode(JSON.stringify(tl)).byteLength).toBe(30001);
    expect(utf8Bytes(JSON.stringify(doc))).toBeLessThan(32768);
    expect(documentProblem(doc)).toBe('tooLarge');
});
test.each([false, true])('backup exceeding %s limit stays pending while edits and history travel succeed', async envelopeLimit => {
    const doc = nearLimit(envelopeLimit); expect(documentProblem(doc)).toBeNull(); await open(doc);
    const edited = { ...doc, brief: doc.brief + 'a' };
    await act(async () => { session.markDocument(edited); });
    const revision = session.getEditRevision();
    const source = { projectId: doc.project_id, assetId: '22222222-2222-4222-8222-222222222222' };
    jest.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    await act(async () => session.applyBackup('m', source));
    expect(session.problem).toBeNull(); expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    expect(session.currentDocument()).toEqual(edited); expect(session.getEditRevision()).toBe(revision);
    const next = { ...edited, brief: edited.brief + 'b' };
    await act(async () => { expect(session.markDocument(next)).toEqual({ status: 'accepted' }); });
    expect(session.currentDocument()).toEqual(next); expect(session.problem).toBeNull();
    await act(async () => session.setSelection({ track: 'text', id: 't1' }));
    await act(async () => session.travel('undo'));
    expect(session.currentDocument()).toEqual(edited); expect(session.selection).toBeNull(); expect(session.problem).toBeNull();
    expect(session.history).toEqual({ canUndo: true, canRedo: true });
    await act(async () => session.travel('undo')); expect(session.currentDocument()).toEqual(doc);
    expect(session.history).toEqual({ canUndo: false, canRedo: true });
    await act(async () => session.travel('redo')); expect(session.currentDocument()).toEqual(edited);
    expect(session.problem).toBeNull();
    await act(async () => session.sync.flushDraft()); expect(jest.mocked(writeDraft).mock.calls.at(-1)![0].document).toEqual(edited);
    jest.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    await act(async () => session.sync.settle()); expect(session.currentDocument()).toEqual(edited);
    expect(session.problem).toBeNull(); expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
});

test.each([false, true])('pending backup merges on the first later commit with room (%s limit)', async envelopeLimit => {
    const doc = nearLimit(envelopeLimit); await open(doc);
    const source = { projectId: doc.project_id, assetId: '22222222-2222-4222-8222-222222222222' };
    await act(async () => session.applyBackup('m', source));
    await act(async () => { session.markDocument({ ...doc, brief: doc.brief + 'a' }); });
    expect((session.currentDocument()!.timeline as any).media.m.assetSource).toBeUndefined();
    await act(async () => { session.markDocument({ ...doc, brief: '', timeline: { ...(doc.timeline as ReturnType<typeof emptyTimeline>), text: [] } }); });
    expect((session.currentDocument()!.timeline as any).media.m.assetSource).toEqual(source);
    expect(documentProblem(session.currentDocument()!)).toBeNull(); expect(session.problem).toBeNull();
});

test('not-live commits return a distinct result without changing the message or document', async () => {
    const doc = envelope(webSequenceV3()); await open(doc);
    await act(async () => session.setProblem('Existing message'));
    await act(async () => session.sync.accountChanged());
    await act(async () => { expect(session.markDocument(doc)).toEqual({ status: 'not-live' }); });
    expect(session.problem).toBe('Existing message'); expect(session.currentDocument()).toEqual(doc);
});

test('a valid envelope at exactly 32768 UTF-8 bytes is accepted, one extra byte is refused', () => {
    const doc = nearLimit(true); doc.brief += 'x'.repeat(32768 - utf8Bytes(JSON.stringify(doc)));
    expect(utf8Bytes(JSON.stringify(doc))).toBe(32768); expect(documentProblem(doc)).toBeNull();
    expect(documentProblem({ ...doc, brief: doc.brief + 'x' })).toBe('tooLarge');
});

test('repair, pending backup, legacy undo and redo retain the unmerged snapshots', async () => {
    const valid = nearLimit(false), legacy = { ...valid, timeline: { ...valid.timeline as ReturnType<typeof emptyTimeline>, fps: 29 } };
    await open(legacy);
    await act(async () => { expect(session.markDocument(valid)).toEqual({ status: 'accepted' }); });
    const source = { projectId: valid.project_id, assetId: '22222222-2222-4222-8222-222222222222' };
    await act(async () => session.applyBackup('m', source));
    await act(async () => session.travel('undo'));
    expect(session.currentDocument()).toEqual(legacy); expect(session.problem).toBeNull();
    expect(session.history).toEqual({ canUndo: false, canRedo: true });
    await act(async () => session.travel('redo'));
    expect(session.currentDocument()).toEqual(valid); expect(session.problem).toBeNull();
    expect(session.history).toEqual({ canUndo: true, canRedo: false });
    await act(async () => { session.markDocument({ ...valid, timeline: { ...valid.timeline as ReturnType<typeof emptyTimeline>, text: [] } }); });
    expect((session.currentDocument()!.timeline as any).media.m.assetSource).toEqual(source);
});
test('adopting a saved document silently retains a backup that cannot merge', async () => {
    const doc = nearLimit(false); await open(doc);
    await act(async () => { session.markDocument({ ...doc, brief: 'edited' }); });
    const source = { projectId: doc.project_id, assetId: '22222222-2222-4222-8222-222222222222' };
    await act(async () => session.sync.openVersions());
    await act(async () => session.applyBackup('m', source));
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => session.sync.useSaved());
    const discard = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(button => button.style === 'destructive')!;
    await act(async () => discard.onPress!());
    expect(session.currentDocument()).toEqual(doc); expect(session.problem).toBeNull();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalledWith("This project is too large to save. Remove some clips or keyframes first.");
    await act(async () => { session.markDocument({ ...doc, timeline: { ...doc.timeline as ReturnType<typeof emptyTimeline>, text: [] } }); });
    expect((session.currentDocument()!.timeline as any).media.m.assetSource).toEqual(source);
});
