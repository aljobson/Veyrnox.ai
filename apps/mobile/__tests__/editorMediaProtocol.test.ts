import { EDITOR_MEDIA_LIMITS, frameTimestampUs, parseError, parseFrameArtifact, parseMediaInfo, parseMp4Artifact, parsePcmArtifact, validateBeginEncodeRequest,
    validateAudioMixRequest, validateDecodePcmRequest, validateFrameBatch, validateOwnedFileUri, validateSampleFramesRequest, type EncodeSession } from '../src/lib/editorMedia/protocol';

test('owned file URLs fail closed before native canonical-root validation', () => {
    expect(validateOwnedFileUri('file:///data/veyrnox-editor-media/a/p/input.mp4')).toBe(true);
    for (const uri of ['https://example.test/x', 'file://host/x', 'file:///x?token=1', 'file:///x#fragment', 'file:///a/../secret', 'file:///a/%2e%2e/secret',
        'file:///a/%2Fsecret', 'file:///a\\secret', 'file:///a\0secret']) expect(validateOwnedFileUri(uri)).toBe(false);
});

test('analysis requests are finite, exact and bounded to thirty seconds', () => {
    const uri = 'file:///data/veyrnox-editor-media/a/p/input.mp4';
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 30, maxFrames: 900 })).toBe(true);
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 30, maxFrames: 900, resizeMode: 'contain' })).toBe(true);
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 30, maxFrames: 900, resizeMode: 'fill' })).toBe(true);
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 30, maxFrames: 1800, resizeMode: 'fill', samplingMode: 'all', maximumFrameRate: 60 })).toBe(true);
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 30, maxFrames: 1800, resizeMode: 'fill', samplingMode: 'all' })).toBe(false);
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 30, maxFrames: 1800, resizeMode: 'fill', samplingMode: 'all', maximumFrameRate: 59 })).toBe(false);
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 30, maxFrames: 900, maximumFrameRate: 60 })).toBe(false);
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 30, maxFrames: 1801, samplingMode: 'all' })).toBe(false);
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 30, maxFrames: 901 })).toBe(false);
    for (const resizeMode of ['cover', 'stretch', '', null, 1])
        expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 1, maxFrames: 1, resizeMode })).toBe(false);
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 1, maxFrames: 1, extra: true })).toBe(false);
    expect(validateDecodePcmRequest({ uri, fromSeconds: 1, toSeconds: 31, sampleRate: 48000, channels: 2 })).toBe(true);
    expect(validateDecodePcmRequest({ uri, fromSeconds: 1, toSeconds: 31, sampleRate: 48000, channels: 1, mixMode: 'web-average' })).toBe(true);
    expect(validateDecodePcmRequest({ uri, fromSeconds: 1, toSeconds: 31, sampleRate: 48000, channels: 2, mixMode: 'web-average' })).toBe(false);
    for (const value of [NaN, Infinity, -1]) expect(validateSampleFramesRequest({ uri, fromSeconds: value, toSeconds: 2, maxFrames: 1 })).toBe(false);
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 30.01, maxFrames: 1 })).toBe(false);
    expect(validateSampleFramesRequest({ uri, fromSeconds: 0, toSeconds: 1, maxFrames: 1, samplingMode: 'uniform' })).toBe(false);
    expect(validateDecodePcmRequest({ uri, fromSeconds: 0, toSeconds: 1, sampleRate: 44100, channels: 2 })).toBe(false);
    expect(validateDecodePcmRequest({ uri, fromSeconds: 0, toSeconds: 1, sampleRate: 48000, channels: 3 })).toBe(false);
});

test('audio mix admits the strict canonical advanced contract and retains the legacy caption crop', () => {
    const sources = { source: 'file:///data/veyrnox-editor-media/a/p/input.mp4' };
    const legacy = { mediaId: 'source', timelineStartSeconds: 0, sourceStartSeconds: 1, durationSeconds: 2,
        volume: 1, fadeInSeconds: 0, fadeOutSeconds: 0 };
    const advanced = { mediaId: 'source', start: 0, in: 30, len: 60, transitionOut: 0, volume: 1, fadeIn: 0, fadeOut: 0,
        rate: 1, reverse: false, preservePitch: true, speedCurve: [{ frame: 0, rate: 1 }, { frame: 60, rate: 2 }],
        audioProcessing: { pitch: 0, voice: 'none', noiseReduction: 0, noiseStart: 0, noiseLength: .3, gateDb: -96 },
        audioEffects: { width: 1, tremoloRate: 4, tremoloDepth: 0, echoDelay: .2, echoDecay: .45, echoRepeats: 3, echoMix: 0 },
        pan: 0, eq: { low: 0, mid: 0, high: 0 } };
    expect(validateAudioMixRequest({ clips: [legacy], sources, frames: 90, fps: 30 })).toBe(true);
    expect(validateAudioMixRequest({ clips: [advanced], sources, frames: 90, fps: 30 })).toBe(true);
    expect(validateAudioMixRequest({ clips: [{ ...advanced, audioEffects: { ...advanced.audioEffects, echoRepeats: 2.5 } }], sources, frames: 90, fps: 30 })).toBe(false);
    expect(validateAudioMixRequest({ clips: [{ ...advanced, speedCurve: [{ frame: 1, rate: 1 }, { frame: 0, rate: 1 }] }], sources, frames: 90, fps: 30 })).toBe(false);
    expect(validateAudioMixRequest({ clips: [{ ...advanced, surprise: true }], sources, frames: 90, fps: 30 })).toBe(false);
});

