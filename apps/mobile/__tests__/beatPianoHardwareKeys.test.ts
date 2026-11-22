import { pianoHardwareCommand } from '../src/lib/beatNative/pianoHardwareKeys';

test('hardware shortcuts keep standard selection and editor commands', () => {
    expect(pianoHardwareCommand({ key: 'a', meta: true }, 240, false)).toEqual({ type: 'selectAll' });
    expect(pianoHardwareCommand({ key: 'Escape' }, 240, true)).toEqual({ type: 'clear' });
    expect(pianoHardwareCommand({ key: 'Delete' }, 240, true)).toEqual({ type: 'delete' });
    expect(pianoHardwareCommand({ key: 'Enter' }, 240, false)).toEqual({ type: 'toggleCursor' });
    expect(pianoHardwareCommand({ key: 'Delete' }, 240, false)).toBeNull();
});

test('arrow keys move the cursor or selected notes with resize and octave modifiers', () => {
    expect(pianoHardwareCommand({ key: 'ArrowRight' }, 240, false)).toEqual({ type: 'cursor', ticks: 240, pitch: 0 });
    expect(pianoHardwareCommand({ key: 'ArrowUp' }, 240, true)).toEqual({ type: 'move', ticks: 0, pitch: 1 });
    expect(pianoHardwareCommand({ key: 'ArrowDown', alt: true }, 240, true)).toEqual({ type: 'move', ticks: 0, pitch: -12 });
    expect(pianoHardwareCommand({ key: 'ArrowLeft', shift: true }, 240, true)).toEqual({ type: 'resize', ticks: -240 });
    expect(pianoHardwareCommand({ key: '=' }, 240, true)).toEqual({ type: 'velocity', delta: 16 });
});
