import { createElement, act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { documentProblem } from '../src/lib/editorDocumentGate';
import { utf8Bytes, type ProjectDocument } from '../src/lib/editorBridge';
import { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { writeDraft } from '../src/lib/editorDrafts';
import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
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
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
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
    expect(accepted).toBe(false); expect(session.currentDocument()).toEqual(doc); expect(session.getEditRevision()).toBe(revision);
    expect(session.history).toEqual({ canUndo: false, canRedo: false }); expect(session.dirty).toBe(false);
    expect(session.selection).toEqual({ track: 'video', id: 'v1' }); expect(session.problem).toBe("That change can't be kept in this project.");
    await act(async () => jest.advanceTimersByTimeAsync(500)); expect(writeDraft).not.toHaveBeenCalled();
});
test('repair then undo to a legacy snapshot then redo is transactional', async () => {
    const valid = envelope(webSequenceV3()), legacy = { ...valid, timeline: { ...webSequenceV3(), fps: 29 } };
    await open(legacy); await act(async () => { expect(session.markDocument(valid)).toBe(true); });
    await act(async () => session.travel('undo')); expect(session.currentDocument()).toEqual(legacy);
    expect(session.history).toEqual({ canUndo: false, canRedo: true });
    await act(async () => session.travel('redo')); expect(session.currentDocument()).toEqual(valid);
    expect(session.history).toEqual({ canUndo: true, canRedo: false });
});
function nearLimit(envelopeLimit: boolean) {
    const tl = emptyTimeline(); tl.media.m = { id: 'm', kind: 'video', name: 'Source', frames: 900, hasAudio: true, width: 640, height: 360 };
    for (let i = 0; i < 28; i++) tl.text.push({ id: `t${i + 1}`, text: 'x'.repeat(950), start: i * 100, len: 90, trackId: 'text-0', x: .5, y: .8, size: 6 });
    const doc = envelope(tl), target = envelopeLimit ? 29000 : 29960;
    tl.text[27].text += 'x'.repeat(Math.max(0, Math.min(1000 - 950, target - utf8Bytes(JSON.stringify(tl)))));
    // Tune total byte length using valid text lengths; the completed backup adds ~110 bytes.
    while (utf8Bytes(JSON.stringify(tl)) > target) tl.text[27].text = tl.text[27].text.slice(0, -1);
    while (utf8Bytes(JSON.stringify(tl)) < target) {
        const item = tl.text.find(c => c.text.length < 1000)!; item.text += 'x';
    }
    if (envelopeLimit) doc.brief = 'b'.repeat(32720 - utf8Bytes(JSON.stringify(doc)));
    return doc;
}
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
test.each([false, true])('backup exceeding %s limit stays pending, drafts accepted data, retries after shrinking', async envelopeLimit => {
    const doc = nearLimit(envelopeLimit); expect(documentProblem(doc)).toBeNull(); await open(doc);
    await act(async () => { session.markDocument({ ...doc, brief: doc.brief + 'a' }); });
    await act(async () => session.setSelection({ track: 'text', id: 't1' }));
    const accepted = session.currentDocument(), history = session.history, revision = session.getEditRevision();
    const source = { projectId: doc.project_id, assetId: '22222222-2222-4222-8222-222222222222' };
    await act(async () => { await Promise.resolve(); session.applyBackup('m', source); });
    expect(session.currentDocument()).toEqual(accepted); expect(session.history).toEqual(history); expect(session.getEditRevision()).toBe(revision);
    await act(async () => session.travel('undo'));
    expect(session.currentDocument()).toEqual(accepted); expect(session.history).toEqual(history);
    expect(session.selection).toEqual({ track: 'text', id: 't1' });
    await act(async () => session.sync.flushDraft()); expect(jest.mocked(writeDraft).mock.calls.at(-1)![0].document).toEqual(accepted);
    await act(async () => { session.markDocument({ ...doc, brief: '', timeline: { ...(doc.timeline as ReturnType<typeof emptyTimeline>), text: [] } }); });
    expect((session.currentDocument()!.timeline as any).media.m.assetSource).toEqual(source);
    expect(documentProblem(session.currentDocument()!)).toBeNull();
});

test('a valid envelope at exactly 32768 UTF-8 bytes is accepted, one extra byte is refused', () => {
    const doc = nearLimit(true); doc.brief += 'x'.repeat(32768 - utf8Bytes(JSON.stringify(doc)));
    expect(utf8Bytes(JSON.stringify(doc))).toBe(32768); expect(documentProblem(doc)).toBeNull();
    expect(documentProblem({ ...doc, brief: doc.brief + 'x' })).toBe('tooLarge');
});
