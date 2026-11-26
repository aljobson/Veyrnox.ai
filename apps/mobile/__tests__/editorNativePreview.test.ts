import type { SkImage } from '@shopify/react-native-skia';
import { renderNativeEditorPreviewFrame, type EditorNativePreviewDependencies } from '../src/lib/editorNativePreview';
import { emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';

function timeline(): Timeline {
    const base = emptyTimeline();
    return {
        ...base,
        media: {
            subject: { id: 'subject', kind: 'image', frames: 90, width: 1080, height: 1920, hasAudio: false },
            mask: { id: 'mask', kind: 'image', frames: 1, width: 384, height: 384, hasAudio: false },
            overlay: { id: 'overlay', kind: 'image', frames: 90, width: 400, height: 400, hasAudio: false },
        },
        tracks: [...base.tracks, { id: 'video-1', kind: 'video', name: 'Video 2', locked: false, muted: false, hidden: false }],
        video: [
            { id: 'v1', mediaId: 'subject', start: 0, in: 0, len: 90, trackId: 'video-0', volume: 1, transition: 0,
                semanticMask: { version: 1, mediaId: 'mask', category: 'person', sourceFrame: 0 } },
            { id: 'v2', mediaId: 'overlay', start: 0, in: 0, len: 90, trackId: 'video-1', volume: 1, transition: 0, behindSubject: 'v1' },
        ],
        text: [{ id: 't3', text: 'Behind', start: 0, len: 90, trackId: 'text-0', x: .5, y: .5, size: 8, behindSubject: 'v1' }],
        seq: 3,
    };
}

function harness(controller?: AbortController) {
    const image = { dispose: jest.fn() } as unknown as SkImage;
    const render = jest.fn(async (frame: Parameters<EditorNativePreviewDependencies['compositor']>[0]) => ({ version: 1 as const, uri: 'file:///cache/vx-frame-preview.rgba', index: frame.index,
        timestampUs: frame.timestampUs, byteLength: frame.width * frame.height * 4, width: frame.width, height: frame.height,
        stride: frame.width * 4, pixelFormat: 'rgba8' as const, colorSpace: 'srgb' as const }));
    const discard = jest.fn(), compositor = Object.assign(render, { discard }) as EditorNativePreviewDependencies['compositor'];
    const dependencies: EditorNativePreviewDependencies = {
        compositor,
        bytes: jest.fn(async () => {
            controller?.abort();
            return new Uint8Array(360 * 640 * 4);
        }),
        makeImage: jest.fn(() => image),
    };
    return { dependencies, compositor, discard, image };
}

const sources = { subject: 'file:///subject.png', mask: 'file:///mask.png', overlay: 'file:///overlay.png' };
const request = (candidate: Timeline, signal = new AbortController().signal) => ({
    account: 'account', project: 'project', timeline: candidate, frame: 0, width: 640, height: 360, sources, signal,
});

test('renders exact behind-subject image and text plans through the native compositor and discards the raw frame', async () => {
    const run = harness();
    const result = await renderNativeEditorPreviewFrame(request(timeline()), run.dependencies);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.code);
    expect(result.plan.capabilities.exact).toBe(true);
    expect(result.plan.visuals[1].clip.behindSubject).toBe('v1');
    expect(result.plan.texts[0].item.behindSubject).toBe('v1');
    expect(run.compositor).toHaveBeenCalledTimes(1);
    expect(run.dependencies.makeImage).toHaveBeenCalledWith(expect.any(Uint8Array), 640, 360, 2560);
    expect(run.discard).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///cache/vx-frame-preview.rgba' })]);
});

test('fails closed before native work when an exact source is unavailable', async () => {
    const run = harness();
    const result = await renderNativeEditorPreviewFrame({ ...request(timeline()), sources: { subject: sources.subject, overlay: sources.overlay } }, run.dependencies);
    expect(result).toEqual({ ok: false, code: 'source-unavailable' });
    expect(run.compositor).not.toHaveBeenCalled();
});

test('fails closed on stale semantic masks and reports the unsupported capability', async () => {
    const value = timeline(); value.video[0].in = 1;
    const run = harness();
    const result = await renderNativeEditorPreviewFrame(request(value), run.dependencies);
    expect(result).toEqual({ ok: false, code: 'unsupported', capabilities: ['semantic-mask'] });
    expect(run.compositor).not.toHaveBeenCalled();
});

test('cancellation after raw-frame read never publishes an image and still discards the frame', async () => {
    const controller = new AbortController(), run = harness(controller);
    const result = await renderNativeEditorPreviewFrame(request(timeline(), controller.signal), run.dependencies);
    expect(result).toEqual({ ok: false, code: 'cancelled' });
    expect(run.dependencies.makeImage).not.toHaveBeenCalled();
    expect(run.discard).toHaveBeenCalledTimes(1);
});
