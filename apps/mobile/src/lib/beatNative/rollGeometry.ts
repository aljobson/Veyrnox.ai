import type { MidiClip, MidiNote } from './midi';
export const ROW = 44;
export const KEYS_WIDTH = 56;
export const MIN_SCALE = 0.025;
export const MAX_SCALE = 0.8;
export const SNAP_OPTIONS = [960, 480, 240, 120, 60, 0] as const;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const pitchRange = (clip: MidiClip) => ({ high: Math.min(108, Math.max(84, ...clip.notes.map(n => n[2]))), low: Math.max(21, Math.min(36, ...clip.notes.map(n => n[2]))) });
export const tickToX = (tick: number, scale: number) => tick * scale;
export const xToTick = (x: number, scale: number, snap: number, lengthTicks: number) => clamp(Math.round(x / scale / (snap || 1)) * (snap || 1), 0, lengthTicks - 30);
export const pitchToY = (pitch: number, high: number) => (high - pitch) * ROW;
export const yToPitch = (y: number, high: number, low = 21) => clamp(high - Math.floor(y / ROW), low, high);
export function noteRect(note: MidiNote, scale: number, high: number) {
    const width = Math.max(4, note[1] * scale);
    return { x: tickToX(note[0], scale), y: pitchToY(note[2], high), width, height: ROW, touchWidth: Math.max(44, width) };
}
export function hitNote(notes: MidiNote[], x: number, y: number, scale: number, high: number): MidiNote | undefined {
    return [...notes].reverse().find(n => { const r = noteRect(n, scale, high); const slop = (r.touchWidth - r.width) / 2; return x >= r.x - slop && x <= r.x + r.width + slop && y >= r.y && y < r.y + ROW; });
}
export const pinchScale = (start: number, startDistance: number, distance: number) => clamp(startDistance > 0 ? start * distance / startDistance : start, MIN_SCALE, MAX_SCALE);
export const zoomStep = (scale: number, dir: number) => clamp(scale * (dir > 0 ? 1.5 : 1 / 1.5), MIN_SCALE, MAX_SCALE);
export const dragDelta = (dx: number, dy: number, scale: number, snap: number) => ({ ticks: Math.round(dx / scale / (snap || 1)) * (snap || 1), pitch: -Math.round(dy / ROW) || 0 });
export const velocityFromDrag = (start: number, dy: number, laneHeight: number) => clamp(Math.round(start - dy / laneHeight * 127), 1, 127);
export const notePosition = (tick: number) => ({ bar: Math.floor(tick / 3840) + 1, beat: Math.floor(tick % 3840 / 960) + 1, step: Math.floor(tick % 960 / 240) + 1 });
export const noteLengthUnits = (ticks: number) => ticks / 240;
export const keyboardPitches = (octave: number) => Array.from({ length: 24 }, (_, i) => 60 + 12 * clamp(Math.round(octave), -3, 2) + i);
export function previewBars(clip: MidiClip, width: number, height: number) {
    const low = Math.min(48, ...clip.notes.map(n => n[2])), high = Math.max(72, ...clip.notes.map(n => n[2]));
    return clip.notes.map(([start, length, pitch]) => ({ left: start / clip.lengthTicks * width, top: (high - pitch) / (high - low + 1) * height, width: Math.max(1, length / clip.lengthTicks * width), height: 2 }));
}
