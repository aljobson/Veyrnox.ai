export type PianoHardwareKeyEvent = {
    key: string;
    shift?: boolean;
    alt?: boolean;
    control?: boolean;
    meta?: boolean;
    repeat?: boolean;
};
export type PianoHardwareCommand =
    | { type: 'selectAll' | 'clear' | 'delete' | 'toggleCursor' }
    | { type: 'velocity'; delta: number }
    | { type: 'move'; ticks: number; pitch: number }
    | { type: 'resize'; ticks: number }
    | { type: 'cursor'; ticks: number; pitch: number };

export function pianoHardwareCommand(event: PianoHardwareKeyEvent, unit: number, hasSelection: boolean): PianoHardwareCommand | null {
    const key = event.key.toLowerCase(), step = unit || 30;
    if ((event.meta || event.control) && key === 'a') return { type: 'selectAll' };
    if (key === 'escape') return { type: 'clear' };
    if (key === 'delete' || key === 'backspace') return hasSelection ? { type: 'delete' } : null;
    if (key === 'enter' || key === 'return') return { type: 'toggleCursor' };
    if (key === '+' || key === '=') return hasSelection ? { type: 'velocity', delta: 16 } : null;
    if (key === '-' || key === '_') return hasSelection ? { type: 'velocity', delta: -16 } : null;
    const horizontal = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
    const vertical = key === 'arrowdown' ? -1 : key === 'arrowup' ? 1 : 0;
    if (!horizontal && !vertical) return null;
    if (!hasSelection) return { type: 'cursor', ticks: horizontal, pitch: vertical };
    if (event.shift && horizontal) return { type: 'resize', ticks: horizontal };
    return { type: 'move', ticks: horizontal, pitch: event.alt && vertical ? vertical * 12 : vertical };
}