test('encode schema fixes pixel layout, exact timestamp rounding and batch bounds', () => {
    expect(validateBeginEncodeRequest({ width: 1280, height: 720, fps: 30, videoBitRate: 6_000_000 })).toBe(true);
    expect(validateBeginEncodeRequest({ width: 1280, height: 720, fps: 30, videoBitRate: 6_000_000, alpha: true })).toBe(true);
    expect(validateBeginEncodeRequest({ width: 1280, height: 720, fps: 30, videoBitRate: 6_000_000, alpha: 'yes' })).toBe(false);
    expect(validateBeginEncodeRequest({ width: 1280, height: 720, fps: 30, videoBitRate: 6_000_000, audioBitRate: 192_000,
        audioArtifactId: 'vx-pcm-audio-1' })).toBe(true);
    expect(validateBeginEncodeRequest({ width: 1280, height: 720, fps: 30, videoBitRate: 6_000_000, audioArtifactId: '../pcm' })).toBe(false);
    expect(validateBeginEncodeRequest({ width: 1280, height: 720, fps: 30, videoBitRate: 6_000_000, audioBitRate: 192_000 })).toBe(false);
    expect(validateBeginEncodeRequest({ width: 1280, height: 720, fps: 30, videoBitRate: 8_000_000, audioBitRate: 192_000 })).toBe(false);
    expect(validateBeginEncodeRequest({ width: 1281, height: 720, fps: 30, videoBitRate: 6_000_000 })).toBe(false);
    expect(validateBeginEncodeRequest({ width: 1280, height: 721, fps: 30, videoBitRate: 6_000_000 })).toBe(false);
    expect(validateBeginEncodeRequest({ width: 1280, height: 720, fps: 30, videoBitRate: 99_999 })).toBe(false);
    expect(validateBeginEncodeRequest({ width: 1280, height: 720, fps: 30, videoBitRate: 6_000_000, audioBitRate: 63_999,
        audioArtifactId: 'vx-pcm-audio-1' })).toBe(false);
    expect(validateBeginEncodeRequest({ width: 1280, height: 720, fps: 29.97, videoBitRate: 6_000_000 })).toBe(false);
    expect([0, 1, 2, 3].map(index => frameTimestampUs(index, 30))).toEqual([0, 33333, 66667, 100000]);
    const session: EncodeSession = { sessionId: 's1', token: 't1', project: 'p1', generation: 1, width: 1280, height: 720, fps: 30, nextIndex: 0 };
    const frame = (index: number) => ({ version: 1 as const, uri: `file:///cache/frame-${index}.rgba`, index, timestampUs: frameTimestampUs(index, 30), byteLength: 1280 * 720 * 4,
        width: 1280, height: 720, stride: 5120, pixelFormat: 'rgba8' as const, colorSpace: 'srgb' as const });
    expect(validateFrameBatch([frame(0), frame(1)], session)).toBe(true);
    expect(validateFrameBatch(Array.from({ length: 9 }, (_, index) => frame(index)), session)).toBe(false);
    expect(validateFrameBatch([{ ...frame(0), stride: 1280 }], session)).toBe(false);
    expect(validateFrameBatch([{ ...frame(0), timestampUs: 33333 }], session)).toBe(false);
    expect(validateFrameBatch([{ ...frame(0), version: 2 }], session)).toBe(false);
    expect(8 * frame(0).byteLength).toBeLessThanOrEqual(EDITOR_MEDIA_LIMITS.batchBytes);
});

