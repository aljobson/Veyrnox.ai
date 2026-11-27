import { editorTopInset } from '../src/lib/editorSafeInsets';

describe('editorTopInset', () => {
    it('preserves a measured iOS safe-area inset', () => {
        expect(editorTopInset('ios', 59, 874)).toBe(59);
    });

    it('keeps editor controls below a modern iPhone status bar when native measurement is zero', () => {
        expect(editorTopInset('ios', 0, 874)).toBe(54);
    });

    it('uses the classic iPhone status-bar inset on short screens', () => {
        expect(editorTopInset('ios', undefined, 667)).toBe(20);
    });

    it('does not invent a top inset on Android', () => {
        expect(editorTopInset('android', 0, 874)).toBe(0);
    });
});
