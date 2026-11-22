import { rankSegments as rankWebSegments } from '../../../app/veyrnox/_lib/editorClipFinder.mjs';
import {
    analyzeClipForFinder,
    appendSelectedClipFinderRows,
    clipFinderRows,
    selectedClipFinderSegments,
    type ClipFinderAnalysisDependencies,
    type ClipFinderAnalysisInput,
    type ClipFinderPcmArtifact,
    type ClipFinderPick,
} from '../src/lib/editorClipAnalysis';
import type { EditorMediaResult } from '../src/lib/editorMedia/protocol';
import { emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';

const URI = 'file:///documents/veyrnox-editor-media/account/project/source.mp4';
const PCM_URI = 'file:///documents/veyrnox-editor-media/account/project/artifact/audio.f32le';
const clip = { start: 90, in: 60, len: 450 };

function timeline(): Timeline {
    const base = emptyTimeline();
    return {
        ...base, seq: 1,
        media: { source: { id: 'source', name: 'source.mp4', kind: 'video', frames: 900, hasAudio: true, width: 1280, height: 720 } },
        video: [{ id: 'v1', mediaId: 'source', start: clip.start, in: clip.in, len: clip.len, trackId: 'video-0', volume: 1, transition: 0 }],
    };
}

function input(overrides: Partial<ClipFinderAnalysisInput> = {}): ClipFinderAnalysisInput {
    return { project: 'project-1', uri: URI, timeline: timeline(), clip, hasAudio: true, ...overrides };
}

function pcmBytes(samples: ArrayLike<number>) {
    const bytes = new Uint8Array(samples.length * 4), view = new DataView(bytes.buffer);
    for (let index = 0; index < samples.length; index++) view.setFloat32(index * 4, samples[index], true);
    return bytes;
}

function pcmArtifact(samples: ArrayLike<number>, overrides: Partial<ClipFinderPcmArtifact> = {}): ClipFinderPcmArtifact {
    return {
        artifactId: 'pcm-1', uri: PCM_URI, kind: 'pcm', size: samples.length * 4, sampleRate: 48_000, channels: 1,
        frames: samples.length, encoding: 'f32le-interleaved', mixMode: 'web-average',
        segments: [{ offsetFrames: 0, timestampUs: 2_000_000, frames: samples.length }], ...overrides,
    };
}

function chunkFiles(bytes: Uint8Array, sizes = [65_535, 7, 2, 131_071]) {
    return {
        async *chunks() {
            let offset = 0, index = 0;
            while (offset < bytes.length) {
                const end = Math.min(bytes.length, offset + sizes[index++ % sizes.length]);
                yield bytes.slice(offset, end); offset = end;
            }
        },
    };
}

type SceneRunner = NonNullable<ClipFinderAnalysisDependencies['analyzeScenes']>;
type ClipMedia = NonNullable<ClipFinderAnalysisDependencies['media']>;

function harness(samples: ArrayLike<number>, options: {
    cuts?: { time: number; score: number; kind: 'hard' | 'gradual' }[];
    artifact?: ClipFinderPcmArtifact;
    files?: ClipFinderAnalysisDependencies['files'];
    decode?: EditorMediaResult<ClipFinderPcmArtifact>;
    releaseError?: Error;
    order?: string[];
} = {}) {
    const order = options.order ?? [];
    const analyzeScenes = jest.fn<ReturnType<SceneRunner>, Parameters<SceneRunner>>(async () => {
        order.push('scenes');
        return { ok: true, value: { cuts: options.cuts ?? [], rows: [], frames: 1, sampledFrames: 1 } };
    });
    const artifact = options.artifact ?? pcmArtifact(samples);
    const decodePcm = jest.fn<ReturnType<ClipMedia['decodePcm']>, Parameters<ClipMedia['decodePcm']>>(async (_project, _request) => {
        order.push('audio');
        return options.decode ?? { ok: true, value: artifact } as const;
    });
    const release = jest.fn<ReturnType<ClipMedia['release']>, Parameters<ClipMedia['release']>>(async () => {
        order.push('release');
        if (options.releaseError) throw options.releaseError;
        return { ok: true, value: null } as const;
    });
    return {
        dependencies: { analyzeScenes, media: { decodePcm, release }, files: options.files ?? chunkFiles(pcmBytes(samples)) } satisfies ClipFinderAnalysisDependencies,
        analyzeScenes, decodePcm, release, order, artifact,
    };
}

test('runs scenes then timestamped web-average PCM, uses hard cuts only, and matches canonical ranking', async () => {
    const frames = 15 * 48_000;
    const samples = new Float32Array(frames);
    samples.fill(0.08); samples.fill(0.8, 10 * 48_000);
    const cuts = [
        { time: 7, score: 1, kind: 'hard' as const },
        { time: 9, score: .5, kind: 'gradual' as const },
        { time: 12, score: 1, kind: 'hard' as const },
    ];
    const run = harness(samples, { cuts });
    const result = await analyzeClipForFinder(input(), run.dependencies);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(run.order).toEqual(['scenes', 'audio', 'release']);
    expect(run.analyzeScenes).toHaveBeenCalledWith(expect.objectContaining({ samplingMode: 'all' }));
    expect(run.decodePcm).toHaveBeenCalledWith('project-1', {
        uri: URI, fromSeconds: 2, toSeconds: 17, sampleRate: 48_000, channels: 1, mixMode: 'web-average',
    }, expect.any(Function), undefined);
    expect(result.value.cutCount).toBe(2);
    expect(result.value.hadAudio).toBe(true);
    expect(result.value.picks[0]).toMatchObject({ start: 12, end: 17 });
    expect(result.value.picks[0].reasons).toContain('Loud, lively audio');
    expect(result.value.rows[0]).toMatchObject({ id: 'clip-pick-360-510', rank: 1, startFrame: 390, endFrame: 540, seconds: 5,
        reasons: expect.arrayContaining(['lively-audio', 'continuous-shot', 'good-length']), ticked: true });
    const energy = { windowSeconds: .5, values: Array.from({ length: 30 }, (_, index) => index >= 20 ? Math.fround(.8) : Math.fround(.08)) };
    const canonical = (rankWebSegments as any)({ duration: 15, cuts: [5, 10], energy, speech: [] });
    expect(result.value.picks.map(pick => [pick.start, pick.end, pick.reasons]))
        .toEqual(canonical.map((pick: ClipFinderPick) => [pick.start + 2, pick.end + 2, pick.reasons]));
    result.value.picks.forEach((pick, index) => expect(pick.score).toBeCloseTo(canonical[index].score, 12));
    expect(run.release).toHaveBeenCalledWith('project-1', 'pcm-1');
});

test('places discontinuous PCM segments by absolute source timestamp', async () => {
    const samples = new Float32Array(48_000 * 6); samples.fill(.2, 0, 48_000); samples.fill(.9, 48_000);
    const artifact = pcmArtifact(samples, { segments: [
        { offsetFrames: 0, timestampUs: 2_000_000, frames: 48_000 },
        { offsetFrames: 48_000, timestampUs: 12_000_000, frames: 48_000 * 5 },
    ] });
    const run = harness(samples, { artifact, cuts: [{ time: 7, score: 1, kind: 'hard' }, { time: 12, score: 1, kind: 'hard' }] });
    const result = await analyzeClipForFinder(input(), run.dependencies);
    expect(result.ok).toBe(true);
    if (result.ok) {
        expect(result.value.picks[0].start).toBe(12);
        expect(result.value.picks[0].reasons).toContain('Loud, lively audio');
    }
});

test('maps caption speech through a trimmed clip and skips PCM when inspect reported no audio', async () => {
    const tl = timeline();
    tl.text = [{ id: 't2', text: 'one two three four five six seven eight nine ten eleven twelve fourteen', caption: true,
        start: 390, len: 150, trackId: 'text-0', x: .5, y: .85, size: 6 }];
    const run = harness([]);
    const result = await analyzeClipForFinder(input({ timeline: tl, hasAudio: false }), run.dependencies);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(run.decodePcm).not.toHaveBeenCalled(); expect(run.release).not.toHaveBeenCalled();
    expect(result.value.hadAudio).toBe(false);
    expect(result.value.picks[0]).toMatchObject({ start: 11, end: 17 });
    expect(result.value.picks[0].reasons.some(reason => reason.startsWith('Lots of speech'))).toBe(true);
});

test('preserves web behavior for a valid clip shorter than the three-second ranking minimum', async () => {
    const run = harness([]);
    const result = await analyzeClipForFinder(input({ clip: { start: 0, in: 0, len: 89 }, hasAudio: false }), run.dependencies);
    expect(result).toEqual({ ok: true, value: { picks: [], rows: [], hadAudio: false, cutCount: 0, boundsSeconds: 30 } });
});

test.each([
    ['wrong mix', (artifact: any) => { artifact.mixMode = 'native'; }],
    ['wrong channels', (artifact: any) => { artifact.channels = 2; artifact.size *= 2; }],
    ['too many segments', (artifact: any) => { artifact.segments = Array.from({ length: 4097 }, (_, index) => ({ offsetFrames: index, timestampUs: index, frames: 1 })); artifact.frames = 4097; artifact.size = 4097 * 4; }],
    ['offset gap', (artifact: any) => { artifact.segments[1].offsetFrames++; }],
    ['duplicate timestamp', (artifact: any) => { artifact.segments[1].timestampUs = artifact.segments[0].timestampUs; }],
    ['zero segment', (artifact: any) => { artifact.segments[1].frames = 0; }],
    ['segment extra key', (artifact: any) => { artifact.segments[0].extra = true; }],
    ['wrong total', (artifact: any) => { artifact.frames++; artifact.size += 4; }],
] as const)('rejects malformed PCM metadata (%s) and still releases it', async (_name, mutate) => {
    const samples = [0.1, 0.2, 0.3, 0.4], artifact = pcmArtifact(samples, { segments: [
        { offsetFrames: 0, timestampUs: 2_000_000, frames: 2 }, { offsetFrames: 2, timestampUs: 2_000_042, frames: 2 },
    ] });
    mutate(artifact);
    const run = harness(samples, { artifact });
    await expect(analyzeClipForFinder(input({ clip: { start: 0, in: 60, len: 90 } }), run.dependencies)).resolves.toEqual({ ok: false, code: 'corrupt-media' });
    expect(run.release).toHaveBeenCalledWith('project-1', 'pcm-1');
});

test.each([
    ['truncated', pcmBytes([.1, .2, .3]).slice(0, 11)],
    ['extra bytes', new Uint8Array([...pcmBytes([.1, .2, .3]), 0])],
    ['NaN sample', pcmBytes([.1, Number.NaN, .3])],
] as const)('rejects malformed PCM bytes (%s) and releases', async (_name, bytes) => {
    const samples = [.1, .2, .3], run = harness(samples, { files: chunkFiles(bytes) });
    await expect(analyzeClipForFinder(input({ clip: { start: 0, in: 60, len: 90 } }), run.dependencies)).resolves.toEqual({ ok: false, code: 'corrupt-media' });
    expect(run.release).toHaveBeenCalledTimes(1);
});

test('maps file read failures to corrupt media and release failures never replace success', async () => {
    const broken = harness([.2], { files: { async *chunks() { throw new Error('read'); } } });
    await expect(analyzeClipForFinder(input({ clip: { start: 0, in: 60, len: 90 } }), broken.dependencies)).resolves.toEqual({ ok: false, code: 'corrupt-media' });
    expect(broken.release).toHaveBeenCalledTimes(1);
    const cleanup = harness([.2], { releaseError: new Error('release') });
    const result = await analyzeClipForFinder(input({ clip: { start: 0, in: 60, len: 90 } }), cleanup.dependencies);
    expect(result.ok).toBe(true); expect(cleanup.release).toHaveBeenCalledTimes(1);
});

test('propagates scene/decode errors without starting later work or releasing an unacquired artifact', async () => {
    const decodePcm = jest.fn(); const release = jest.fn();
    const sceneError: ClipFinderAnalysisDependencies = { analyzeScenes: jest.fn().mockResolvedValue({ ok: false, code: 'unsupported-codec' }), media: { decodePcm, release } } as any;
    await expect(analyzeClipForFinder(input(), sceneError)).resolves.toEqual({ ok: false, code: 'unsupported-codec' });
    expect(decodePcm).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
    const run = harness([], { decode: { ok: false, code: 'disk-full' } });
    await expect(analyzeClipForFinder(input(), run.dependencies)).resolves.toEqual({ ok: false, code: 'disk-full' });
    expect(run.release).not.toHaveBeenCalled();
});

test('cancellation is terminal before work, between sequential operations, and during PCM reads', async () => {
    const before = new AbortController(); before.abort(); const first = harness([.1]);
    await expect(analyzeClipForFinder(input({ signal: before.signal }), first.dependencies)).resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(first.analyzeScenes).not.toHaveBeenCalled();

    const between = new AbortController(), second = harness([.1]);
    second.analyzeScenes.mockImplementationOnce(async () => { between.abort(); return { ok: true, value: { cuts: [], rows: [], frames: 1, sampledFrames: 1 } }; });
    await expect(analyzeClipForFinder(input({ signal: between.signal }), second.dependencies)).resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(second.decodePcm).not.toHaveBeenCalled();

    const during = new AbortController(), bytes = pcmBytes([.1, .2, .3]);
    const third = harness([.1, .2, .3], { files: { async *chunks() { yield bytes.slice(0, 4); during.abort(); yield bytes.slice(4); } } });
    await expect(analyzeClipForFinder(input({ clip: { start: 0, in: 60, len: 90 }, signal: during.signal }), third.dependencies))
        .resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(third.release).toHaveBeenCalledTimes(1);
});

test.each([
    { project: '', uri: URI, clip, hasAudio: true },
    { project: 'project-1', uri: 'https://example.com/source.mp4', clip, hasAudio: true },
    { project: 'project-1', uri: URI, clip: { ...clip, start: -1 }, hasAudio: true },
    { project: 'project-1', uri: URI, clip: { ...clip, in: 1.5 }, hasAudio: true },
    { project: 'project-1', uri: URI, clip: { ...clip, len: 2 }, hasAudio: true },
    { project: 'project-1', uri: URI, clip: { ...clip, len: 901 }, hasAudio: true },
] as const)('rejects invalid input before native work', async override => {
    const run = harness([.1]);
    await expect(analyzeClipForFinder(input(override as any), run.dependencies)).resolves.toEqual({ ok: false, code: 'invalid-input' });
    expect(run.analyzeScenes).not.toHaveBeenCalled();
});

test('row mapping ticks the first three valid ranked picks and selected segments keep rank order', () => {
    const pick = (start: number, end: number): ClipFinderPick => ({ start, end, score: 1, parts: {}, reasons: ['reason'] });
    const rows = clipFinderRows({ start: 90, in: 60, len: 600 }, [pick(10, 15), pick(20, 25), pick(5, 9), pick(4, 7), pick(1, 4), pick(1, 30)]);
    expect(rows.map(row => [row.rank, row.startFrame, row.endFrame, row.seconds, row.reasons, row.ticked])).toEqual([
        [1, 330, 480, 5, ['fallback'], true], [2, 180, 300, 4, ['fallback'], true], [3, 150, 240, 3, ['fallback'], true],
    ]);
    expect(selectedClipFinderSegments(rows)).toEqual([{ start: 10, end: 15 }, { start: 5, end: 9 }, { start: 4, end: 7 }]);
});

test('atomic append sorts by source time, appends once, and leaves input unchanged on failure', () => {
    const base = timeline(), snapshot = structuredClone(base);
    const rows = [
        { id: 'a', rank: 1, start: 12, end: 17, startFrame: 390, endFrame: 540, seconds: 5, reasons: ['fallback' as const], ticked: true },
        { id: 'b', rank: 2, start: 7, end: 12, startFrame: 240, endFrame: 390, seconds: 5, reasons: ['fallback' as const], ticked: true },
        { id: 'c', rank: 3, start: 2, end: 7, startFrame: 90, endFrame: 240, seconds: 5, reasons: ['fallback' as const], ticked: false },
    ];
    const next = appendSelectedClipFinderRows(base, 'source', rows);
    expect('error' in next).toBe(false);
    if (!('error' in next)) expect(next.video.slice(1).map(item => [item.start, item.in, item.len])).toEqual([[540, 210, 150], [690, 360, 150]]);
    expect(base).toEqual(snapshot);
    expect(appendSelectedClipFinderRows(base, 'source', rows.map(row => ({ ...row, ticked: false })))).toEqual({ error: 'Choose at least one clip to add.' });

    const nearEnd = timeline(); nearEnd.video[0] = { ...nearEnd.video[0], start: 17_800, in: 0, len: 100 };
    const before = structuredClone(nearEnd);
    const failed = appendSelectedClipFinderRows(nearEnd, 'source', [
        { id: 'a', rank: 1, start: 0, end: 2, startFrame: 0, endFrame: 60, seconds: 2, reasons: [], ticked: true },
        { id: 'b', rank: 2, start: 3, end: 5, startFrame: 90, endFrame: 150, seconds: 2, reasons: [], ticked: true },
    ]);
    expect('error' in failed).toBe(true); expect(nearEnd).toEqual(before);
});
