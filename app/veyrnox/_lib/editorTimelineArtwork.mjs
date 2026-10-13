import { sourceFrame } from './editorSpeed.mjs';

export const TIMELINE_ARTWORK_LIMITS = Object.freeze({ thumbnails: 12, waveformBins: 240, sourcePeaks: 2048, concurrentJobs: 2 });
const countFor = (width, spacing, maximum) => Math.min(maximum, Math.max(1, Math.ceil(Math.max(1, Number.isFinite(width) ? width : 240) / spacing)));
const boundedFrame = (media, clip, offset) => ['image', 'graphic'].includes(media.kind) ? 0 : Math.max(0, Math.min(media.frames - 1, sourceFrame(clip, offset)));

/** Filmstrip positions use the same source mapping as playback and export, never timeline placement. */
export function timelineThumbnailFrames(media, clip, width = 240) {
    const count = countFor(width, 80, TIMELINE_ARTWORK_LIMITS.thumbnails);
    return Array.from({ length: count }, (_, i) => boundedFrame(media, clip, Math.min(clip.len - 1, (i + 0.5) / count * clip.len)));
}

/** Peak bins are an overview of source sound; project each displayed interval through the actual edit. */
export function timelineWaveform(peaks, media, clip, width = 240) {
    if (!peaks?.length || !media.hasAudio || clip.freezeFrame !== undefined) return [];
    const count = countFor(width, 2, TIMELINE_ARTWORK_LIMITS.waveformBins);
    return Array.from({ length: count }, (_, i) => {
        const a = boundedFrame(media, clip, i / count * clip.len);
        const b = boundedFrame(media, clip, Math.min(clip.len - 1, (i + 1) / count * clip.len - 1e-7));
        const aBin = a / media.frames * peaks.length, bBin = b / media.frames * peaks.length;
        // Reversed intervals include their first sample, but exclude the next interval's first sample.
        const first = b < a ? Math.min(Math.floor(aBin), Math.ceil(bBin)) : Math.floor(aBin);
        const last = Math.min(peaks.length - 1, Math.floor(b < a ? aBin : bBin));
        let peak = 0;
        for (let j = first; j <= last; j++) peak = Math.max(peak, peaks[j] || 0);
        return peak;
    });
}

/** Keep bin rendering bounded even when the source analysis contains a more detailed waveform. */
export function mediaWaveform(peaks, media) {
    return timelineWaveform(peaks, media, { in: 0, len: media.frames }, 240);
}

/** Bound concurrent analysis jobs and skip queued work after its last viewer has gone away. */
export function createArtworkQueue(maximum = TIMELINE_ARTWORK_LIMITS.concurrentJobs) {
    let running = 0;
    const pending = [];
    function drain() {
        while (running < maximum && pending.length) {
            const job = pending.shift();
            if (!job.isActive()) { job.reject(Object.assign(new Error('Artwork cancelled.'), { name: 'AbortError' })); continue; }
            running++;
            Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => { running--; drain(); });
        }
    }
    return (work, isActive = () => true) => new Promise((resolve, reject) => { pending.push({ work, isActive, resolve, reject }); queueMicrotask(drain); });
}
