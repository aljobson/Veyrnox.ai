import type { EngineContext } from './shared';
import type { Capture, CaptureChunk } from './takeShared';
export type Permission = 'Undetermined' | 'Denied' | 'Granted';
type Result = { status: 'success' } | { status: 'error'; message: string };
export type AudioReady = { buffer: { getChannelData(channel: number): Float32Array }; when: number; numFrames: number };
export interface NativeRecorder {
    onAudioReady(options: { sampleRate: number; bufferLength: number; channelCount: number }, callback: (event: AudioReady) => void): Result;
    onError(callback: (event: { message: string }) => void): void;
    clearOnAudioReady(): void; clearOnError(): void;
    start(): Promise<Result>; stop(): Promise<unknown>;
}
export interface NativeAudio {
    AudioRecorder: new () => NativeRecorder;
    AudioManager: {
        checkRecordingPermissions(): Promise<Permission>; requestRecordingPermissions(): Promise<Permission>;
        setSystemOptions(options: { ios: { category: 'playAndRecord' | 'playback'; options: ('defaultToSpeaker')[] } }): void;
        addSystemEventListener(name: 'routeChange', callback: (event: { reason: string }) => void): { remove(): void };
    };
}
export const loadNativeAudio = (): NativeAudio => require('react-native-audio-api');
export async function requestTakePermission(native = loadNativeAudio()): Promise<boolean> {
    const status = await native.AudioManager.checkRecordingPermissions();
    return status === 'Granted' || (status === 'Undetermined' && await native.AudioManager.requestRecordingPermissions() === 'Granted');
}
export function takeAudioSession(armed: boolean, native = loadNativeAudio()) {
    // AudioManager has no options getter. Restore the editor's playback defaults on disarm.
    native.AudioManager.setSystemOptions({ ios: { category: armed ? 'playAndRecord' : 'playback', options: armed ? ['defaultToSpeaker'] : [] } });
}
export async function openNativeCapture(context: EngineContext, { onEnded = () => {}, native = loadNativeAudio() }: { onEnded?: () => void; native?: NativeAudio } = {}): Promise<Capture> {
    const recorder = new native.AudioRecorder(), listeners = new Set<(c: CaptureChunk) => void>();
    let anchor: number | undefined, ended = false, closed = false, capturedFrame = -Infinity;
    const lost = () => { if (!closed && !ended) { ended = true; onEnded(); } };
    recorder.onError(lost);
    const route = native.AudioManager.addSystemEventListener('routeChange', event => {
        if (['OldDeviceUnavailable', 'NoSuitableRouteForCategory'].includes(event.reason)) lost();
    });
    const close = async () => {
        if (closed) return; closed = true; listeners.clear(); route.remove();
        recorder.clearOnAudioReady(); recorder.clearOnError(); await recorder.stop();
    };
    try {
        const ready = recorder.onAudioReady({ sampleRate: context.sampleRate, channelCount: 1, bufferLength: 1024 }, event => {
            if (closed || ended) return;
            // `when` is recorder-relative. Anchor it once to the context timeline. Calibration
            // absorbs the residual constant callback/delivery offset; never re-anchor mid-take.
            anchor ??= context.currentTime - event.when - event.numFrames / context.sampleRate;
            const chunk = { frame: Math.round((anchor + event.when) * context.sampleRate), samples: event.buffer.getChannelData(0).slice(0, event.numFrames) };
            capturedFrame = Math.max(capturedFrame, chunk.frame + chunk.samples.length);
            listeners.forEach(fn => fn(chunk));
        });
        if (ready.status === 'error') throw new Error(ready.message);
        const started = await recorder.start();
        if (started.status === 'error') throw new Error(started.message);
        return { context, deviceId: 'default', get ended() { return ended || closed; }, get capturedFrame() { return capturedFrame; },
            subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }, close };
    } catch (error) { await close(); throw error; }
}
export function drainNativeCapture(capture: Capture, end: number, rtt: number, timeoutMs = 1250): Promise<boolean> {
    return new Promise(resolve => {
        const target = Math.round((end + rtt) * capture.context.sampleRate);
        let latest = capture.capturedFrame ?? -Infinity, done = false;
        let off = () => {}, timer: ReturnType<typeof setTimeout>, poll: ReturnType<typeof setInterval>;
        const finish = (result: boolean) => { if (done) return; done = true; off(); clearTimeout(timer); clearInterval(poll); resolve(result); };
        const check = () => {
            if (latest >= target) finish(true);
            else if (capture.ended || capture.context.state !== 'running') finish(false);
        };
        off = capture.subscribe(chunk => { latest = chunk.frame + chunk.samples.length; check(); });
        timer = setTimeout(() => finish(false), timeoutMs); poll = setInterval(check, 20); check();
    });
}
