import { EDITOR_MOTION_PLATFORM_GATES, runEditorMotionProcessing, type EditorMotionProcessor } from '../src/lib/editorMotionProcessingNative';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const options = { tool: 'stabilize' as const, frameRate: 30 as const, height: 720 as const, smoothing: 10, strength: .8 };
function processor(patch: Partial<EditorMotionProcessor> = {}): EditorMotionProcessor {
    return { capabilities: async () => ({ platform: 'ios', tools: ['stabilize', 'flicker', 'optical-flow', 'track-reframe', 'camera-movement'] }),
        inspect: async () => ({ durationSeconds: 3, bytes: 1_000_000, hasAudio: true }),
        process: async (_request, _signal, progress) => { progress({ stage: 'processing', value: .7 }); progress({ stage: 'encoding', value: .6 }); return { ok: true, value: {
            artifactId: 'vx-mp4-output', uri: 'file:///output.mp4', bytes: 2_000_000, durationSeconds: 3, width: 1280, height: 720, frameRate: 30, videoCodec: 'avc1', audioCodec: 'mp4a',
        } }; }, release: async () => {}, recover: async () => {}, ...patch };
}

test('publishes named platform gates without implying Android support', () => {
    expect(EDITOR_MOTION_PLATFORM_GATES.ios.tools).toEqual(['stabilize', 'flicker', 'optical-flow', 'track-reframe', 'camera-movement']);
    expect(EDITOR_MOTION_PLATFORM_GATES.android).toEqual({ tools: [], reason: 'android-editor-motion-processing-not-qualified' });
});

test('native capability and worker allowlists expose the two advanced implementations', () => {
    const module = readFileSync(resolve(__dirname, '../modules/editor-media/ios/VeyrnoxEditorMediaModule.swift'), 'utf8');
    const advanced = readFileSync(resolve(__dirname, '../modules/editor-media/ios/EditorAdvancedMotion.swift'), 'utf8');
    const full = '["stabilize", "flicker", "optical-flow", "track-reframe", "camera-movement"]';
    expect(module.match(new RegExp(full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(2);
    expect(module).toContain('EditorAdvancedMotion.trackReframe(');
    expect(module).toContain('EditorAdvancedMotion.interpolate(');
    expect(advanced).toContain('static func trackReframe(');
    expect(advanced).toContain('static func interpolate(');
});

test('bounds progress monotonically and verifies encoded metadata', async () => {
    const progress: number[] = [];
    await expect(runEditorMotionProcessing('file:///input.mp4', options, processor(), undefined, event => progress.push(event.value)))
        .resolves.toMatchObject({ ok: true, value: { videoCodec: 'avc1', audioCodec: 'mp4a', height: 720 } });
    expect(progress).toEqual([0, .05, .7, .7, 1]);
});

test('processes only the selected source range and validates the baked duration', async () => {
    const process = jest.fn(async () => ({ ok: true as const, value: { artifactId: 'vx-mp4-range', uri: 'file:///range.mp4', bytes: 2_000_000,
        durationSeconds: 1.5, width: 1280, height: 720, frameRate: 30, videoCodec: 'avc1' as const, audioCodec: 'mp4a' as const } }));
    await expect(runEditorMotionProcessing('file:///input.mp4', options, processor({ process }), undefined, undefined,
        { fromSeconds: 1, durationSeconds: 1.5 })).resolves.toMatchObject({ ok: true, value: { durationSeconds: 1.5 } });
    expect(process).toHaveBeenCalledWith(expect.objectContaining({ sourceUri: 'file:///input.mp4', range: { fromSeconds: 1, durationSeconds: 1.5 } }),
        expect.any(AbortSignal), expect.any(Function));
    await expect(runEditorMotionProcessing('file:///input.mp4', options, processor(), undefined, undefined,
        { fromSeconds: 2.5, durationSeconds: 1 })).resolves.toEqual({ ok: false, code: 'invalid-input' });
});

test('rejects over-limit optical-flow input and recovers thrown processors', async () => {
    await expect(runEditorMotionProcessing('file:///input.mp4', { ...options, tool: 'optical-flow', height: 480 }, processor({
        inspect: async () => ({ durationSeconds: 10.1, bytes: 1_000_000, hasAudio: false }),
    }))).resolves.toEqual({ ok: false, code: 'invalid-input' });
    const recover = jest.fn(async () => {});
    await expect(runEditorMotionProcessing('file:///input.mp4', options, processor({ process: async () => { throw Error('private native failure'); }, recover })))
        .resolves.toEqual({ ok: false, code: 'write-failed' });
    expect(recover).toHaveBeenCalledTimes(1);
});

test('cancellation wins over a late successful output', async () => {
    const controller = new AbortController();
    const release = jest.fn(async () => {});
    const result = runEditorMotionProcessing('file:///input.mp4', options, processor({ process: async () => {
        controller.abort(); return { ok: true, value: { artifactId: 'vx-mp4-late', uri: 'file:///late.mp4', bytes: 1, durationSeconds: 3, width: 1280, height: 720,
            frameRate: 30, videoCodec: 'avc1', audioCodec: 'mp4a' } };
    }, release }), controller.signal);
    await expect(result).resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ artifactId: 'vx-mp4-late' }));
});
