import { createEditorMediaClient } from '../src/lib/editorMedia';
import { frameTimestampUs, type FrameDescriptor } from '../src/lib/editorMedia/protocol';
import type { NativeEditorMediaModule, NativeProgressEvent } from '../src/lib/editorMedia/native';

function nativeHarness() {
    let progress: ((event: NativeProgressEvent) => void) | undefined;
    const native: NativeEditorMediaModule = {
        capabilities: jest.fn(async () => ({ ok: true, available: true, platform: 'ios', protocolVersion: 1, operations: {} })), setOwner: jest.fn(async () => {}),
        setProjectGeneration: jest.fn(async () => {}), inspect: jest.fn(async () => ({})), sampleFrames: jest.fn(), decodePcm: jest.fn(),
        mixAudio: jest.fn(async () => ({})),
        beginEncode: jest.fn(async () => ({ ok: true, sessionId: 'session-1' })), appendFrameBatch: jest.fn(async () => ({ ok: true })),
        finishEncode: jest.fn(async () => ({ ok: true, artifactId: 'mp4-1', uri: 'file:///cache/mp4-1.mp4', kind: 'mp4', size: 4096, width: 1280, height: 720,
            fps: 30, frames: 1, durationUs: 33333, videoCodec: 'avc1', audioCodec: 'mp4a', audioSampleRate: 48000, audioChannels: 2 })),
        cancel: jest.fn(), cancelProject: jest.fn(async () => {}), release: jest.fn(async () => {}),
        addListener: jest.fn((_event, listener) => { progress = listener; return { remove: jest.fn() }; }),
    };
    return { native, emit: (event: NativeProgressEvent) => progress?.(event) };
}
const encode = { width: 1280, height: 720, fps: 30, videoBitRate: 6_000_000 };
const frame = (index: number): FrameDescriptor => ({ version: 1, uri: `file:///cache/frame-${index}.rgba`, index, timestampUs: frameTimestampUs(index, 30), byteLength: 1280 * 720 * 4,
    width: 1280, height: 720, stride: 5120, pixelFormat: 'rgba8', colorSpace: 'srgb' });

test('begin, bounded append and finish preserve the versioned session contract', async () => {
    const { native } = nativeHarness(), client = createEditorMediaClient(native); await client.setOwner('account-1'); await client.setProjectGeneration('project-1', 4);
    const begun = await client.beginEncode('project-1', { ...encode, audioBitRate: 192_000, audioArtifactId: 'vx-pcm-1' }); expect(begun.ok).toBe(true); if (!begun.ok) return;
    expect(begun.value.audioArtifactId).toBe('vx-pcm-1'); expect(native.beginEncode).toHaveBeenCalledWith(expect.any(String), 'project-1', expect.any(String),
        expect.any(String), expect.objectContaining({ audioArtifactId: 'vx-pcm-1' }));
    expect(await client.release('project-1', 'vx-pcm-1')).toEqual({ ok: false, code: 'busy' }); expect(native.release).not.toHaveBeenCalled();
    const appended = await client.appendFrameBatch(begun.value, [frame(0)]); expect(appended).toMatchObject({ ok: true, value: { nextIndex: 1 } });
    if (!appended.ok) return; expect(await client.finishEncode(appended.value)).toMatchObject({ ok: true, value: { videoCodec: 'avc1', frames: 1 } });
    expect(native.finishEncode).toHaveBeenLastCalledWith(expect.any(String), 'project-1', expect.any(String), expect.any(String), 'session-1', null);
    expect(await client.release('project-1', 'vx-pcm-1')).toEqual({ ok: true, value: null }); client.close();
});

test('HEVC is bound at begin and the finished artifact must report hvc1', async () => {
    const { native } = nativeHarness();
    jest.mocked(native.finishEncode).mockResolvedValueOnce({ ok: true, artifactId: 'mp4-hevc', uri: 'file:///cache/mp4-hevc.mp4', kind: 'mp4', size: 4096,
        width: 1280, height: 720, fps: 30, frames: 1, durationUs: 33333, videoCodec: 'hvc1' });
    const client = createEditorMediaClient(native); await client.setOwner('account-1');
    const begun = await client.beginEncode('project-1', { ...encode, codec: 'hevc' });
    expect(begun).toMatchObject({ ok: true, value: { codec: 'hevc' } });
    if (!begun.ok) return;
    expect(await client.finishEncode(begun.value)).toMatchObject({ ok: true, value: { videoCodec: 'hvc1' } });
    client.close();
});

