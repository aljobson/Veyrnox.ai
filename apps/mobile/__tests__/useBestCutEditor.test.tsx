import { nearLimit } from './fixtures/editorNearLimit';
import { t } from '../src/lib/i18n';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { useBestCutEditor } from '../src/components/editor/useBestCutEditor';
import { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { emptyTimeline } from '../src/lib/nativeEditorModel';
import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
let mockApply: (value: any) => import('../src/lib/editorDocumentGate').DocumentApplyResult;
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/components/editor/useBestCutAvailability', () => ({ useBestCutAvailability: () => ({ quote: {} }) }));
jest.mock('../src/components/editor/BestCutResult', () => ({ BestCutResult: () => null }));
jest.mock('../src/components/editor/BestCutSheet', () => ({ BestCutSheet: (props: any) => { mockApply = props.onApply; return null; } }));
test.each(['accepted', 'invalid', 'tooLarge', 'not-live'] as const)('Best Cut is one transactional commit; result=%s', async status => {
    const refused = status !== 'accepted';
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const doc = envelope(emptyTimeline()), markDocument = jest.fn().mockReturnValue(status === 'invalid' || status === 'tooLarge' ? { status: 'refused', reason: status } : { status });
    const session = { api: {}, document: doc, currentDocument: () => doc, sync: { live: () => true, draftDecided: true },
        getEditRevision: () => 1, markDocument, setPlaying: jest.fn(), setFrame: jest.fn(), setSelection: jest.fn(),
        setSelections: jest.fn(), setLocalMediaUris: jest.fn(), setProblem: jest.fn() } as unknown as ReturnType<typeof useFullEditorSession>;
    function Harness() { return useBestCutEditor(session, doc.project_id, true).sheet; }
    const root = createRoot(); await act(async () => root.render(<Harness />));
    const value = { before: webSequenceV3(), timeline: webSequenceV3(), uris: {}, plan: null };
    let result: unknown; await act(async () => { result = mockApply(value); });
    expect(result).toEqual(markDocument.mock.results[0].value); expect(markDocument).toHaveBeenCalledTimes(1);
    expect(session.setProblem).not.toHaveBeenCalled();
    if (refused) {
        expect(session.setFrame).not.toHaveBeenCalled(); expect(session.setSelection).not.toHaveBeenCalled();
        expect(session.setLocalMediaUris).not.toHaveBeenCalled();
    }
    await act(async () => root.unmount());
});

const mockRequest = jest.fn(), mockApi = { request: mockRequest }, mockRouter = { back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen') }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: () => ({ current: () => true }) }) }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true), removeDraft: jest.fn() }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}) } }));

test('Best Cut preserves a real tooLarge refusal and permits retry', async () => {
    jest.useFakeTimers();
    const doc = envelope(emptyTimeline());
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/document') ? { document: doc, revision: 1 } : { project: { name: 'Test' } });
    let session: ReturnType<typeof useFullEditorSession>;
    function Harness() { session = useFullEditorSession({ projectId: doc.project_id }); return useBestCutEditor(session, doc.project_id, true).sheet; }
    const root = createRoot();
    try {
        await act(async () => root.render(<Harness />));
        const timeline = nearLimit(false).timeline as ReturnType<typeof emptyTimeline>;
        timeline.text.push({ ...timeline.text[0], id: 't29', start: 2800 }); timeline.seq = 29;
        const value = { before: emptyTimeline(), timeline, uris: { m: 'file://source' }, plan: null };
        await act(async () => { expect(mockApply(value)).toEqual({ status: 'refused', reason: 'tooLarge' }); });
        expect(session!.problem).toBe(t('editorEditGate.tooLarge'));
        expect(session!.currentDocument()).toEqual(doc); expect(session!.history.canUndo).toBe(false);
        expect(session!.localMediaUris).toEqual({});
        await act(async () => { expect(mockApply({ ...value, timeline: webSequenceV3() })).toEqual({ status: 'accepted' }); });
        expect(session!.problem).toBeNull(); expect(session!.localMediaUris).toEqual(value.uris);
    } finally { await act(async () => root.unmount()); jest.useRealTimers(); }
});

test.each(['invalid', 'tooLarge'] as const)('Best Cut refuses a %s history base before any transactional side effects', async reason => {
    jest.useFakeTimers();
    const doc = envelope(emptyTimeline());
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/document') ? { document: doc, revision: 1 } : { project: { name: 'Test' } });
    let session: ReturnType<typeof useFullEditorSession>;
    function Harness() { session = useFullEditorSession({ projectId: doc.project_id }); return useBestCutEditor(session, doc.project_id, true).sheet; }
    const root = createRoot();
    try {
        await act(async () => root.render(<Harness />));
        const revision = session!.getEditRevision();
        const before = reason === 'invalid' ? { ...webSequenceV3(), fps: 29 } : nearLimit(false).timeline as ReturnType<typeof emptyTimeline>;
        if (reason === 'tooLarge') before.text.push({ ...before.text[0], id: 't29', start: 2800 });
        const value = { before, timeline: webSequenceV3(), uris: { m: 'file://source' }, plan: null };
        await act(async () => { expect(mockApply(value)).toEqual({ status: 'refused', reason }); });
        expect(session!.problem).toBe(t(`editorEditGate.${reason}`));
        expect(session!.currentDocument()).toEqual(doc); expect(session!.getEditRevision()).toBe(revision);
        expect(session!.history).toEqual({ canUndo: false, canRedo: false });
        expect(session!.dirty).toBe(false); expect(session!.localMediaUris).toEqual({});
        await act(async () => { expect(mockApply({ ...value, before: webSequenceV3() })).toEqual({ status: 'accepted' }); });
        expect(session!.problem).toBeNull(); expect(session!.localMediaUris).toEqual(value.uris);
        await act(async () => session!.travel('undo'));
        expect(session!.currentDocument()).toEqual(envelope(webSequenceV3()));
    } finally { await act(async () => root.unmount()); jest.useRealTimers(); }
});
