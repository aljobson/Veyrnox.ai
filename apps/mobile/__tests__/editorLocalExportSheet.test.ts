import { estimatedLocalExportBytes, fittedLocalExportDimensions, LOCAL_EXPORT_QUALITY, localExportDimensions, localExportInterruptedState, saveLocalExportToPhotos } from '../src/components/editor/LocalExportSheet';
import { validateBeginEncodeRequest } from '../src/lib/editorMedia/protocol';

jest.mock('../src/auth/sessionTask', () => ({ useSessionTask: () => () => ({ current: () => true }) }));

test('uses bounded native export dimensions for every editor canvas', () => {
    expect(localExportDimensions({ aspect_ratio: '16:9', frame_rate: 30 })).toEqual({ width: 1280, height: 720 });
    expect(localExportDimensions({ aspect_ratio: '9:16', frame_rate: 30 })).toEqual({ width: 720, height: 1280 });
    expect(localExportDimensions({ aspect_ratio: '1:1', frame_rate: 30 })).toEqual({ width: 960, height: 960 });
    expect(localExportDimensions({ aspect_ratio: '4:5', frame_rate: 30 })).toEqual({ width: 1024, height: 1280 });
    expect(localExportDimensions({ aspect_ratio: 'custom:5x8', frame_rate: 30 })).toEqual({ width: 800, height: 1280 });
    expect(localExportDimensions({ aspect_ratio: 'custom:4x1', frame_rate: 30 })).toEqual({ width: 1280, height: 320 });
    for (const aspect_ratio of ['16:9', '9:16', '1:1', '4:5', 'custom:5x8', 'custom:4x1'] as const) {
        const size = fittedLocalExportDimensions({ aspect_ratio, frame_rate: 30 });
        expect(size.width % 2).toBe(0); expect(size.height % 2).toBe(0); expect(size.width * size.height).toBeLessThanOrEqual(1280 * 720);
    }
});

test('a stale session exits the exporting state so close and retry are not left disabled', () => {
    expect(localExportInterruptedState(false, false)).toEqual({ phase: 'error', error: 'stale' });
    expect(localExportInterruptedState(true, true)).toEqual({ phase: 'idle', error: null });
});

test('quality presets produce honest duration-based output estimates', () => {
    const timeline = { fps: 30, video: [{ start: 0, len: 300 }], audio: [], text: [] } as never;
    expect(LOCAL_EXPORT_QUALITY.standard).toEqual({ videoBitRate: 6_000_000, audioBitRate: 192_000 });
    expect(estimatedLocalExportBytes(timeline, 'compact')).toBe(3_910_000);
    expect(estimatedLocalExportBytes(timeline, 'standard')).toBe(7_740_000);
    expect(estimatedLocalExportBytes(timeline, 'high')).toBe(8_320_000);
    for (const aspect_ratio of ['16:9', '9:16', '1:1', '4:5', 'custom:5x8', 'custom:4x1'] as const) for (const [quality, preset] of Object.entries(LOCAL_EXPORT_QUALITY)) {
        expect(validateBeginEncodeRequest({ ...fittedLocalExportDimensions({ aspect_ratio, frame_rate: 30 }), fps: 30,
            ...preset, audioArtifactId: `vx-pcm-${quality}` })).toBe(true);
        expect(validateBeginEncodeRequest({ ...fittedLocalExportDimensions({ aspect_ratio, frame_rate: 30 }), fps: 30,
            ...preset, audioArtifactId: `vx-pcm-${quality}`, codec: 'hevc' })).toBe(true);
    }
});

test('photo saving is permission-gated, exclusive and rejects stale artifacts', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const allowed = { requestPermission: jest.fn().mockResolvedValue({ granted: true }), create };
    await expect(saveLocalExportToPhotos('file://export.mp4', () => true, allowed)).resolves.toBe('saved');
    expect(create).toHaveBeenCalledTimes(1);

    create.mockClear();
    await expect(saveLocalExportToPhotos('file://export.mp4', () => true, {
        requestPermission: jest.fn().mockResolvedValue({ granted: false }), create,
    })).resolves.toBe('permission');
    expect(create).not.toHaveBeenCalled();

    let checks = 0;
    await expect(saveLocalExportToPhotos('file://export.mp4', () => ++checks === 1, allowed)).resolves.toBe('stale');
    expect(create).toHaveBeenCalledTimes(1);

    await expect(saveLocalExportToPhotos('file://export.mp4', () => true, {
        requestPermission: jest.fn().mockResolvedValue({ granted: true }), create: jest.fn().mockRejectedValue(new Error('disk full')),
    })).resolves.toBe('failed');
});
