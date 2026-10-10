// Browser timeline editor, slice 1 (ADR-0080): getting media into the timeline.
// Two sources, both read in the browser and neither uploaded: the user's own GENERATED assets (fetched from their signed link) and a LOCAL
// file picked from their computer. A local file never leaves the machine, so it needs no storage, scanning or moderation. Pure checks
// first (testable); `probeMedia` then asks the browser what it can really decode, since a file type is only a claim.
import { FPS } from './editorTimeline.mjs';

export const MEDIA_LIMITS = Object.freeze({
    videoBytes: 100 * 1024 * 1024, audioBytes: 20 * 1024 * 1024, maxSourceSeconds: 600, maxEdge: 4096,
});

const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'audio/ogg']);

/** Judge what a local file CLAIMS to be, before reading any of it. Returns { kind } or { error }. */
export function checkLocalFile(file) {
    if (!file || typeof file.size !== 'number' || typeof file.type !== 'string') return { error: 'Choose a video or audio file.' };
    const video = VIDEO_TYPES.has(file.type), audio = AUDIO_TYPES.has(file.type);
    if (!video && !audio) return { error: 'Choose an MP4, MOV or WebM video, or an MP3, WAV or M4A sound.' };
    if (!(file.size > 0)) return { error: 'That file is empty.' };
    if (video && file.size > MEDIA_LIMITS.videoBytes) return { error: 'Choose a video under 100 MiB.' };
    if (audio && file.size > MEDIA_LIMITS.audioBytes) return { error: 'Choose a sound under 20 MiB.' };
    return { kind: video ? 'video' : 'audio' };
}

/** Judge what the browser READ from the file. Pure, so the rules are tested without a browser. */
export function checkProbe(probe) {
    if (!probe || probe.error) return probe?.error || 'This file could not be read.';
    if (probe.kind === 'video') {
        if (!probe.canDecodeVideo) return 'This browser cannot decode that video. Try an H.264 MP4.';
        if (!(probe.width > 0 && probe.height > 0)) return 'That video has no picture size.';
        if (Math.max(probe.width, probe.height) > MEDIA_LIMITS.maxEdge) return `Choose a video up to ${MEDIA_LIMITS.maxEdge} pixels wide.`;
    } else if (!probe.canDecodeAudio) {
        return 'This browser cannot decode that sound. Try an MP3 or WAV.';
    }
    if (!(probe.seconds > 0)) return 'That file has no length.';
    if (probe.seconds > MEDIA_LIMITS.maxSourceSeconds) return 'Choose a file up to 10 minutes long. You can trim it after.';
    return null;
}

/** A media entry for the timeline from a probe result. Whole frames, rounded down so a clip never reads past the end. */
export function mediaFromProbe(id, name, probe) {
    return { id, kind: probe.kind, frames: Math.max(1, Math.floor(probe.seconds * FPS)), name, hasAudio: !!probe.hasAudio, width: probe.width || 0, height: probe.height || 0 };
}

/** Open the file with the pinned engine and report what it holds. Never throws: failures come back as { error }. */
export async function probeMedia(blob) {
    let input;
    try {
        const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
        input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const video = await input.getPrimaryVideoTrack();
        const audio = await input.getPrimaryAudioTrack();
        if (!video && !audio) return { error: 'There is no video or sound in that file.' };
        const canDecodeAudio = audio ? await audio.canDecode() : false;
        const out = {
            kind: video ? 'video' : 'audio', seconds: await input.computeDuration(), hasAudio: canDecodeAudio, canDecodeAudio,
            canDecodeVideo: video ? await video.canDecode() : false, width: 0, height: 0,
        };
        if (video) { out.width = await video.getDisplayWidth(); out.height = await video.getDisplayHeight(); }
        return out;
    } catch {
        return { error: 'This file could not be read. Try an H.264 MP4 or an MP3.' };
    } finally {
        input?.dispose();
    }
}

let localSeq = 0;
/** Media ids are `[A-Za-z0-9_-]` only (the timeline refuses anything else): `j-<job id>` for a generation, `l-<n>` for a local file. */
export const libraryMediaId = jobId => `j-${String(jobId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)}`;
export const localMediaId = () => `l-${++localSeq}`;