test('finished output audio must match whether audio was bound at begin', async () => {
    const { native } = nativeHarness(), client = createEditorMediaClient(native); await client.setOwner('account-1');
    const silent = await client.beginEncode('project-1', encode); if (!silent.ok) throw Error('begin failed');
    expect(await client.finishEncode(silent.value)).toEqual({ ok: false, code: 'write-failed' });
    jest.mocked(native.finishEncode).mockResolvedValueOnce({ ok: true, artifactId: 'mp4-2', uri: 'file:///cache/mp4-2.mp4', kind: 'mp4', size: 4096,
        width: 1280, height: 720, fps: 30, frames: 1, durationUs: 33333, videoCodec: 'avc1' });
    const withAudio = await client.beginEncode('project-1', { ...encode, audioArtifactId: 'vx-pcm-2' }); if (!withAudio.ok) throw Error('begin failed');
    expect(await client.finishEncode(withAudio.value)).toEqual({ ok: false, code: 'write-failed' }); client.close();
});

test('progress is owner-scoped, stage-ordered and globally monotonic', async () => {
    const harness = nativeHarness(); let finish!: (value: Record<string, unknown>) => void;
    harness.native.beginEncode = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const client = createEditorMediaClient(harness.native); await client.setOwner('account-1'); const seen: number[] = [];
    const pending = client.beginEncode('project-1', encode, progress => seen.push(progress.value)); await Promise.resolve();
    const [account, project, owner, token] = jest.mocked(harness.native.beginEncode).mock.calls[0];
    harness.emit({ account, project, owner, token, stage: 'preparing', value: .1 });
    harness.emit({ account, project, owner: 'foreign', token, stage: 'preparing', value: .2 });
    harness.emit({ account, project, owner, token, stage: 'encoding', value: .5 });
    harness.emit({ account, project, owner, token, stage: 'preparing', value: .7 });
    harness.emit({ account, project, owner, token, stage: 'finishing', value: .4 });
    expect(seen).toEqual([.1, .5]); finish({ ok: true, sessionId: 'session-1' }); expect((await pending).ok).toBe(true); client.close();
});

test('account switch cancels and suppresses a late successful result', async () => {
    const harness = nativeHarness(); let finish!: (value: Record<string, unknown>) => void;
    harness.native.sampleFrames = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const client = createEditorMediaClient(harness.native); await client.setOwner('account-1');
    const pending = client.sampleFrames('project-1', { uri: 'file:///documents/input.mp4', fromSeconds: 0, toSeconds: 1, maxFrames: 1 }); await Promise.resolve();
    await client.setOwner('account-2'); finish({ ok: true, artifactId: 'foreign', uri: 'file:///cache/foreign', kind: 'frames', size: 1, width: 128, height: 72, stride: 512,
        pixelFormat: 'rgba8', colorSpace: 'srgb', count: 1, timestampsUs: [0], preferredTransform: [1, 0, 0, 1, 0, 0] });
    expect(await pending).toEqual({ ok: false, code: 'cancelled' }); expect(harness.native.cancel).toHaveBeenCalledTimes(1); client.close();
    expect(harness.native.release).toHaveBeenCalledWith('account-1', 'project-1', 'foreign');
});

test('project cancellation fences an open encode and purges its native scope', async () => {
    const { native } = nativeHarness(), client = createEditorMediaClient(native); await client.setOwner('account-1');
    const begun = await client.beginEncode('project-1', { ...encode, audioArtifactId: 'vx-pcm-cancel' }); if (!begun.ok) throw Error('begin failed');
    expect(await client.release('project-1', 'vx-pcm-cancel')).toEqual({ ok: false, code: 'busy' });
    await client.cancelProject('project-1');
    expect(await client.appendFrameBatch(begun.value, [frame(0)])).toEqual({ ok: false, code: 'cancelled' });
    expect(native.cancelProject).toHaveBeenCalledWith('account-1', 'project-1');
    expect(await client.release('project-1', 'vx-pcm-cancel')).toEqual({ ok: true, value: null }); client.close();
});

