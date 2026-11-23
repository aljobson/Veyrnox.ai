import { beatPianoLayout } from '../src/lib/beatNative/pianoLayout';
import { normaliseMarquee, notesInMarquee } from '../src/lib/beatNative/rollGeometry';
import type { MidiNote } from '../src/lib/beatNative/midi';

test('piano layout adapts by available space and prioritises large text', () => {
    expect(beatPianoLayout(390, 844, 1, 1).mode).toBe('compact');
    expect(beatPianoLayout(1024, 768, 1, 1)).toEqual(expect.objectContaining({ mode: 'regular', dockKeyboard: true, compactKeyboard: true }));
    expect(beatPianoLayout(1024, 768, 1.5, 1)).toEqual(expect.objectContaining({ mode: 'accessible', dockKeyboard: false, compactKeyboard: false }));
    expect(beatPianoLayout(844, 390, 1, 1).dockKeyboard).toBe(false);
});

test('marquee normalises reverse drags and selects every intersecting note', () => {
    const notes: MidiNote[] = [[0, 240, 60, 100], [480, 240, 64, 100], [960, 240, 67, 100]];
    const box = normaliseMarquee(70, 1110, -10, 1020);
    expect(box).toEqual({ x: -10, y: 1020, width: 80, height: 90 });
    expect(notesInMarquee(notes, box, 0.1, 84)).toEqual(['0:60']);
});
