var mockExportMp4 = jest.fn();
var mockRelease = jest.fn().mockResolvedValue(undefined);
var mockCreateAsset = jest.fn().mockResolvedValue({});

jest.mock('../src/lib/editorLocalExport', () => {
    const actual = jest.requireActual('../src/lib/editorLocalExport');
    return { ...actual, exportEditorMp4: (...args: unknown[]) => mockExportMp4(...args) };
});
jest.mock('../src/lib/editorExportSources', () => ({
    withEditorExportSources: async (_request: unknown, run: (sources: Record<string, string>) => Promise<unknown>) => ({ ok: true, value: await run({}) }),
}));
jest.mock('../src/lib/editorCompositorNative', () => ({
    createNativeEditorLocalExportDependencies: () => ({}), createNativeEditorAudioExportDependencies: () => ({}),
}));
jest.mock('../src/lib/editorMedia/artifacts', () => ({ editorMediaArtifacts: { release: (...args: unknown[]) => mockRelease(...args) } }));
jest.mock('../src/lib/editorFontFiles', () => ({ editorFontStore: { exportSources: () => ({}) } }));
jest.mock('../src/auth/sessionTask', () => ({ useSessionTask: () => () => ({ current: () => true }) }));
jest.mock('../src/components/editor/ExportFootagePreview', () => ({ ExportFootagePreview: () => null }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(true), shareAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-media-library', () => ({ Asset: { create: (...args: unknown[]) => mockCreateAsset(...args) }, requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }) }));

import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { LocalExportSheet } from '../src/components/editor/LocalExportSheet';

const projectId = '11111111-1111-4111-8111-111111111111';
const timeline = { schemaVersion: 3, fps: 30, seq: 1, aspect: '16:9', background: '#000000', media: {},
    video: [{ id: 'v1', mediaId: 'm1', start: 0, in: 0, len: 30, trackId: 'video-0' }], audio: [], text: [], tracks: [], markers: [] } as never;
const canvas = { aspect_ratio: '16:9', frame_rate: 30 } as const;
const artifact = { artifactId: 'vx-mp4-paid', uri: 'file:///paid.mp4', kind: 'mp4' as const, size: 1_500_000,
    width: 1280, height: 720, fps: 30, frames: 30, durationUs: 1_000_000, videoCodec: 'avc1' as const };
let root: Root;
const labelled = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === label);
const press = async (label: string) => act(async () => labelled(label)[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    mockExportMp4.mockResolvedValue({ ok: true, artifact });
    root = createRoot();
});
afterEach(async () => act(async () => root.unmount()));

test('a successful paid local export keeps its artifact and exposes Save and Share', async () => {
    const onPrepare = jest.fn().mockResolvedValue(5);
    const onCommit = jest.fn().mockResolvedValue(7);
    const onFinalize = jest.fn().mockResolvedValue(7), onCancel = jest.fn().mockResolvedValue(true);
    await act(async () => root.render(<LocalExportSheet visible api={{ request: jest.fn() } as never} account="owner" projectId={projectId} revision={7}
        timeline={timeline} canvas={canvas} localMediaUris={{}} onClose={jest.fn()} onCloud={jest.fn()} onPrepare={onPrepare} onCommit={onCommit} onFinalize={onFinalize} onCancel={onCancel} />));
    await press('Export on this device');
    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(5);
    expect(onFinalize).toHaveBeenCalledTimes(1); expect(onCancel).not.toHaveBeenCalled();
    expect(onCommit.mock.invocationCallOrder[0]).toBeLessThan(mockCreateAsset.mock.invocationCallOrder[0]);
    expect(root.container.queryAll(node => node.children.includes('Saved to your photo library.'))).not.toHaveLength(0);
    expect(labelled('Share export')).toHaveLength(1);
    expect(labelled('Export on this device')).toHaveLength(0);
    expect(mockRelease).not.toHaveBeenCalled();
});

test('a refused reservation does not render or expose Save or Share', async () => {
    await act(async () => root.render(<LocalExportSheet visible api={{ request: jest.fn() } as never} account="owner" projectId={projectId} revision={7}
        timeline={timeline} canvas={canvas} localMediaUris={{}} onClose={jest.fn()} onCloud={jest.fn()} onPrepare={jest.fn().mockResolvedValue(5)}
        onCommit={jest.fn().mockResolvedValue(null)} onFinalize={jest.fn()} onCancel={jest.fn()} />));
    await press('Export on this device');
    expect(mockExportMp4).not.toHaveBeenCalled(); expect(mockRelease).not.toHaveBeenCalled();
    expect(labelled('Save to photo library')).toHaveLength(0);
    expect(labelled('Share export')).toHaveLength(0);
    expect(labelled('Export on this device')).toHaveLength(1);
});

test('same-content revision changes retain the render and retry completes automatic Photos save', async () => {
    const onCommit = jest.fn().mockResolvedValue(7), onFinalize = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(8);
    const props = { visible: true, api: { request: jest.fn() } as never, account: 'owner', projectId, timeline, canvas, localMediaUris: {},
        onClose: jest.fn(), onCloud: jest.fn(), onPrepare: jest.fn().mockResolvedValue(5), onCommit, onFinalize, onCancel: jest.fn().mockResolvedValue(true) };
    await act(async () => root.render(<LocalExportSheet {...props} revision={7} />));
    await press('Export on this device');
    expect(mockCreateAsset).toHaveBeenCalledWith(artifact.uri);
    await act(async () => root.render(<LocalExportSheet {...props} revision={8} />));
    expect(labelled('Try again')).toHaveLength(1);
    expect(mockRelease).not.toHaveBeenCalled();
    await press('Try again');
    expect(onCommit).toHaveBeenCalledTimes(1); expect(onCommit).toHaveBeenCalledWith(5);
    expect(onFinalize).toHaveBeenCalledTimes(2);
    expect(mockExportMp4).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockCreateAsset).toHaveBeenCalledTimes(1);
    expect(labelled('Share export')).toHaveLength(1);
});

