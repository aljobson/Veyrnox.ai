import { act } from 'react';
import { createRoot } from 'test-renderer';
import { useBestCutEditor } from '../src/components/editor/useBestCutEditor';
import type { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { emptyTimeline } from '../src/lib/nativeEditorModel';
import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
let mockApply: (value: any) => boolean;
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/components/editor/useBestCutAvailability', () => ({ useBestCutAvailability: () => ({ quote: {} }) }));
jest.mock('../src/components/editor/BestCutResult', () => ({ BestCutResult: () => null }));
jest.mock('../src/components/editor/BestCutSheet', () => ({ BestCutSheet: (props: any) => { mockApply = props.onApply; return null; } }));
test.each([false, true])('Best Cut is one transactional commit; refusal=%s', async refused => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const doc = envelope(emptyTimeline()), markDocument = jest.fn().mockReturnValue(!refused);
    const session = { api: {}, document: doc, currentDocument: () => doc, sync: { live: () => true, draftDecided: true },
        getEditRevision: () => 1, markDocument, setPlaying: jest.fn(), setFrame: jest.fn(), setSelection: jest.fn(),
        setSelections: jest.fn(), setLocalMediaUris: jest.fn(), setProblem: jest.fn() } as unknown as ReturnType<typeof useFullEditorSession>;
    function Harness() { return useBestCutEditor(session, doc.project_id, true).sheet; }
    const root = createRoot(); await act(async () => root.render(<Harness />));
    const value = { before: webSequenceV3(), timeline: webSequenceV3(), uris: {}, plan: null };
    let result: unknown; await act(async () => { result = mockApply(value); });
    expect(result).toBe(!refused); expect(markDocument).toHaveBeenCalledTimes(1);
    if (refused) {
        expect(session.setFrame).not.toHaveBeenCalled(); expect(session.setSelection).not.toHaveBeenCalled();
        expect(session.setLocalMediaUris).not.toHaveBeenCalled();
    }
    await act(async () => root.unmount());
});
