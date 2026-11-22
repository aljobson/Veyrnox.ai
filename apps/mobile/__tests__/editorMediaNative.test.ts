import { createEditorMediaClient } from '../src/lib/editorMedia';
import type { NativeEditorMediaModule, NativeProgressEvent } from '../src/lib/editorMedia/native';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fakeNative(overrides: Partial<NativeEditorMediaModule> = {}) {
    let progress: ((event: NativeProgressEvent) => void) | undefined;
    const native: NativeEditorMediaModule = {
        capabilities: jest.fn(async () => ({ ok: true, available: true, platform: 'ios', protocolVersion: 1, operations: {} })),
        setOwner: jest.fn(async () => {}), setProjectGeneration: jest.fn(async () => {}), inspect: jest.fn(async () => ({})),
        sampleFrames: jest.fn(async () => ({ ok: true, artifactId: 'frames-1', uri: 'file:///cache/frames-1.bin', kind: 'frames', size: 2048, width: 128, height: 72,
            stride: 512, pixelFormat: 'rgba8', colorSpace: 'srgb', count: 2, timestampsUs: [0, 33333], preferredTransform: [1, 0, 0, 1, 0, 0] })),
        decodePcm: jest.fn(async () => ({ ok: true, artifactId: 'pcm-1', uri: 'file:///cache/pcm-1.bin', kind: 'pcm', size: 384000, sampleRate: 48000, channels: 2,
            frames: 48000, encoding: 'f32le-interleaved' })),
        mixAudio: jest.fn(async () => ({})),
        beginEncode: jest.fn(async () => ({ ok: true, sessionId: 'session-1' })), appendFrameBatch: jest.fn(async () => ({ ok: true })),
        finishEncode: jest.fn(async () => ({ ok: true, artifactId: 'mp4-1', uri: 'file:///cache/mp4-1.mp4', kind: 'mp4', size: 4096, width: 1280, height: 720,
            fps: 30, frames: 1, durationUs: 33333, videoCodec: 'avc1' })),
        cancel: jest.fn(), cancelProject: jest.fn(async () => {}), release: jest.fn(async () => {}),
        addListener: jest.fn((_event, listener) => { progress = listener; return { remove: jest.fn() }; }), ...overrides,
    };
    return { native, emit: (event: NativeProgressEvent) => progress?.(event) };
}
const sample = { uri: 'file:///documents/veyrnox-editor-media/account/project/input.mp4', fromSeconds: 0, toSeconds: 1, maxFrames: 30 };

test('missing and Android-stub modules fail with stable capability and operation codes', async () => {
    const missing = createEditorMediaClient(null); await missing.setOwner('account-1');
    expect(await missing.capabilities()).toMatchObject({ available: false, platform: 'ios', protocolVersion: 1, reason: 'module-missing', operations: { inspect: false } });
    expect(await missing.sampleFrames('project-1', sample)).toEqual({ ok: false, code: 'module-missing' }); missing.close();
    const { native } = fakeNative({
        capabilities: jest.fn(async () => ({ ok: true, available: false, platform: 'android', protocolVersion: 1, reason: 'unsupported-platform', operations: {} })),
        sampleFrames: jest.fn(async () => ({ ok: false, code: 'unsupported-platform' })),
    });
    const android = createEditorMediaClient(native); await android.setOwner('account-1');
    expect(await android.capabilities()).toMatchObject({ available: false, platform: 'android', reason: 'unsupported-platform' });
    expect(await android.sampleFrames('project-1', sample)).toEqual({ ok: false, code: 'unsupported-platform' }); android.close();
    const oldBinary = createEditorMediaClient({ capabilities: jest.fn() } as unknown as NativeEditorMediaModule); await oldBinary.setOwner('account-1');
    expect(await oldBinary.sampleFrames('project-1', sample)).toEqual({ ok: false, code: 'module-missing' }); oldBinary.close();
});

