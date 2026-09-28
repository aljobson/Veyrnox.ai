export const VIDEO_LIMITS = { bytes: 100 * 1024 * 1024, seconds: 15, dimension: 1920 };
export const VIDEO_LOOKS = [
    { id: 'natural', label: 'Natural', saturation: 1, contrast: 1, warmth: 0 },
    { id: 'warm', label: 'Warm', saturation: 1.06, contrast: 1.02, warmth: 0.035 },
    { id: 'cool', label: 'Cool', saturation: 0.95, contrast: 1.03, warmth: -0.03 },
    { id: 'cinema', label: 'Soft cinema', saturation: 0.82, contrast: 0.94, warmth: 0.012 },
];

export function validateVideo(file, metadata) {
    if (!file || !['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) return 'Choose an MP4, WebM or MOV video.';
    if (!(file.size > 0) || file.size > VIDEO_LIMITS.bytes) return 'Choose a video under 100 MiB.';
    if (!metadata) return null;
    if (!Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > VIDEO_LIMITS.seconds) return 'Choose a clip up to 15 seconds long.';
    if (!(metadata.width > 0 && metadata.height > 0) || Math.max(metadata.width, metadata.height) > VIDEO_LIMITS.dimension) return 'Choose a video with a longest edge of 1920 pixels or less.';
    return null;
}

export function lookSettings(id, intensity) {
    const look = VIDEO_LOOKS.find(item => item.id === id) || VIDEO_LOOKS[0];
    const amount = Number.isFinite(intensity) ? Math.max(0, Math.min(100, intensity)) / 100 : 0;
    return { saturation: 1 + (look.saturation - 1) * amount, contrast: 1 + (look.contrast - 1) * amount, warmth: amount ? look.warmth * amount : 0 };
}

export function downloadName(name, mime) {
    return `${name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 70) || 'video'}-enhanced.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
}

export function validateExportAudio(codec) {
    // The pinned converter loses Opus end padding in the verified WebM fixture.
    // Keep this explicit until a real-file audio regression passes for that path.
    return codec === 'opus'
        ? 'Opus audio export is not supported in this preview yet. Use an MP4 clip with AAC audio, or a silent clip.'
        : codec !== null && codec !== 'aac'
            ? 'Export supports AAC audio or no audio. Convert this clip to MP4 with AAC audio, or remove its audio.'
            : null;
}
