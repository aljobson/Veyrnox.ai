import { ROW, MIN_SCALE, MAX_SCALE, tickToX, xToTick, pitchToY, yToPitch, pitchRange, noteRect, hitNote, pinchScale, zoomStep, dragDelta, velocityFromDrag, notePosition, noteLengthUnits, keyboardPitches, previewBars } from '../src/lib/beatNative/rollGeometry';
import type { MidiClip, MidiNote } from '../src/lib/beatNative/midi';
const note: MidiNote = [240, 30, 60, 100];
const clip: MidiClip = { name: 'Test', lengthTicks: 3840, notes: [note] };
test('tick and pitch coordinate round trips, snap and clip boundary clamps', () => {
    for (const tick of [0, 240, 960, 3600]) expect(xToTick(tickToX(tick, 0.1), 0.1, 240, 3840)).toBe(tick);
    for (const pitch of [21, 36, 60, 84]) expect(yToPitch(pitchToY(pitch, 84), 84)).toBe(pitch);
    expect(xToTick(381, 0.1, 240, 3840)).toBe(3810);
    expect(xToTick(-50, 0.1, 240, 3840)).toBe(0);
    expect(xToTick(13, 0.1, 240, 3840)).toBe(240);
    expect(yToPitch(99999, 84, 36)).toBe(36);
    expect(yToPitch(-999, 84)).toBe(84);
    expect(pitchRange(clip)).toEqual({ high: 84, low: 36 });
    expect(pitchRange({ ...clip, notes: [[0, 30, 21, 1], [30, 30, 108, 1]] })).toEqual({ high: 108, low: 21 });
});
test('small note touch targets have horizontal slop, last note wins, rows stay distinct', () => {
    const rect = noteRect(note, 0.1, 84);
    expect(rect).toMatchObject({ width: 4, touchWidth: 44, height: ROW });
    expect(hitNote([note], rect.x - 15, rect.y + 20, 0.1, 84)).toBe(note);
    expect(hitNote([note], rect.x, rect.y + ROW, 0.1, 84)).toBeUndefined();
    const top: MidiNote = [250, 30, 60, 80];
    expect(hitNote([note, top], 25, rect.y + 20, 0.1, 84)).toBe(top);
});
test('zoom, drag, velocity and keyboard limits', () => {
    expect(pinchScale(0.1, 100, 200)).toBe(0.2);
    expect(pinchScale(0.1, 100, 1)).toBe(MIN_SCALE);
    expect(pinchScale(0.1, 100, 10000)).toBe(MAX_SCALE);
    expect(pinchScale(0.1, 0, 20)).toBe(0.1);
    expect(zoomStep(MAX_SCALE, 1)).toBe(MAX_SCALE);
    expect(zoomStep(MIN_SCALE, -1)).toBe(MIN_SCALE);
    expect(dragDelta(25, -ROW * 2, 0.1, 240)).toEqual({ ticks: 240, pitch: 2 });
    expect(velocityFromDrag(64, -100, 100)).toBe(127);
    expect(velocityFromDrag(64, 100, 100)).toBe(1);
    expect(velocityFromDrag(100, 10, 100)).toBe(87);
    expect(keyboardPitches(-9)).toEqual(Array.from({ length: 24 }, (_, i) => i + 24));
    expect(keyboardPitches(9)).toEqual(Array.from({ length: 24 }, (_, i) => i + 84));
});
test('musical labels and thumbnail geometry preserve timing and pitch', () => {
    expect(notePosition(5040)).toEqual({ bar: 2, beat: 2, step: 2 });
    expect(noteLengthUnits(30)).toBe(0.125);
    expect(previewBars(clip, 256, 30)[0]).toMatchObject({ left: 16, width: 2, height: 2 });
    expect(previewBars(clip, 256, 30)[0].top).toBeCloseTo(14.4);
    expect(previewBars({ ...clip, notes: [] }, 256, 30)).toEqual([]);
});