test('valid native artifacts pass while malformed or oversized results fail closed', async () => {
    const good = fakeNative(), client = createEditorMediaClient(good.native); await client.setOwner('account-1');
    expect(await client.sampleFrames('project-1', sample)).toMatchObject({ ok: true, value: { artifactId: 'frames-1', count: 2 } });
    expect(await client.decodePcm('project-1', { uri: sample.uri, fromSeconds: 0, toSeconds: 1, sampleRate: 48000, channels: 2 }))
        .toMatchObject({ ok: true, value: { artifactId: 'pcm-1', frames: 48000 } }); client.close();
    const bad = fakeNative({ sampleFrames: jest.fn(async () => ({ artifactId: 'x', uri: 'https://outside.test/x', kind: 'frames', size: 1 })) });
    const rejected = createEditorMediaClient(bad.native); await rejected.setOwner('account-1');
    expect(await rejected.sampleFrames('project-1', sample)).toEqual({ ok: false, code: 'write-failed' }); rejected.close();
    const missingOk = fakeNative({ sampleFrames: jest.fn(async () => ({ artifactId: 'frames-1', uri: 'file:///cache/frames-1.bin', kind: 'frames', size: 2048,
        width: 128, height: 72, stride: 512, pixelFormat: 'rgba8', colorSpace: 'srgb', count: 1, timestampsUs: [0], preferredTransform: [1, 0, 0, 1, 0, 0] })) });
    const strict = createEditorMediaClient(missingOk.native); await strict.setOwner('account-1');
    expect(await strict.sampleFrames('project-1', sample)).toEqual({ ok: false, code: 'write-failed' }); strict.close();
});

test('frame resize mode is forwarded, echoed and fails closed against an old native binary', async () => {
    const good = fakeNative({ sampleFrames: jest.fn(async (_account, _project, _owner, _token, rawRequest) => { const request = rawRequest as { resizeMode?: string }; return ({ ok: true, artifactId: 'frames-fill',
        uri: 'file:///cache/frames-fill.bin', kind: 'frames', size: 2048, width: 128, height: 72, stride: 512, pixelFormat: 'rgba8', colorSpace: 'srgb', count: 1,
        timestampsUs: [0], preferredTransform: [1, 0, 0, 1, 0, 0], resizeMode: request.resizeMode }); }) });
    const client = createEditorMediaClient(good.native); await client.setOwner('account-1');
    expect(await client.sampleFrames('project-1', { ...sample, resizeMode: 'fill' })).toMatchObject({ ok: true, value: { resizeMode: 'fill' } });
    expect(good.native.sampleFrames).toHaveBeenCalledWith(expect.any(String), 'project-1', expect.any(String), expect.any(String), { ...sample, resizeMode: 'fill' }); client.close();

    const legacy = fakeNative(), strict = createEditorMediaClient(legacy.native); await strict.setOwner('account-1');
    expect(await strict.sampleFrames('project-1', { ...sample, resizeMode: 'fill' })).toEqual({ ok: false, code: 'write-failed' });
    expect(legacy.native.release).toHaveBeenCalledWith('account-1', 'project-1', 'frames-1'); strict.close();
});

test('all-frame sampling raises the bound to 1800 and requires the native echo', async () => {
    const exact = { ...sample, maxFrames: 1800, resizeMode: 'fill' as const, samplingMode: 'all' as const, maximumFrameRate: 60 as const };
    const good = fakeNative({ sampleFrames: jest.fn(async () => ({ ok: true, artifactId: 'frames-all', uri: 'file:///cache/frames-all.bin', kind: 'frames', size: 2048,
        width: 128, height: 72, stride: 512, pixelFormat: 'rgba8', colorSpace: 'srgb', count: 2, timestampsUs: [0, 16667],
        preferredTransform: [1, 0, 0, 1, 0, 0], resizeMode: 'fill', samplingMode: 'all', maximumFrameRate: 60 })) });
    const client = createEditorMediaClient(good.native); await client.setOwner('account-1');
    expect(await client.sampleFrames('project-1', exact)).toMatchObject({ ok: true, value: { samplingMode: 'all', maximumFrameRate: 60, count: 2 } });
    expect(good.native.sampleFrames).toHaveBeenCalledWith(expect.any(String), 'project-1', expect.any(String), expect.any(String), exact); client.close();

    const legacyNative = fakeNative(), legacy = createEditorMediaClient(legacyNative.native); await legacy.setOwner('account-1');
    expect(await legacy.sampleFrames('project-1', exact)).toEqual({ ok: false, code: 'write-failed' });
    expect(legacyNative.native.release).toHaveBeenCalledWith('account-1', 'project-1', 'frames-1'); legacy.close();
});