test('reserves credits before rendering or delivering the finished file', async () => {
    const commit = deferred<number | null>(), onCommit = jest.fn(() => commit.promise);
    await act(async () => root.render(<LocalExportSheet visible api={{ request: jest.fn() } as never} account="owner" projectId={projectId} revision={7}
        timeline={timeline} canvas={canvas} localMediaUris={{}} onClose={jest.fn()} onCloud={jest.fn()} onPrepare={jest.fn().mockResolvedValue(5)}
        onCommit={onCommit} onFinalize={jest.fn().mockResolvedValue(7)} onCancel={jest.fn().mockResolvedValue(true)} />));
    const started = press('Export on this device');
    expect(onCommit).toHaveBeenCalledWith(5);
    expect(mockExportMp4).not.toHaveBeenCalled(); expect(mockCreateAsset).not.toHaveBeenCalled();
    await act(async () => commit.resolve(7)); await started;
    expect(onCommit.mock.invocationCallOrder[0]).toBeLessThan(mockCreateAsset.mock.invocationCallOrder[0]);
});

test('with automatic Photos delivery off, reserve happens first and Share finalizes it', async () => {
    const onCommit = jest.fn().mockResolvedValue(7);
    const onFinalize = jest.fn().mockResolvedValue(7);
    await act(async () => root.render(<LocalExportSheet visible api={{ request: jest.fn() } as never} account="owner" projectId={projectId} revision={7}
        timeline={timeline} canvas={canvas} localMediaUris={{}} onClose={jest.fn()} onCloud={jest.fn()} onPrepare={jest.fn().mockResolvedValue(5)}
        onCommit={onCommit} onFinalize={onFinalize} onCancel={jest.fn().mockResolvedValue(true)} />));
    const autoSaveSwitch = labelled('Save to your photo library automatically')[0];
    expect(autoSaveSwitch).toBeDefined();
    await act(async () => autoSaveSwitch.props.onChange({ nativeEvent: { value: false } }));
    await press('Export on this device');
    expect(onCommit).toHaveBeenCalledWith(5); expect(mockCreateAsset).not.toHaveBeenCalled(); expect(onFinalize).not.toHaveBeenCalled();
    expect(labelled('Share export')).toHaveLength(1);
    await press('Share export');
    expect(onFinalize).toHaveBeenCalledTimes(1);
});

test('cancelling the credit confirmation does not render or show a false export error', async () => {
    const onCommit = jest.fn();
    await act(async () => root.render(<LocalExportSheet visible api={{ request: jest.fn() } as never} account="owner" projectId={projectId} revision={7}
        timeline={timeline} canvas={canvas} localMediaUris={{}} onClose={jest.fn()} onCloud={jest.fn()} onPrepare={jest.fn().mockResolvedValue(null)}
        onCommit={onCommit} onFinalize={jest.fn()} onCancel={jest.fn()} />));
    await press('Export on this device');
    expect(mockExportMp4).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(labelled('Export on this device')).toHaveLength(1);
    expect(root.container.queryAll(node => node.children.includes('The edit was rendered, but it could not be saved because the manual-edit credit check did not complete. Nothing was exported.'))).toHaveLength(0);
});

test('a quote failure is shown before rendering with accurate copy', async () => {
    const onCommit = jest.fn();
    await act(async () => root.render(<LocalExportSheet visible api={{ request: jest.fn() } as never} account="owner" projectId={projectId} revision={7}
        timeline={timeline} canvas={canvas} localMediaUris={{}} onClose={jest.fn()} onCloud={jest.fn()} onPrepare={jest.fn().mockResolvedValue('failed')}
        onCommit={onCommit} onFinalize={jest.fn()} onCancel={jest.fn()} />));
    await press('Export on this device');
    expect(mockExportMp4).not.toHaveBeenCalled(); expect(onCommit).not.toHaveBeenCalled();
    expect(root.container.queryAll(node => node.children.includes('The manual-edit credit check could not start. Nothing was rendered or exported. Check your connection and try again.'))).not.toHaveLength(0);
});

test('an unresolved finalization shows a non-cancellable verifying state and retains the artifact', async () => {
    const finalize = deferred<number | null>();
    await act(async () => root.render(<LocalExportSheet visible api={{ request: jest.fn() } as never} account="owner" projectId={projectId} revision={7}
        timeline={timeline} canvas={canvas} localMediaUris={{}} onClose={jest.fn()} onCloud={jest.fn()} onPrepare={jest.fn().mockResolvedValue(5)}
        onCommit={jest.fn().mockResolvedValue(7)} onFinalize={jest.fn(() => finalize.promise)} onCancel={jest.fn().mockResolvedValue(true)} />));
    await press('Export on this device');
    expect(root.container.queryAll(node => node.children.includes('Verifying credits and finalizing export…'))).not.toHaveLength(0);
    expect(labelled('Cancel')).toHaveLength(0);
    expect(labelled('Close')[0].props.accessibilityState).toEqual({ disabled: true });
    expect(mockRelease).not.toHaveBeenCalled();
    await act(async () => finalize.resolve(7));
    expect(labelled('Share export')).toHaveLength(1); expect(mockRelease).not.toHaveBeenCalled();
});
