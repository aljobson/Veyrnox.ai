import { barTicks, snapTick, songEnd, type BeatDoc, type BeatRegionDoc } from './doc';
export { guardedRippleDelete, guardedRippleInsert } from './ripple';
export { laneRevealScrollY, measureAndRevealLane, searchClips } from './clipSearch';
export type { BeatClipSearchResult, ClipSearchResult, LaneRevealGeometry, MeasureAndRevealLaneInput, WindowMeasurable } from './clipSearch';
export type DragMode = 'move' | 'trim' | 'resize';
export type DragValue = BeatRegionDoc & { trackId: string };
export const tickToX = (tick: number, zoom: number) => tick / barTicks * zoom;
export const xToTick = (x: number, zoom: number) => x / zoom * barTicks;
export const arrangementBars = (doc: BeatDoc, locator: number) => Math.min(512, Math.max(16, Math.ceil(Math.max(songEnd(doc), doc.cycle.end, locator) / barTicks) + 4));
export const laneAt = (y: number, heights: number[]) => {
    let bottom = 0;
    for (let i = 0; i < heights.length; i++) { bottom += heights[i]; if (y < bottom) return i; }
    return heights.length - 1;
};
export function dragValue(region: BeatRegionDoc, mode: DragMode, dxTicks: number, snap: number, trackId: string): DragValue {
    const start = mode === 'resize' ? region.start : Math.max(0, snapTick(region.start + dxTicks, snap));
    const end = mode === 'resize' ? Math.max(region.start + 240, snapTick(region.start + region.length + dxTicks, snap)) : region.start + region.length;
    const trimmed = mode === 'trim' ? Math.min(start, end - 240) : start;
    return { ...region, start: trimmed, length: mode === 'move' ? region.length : end - trimmed, trackId };
}
export function positionParts(tick: number) {
    const value = Math.max(0, Math.floor(tick));
    return { bar: Math.floor(value / barTicks) + 1, beat: Math.floor(value % barTicks / 960) + 1, step: Math.floor(value % 960 / 240) + 1 };
}
