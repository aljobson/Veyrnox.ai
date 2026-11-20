import { clipAt, updateClip, type Clip, type Media, type Selection, type TextClip, type Timeline } from './nativeEditorModel';

export const PPF_MIN = 0.25;
export const PPF_MAX = 8;
export const PPF_DEFAULT = 2;
export const SEQUENCE_MAX = 18_000;
export const SNAP_FRAMES = 6;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

export function formatTimecode(frames: number, fps: number): string {
    const value = Math.max(0, Math.floor(frames));
    const seconds = Math.floor(value / fps);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, value % fps].map(n => String(n).padStart(2, '0')).join(':');
}
export function parseTimecode(text: string, fps: number): number | null {
    if (!Number.isFinite(fps) || fps <= 0) return null;
    if (/^\d+(\.\d+)?$/.test(text)) {
        const seconds = Number(text);
        return seconds < 60 ? Math.round(seconds * fps) : null;
    }
    if (!/^\d+(?::\d+){1,3}$/.test(text)) return null;
    const parts = text.split(':').map(Number);
    let hours = 0, minutes = 0, seconds = 0, frames = 0;
    if (parts.length === 2) [minutes, seconds] = parts;
    else if (parts.length === 3) [minutes, seconds, frames] = parts;
    else [hours, minutes, seconds, frames] = parts;
    if (minutes >= 60 || seconds >= 60 || frames >= fps) return null;
    const result = ((hours * 60 + minutes) * 60 + seconds) * fps + frames;
    return Number.isSafeInteger(result) ? result : null;
}
export const frameAtX = (x: number, ppf: number, total: number) => clamp(Math.round(x / ppf), 0, Math.max(0, total - 1));
export const fitPpf = (viewportWidth: number, total: number) => clamp(viewportWidth / (total + 150), PPF_MIN, PPF_MAX);

export function snapTo(timeline: Timeline, excludeIds: readonly string[], at: number, len: number, playhead: number) {
    const anchors = [0, playhead, ...[...timeline.video, ...timeline.audio, ...timeline.text]
        .filter(item => !excludeIds.includes(item.id)).flatMap(item => [item.start, item.start + item.len])];
    const shifts = anchors.flatMap(anchor => [anchor - at, anchor - (at + len)])
        .filter(shift => Math.abs(shift) <= SNAP_FRAMES).sort((a, b) => Math.abs(a) - Math.abs(b));
    return { at: at + (shifts[0] ?? 0), snapped: shifts.length > 0 };
}
const locked = (timeline: Timeline, item: Clip | TextClip) => timeline.tracks.some(track => track.id === item.trackId && track.locked);
export function movingSelections(selections: readonly Selection[], dragged: Selection): readonly Selection[] {
    return selections.some(s => s.track === dragged.track && s.id === dragged.id) ? selections : [dragged];
}
export function moveItems(timeline: Timeline, selections: readonly Selection[], dragged: Selection, deltaFrames: number, targetTrackId: string | undefined, snap: boolean, playhead: number): Timeline | null {
    const moving = movingSelections(selections, dragged).map(selection => ({ selection, item: clipAt(timeline, selection) }));
    const item = clipAt(timeline, dragged);
    if (!item || moving.some(({ item }) => !item || locked(timeline, item))) return null;
    const low = Math.max(...moving.map(({ item }) => -item!.start));
    const high = Math.min(...moving.map(({ item }) => SEQUENCE_MAX - item!.start - item!.len));
    if (low > high) return null;
    const requested = Math.round(deltaFrames);
    const snapped = snap ? snapTo(timeline, moving.map(({ item }) => item!.id), item.start + requested, item.len, playhead).at - item.start : requested;
    const delta = clamp(snapped, low, high);
    const target = moving.length === 1 ? timeline.tracks.find(track => track.id === targetTrackId && track.kind === dragged.track && !track.locked) : undefined;
    return moving.reduce((next, { selection, item }) => updateClip(next, selection, { start: item!.start + delta, ...(target ? { trackId: target.id } : {}) }), timeline);
}

