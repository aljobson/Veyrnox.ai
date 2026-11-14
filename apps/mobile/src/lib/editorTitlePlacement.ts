export const TITLE_FRAMES = 90;

/**
 * Where a new title goes. With video on the timeline it starts inside the video and ends at or before
 * the video's last frame, so adding a title never makes the project longer. With none, it keeps the
 * old behaviour: at the playhead, three seconds long.
 */
export function placeTitle(playhead: number, videoEnd: number, total: number): { start: number; len: number } {
    if (videoEnd <= 0) return { start: Math.min(playhead, Math.max(0, total)), len: TITLE_FRAMES };
    const len = Math.min(TITLE_FRAMES, videoEnd);
    return { start: Math.max(0, Math.min(playhead, videoEnd - len)), len };
}
