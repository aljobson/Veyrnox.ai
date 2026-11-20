import type { PlaybackContext } from './takePlayback';
import { calibrationFrames, capturedSamples, detectClickOnsets, matchCalibration, writeLatency, type Capture, type CaptureChunk, type SyncStorage } from './takeShared';
export async function calibrateTake(capture: Capture, storage: SyncStorage, signal: AbortSignal) {
    const context = capture.context as PlaybackContext, sr = context.sampleRate, start = context.currentTime + 0.1;
    const frames = calibrationFrames(sr, start), end = frames[frames.length - 1] / sr + 0.5;
    const chunks: CaptureChunk[] = [], sources: ReturnType<PlaybackContext['createBufferSource']>[] = [];
    const off = capture.subscribe(chunk => chunks.push(chunk));
    try {
        for (const frame of frames) {
            const buffer = context.createBuffer(1, Math.round(sr * 0.003), sr), samples = buffer.getChannelData(0);
            for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * Math.sin(2 * Math.PI * 2000 * i / sr);
            const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start(frame / sr); sources.push(source);
        }
        await new Promise<void>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout>, poll: ReturnType<typeof setInterval>;
            const finish = (error?: Error) => { clearTimeout(timer); clearInterval(poll); signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve(); };
            const cancel = () => finish(new Error('calibration_cancelled'));
            timer = setTimeout(() => finish(new Error('capture_timeout')), 10_000);
            poll = setInterval(() => {
                if (capture.ended) finish(new Error('input_disconnected'));
                else if ((capture.capturedFrame ?? -Infinity) >= end * sr) finish();
            }, 20);
            signal.addEventListener('abort', cancel); if (signal.aborted) cancel();
        });
        const first = Math.floor(start * sr), relative = frames.map(f => f - first);
        const samples = capturedSamples(chunks, first, Math.ceil(end * sr));
        const result = matchCalibration(detectClickOnsets(samples, sr, relative[0]), relative, sr);
        if (!result.ok || result.ms === undefined || !writeLatency(capture.deviceId, result.ms, storage)) throw new Error('calibration_unclear');
        return result.ms;
    } finally { off(); for (const source of sources) { try { source.stop(); } catch { /* Ended clicks. */ } source.disconnect(); } }
}
