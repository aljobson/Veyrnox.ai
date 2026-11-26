import { exportEditorMp4, CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES, type EditorLocalExportDependencies } from '../src/lib/editorLocalExport';
import { frameTimestampUs, type EncodeSession, type FrameDescriptor, type Mp4Artifact } from '../src/lib/editorMedia/protocol';
import { webSequenceV3 } from './fixtures/webSequenceV3';

function exactTimeline(frames = 17) {
    const timeline = webSequenceV3(), source = timeline.video[0];
    timeline.video = [{ id: source.id, mediaId: source.mediaId, start: 0, in: 0, len: frames, volume: 1, transition: 0,
        trackId: 'video-0', fit: 'contain' }];
    timeline.audio = []; timeline.text = []; timeline.fonts = [];
    timeline.tracks = timeline.tracks.map(track => ({ ...track, hidden: false, solo: false }));
    return timeline;
}

function harness(): EditorLocalExportDependencies & { rendered: number[]; batches: number[][]; released: string[]; cancelled: string[] } {
    const rendered: number[] = [], batches: number[][] = [], released: string[] = [], cancelled: string[] = [];
    const session = (request: { width: number; height: number; fps: number; audioArtifactId: string }): EncodeSession => ({ sessionId: 'session', token: 'token', project: 'project', generation: 1,
        width: request.width, height: request.height, fps: request.fps, nextIndex: 0, audioArtifactId: request.audioArtifactId });
    return {
        rendered, batches, released, cancelled,
        prepareAudio: jest.fn(async () => ({ ok: true as const, value: { artifactId: 'audio' } })),
        begin: jest.fn(async request => ({ ok: true as const, value: session(request) })),
        renderFrame: jest.fn(async value => {
            rendered.push(value.index);
            return { version: 1, uri: `file:///frame-${value.index}.rgba`, index: value.index,
                timestampUs: value.timestampUs, byteLength: value.width * value.height * 4, width: value.width,
                height: value.height, stride: value.width * 4, pixelFormat: 'rgba8', colorSpace: 'srgb' } satisfies FrameDescriptor;
        }),
        discardFrames: jest.fn(),
        append: jest.fn(async (current, frames) => { batches.push(frames.map(frame => frame.index)); return { ok: true as const,
            value: { ...current, nextIndex: current.nextIndex + frames.length } }; }),
        finish: jest.fn(async current => ({ ok: true as const, value: { artifactId: 'mp4', uri: 'file:///output.mp4', kind: 'mp4', size: 100,
            width: current.width, height: current.height, fps: current.fps, frames: current.nextIndex,
            durationUs: frameTimestampUs(current.nextIndex, current.fps), videoCodec: 'avc1', audioCodec: 'mp4a',
            audioSampleRate: 48000, audioChannels: 2 } satisfies Mp4Artifact })),
        cancel: current => { cancelled.push(current.sessionId); },
        release: async id => { released.push(id); },
    };
}

test('native compositor advertises the complete canonical web semantic surface', () => {
    expect(new Set(CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES)).toEqual(new Set([
        'timeline-background', 'image-source', 'graphic-source', 'video-source', 'fit', 'crop', 'transform', 'visual-layering',
        'blend', 'mask', 'transition', 'clip-animation', 'animation-reveal', 'clip-background-solid', 'clip-background-blur',
        'clip-background-image', 'clip-background-gradient', 'clip-background-video', 'basic-filter', 'smart-picture', 'advanced-colour', 'effect', 'text-layer', 'caption-words',
        'custom-font', 'behind-subject', 'semantic-mask', 'semantic-mask-dynamic', 'audio-mix',
    ]));
});

test('renders the full canonical visual semantic stack', async () => {
    const timeline = webSequenceV3(); timeline.audio = []; timeline.text = [];
    timeline.video[0].effect = { type: 'sepia', intensity: .5 };
    const run = harness();
    const result = await exportEditorMp4({ timeline, width: 640, height: 360, videoBitRate: 6_000_000 }, run);
    expect(result).toMatchObject({ ok: true });
    expect(run.renderFrame).toHaveBeenCalled();
});

test('feeds canonical plans to S9 in bounded ordered batches and releases the audio spool', async () => {
    const timeline = exactTimeline();
    const run = harness();
    const result = await exportEditorMp4({ timeline, width: 640, height: 360, videoBitRate: 6_000_000 }, run);
    expect(result.ok).toBe(true);
    expect(run.rendered).toEqual(Array.from({ length: 17 }, (_, index) => index));
    expect(run.batches).toEqual([[0, 1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14, 15], [16]]);
    expect(run.released).toEqual(['audio']); expect(run.cancelled).toEqual([]);
});

test('passes an explicit HEVC request to the native writer', async () => {
    const timeline = exactTimeline(2), run = harness();
    await exportEditorMp4({ timeline, width: 640, height: 360, videoBitRate: 6_000_000, codec: 'hevc' }, run);
    expect(run.begin).toHaveBeenCalledWith(expect.objectContaining({ codec: 'hevc' }));
});

test('resamples project frames to a selected export cadence without changing duration', async () => {
    const timeline = exactTimeline(15), run = harness();
    const result = await exportEditorMp4({ timeline, fps: 60, width: 640, height: 360, videoBitRate: 6_000_000 }, run);
    expect(result).toMatchObject({ ok: true, artifact: { fps: 60, frames: 30, durationUs: 500_000 } });
    expect(run.begin).toHaveBeenCalledWith(expect.objectContaining({ fps: 60 }));
    expect(run.renderFrame).toHaveBeenCalledTimes(30);
    expect(jest.mocked(run.renderFrame).mock.calls.map(([frame]) => frame.plan.frame)).toEqual(
        Array.from({ length: 30 }, (_, index) => Math.floor(index / 2)));
});

test('cancellation aborts the live session and releases transient audio', async () => {
    const timeline = exactTimeline(10);
    const run = harness(), controller = new AbortController();
    run.renderFrame = jest.fn(async value => {
        if (value.index === 1) controller.abort();
        return { version: 1, uri: `file:///frame-${value.index}.rgba`, index: value.index, timestampUs: value.timestampUs,
            byteLength: value.width * value.height * 4, width: value.width, height: value.height, stride: value.width * 4,
            pixelFormat: 'rgba8', colorSpace: 'srgb' } satisfies FrameDescriptor;
    });
    await expect(exportEditorMp4({ timeline, width: 640, height: 360, videoBitRate: 6_000_000, signal: controller.signal }, run))
        .resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(run.cancelled).toEqual(['session']); expect(run.released).toEqual(['audio']);
});

test('refuses timelines beyond the qualified S9 duration before allocating media', async () => {
    const timeline = exactTimeline(901);
    const run = harness();
    await expect(exportEditorMp4({ timeline, width: 640, height: 360, videoBitRate: 6_000_000 }, run))
        .resolves.toEqual({ ok: false, code: 'invalid-timeline' });
    expect(run.prepareAudio).not.toHaveBeenCalled();
});
