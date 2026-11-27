import { File } from 'expo-file-system';
import { sourceFrame } from '../../../../app/veyrnox/_lib/editorSpeed.mjs';
import { editorMedia } from './editorMedia';
import type { Clip, Timeline } from './nativeEditorModel';

const SAMPLE_RATE = 48_000;
const CHUNK_SECONDS = 30;
export const TIMELINE_WAVEFORM_BINS = 64;

export type TimelineWaveformFiles = { bytes(uri: string): Promise<Uint8Array> };
export type TimelineWaveformMedia = Pick<typeof editorMedia, 'decodePcm' | 'release'>;

const defaultFiles: TimelineWaveformFiles = { bytes: uri => new File(uri).bytes() };

export function pcmPeakBins(bytes: Uint8Array, bins: number): number[] {
    if (!Number.isSafeInteger(bins) || bins < 1 || bins > 240 || !bytes.byteLength || bytes.byteLength % 4) return [];
    const samples = bytes.byteLength / 4, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const peaks = Array.from({ length: Math.min(bins, samples) }, () => 0);
    for (let bin = 0; bin < peaks.length; bin++) {
        const from = Math.floor(bin * samples / peaks.length), to = Math.max(from + 1, Math.floor((bin + 1) * samples / peaks.length));
        let peak = 0;
        for (let sample = from; sample < to; sample++) {
            const value = view.getFloat32(sample * 4, true);
            if (!Number.isFinite(value)) return [];
            peak = Math.max(peak, Math.abs(value));
        }
        peaks[bin] = peak;
    }
    return peaks;
}

export function normalizePeakBins(peaks: readonly number[]): number[] {
    const maximum = Math.max(0, ...peaks.filter(Number.isFinite));
    if (!(maximum > 0)) return peaks.map(() => 0);
    return peaks.map(value => Math.max(0, Math.min(1, Number.isFinite(value) ? value / maximum : 0)));
}

export function waveformSourceRange(clip: Clip, fps: number) {
    if (!Number.isFinite(fps) || fps <= 0 || clip.len < 1 || clip.freezeFrame !== undefined) return null;
    const first = sourceFrame(clip, 0), last = sourceFrame(clip, Math.max(0, clip.len - 1));
    const fromSeconds = Math.max(0, Math.min(first, last) / fps);
    const toSeconds = Math.max(fromSeconds + 1 / fps, (Math.max(first, last) + 1) / fps);
    return { fromSeconds, toSeconds };
}

export async function decodeTimelineWaveform(project: string, uri: string, clip: Clip, fps: number, signal?: AbortSignal,
    dependencies: { media?: TimelineWaveformMedia; files?: TimelineWaveformFiles } = {}): Promise<number[]> {
    const range = waveformSourceRange(clip, fps);
    if (!range || signal?.aborted) return [];
    const media = dependencies.media ?? editorMedia, files = dependencies.files ?? defaultFiles;
    const duration = range.toSeconds - range.fromSeconds, raw: number[] = [];
    for (let from = range.fromSeconds; from < range.toSeconds && !signal?.aborted; from += CHUNK_SECONDS) {
        const to = Math.min(range.toSeconds, from + CHUNK_SECONDS);
        const bins = Math.max(1, Math.round(TIMELINE_WAVEFORM_BINS * (to - from) / duration));
        const decoded = await media.decodePcm(project, { uri, fromSeconds: from, toSeconds: to, sampleRate: SAMPLE_RATE, channels: 1, mixMode: 'web-average' }, undefined, signal);
        if (!decoded.ok) return [];
        try {
            const bytes = await files.bytes(decoded.value.uri);
            if (signal?.aborted || bytes.byteLength !== decoded.value.size) return [];
            const peaks = pcmPeakBins(bytes, bins);
            if (!peaks.length) return [];
            raw.push(...peaks);
        } finally {
            await media.release(project, decoded.value.artifactId);
        }
    }
    return signal?.aborted ? [] : normalizePeakBins(raw.slice(0, TIMELINE_WAVEFORM_BINS));
}

export function waveformClipInputs(timeline: Timeline, localMediaUris: Readonly<Record<string, string>>) {
    return [...timeline.video, ...timeline.audio].flatMap(clip => {
        const media = timeline.media[clip.mediaId ?? ''], uri = localMediaUris[media?.id ?? ''];
        return media?.hasAudio && uri && clip.freezeFrame === undefined ? [{ clip, uri }] : [];
    });
}
