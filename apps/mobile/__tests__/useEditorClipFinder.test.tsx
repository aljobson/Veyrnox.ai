import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { clipFinderBlocker, useEditorClipFinder } from '../src/components/editor/tools/useEditorClipFinder';
import { emptyTimeline, type Clip, type Media, type Timeline } from '../src/lib/nativeEditorModel';

const mockPrepare = jest.fn(), mockInspect = jest.fn(), mockAnalyze = jest.fn(), mockCapabilities = jest.fn();
jest.mock('../src/lib/editorAnalysisSource', () => ({ prepareEditorAnalysisSource: (...args: unknown[]) => mockPrepare(...args) }));
jest.mock('../src/lib/editorSceneAnalysis', () => ({ inspectSceneAnalysisSource: (...args: unknown[]) => mockInspect(...args) }));
jest.mock('../src/lib/editorClipAnalysis', () => ({ analyzeClipForFinder: (...args: unknown[]) => mockAnalyze(...args),
    clipFinderAnalysisAvailable: async (...args: unknown[]) => {
        const capability = await mockCapabilities(...args);
        return capability.available && capability.operations.inspect && capability.operations.sampleFrames && capability.operations.decodePcm;
    } }));
jest.mock('../src/lib/editorFlag', () => ({ EDITOR_CLIPS_ENABLED: true }));

const projectId = '11111111-1111-4111-8111-111111111111';
const sourceUri = 'file:///private/veyrnox/source.mp4';
const api = { request: jest.fn() };
const media: Media = { id: 'm1', kind: 'video', name: 'Source', frames: 600, hasAudio: true };
const clip: Clip = { id: 'v1', mediaId: media.id, start: 30, in: 15, len: 300, trackId: 'video-0' };
const timeline: Timeline = { ...emptyTimeline(), media: { [media.id]: media }, video: [clip] };
const row = { id: 'clip-pick-15-195', rank: 1, start: 0.5, end: 6.5, startFrame: 30, endFrame: 210,
    seconds: 6, reasons: ['good-length' as const], ticked: true };