test('native idle-timeout cancellation terminates the JS session and a retry can begin', async () => {
    const { native } = nativeHarness(); jest.mocked(native.appendFrameBatch).mockResolvedValueOnce({ ok: false, code: 'cancelled', reason: 'idle-timeout' });
    const client = createEditorMediaClient(native); await client.setOwner('account-1'); const begun = await client.beginEncode('project-1', encode);
    if (!begun.ok) throw Error('begin failed'); expect(await client.appendFrameBatch(begun.value, [frame(0)])).toMatchObject({ ok: false, code: 'cancelled' });
    expect(await client.appendFrameBatch(begun.value, [frame(0)])).toEqual({ ok: false, code: 'cancelled' });
    expect((await client.beginEncode('project-1', encode)).ok).toBe(true); client.close();
});

test('abandoned encode expires locally so bound PCM can be released', async () => {
    jest.useFakeTimers();
    try {
        const harness = nativeHarness(), progress: number[] = [], client = createEditorMediaClient(harness.native); await client.setOwner('account-1');
        const begun = await client.beginEncode('project-1', { ...encode, audioArtifactId: 'vx-pcm-idle' }, event => progress.push(event.value));
        if (!begun.ok) throw Error('begin failed');
        expect(await client.release('project-1', 'vx-pcm-idle')).toEqual({ ok: false, code: 'busy' });
        jest.advanceTimersByTime(30_001);
        const [account, project, owner, token] = jest.mocked(harness.native.beginEncode).mock.calls[0];
        harness.emit({ account, project, owner, token, stage: 'encoding', value: .5 });
        expect(progress).toEqual([]);
        expect(await client.release('project-1', 'vx-pcm-idle')).toEqual({ ok: true, value: null });
        expect(harness.native.release).toHaveBeenCalledWith('account-1', 'project-1', 'vx-pcm-idle');
        expect(await client.appendFrameBatch(begun.value, [frame(0)])).toEqual({ ok: false, code: 'cancelled' });
        expect(await client.finishEncode(begun.value)).toEqual({ ok: false, code: 'cancelled' });
        expect(harness.native.appendFrameBatch).not.toHaveBeenCalled(); expect(harness.native.finishEncode).not.toHaveBeenCalled(); client.close();
    } finally { jest.useRealTimers(); }
});

test('successful append resets the local idle timeout', async () => {
    jest.useFakeTimers();
    try {
        const { native } = nativeHarness(), client = createEditorMediaClient(native); await client.setOwner('account-1');
        const begun = await client.beginEncode('project-1', { ...encode, audioArtifactId: 'vx-pcm-active' }); if (!begun.ok) throw Error('begin failed');
        jest.advanceTimersByTime(20_000); const appended = await client.appendFrameBatch(begun.value, [frame(0)]); if (!appended.ok) throw Error('append failed');
        jest.advanceTimersByTime(20_000);
        expect(await client.release('project-1', 'vx-pcm-active')).toEqual({ ok: false, code: 'busy' });
        jest.advanceTimersByTime(10_001);
        expect(await client.release('project-1', 'vx-pcm-active')).toEqual({ ok: true, value: null });
        expect(await client.finishEncode(appended.value)).toEqual({ ok: false, code: 'cancelled' }); client.close();
    } finally { jest.useRealTimers(); }
});

test('an in-flight append suspends idle expiry until native work settles', async () => {
    jest.useFakeTimers();
    try {
        const { native } = nativeHarness(); let settleAppend!: (value: Record<string, unknown>) => void;
        native.appendFrameBatch = jest.fn(() => new Promise(resolve => { settleAppend = resolve; }));
        const client = createEditorMediaClient(native); await client.setOwner('account-1');
        const begun = await client.beginEncode('project-1', { ...encode, audioArtifactId: 'vx-pcm-slow' }); if (!begun.ok) throw Error('begin failed');
        jest.advanceTimersByTime(29_000);
        const pending = client.appendFrameBatch(begun.value, [frame(0)]);
        jest.advanceTimersByTime(31_000);
        expect(await client.release('project-1', 'vx-pcm-slow')).toEqual({ ok: false, code: 'busy' });
        settleAppend({ ok: true }); const appended = await pending; expect(appended).toMatchObject({ ok: true, value: { nextIndex: 1 } });
        jest.advanceTimersByTime(30_001);
        expect(await client.release('project-1', 'vx-pcm-slow')).toEqual({ ok: true, value: null }); client.close();
    } finally { jest.useRealTimers(); }
});

