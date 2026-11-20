import { openNativeCapture, drainNativeCapture, requestTakePermission, takeAudioSession, type NativeAudio, type AudioReady } from '../src/lib/beatNative/nativeCapture';
import { fakeContext } from './beatNativeTakeFixtures';
function native() {
    let ready!: (e: AudioReady) => void, error!: () => void, route!: (e: { reason: string }) => void;
    const recorder = { onAudioReady: jest.fn((_o, cb) => { ready = cb; return { status: 'success' }; }), onError: (cb: () => void) => { error = cb; }, clearOnAudioReady: jest.fn(), clearOnError: jest.fn(), start: async () => ({ status: 'success' }), stop: jest.fn(async () => {}) };
    const manager = { checkRecordingPermissions: jest.fn(async () => 'Undetermined'), requestRecordingPermissions: jest.fn(async () => 'Granted'), setSystemOptions: jest.fn(), addSystemEventListener: (_n: string, cb: typeof route) => { route = cb; return { remove: jest.fn() }; } };
    return { api: { AudioRecorder: function () { return recorder; }, AudioManager: manager } as unknown as NativeAudio, manager, recorder,
        send: (when: number, length: number) => ready({ when, numFrames: length, buffer: { getChannelData: () => new Float32Array(length).fill(0.5) } }), error: () => error(), route: () => route({ reason: 'OldDeviceUnavailable' }) };
}
test('anchors once in context frames, drains to end+rtt, closes and disconnects once', async () => {
    const n = native(), { context } = fakeContext(), ended = jest.fn(); context.currentTime = 10;
    const input = await openNativeCapture(context, { native: n.api, onEnded: ended }); const chunks: any[] = []; input.subscribe(c => chunks.push(c));
    n.send(0, 100); context.currentTime = 10.7; n.send(0.1, 100);
    expect(chunks.map(c => c.frame)).toEqual([9900, 10000]);
    expect(n.recorder.onAudioReady.mock.calls[0][0]).toEqual({ sampleRate: 1000, channelCount: 1, bufferLength: 1024 });
    expect(await drainNativeCapture(input, 10, 0.1)).toBe(true);
    jest.useFakeTimers(); const draining = drainNativeCapture(input, 99, 0, 50); jest.advanceTimersByTime(50); expect(await draining).toBe(false); jest.useRealTimers();
    n.error(); n.route(); expect(ended).toHaveBeenCalledTimes(1); expect(input.ended).toBe(true);
    await input.close(); expect(n.recorder.stop).toHaveBeenCalledTimes(1);
});
test('denial is rechecked and only undetermined permission requests the prompt', async () => {
    const n = native(); expect(await requestTakePermission(n.api)).toBe(true);
    n.manager.checkRecordingPermissions.mockResolvedValue('Denied'); expect(await requestTakePermission(n.api)).toBe(false);
    n.manager.checkRecordingPermissions.mockResolvedValue('Granted'); expect(await requestTakePermission(n.api)).toBe(true);
    expect(n.manager.checkRecordingPermissions).toHaveBeenCalledTimes(3); expect(n.manager.requestRecordingPermissions).toHaveBeenCalledTimes(1);
    takeAudioSession(true, n.api); takeAudioSession(false, n.api);
    expect(n.manager.setSystemOptions.mock.calls).toEqual([[{ ios: { category: 'playAndRecord', options: ['defaultToSpeaker'] } }], [{ ios: { category: 'playback', options: [] } }]]);
});

test('idle jitter converges to the minimum offset and subscribers freeze the anchor', async () => {
    const n = native(), { context } = fakeContext();
    const input = await openNativeCapture(context, { native: n.api });
    // Buffer duration is 100 ms; callback jitter adds 40, 10, then 30 ms.
    context.currentTime = 10.14; n.send(0, 100);
    context.currentTime = 10.21; n.send(0.1, 100);
    context.currentTime = 10.33; n.send(0.2, 100);
    const frames: number[] = [], off = input.subscribe(c => frames.push(c.frame));
    const offCalibration = input.subscribe(() => {});
    context.currentTime = 10.4; n.send(0.3, 100); // Lower offset must not move an active timeline.
    context.currentTime = 10.56; n.send(0.4, 100);
    offCalibration();
    context.currentTime = 10.6; n.send(0.5, 100); // One remaining subscriber still freezes it.
    expect(frames).toEqual([10310, 10410, 10510]);
    off(); context.currentTime = 10.7; n.send(0.6, 100); // Idle estimation resumes.
    input.subscribe(c => frames.push(c.frame));
    context.currentTime = 10.84; n.send(0.7, 100);
    expect(frames.at(-1)).toBe(10700);
    expect(input.capturedFrame).toBe(10800);
    await input.close();
});