test('native exact sampling drops pre-trim frames and deterministically caps high-rate sources', () => {
    const source = readFileSync(resolve(__dirname, '../modules/editor-media/ios/EditorFrameSampler.swift'), 'utf8');
    expect(source).toContain('if seconds + 0.000_001 < request.fromSeconds || seconds >= request.toSeconds { continue }');
    expect(source).toContain('if seconds + 0.000_001 < nextMaximumFrameTime { continue }');
    expect(source).toContain('nextMaximumFrameTime = sampledSeconds + 1 / Double(maximumFrameRate)');
    expect(source).toContain('let sampledSeconds = request.samplingMode == "all" ? max(request.fromSeconds, seconds) : seconds');
});

test('web-average PCM requires mono, exact timing segments and releases malformed native artifacts', async () => {
    const request = { uri: sample.uri, fromSeconds: 1, toSeconds: 2, sampleRate: 48000 as const, channels: 1 as const, mixMode: 'web-average' as const };
    const artifact = { ok: true, artifactId: 'pcm-exact', uri: 'file:///cache/pcm-exact.bin', kind: 'pcm', size: 192000, sampleRate: 48000, channels: 1,
        frames: 48000, encoding: 'f32le-interleaved', mixMode: 'web-average', segments: [{ offsetFrames: 0, timestampUs: 1_000_000, frames: 24000 },
            { offsetFrames: 24000, timestampUs: 1_500_000, frames: 24000 }] };
    const good = fakeNative({ decodePcm: jest.fn(async () => artifact) }), client = createEditorMediaClient(good.native); await client.setOwner('account-1');
    expect(await client.decodePcm('project-1', request)).toMatchObject({ ok: true, value: { mixMode: 'web-average', segments: artifact.segments } });
    expect(good.native.decodePcm).toHaveBeenCalledWith(expect.any(String), 'project-1', expect.any(String), expect.any(String), request); client.close();

    const malformedNative = fakeNative({ decodePcm: jest.fn(async () => ({ ...artifact, segments: [{ offsetFrames: 1, timestampUs: 1_000_000, frames: 48000 }] })) });
    const malformed = createEditorMediaClient(malformedNative.native); await malformed.setOwner('account-1');
    expect(await malformed.decodePcm('project-1', request)).toEqual({ ok: false, code: 'write-failed' });
    expect(malformedNative.native.release).toHaveBeenCalledWith('account-1', 'project-1', 'pcm-exact'); malformed.close();

    const oldNative = fakeNative(), old = createEditorMediaClient(oldNative.native); await old.setOwner('account-1');
    expect(await old.decodePcm('project-1', request)).toEqual({ ok: false, code: 'write-failed' });
    expect(oldNative.native.release).toHaveBeenCalledWith('account-1', 'project-1', 'pcm-1'); old.close();
});

test('native web-average preserves multichannel order with an explicit discrete PCM layout', () => {
    const source = readFileSync(resolve(__dirname, '../modules/editor-media/ios/EditorPcmDecoder.swift'), 'utf8');
    expect(source).toContain('if webAverage && decodedChannels > 2');
    expect(source).toContain('kAudioChannelLayoutTag_DiscreteInOrder | UInt32(channels)');
    expect(source).toContain('outputSettings[AVChannelLayoutKey] = channelLayout');
    expect(source).toContain('Int(layout.channelCount) == channels');
    expect(source).toContain('sum += Double(source[frame * channels + channel])');
});

test('native web-average maps only a completed empty audio range to bounded zero loudness', () => {
    const source = readFileSync(resolve(__dirname, '../modules/editor-media/ios/EditorPcmDecoder.swift'), 'utf8');
    expect(source).toContain('guard reader.status == .completed else');
    expect(source).toContain('if frames == 0');
    expect(source).toContain('guard webAverage, request.fromSeconds <= 9_007_199_254.740_991 else');
    expect(source).toContain('handle.write(contentsOf: Data(count: outputLength))');
    expect(source).toContain('segments = [["offsetFrames": Int64(0), "timestampUs": timestampUs, "frames": silentFrames]]');
    expect(source.indexOf('guard reader.status == .completed else')).toBeLessThan(source.indexOf('if frames == 0'));
});