test.each(['cancelled', 'disk-full', 'write-failed'] as const)('%s append failure terminally fences the encode session', async code => {
    const { native } = nativeHarness(); jest.mocked(native.appendFrameBatch).mockResolvedValueOnce({ ok: false, code });
    const client = createEditorMediaClient(native); await client.setOwner('account-1'); const begun = await client.beginEncode('project-1', encode);
    if (!begun.ok) throw Error('begin failed');
    expect(await client.appendFrameBatch(begun.value, [frame(0)])).toEqual({ ok: false, code });
    expect(await client.appendFrameBatch(begun.value, [frame(0)])).toEqual({ ok: false, code: 'cancelled' });
    expect(await client.finishEncode(begun.value)).toEqual({ ok: false, code: 'cancelled' });
    expect(native.appendFrameBatch).toHaveBeenCalledTimes(1); expect(native.finishEncode).not.toHaveBeenCalled(); client.close();
});

test('malformed append success is a terminal write failure', async () => {
    const { native } = nativeHarness(); jest.mocked(native.appendFrameBatch).mockResolvedValueOnce({});
    const client = createEditorMediaClient(native); await client.setOwner('account-1'); const begun = await client.beginEncode('project-1', encode);
    if (!begun.ok) throw Error('begin failed');
    expect(await client.appendFrameBatch(begun.value, [frame(0)])).toEqual({ ok: false, code: 'write-failed' });
    expect(await client.finishEncode(begun.value)).toEqual({ ok: false, code: 'cancelled' }); client.close();
});

test('fatal append rejection terminally fences the encode session', async () => {
    const { native } = nativeHarness(); jest.mocked(native.appendFrameBatch).mockRejectedValueOnce({ code: 'disk-full', reason: 'cache-quota' });
    const client = createEditorMediaClient(native); await client.setOwner('account-1'); const begun = await client.beginEncode('project-1', encode);
    if (!begun.ok) throw Error('begin failed');
    expect(await client.appendFrameBatch(begun.value, [frame(0)])).toEqual({ ok: false, code: 'disk-full', reason: 'cache-quota' });
    expect(await client.finishEncode(begun.value)).toEqual({ ok: false, code: 'cancelled' }); expect(native.finishEncode).not.toHaveBeenCalled(); client.close();
});

test('same-owner calls join the native fence and generation bumps fence active work', async () => {
    const { native } = nativeHarness(); let settle!: () => void;
    native.setOwner = jest.fn(() => new Promise<void>(resolve => { settle = resolve; }));
    const client = createEditorMediaClient(native), first = client.setOwner('account-1'), second = client.setOwner('account-1');
    expect(native.setOwner).toHaveBeenCalledTimes(1); let joined = false; second.then(() => { joined = true; }); await Promise.resolve(); expect(joined).toBe(false);
    settle(); await Promise.all([first, second]); expect(joined).toBe(true);
    expect(await client.bumpProjectGeneration('project-1')).toBe(1); expect(await client.bumpProjectGeneration('project-1')).toBe(2);
    expect(native.setProjectGeneration).toHaveBeenLastCalledWith('account-1', 'project-1', 2); client.close();
});

test('a fresh signed-out client adopts the native lease before null becomes idempotent', async () => {
    const { native } = nativeHarness(), client = createEditorMediaClient(native);
    await client.setOwner(null); await client.setOwner(null);
    expect(native.setOwner).toHaveBeenCalledTimes(1);
    expect(native.setOwner).toHaveBeenCalledWith(null, expect.stringMatching(/^editor-media-/), 1); client.close();
});

test('failed native adoption propagates and remains retryable at a higher epoch', async () => {
    const { native } = nativeHarness(); jest.mocked(native.setOwner).mockRejectedValueOnce(new Error('native fence failed'));
    const client = createEditorMediaClient(native); await expect(client.setOwner('account-1')).rejects.toThrow('native fence failed');
    await client.setOwner('account-1'); expect(native.setOwner).toHaveBeenCalledTimes(2);
    expect(jest.mocked(native.setOwner).mock.calls.map(call => call[2])).toEqual([1, 2]); client.close();
});

test('a stale adoption success cannot mask a newer adoption failure', async () => {
    const { native } = nativeHarness(); let settleFirst!: () => void;
    jest.mocked(native.setOwner).mockImplementationOnce(() => new Promise<void>(resolve => { settleFirst = resolve; }))
        .mockRejectedValueOnce(new Error('new adoption failed'));
    const client = createEditorMediaClient(native), first = client.setOwner('account-1'), second = client.setOwner('account-2');
    settleFirst(); await first; await expect(second).rejects.toThrow('new adoption failed'); await client.setOwner('account-2');
    expect(jest.mocked(native.setOwner).mock.calls.map(call => call[2])).toEqual([1, 2, 3]); client.close();
});
