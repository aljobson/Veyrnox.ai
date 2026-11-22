import { analyzeClipScenes, sceneRowsForClip, type SceneAnalysisFiles } from '../src/lib/editorSceneAnalysis';
import type { EditorMediaResult, FrameArtifact, SampleFramesRequest } from '../src/lib/editorMedia/protocol';

const W = 128, H = 72, FRAME_BYTES = W * H * 4;
const manifestUri = 'file:///cache/account/project/artifact/frames.json';
const sourceUri = 'file:///documents/source.mp4';
const clip = { start: 90, in: 60, len: 120 };

function picture(seed: number, brightness = 0) {
    const pixels = new Uint8Array(FRAME_BYTES);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const at = (y * W + x) * 4;
        const box = x >= (seed * 19) % 80 && x < (seed * 19) % 80 + 36 && y >= (seed * 11) % 36 && y < (seed * 11) % 36 + 28;
        const value = Math.max(0, Math.min(255, (box ? 230 - seed * 17 : 30 + ((x + seed * 40) * 4) % 90) + brightness));
        pixels[at] = value; pixels[at + 1] = value; pixels[at + 2] = value; pixels[at + 3] = 255;
    }
    return pixels;
}

function fixture(count = clip.len) {
    const timestampsUs = Array.from({ length: count }, (_, index) => Math.round((clip.in / 30 + index / 30) * 1_000_000));
    const frames = timestampsUs.map((timestampUs, index) => ({ file: `frame-${String(index).padStart(6, '0')}.rgba`, timestampUs }));
    const transform = [1, 0, 0, 1, 0, 0];
    const manifest = { version: 1, format: 'rgba8', width: W, height: H, rowStride: W * 4, colorSpace: 'srgb', orientedWidth: 1280, orientedHeight: 720,
        transform, resizeMode: 'fill', frames };
    const artifact: FrameArtifact = { artifactId: 'artifact-1', uri: manifestUri, kind: 'frames', size: count * FRAME_BYTES + 1000, width: W, height: H, stride: 512,
        pixelFormat: 'rgba8', colorSpace: 'srgb', count, timestampsUs, preferredTransform: transform, resizeMode: 'fill' };
    const bytes = new Map(frames.map((frame, index) => [`${manifestUri.slice(0, -'frames.json'.length)}${frame.file}`, picture(index < count / 2 ? 1 : 4, index % 3)]));
    return { artifact, manifest, bytes };
}

function harness(overrides: { artifact?: FrameArtifact; manifest?: unknown; bytes?: Map<string, Uint8Array>; sample?: EditorMediaResult<FrameArtifact>; files?: SceneAnalysisFiles } = {}) {
    const base = fixture(), artifact = overrides.artifact ?? base.artifact, manifest = overrides.manifest ?? base.manifest, bytes = overrides.bytes ?? base.bytes;
    const sampleFrames = jest.fn<Promise<EditorMediaResult<FrameArtifact>>, [string, SampleFramesRequest, ((progress: never) => void)?, AbortSignal?]>()
        .mockResolvedValue(overrides.sample ?? { ok: true, value: artifact });
    const release = jest.fn().mockResolvedValue({ ok: true, value: null });
    const files = overrides.files ?? { text: jest.fn().mockResolvedValue(JSON.stringify(manifest)), bytes: jest.fn((uri: string) => Promise.resolve(bytes.get(uri)!)) };
    return { base, media: { sampleFrames, release }, files, sampleFrames, release };
}

test('uses the canonical detector on strict fill-mode RGBA artifacts and maps source cuts to timeline rows', async () => {
    const run = harness();
    const result = await analyzeClipScenes({ project: 'project-1', uri: sourceUri, clip }, { media: run.media, files: run.files });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sampledFrames).toBe(120);
    expect(result.value.cuts).toHaveLength(1);
    expect(result.value.cuts[0]).toMatchObject({ time: 4, kind: 'hard' });
    expect(result.value.rows).toEqual([{ frame: 150, time: 4, kind: 'hard', ticked: true }]);
    expect(run.sampleFrames).toHaveBeenCalledWith('project-1', { uri: sourceUri, fromSeconds: 2, toSeconds: 6, maxFrames: 120, resizeMode: 'fill' }, undefined, undefined);
    expect(run.release).toHaveBeenCalledTimes(1);
    expect(run.release).toHaveBeenCalledWith('project-1', 'artifact-1');
});

