import type { Timeline } from './nativeEditorModel';

/** Length of the media on the timeline, ignoring text overlays. */
export function mediaFrames(timeline: Pick<Timeline, 'video' | 'audio'>): number {
    return Math.max(0, ...[...timeline.video, ...timeline.audio].map((clip) => clip.start + clip.len));
}

/**
 * Where a new title or caption goes. It starts at the playhead and is cut short at the end of the
 * video, so an overlay never makes the project longer (that would export frozen or black frames).
 * With no video or audio yet there is nothing to overrun, so the wanted length is kept.
 */
export function overlaySpan(timeline: Pick<Timeline, 'video' | 'audio'>, playhead: number, wantedLen: number): { start: number; len: number } {
    const end = mediaFrames(timeline);
    if (end <= 0) return { start: Math.max(0, playhead), len: wantedLen };
    const start = Math.min(Math.max(0, playhead), end - 1);
    return { start, len: Math.max(1, Math.min(wantedLen, end - start)) };
}
