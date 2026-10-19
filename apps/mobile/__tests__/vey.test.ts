declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

import { DEFAULT_SIDE, VEY_PLACEMENT_SLOT, otherSide, parseSide, serializeSide } from '../src/lib/veyPlacement';

describe('Vey placement (mirrors the web: left by default, versioned, nothing else stored)', () => {
    test('defaults to the left', () => {
        expect(DEFAULT_SIDE).toBe('left');
        expect(parseSide(null)).toBe('left');
        expect(parseSide(undefined)).toBe('left');
        expect(parseSide('')).toBe('left');
    });

    test('reads a stored right side', () => {
        expect(parseSide(JSON.stringify({ version: 1, side: 'right' }))).toBe('right');
        expect(parseSide(JSON.stringify({ version: 1, side: 'left' }))).toBe('left');
    });

    test('falls back to the default for anything it does not understand', () => {
        expect(parseSide('not json')).toBe('left');
        expect(parseSide(JSON.stringify({ version: 2, side: 'right' }))).toBe('left');
        expect(parseSide(JSON.stringify({ side: 'right' }))).toBe('left');
        expect(parseSide(JSON.stringify({ version: 1, side: 'middle' }))).toBe('left');
        expect(parseSide(JSON.stringify(['right']))).toBe('left');
    });

    test('writes only the version and the side, never anything about the conversation', () => {
        expect(JSON.parse(serializeSide('right'))).toEqual({ version: 1, side: 'right' });
        expect(parseSide(serializeSide('right'))).toBe('right');
    });

    test('moves to the other side', () => {
        expect(otherSide('left')).toBe('right');
        expect(otherSide('right')).toBe('left');
    });

    test('the storage name uses only the characters SecureStore allows', () => {
        expect(VEY_PLACEMENT_SLOT).toMatch(/^[A-Za-z0-9._-]+$/);
    });
});

describe('where Vey shows (N8)', () => {
    const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

    test('every tab shows it, except the Cinema feed where the actions sit at the bottom', () => {
        const layout = read('app', '(app)', '(tabs)', '_layout.tsx');
        expect(layout).toContain('<VeyMascot');
        expect(layout).toMatch(/route\.name === 'cinema'/);
    });

    test('it opens the chat and offers the move as a screen-reader action as well as a long press', () => {
        const mascot = read('components', 'VeyMascot.tsx');
        expect(mascot).toContain("router.push('/chat')");
        expect(mascot).toContain('accessibilityActions');
        expect(mascot).toContain('onLongPress');
        expect(mascot).toContain('Keyboard.addListener');
    });

    test('the old Chat button left the home', () => {
        expect(read('app', '(app)', '(tabs)', 'index.tsx')).not.toContain('href="/chat"');
    });
});