test('exact scene mode requests every source frame up to 60fps and requires artifact and manifest echoes', async () => {
    const data = fixture();
    const artifact = { ...data.artifact, samplingMode: 'all' as const };
    const manifest = { ...data.manifest, samplingMode: 'all' as const };
    const run = harness({ artifact, manifest });
    const result = await analyzeClipScenes({ project: 'project-1', uri: sourceUri, clip, samplingMode: 'all' }, { media: run.media, files: run.files });
    expect(result.ok).toBe(true);
    expect(run.sampleFrames).toHaveBeenCalledWith('project-1', {
        uri: sourceUri, fromSeconds: 2, toSeconds: 6, maxFrames: 240, resizeMode: 'fill', samplingMode: 'all',
    }, undefined, undefined);
    expect(run.release).toHaveBeenCalledWith('project-1', 'artifact-1');

    const missingArtifactEcho = harness({ manifest });
    await expect(analyzeClipScenes({ project: 'project-1', uri: sourceUri, clip, samplingMode: 'all' },
        { media: missingArtifactEcho.media, files: missingArtifactEcho.files })).resolves.toEqual({ ok: false, code: 'corrupt-media' });
    expect(missingArtifactEcho.release).toHaveBeenCalledTimes(1);

    const missingManifestEcho = harness({ artifact });
    await expect(analyzeClipScenes({ project: 'project-1', uri: sourceUri, clip, samplingMode: 'all' },
        { media: missingManifestEcho.media, files: missingManifestEcho.files })).resolves.toEqual({ ok: false, code: 'corrupt-media' });
    expect(missingManifestEcho.release).toHaveBeenCalledTimes(1);
});

test('timeline rows drop endpoints, deduplicate rounded frames, and leave gradual cuts unticked', () => {
    expect(sceneRowsForClip(clip, [
        { time: 2, score: 1, kind: 'hard' }, { time: 4, score: 1, kind: 'hard' }, { time: 4.01, score: .8, kind: 'gradual' },
        { time: 5, score: .7, kind: 'gradual' }, { time: 6, score: 1, kind: 'hard' },
    ])).toEqual([
        { frame: 150, time: 4, kind: 'hard', ticked: true },
        { frame: 180, time: 5, kind: 'possible', ticked: false },
    ]);
});

test.each([
    ['extra manifest field', (value: any) => { value.extra = true; }],
    ['wrong version', (value: any) => { value.version = 2; }],
    ['wrong format', (value: any) => { value.format = 'bgra8'; }],
    ['wrong width', (value: any) => { value.width = 127; }],
    ['wrong height', (value: any) => { value.height = 71; }],
    ['wrong stride', (value: any) => { value.rowStride = 511; }],
    ['wrong color space', (value: any) => { value.colorSpace = 'p3'; }],
    ['non-fill resize', (value: any) => { value.resizeMode = 'contain'; }],
    ['count mismatch', (value: any) => { value.frames.pop(); }],
    ['timestamp mismatch', (value: any) => { value.frames[1].timestampUs++; }],
    ['duplicate timestamp', (value: any) => { value.frames[1].timestampUs = value.frames[0].timestampUs; }],
    ['wrong ordered name', (value: any) => { value.frames[1].file = 'frame-000002.rgba'; }],
    ['traversal name', (value: any) => { value.frames[1].file = '../frame-000001.rgba'; }],
    ['encoded traversal name', (value: any) => { value.frames[1].file = '%2e%2e%2fframe-000001.rgba'; }],
    ['transform mismatch', (value: any) => { value.transform[0] = 0; }],
] as const)('rejects a hostile frames.json: %s and still releases the artifact', async (_name, mutate) => {
    const data = fixture(), manifest = structuredClone(data.manifest); mutate(manifest);
    const run = harness({ manifest });
    await expect(analyzeClipScenes({ project: 'project-1', uri: sourceUri, clip }, { media: run.media, files: run.files }))
        .resolves.toEqual({ ok: false, code: 'corrupt-media' });
    expect(run.release).toHaveBeenCalledWith('project-1', 'artifact-1');
});