export function canTrim(item: Clip | TextClip): boolean {
    const fields = item as unknown as Record<string, unknown>;
    const animation = item.animation as Record<string, unknown> | undefined;
    return !['words', 'keyframes', 'parameterKeyframes', 'maskKeyframes', 'speedCurve'].some(key => fields[key] != null)
        && animation?.offset == null && animation?.span == null;
}
// Longest length (frames) a video or audio clip may have so it never reads past the end of its source file; null when
// the file's length is unknown or the media is unbounded (images, graphics). Never below 1 frame and `in` never below 0.
export function maxClipLength(media: Media | undefined, clip: Pick<Clip, 'in' | 'rate' | 'reverse'>): number | null {
    if (!media?.frames || media.kind === 'image' || media.kind === 'graphic') return null;
    const rate = Math.max(0.1, clip.rate ?? 1), sourceIn = Math.max(0, clip.in ?? 0);
    return Math.max(1, clip.reverse ? Math.floor(sourceIn / rate) + 1 : Math.floor((media.frames - sourceIn) / rate));
}
const fitLength = (media: Media | undefined, clip: Clip): number => Math.min(clip.len, maxClipLength(media, clip) ?? clip.len);
// Cut every video and audio clip that runs past the end of its file back to the file's length (repairs older edits).
export function fitToMedia(timeline: Timeline): Timeline {
    const fit = (list: Clip[]) => list.map(clip => {
        const len = fitLength(timeline.media[clip.mediaId ?? ''], clip), sourceIn = Math.max(0, clip.in ?? 0);
        return len === clip.len && sourceIn === (clip.in ?? 0) ? clip : { ...clip, in: sourceIn, len, fadeIn: Math.min(clip.fadeIn ?? 0, len), fadeOut: Math.min(clip.fadeOut ?? 0, len) };
    });
    return { ...timeline, video: fit(timeline.video), audio: fit(timeline.audio) };
}
export function trimItem(timeline: Timeline, selection: Selection, edge: 'in' | 'out', deltaFrames: number, snap: boolean, playhead: number, ripple: 'none' | 'lane' | 'all' = 'none'): Timeline | null {
    const item = clipAt(timeline, selection);
    if (!item || locked(timeline, item) || !canTrim(item)) return null;
    const clip = item as Clip;
    const rate = Math.max(0.1, clip.rate ?? 1), sourceIn = clip.in ?? 0;
    const media = timeline.media[clip.mediaId ?? ''];
    const bounded = selection.track !== 'text' && media?.kind !== 'image' && media?.kind !== 'graphic';
    const fromStart = edge === 'in';
    let low = fromStart ? -item.start : 1 - item.len;
    let high = fromStart ? item.len - 1 : SEQUENCE_MAX - item.start - item.len;
    // Even still media must retain a nonnegative source offset for the shared save validator.
    if (fromStart && selection.track !== 'text') {
        if (clip.reverse) high = Math.min(high, Math.floor(sourceIn / rate));
        else low = Math.max(low, Math.ceil(-sourceIn / rate));
    }
    if (bounded) {
        if (!media?.frames) return null;
        if (fromStart) low = Math.max(low, clip.reverse ? Math.floor((sourceIn - media.frames) / rate) + 1 : Math.ceil(-sourceIn / rate));
        else high = Math.min(high, (clip.reverse ? Math.floor(sourceIn / rate) + 1 : Math.floor((media.frames - sourceIn) / rate)) - item.len);
    }
    // Ripple (off by default): trimming an end closes or opens the gap for the clips after it, on the same track or on every track.
    const oldEnd = item.start + item.len;
    const kinds: readonly ('video' | 'audio' | 'text')[] = ripple === 'all' ? ['video', 'audio', 'text'] : ripple === 'lane' ? [selection.track] : [];
    const followers = fromStart ? [] : kinds.flatMap(track => timeline[track].filter(other => other.id !== item.id && (ripple === 'all' || other.trackId === item.trackId) && other.start >= oldEnd && !locked(timeline, other)).map(other => ({ track, other })));
    if (followers.length) high = Math.min(high, SEQUENCE_MAX - Math.max(...followers.map(({ other }) => other.start + other.len)));
    if (low > high) return null;
    const oldEdge = fromStart ? item.start : item.start + item.len;
    const requested = oldEdge + Math.round(deltaFrames);
    const at = snap ? snapTo(timeline, [item.id], requested, 0, playhead).at : requested;
    const delta = clamp(at - oldEdge, low, high);
    const len = item.len + (fromStart ? -delta : delta);
    const rippled = followers.reduce((next, { track, other }) => updateClip(next, { track, id: other.id }, { start: other.start + delta }), timeline);
    // A clip that was already longer than its file (older edits) is healed by any trim, not grown further.
    const fitted = bounded ? fitLength(media, { ...clip, len, ...(fromStart ? { in: sourceIn + delta * rate * (clip.reverse ? -1 : 1) } : {}) }) : len;
    return updateClip(rippled, selection, {
        len: fitted,
        ...(fromStart ? { start: item.start + delta, ...(selection.track !== 'text' ? { in: sourceIn + delta * rate * (clip.reverse ? -1 : 1) } : {}) } : {}),
        ...(selection.track !== 'text' ? { fadeIn: Math.min(clip.fadeIn ?? 0, len), fadeOut: Math.min(clip.fadeOut ?? 0, len) } : {}),
    });
}