test('native results are strictly bounded and native prose never escapes', () => {
    expect(parseError({ ok: false, code: 'invalid-input', reason: 'source-too-large', message: 'private AVFoundation detail' }))
        .toEqual({ ok: false, code: 'invalid-input', reason: 'source-too-large' });
    expect(parseError({ ok: false, code: 'unknown', reason: 'x' })).toBeNull();
    const base = { ok: true, artifactId: 'artifact-1', uri: 'file:///cache/a', size: 1024 };
    const frames = { ...base, kind: 'frames', width: 128, height: 72, stride: 512, pixelFormat: 'rgba8', colorSpace: 'srgb', count: 2,
        timestampsUs: [0, 33333], preferredTransform: [1, 0, 0, 1, 0, 0] };
    expect(parseFrameArtifact(frames)).toMatchObject({ count: 2, resizeMode: 'contain' });
    expect(parseFrameArtifact({ ...frames, resizeMode: 'fill' }, { maxFrames: 2, resizeMode: 'fill' })).toMatchObject({ resizeMode: 'fill', samplingMode: 'uniform' });
    expect(parseFrameArtifact(frames, { maxFrames: 2, resizeMode: 'fill' })).toBeNull();
    expect(parseFrameArtifact({ ...frames, resizeMode: 'contain' }, { maxFrames: 2, resizeMode: 'fill' })).toBeNull();
    expect(parseFrameArtifact({ ...frames, resizeMode: 'cover' })).toBeNull();
    const exactFrames = { ...frames, resizeMode: 'fill', samplingMode: 'all', maximumFrameRate: 60 };
    const exactRequest = { maxFrames: 1800, resizeMode: 'fill' as const, samplingMode: 'all' as const, maximumFrameRate: 60 as const };
    expect(parseFrameArtifact(exactFrames, exactRequest)).toMatchObject({ samplingMode: 'all', maximumFrameRate: 60 });
    expect(parseFrameArtifact({ ...exactFrames, maximumFrameRate: undefined }, exactRequest)).toBeNull();
    expect(parseFrameArtifact({ ...frames, resizeMode: 'fill' }, exactRequest)).toBeNull();
    expect(parseFrameArtifact({ ...base, kind: 'frames', width: 128, height: 72, stride: 512, pixelFormat: 'rgba8', colorSpace: 'srgb', count: 2,
        timestampsUs: [0, 0], preferredTransform: [1, 0, 0, 1, 0, 0] })).toBeNull();
    expect(parsePcmArtifact({ ...base, size: 11_520_000, kind: 'pcm', sampleRate: 48000, channels: 2, frames: 1_440_000, encoding: 'f32le-interleaved' })?.channels).toBe(2);
    expect(parsePcmArtifact({ ...base, kind: 'pcm', sampleRate: 48000, channels: 2, frames: 100, encoding: 'f32le-interleaved' })).toBeNull();
    expect(parsePcmArtifact({ ...base, kind: 'pcm', sampleRate: 44100, channels: 2, frames: 1, encoding: 'f32le-interleaved' })).toBeNull();
    const exactPcm = { ...base, size: 192_000, kind: 'pcm', sampleRate: 48000, channels: 1, frames: 48_000, encoding: 'f32le-interleaved',
        mixMode: 'web-average', segments: [{ offsetFrames: 0, timestampUs: 1_000_000, frames: 24_000 }, { offsetFrames: 24_000, timestampUs: 1_500_000, frames: 24_000 }] };
    expect(parsePcmArtifact(exactPcm, 'web-average')).toMatchObject({ mixMode: 'web-average', segments: exactPcm.segments });
    expect(parsePcmArtifact(exactPcm)).toBeNull();
    expect(parsePcmArtifact({ ...exactPcm, segments: [{ offsetFrames: 1, timestampUs: 1_000_000, frames: 48_000 }] }, 'web-average')).toBeNull();
    expect(parsePcmArtifact({ ...exactPcm, segments: [{ offsetFrames: 0, timestampUs: 1_000_000, frames: 47_999 }] }, 'web-average')).toBeNull();
    expect(parsePcmArtifact({ ...exactPcm, segments: [{ offsetFrames: 0, timestampUs: 1_000_000, frames: 24_000 },
        { offsetFrames: 24_000, timestampUs: 1_000_000, frames: 24_000 }] }, 'web-average')).toBeNull();
    expect(parseMp4Artifact({ ...base, kind: 'mp4', width: 1280, height: 720, fps: 30, frames: 900, durationUs: 30_000_000, videoCodec: 'avc1',
        audioCodec: 'mp4a', audioSampleRate: 48000, audioChannels: 2 })?.frames).toBe(900);
    expect(parseMp4Artifact({ ...base, kind: 'mp4', width: 1280, height: 720, fps: 30, frames: 900, durationUs: 30_000_000,
        videoCodec: 'hvc1-alpha' })?.videoCodec).toBe('hvc1-alpha');
    expect(parseMp4Artifact({ ...base, kind: 'mp4', width: 1280, height: 720, fps: 30, frames: 900, durationUs: 29_999_999, videoCodec: 'avc1' })).toBeNull();
    expect(parseMp4Artifact({ ...base, kind: 'mp4', width: 1280, height: 720, fps: 30, frames: 900, durationUs: 30_000_000, videoCodec: 'avc1',
        audioCodec: 'mp4a' })).toBeNull();
    expect(parseMp4Artifact({ ...base, kind: 'mp4', size: EDITOR_MEDIA_LIMITS.mp4ArtifactBytes + 1, width: 1, height: 1, fps: 30, frames: 1,
        durationUs: 1, videoCodec: 'avc1' })).toBeNull();
    expect(parseMediaInfo({ ok: true, duration: 2, hasVideo: true, hasAudio: false, width: 640, height: 480,
        transform: [1, 0, 0, 1, 0, 0], nominalFrameRate: 0, videoCodec: 'avc1', videoStartUs: 0, videoDurationUs: 2_000_000 }))
        .toEqual({ durationUs: 2_000_000, hasVideo: true, hasAudio: false, width: 640, height: 480,
            preferredTransform: [1, 0, 0, 1, 0, 0], videoCodec: 'avc1', videoStartUs: 0, videoDurationUs: 2_000_000 });
});