test('rejects a frame whose file is not exactly 36,864 bytes and releases', async () => {
    const data = fixture();
    data.bytes.set('file:///cache/account/project/artifact/frame-000007.rgba', new Uint8Array(FRAME_BYTES - 1));
    const run = harness({ bytes: data.bytes });
    await expect(analyzeClipScenes({ project: 'project-1', uri: sourceUri, clip }, { media: run.media, files: run.files }))
        .resolves.toEqual({ ok: false, code: 'corrupt-media' });
    expect(run.release).toHaveBeenCalledTimes(1);
});

test('requires a contained file:// frames.json artifact before reading it', async () => {
    for (const uri of ['https://example.com/frames.json', 'file:///cache/artifact/not-frames.json', 'file:///cache/artifact/%2e%2e/frames.json', 'file:///cache/artifact\\frames.json']) {
        const data = fixture(), run = harness({ artifact: { ...data.artifact, uri } });
        await expect(analyzeClipScenes({ project: 'project-1', uri: sourceUri, clip }, { media: run.media, files: run.files }))
            .resolves.toEqual({ ok: false, code: 'corrupt-media' });
        expect(run.release).toHaveBeenCalledTimes(1);
    }
});

test('cancellation during frame reads is terminal and always releases', async () => {
    const controller = new AbortController(), data = fixture(); let reads = 0;
    const files: SceneAnalysisFiles = {
        text: async () => JSON.stringify(data.manifest),
        bytes: async uri => { reads++; if (reads === 2) controller.abort(); return data.bytes.get(uri)!; },
    };
    const run = harness({ files });
    await expect(analyzeClipScenes({ project: 'project-1', uri: sourceUri, clip, signal: controller.signal }, { media: run.media, files }))
        .resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(reads).toBe(2);
    expect(run.release).toHaveBeenCalledTimes(1);
});

test('pre-cancellation and native errors avoid file work; only acquired artifacts are released', async () => {
    const controller = new AbortController(); controller.abort(); const first = harness();
    await expect(analyzeClipScenes({ project: 'project-1', uri: sourceUri, clip, signal: controller.signal }, { media: first.media, files: first.files }))
        .resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(first.sampleFrames).not.toHaveBeenCalled(); expect(first.release).not.toHaveBeenCalled();
    const second = harness({ sample: { ok: false, code: 'unsupported-platform' } });
    await expect(analyzeClipScenes({ project: 'project-1', uri: sourceUri, clip }, { media: second.media, files: second.files }))
        .resolves.toEqual({ ok: false, code: 'unsupported-platform' });
    expect(second.release).not.toHaveBeenCalled();
});

test('release failure never replaces a successful analysis result', async () => {
    const run = harness(); run.release.mockRejectedValueOnce(new Error('native cleanup failed'));
    const result = await analyzeClipScenes({ project: 'project-1', uri: sourceUri, clip }, { media: run.media, files: run.files });
    expect(result.ok).toBe(true); expect(run.release).toHaveBeenCalledTimes(1);
});

test.each([
    { project: '', uri: sourceUri, clip },
    { project: 'project-1', uri: 'https://example.com/source.mp4', clip },
    { project: 'project-1', uri: sourceUri, clip: { ...clip, start: -1 } },
    { project: 'project-1', uri: sourceUri, clip: { ...clip, in: 1.5 } },
    { project: 'project-1', uri: sourceUri, clip: { ...clip, len: 2 } },
    { project: 'project-1', uri: sourceUri, clip: { ...clip, len: 901 } },
])('rejects invalid analysis input before native work', async input => {
    const run = harness();
    await expect(analyzeClipScenes(input, { media: run.media, files: run.files })).resolves.toEqual({ ok: false, code: 'invalid-input' });
    expect(run.sampleFrames).not.toHaveBeenCalled(); expect(run.release).not.toHaveBeenCalled();
});