test('aborting a one-shot operation cancels its hidden native token', async () => {
    let resolve: ((value: Record<string, unknown>) => void) | undefined;
    const pending = fakeNative({ sampleFrames: jest.fn(() => new Promise<Record<string, unknown>>(value => { resolve = value; })) });
    const client = createEditorMediaClient(pending.native); await client.setOwner('account-1');
    const controller = new AbortController(); const result = client.sampleFrames('project-1', sample, undefined, controller.signal); controller.abort();
    resolve?.({ ok: false, code: 'cancelled' });
    await expect(result).resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(pending.native.cancel).toHaveBeenCalledWith('account-1', 'project-1', expect.any(String), expect.any(String)); client.close();
});

test('inspect validates native metadata and capabilities preserve operation flags', async () => {
    const { native } = fakeNative({
        capabilities: jest.fn(async () => ({ ok: true, available: true, platform: 'ios', protocolVersion: 1, operations: { inspect: true, sampleFrames: true } })),
        inspect: jest.fn(async () => ({ ok: true, duration: 30, hasVideo: true, hasAudio: true, width: 1280, height: 720,
            transform: [1, 0, 0, 1, 0, 0], nominalFrameRate: 30, videoCodec: 'avc1', videoStartUs: 0, videoDurationUs: 30_000_000,
            audioCodec: 'mp4a', audioStartUs: 0, audioDurationUs: 30_000_000 })),
    });
    const client = createEditorMediaClient(native); await client.setOwner('account-1');
    expect(await client.capabilities()).toMatchObject({ operations: { inspect: true, sampleFrames: true, decodePcm: false } });
    expect(await client.inspect('project-1', sample.uri)).toMatchObject({ ok: true, value: { durationUs: 30_000_000, width: 1280, hasAudio: true } });
    jest.mocked(native.inspect).mockResolvedValueOnce({ ok: true, duration: 30, hasVideo: true, hasAudio: true, width: 1280, height: 720 });
    expect(await client.inspect('project-1', sample.uri)).toEqual({ ok: false, code: 'write-failed' }); client.close();
});

test('owner updates are idempotent and release is scoped to valid project/artifact ids', async () => {
    const { native } = fakeNative(), client = createEditorMediaClient(native); await client.setOwner('account-1'); await client.setOwner('account-1');
    expect(native.setOwner).toHaveBeenCalledTimes(1); expect(await client.release('project-1', 'artifact-1')).toEqual({ ok: true, value: null });
    expect(native.setOwner).toHaveBeenCalledWith('account-1', expect.stringMatching(/^editor-media-/), 1);
    expect(native.release).toHaveBeenCalledWith('account-1', 'project-1', 'artifact-1');
    expect(await client.release('../project', 'artifact-1')).toEqual({ ok: false, code: 'invalid-input' }); client.close();
});

test('release normalizes native refusal to a stable result', async () => {
    const { native } = fakeNative({ release: jest.fn(async () => { throw { ok: false, code: 'disk-full', message: 'private path' }; }) });
    const client = createEditorMediaClient(native); await client.setOwner('account-1');
    expect(await client.release('project-1', 'artifact-1')).toEqual({ ok: false, code: 'disk-full' }); client.close();
});

test('quota refusal is typed and carries no native prose', async () => {
    const { native } = fakeNative({ sampleFrames: jest.fn(async () => ({ ok: false, code: 'disk-full', reason: 'cache-quota', message: 'private path' })) });
    const client = createEditorMediaClient(native); await client.setOwner('account-1');
    expect(await client.sampleFrames('project-1', sample)).toEqual({ ok: false, code: 'disk-full', reason: 'cache-quota' }); client.close();
});

test('Expo Promise rejection codes are normalized without exposing rejection prose', async () => {
    const { native } = fakeNative({ sampleFrames: jest.fn(async () => { throw { code: 'corrupt-media', reason: 'decode-failed', message: '/private/path' }; }) });
    const client = createEditorMediaClient(native); await client.setOwner('account-1');
    expect(await client.sampleFrames('project-1', sample)).toEqual({ ok: false, code: 'corrupt-media', reason: 'decode-failed' }); client.close();
});

test('bad JS input is refused before native work', async () => {
    const { native } = fakeNative(), client = createEditorMediaClient(native); await client.setOwner('account-1');
    expect(await client.sampleFrames('project-1', { ...sample, uri: 'file:///a/../secret' })).toEqual({ ok: false, code: 'invalid-input' });
    expect(native.sampleFrames).not.toHaveBeenCalled(); client.close();
});