let root: Root, latest: ReturnType<typeof useEditorClipFinder>;
function Harness({ runKey = 'run-1' }: { runKey?: string }) {
    latest = useEditorClipFinder({ api, projectId, timeline, media, clip, localUri: sourceUri, runKey });
    return null;
}
const capability = (available = true) => ({ available, operations: { inspect: available, sampleFrames: available, decodePcm: available } });
const inspected = (hasAudio = true) => ({ ok: true as const, value: { hasVideo: true, hasAudio, width: 1280, height: 720 } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    mockCapabilities.mockResolvedValue(capability());
    mockPrepare.mockResolvedValue({ ok: true, uri: sourceUri, downloaded: false });
    mockInspect.mockResolvedValue(inspected());
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('blockers preserve the web limits and never reject a readable clip because its source track is locked', () => {
    expect(clipFinderBlocker(undefined, undefined)).toBe('select');
    expect(clipFinderBlocker({ ...media, kind: 'audio' }, clip)).toBe('select');
    expect(clipFinderBlocker(media, { ...clip, reverse: true })).toBe('transform');
    expect(clipFinderBlocker(media, { ...clip, rate: 2 })).toBe('transform');
    expect(clipFinderBlocker(media, { ...clip, len: 2 })).toBe('short');
    expect(clipFinderBlocker(media, { ...clip, len: 901 })).toBe('long');
    expect(clipFinderBlocker(media, clip)).toBeNull();
});

test('keeps the tool visible but unsupported when the full local analysis seam is unavailable', async () => {
    mockCapabilities.mockResolvedValue(capability(false));
    await act(async () => root.render(<Harness />));
    expect(latest.availability).toBe('unsupported');
    await act(async () => { await latest.find(); });
    expect(mockPrepare).not.toHaveBeenCalled();
});

test('materializes and inspects once, reports monotonic stages, and fences the finished rows to the run key', async () => {
    const analysis = deferred<{ ok: true; value: { rows: (typeof row)[]; hadAudio: boolean } }>();
    mockAnalyze.mockReturnValue(analysis.promise);
    await act(async () => root.render(<Harness />));
    expect(latest.availability).toBe('available');
    await act(async () => { void latest.find(); await Promise.resolve(); await Promise.resolve(); });
    expect(latest).toMatchObject({ status: 'reading-picture', progress: 0.05, hadAudio: true });
    expect(mockPrepare).toHaveBeenCalledWith(api, projectId, media, sourceUri, expect.any(AbortSignal));
    expect(mockInspect).toHaveBeenCalledTimes(1);
    expect(mockInspect).toHaveBeenCalledWith(projectId, sourceUri, expect.any(AbortSignal));
    const input = mockAnalyze.mock.calls[0][0];
    expect(input).toMatchObject({ project: projectId, uri: sourceUri, timeline, clip: { start: 30, in: 15, len: 300 }, hasAudio: true });

    await act(async () => input.onProgress({ phase: 'scenes', value: 0.4 }));
    expect(latest.status).toBe('reading-picture'); expect(latest.progress).toBeCloseTo(0.23);
    await act(async () => input.onProgress({ phase: 'scenes', value: 0.2 }));
    expect(latest.progress).toBeCloseTo(0.23);
    await act(async () => input.onProgress({ phase: 'audio', value: 0.3 }));
    expect(latest.status).toBe('reading-sound'); expect(latest.progress).toBeCloseTo(0.635);
    await act(async () => input.onProgress({ phase: 'scenes', value: 1 }));
    expect(latest.status).toBe('reading-sound'); expect(latest.progress).toBeCloseTo(0.635);
    await act(async () => input.onProgress({ phase: 'audio', value: 1 }));
    expect(latest).toMatchObject({ status: 'ranking', progress: 0.95 });

    await act(async () => analysis.resolve({ ok: true, value: { rows: [row], hadAudio: true } }));
    expect(latest).toMatchObject({ status: 'done', progress: 1, resultKey: 'run-1', rows: [row] });
    await act(async () => latest.toggle(row.id));
    expect(latest.rows[0].ticked).toBe(false);
});

test('silent clips advance from picture to ranking without requesting a sound stage', async () => {
    mockInspect.mockResolvedValue(inspected(false));
    const analysis = deferred<{ ok: true; value: { rows: (typeof row)[]; hadAudio: boolean } }>();
    mockAnalyze.mockReturnValue(analysis.promise);
    await act(async () => root.render(<Harness />));
    await act(async () => { void latest.find(); await Promise.resolve(); await Promise.resolve(); });
    const input = mockAnalyze.mock.calls[0][0];
    expect(input.hasAudio).toBe(false);
    await act(async () => input.onProgress({ phase: 'scenes', value: 1 }));
    expect(latest).toMatchObject({ status: 'ranking', progress: 0.95, hadAudio: false });
    await act(async () => analysis.resolve({ ok: true, value: { rows: [row], hadAudio: false } }));
    expect(latest).toMatchObject({ status: 'done', hadAudio: false });
});

test('cancel and run-key changes abort in-flight work and ignore late native results', async () => {
    const source = deferred<{ ok: true; uri: string; downloaded: false }>();
    mockPrepare.mockReturnValueOnce(source.promise);
    await act(async () => root.render(<Harness />));
    await act(async () => { void latest.find(); await Promise.resolve(); });
    const firstSignal = mockPrepare.mock.calls[0][4] as AbortSignal;
    expect(latest.status).toBe('preparing');
    await act(async () => latest.cancel());
    expect(firstSignal.aborted).toBe(true); expect(latest).toMatchObject({ status: 'idle', rows: [] });
    await act(async () => source.resolve({ ok: true, uri: sourceUri, downloaded: false }));
    expect(mockInspect).not.toHaveBeenCalled();

    const analysis = deferred<{ ok: true; value: { rows: (typeof row)[]; hadAudio: boolean } }>();
    mockAnalyze.mockReturnValueOnce(analysis.promise);
    await act(async () => { void latest.find(); await Promise.resolve(); await Promise.resolve(); });
    const secondSignal = mockAnalyze.mock.calls[0][0].signal as AbortSignal;
    await act(async () => root.render(<Harness runKey="run-2" />));
    expect(secondSignal.aborted).toBe(true); expect(latest).toMatchObject({ status: 'idle', rows: [] });
    await act(async () => analysis.resolve({ ok: true, value: { rows: [row], hadAudio: true } }));
    expect(latest).toMatchObject({ status: 'idle', rows: [] }); expect(latest.resultKey).toBeUndefined();
});

test('rejects oversized or non-video inspection before analysis', async () => {
    mockInspect.mockResolvedValue({ ok: true, value: { hasVideo: true, hasAudio: true, width: 1920, height: 1080 } });
    await act(async () => root.render(<Harness />));
    await act(async () => { await latest.find(); });
    expect(latest).toMatchObject({ status: 'error', error: 'invalid-input', rows: [] });
    expect(mockAnalyze).not.toHaveBeenCalled();
});
