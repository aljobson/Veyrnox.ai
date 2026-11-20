import { setSequenceRate, setSequenceSpeedCurve, reverseSequenceClip, insertSequenceFreeze } from '../../../../app/veyrnox/_lib/editorSequence.mjs';
import { sourceFrame, sourceRange, shiftedSpeedKeys } from '../../../../app/veyrnox/_lib/editorSpeed.mjs';
import { clipAt, type Clip, type Media, type Selection, type Timeline } from './nativeEditorModel';
export type SpeedPoint = { position: number; rate: number };
export type SpeedResult = { timeline: Timeline } | { refused: 'outside' | 'locked' | 'invalid' };
type WebResult = Timeline | { error: string };
export function isMovingClip(timeline: Timeline, selection: Selection | null): boolean {
    const clip = clipAt(timeline, selection) as Clip | undefined;
    const media = timeline.media[clip?.mediaId ?? ''];
    return !!clip && selection?.track !== 'text' && !!media && !['image', 'graphic'].includes(media.kind ?? '') && clip.freezeFrame === undefined;
}
function edit(timeline: Timeline, selection: Selection, run: () => WebResult): SpeedResult {
    const clip = clipAt(timeline, selection);
    if (!clip) return { refused: 'invalid' };
    if (timeline.tracks.some(t => t.id === clip.trackId && t.locked)) return { refused: 'locked' };
    if (!isMovingClip(timeline, selection)) return { refused: 'invalid' };
    try { const next = run(); return 'error' in next ? { refused: 'invalid' } : { timeline: next }; }
    catch { return { refused: 'invalid' }; }
}
export const speedRate = (tl: Timeline, sel: Selection, rate: number): SpeedResult =>
    edit(tl, sel, () => setSequenceRate(tl, sel.track, sel.id, rate) as WebResult);
export const speedCurve = (tl: Timeline, sel: Selection, points: readonly SpeedPoint[]): SpeedResult =>
    edit(tl, sel, () => setSequenceSpeedCurve(tl, sel.track, sel.id, points) as WebResult);
export const speedReverse = (tl: Timeline, sel: Selection): SpeedResult =>
    edit(tl, sel, () => reverseSequenceClip(tl, sel.track, sel.id) as WebResult);
export function freezeInsert(tl: Timeline, sel: Selection, frame: number): SpeedResult {
    const clip = clipAt(tl, sel);
    if (clip && tl.tracks.some(t => t.id === clip.trackId && t.locked)) return { refused: 'locked' };
    if (sel.track !== 'video' || !isMovingClip(tl, sel) || !Number.isFinite(frame)) return { refused: 'invalid' };
    if (clip && (frame < clip.start || frame >= clip.start + clip.len)) return { refused: 'outside' };
    return edit(tl, sel, () => insertSequenceFreeze(tl, sel.id, frame) as WebResult);
}
/** All rates are positive: in-trim validity is a suffix, out-trim validity a prefix. */
export function speedSourceBounds(clip: Clip, media: Media, edge: 'in' | 'out', low: number, high: number): { low: number; high: number } {
    const valid = (delta: number) => {
        const from = edge === 'in' ? delta : 0;
        const candidate = { ...clip, len: clip.len + (edge === 'in' ? -delta : delta),
            in: sourceFrame(clip, from), speedCurve: shiftedSpeedKeys(clip, from) };
        const range = sourceRange(candidate);
        return range.from >= 0 && range.to < (media.frames ?? 0);
    };
    let left = Math.ceil(low), right = Math.floor(high);
    if (edge === 'in') {
        if (!valid(right)) return { low: high + 1, high };
        while (left < right) { const mid = Math.floor((left + right) / 2); if (valid(mid)) right = mid; else left = mid + 1; }
        return { low: left, high };
    }
    if (!valid(left)) return { low, high: low - 1 };
    while (left < right) { const mid = Math.ceil((left + right) / 2); if (valid(mid)) left = mid; else right = mid - 1; }
    return { low, high: left };
}
