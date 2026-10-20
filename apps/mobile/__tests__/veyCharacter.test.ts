declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string; existsSync: (p: string) => boolean };
const path = require('path') as { join: (...p: string[]) => string };

import { CANVAS, LAYERS, PIVOTS, heightFor, pivotStyle } from '../src/lib/veyCharacter';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

describe('Vey character art (the web character, drawn as layers)', () => {
    test('keeps the web character\'s proportions', () => {
        expect(CANVAS).toEqual({ width: 160, height: 170 });
        expect(heightFor(160)).toBe(170);
        expect(heightFor(72)).toBeCloseTo(76.5, 5);
    });

    test('every layer is a picture file in the app', () => {
        expect(LAYERS).toEqual(['base', 'left-arm', 'right-arm', 'body', 'core', 'head', 'eyes']);
        for (const name of LAYERS) expect(fs.existsSync(path.join(__dirname, '..', 'assets', 'vey', `${name}.png`))).toBe(true);
    });

    test('each part turns about a point inside the drawing', () => {
        for (const [name, p] of Object.entries(PIVOTS)) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(CANVAS.width);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(CANVAS.height);
            expect(name).toBeTruthy();
        }
        // The head nods about its neck, the arms about their shoulders, the eyes blink about their middle.
        expect(PIVOTS.head).toEqual({ x: 80, y: 96 });
        expect(PIVOTS.leftArm.x).toBeLessThan(PIVOTS.rightArm.x);
        expect(PIVOTS.eyes.y).toBeLessThan(PIVOTS.head.y);
    });

    test('a pivot scales with the size the character is drawn at', () => {
        expect(pivotStyle('head', 160)).toEqual({ transformOrigin: '80px 96px' });
        expect(pivotStyle('head', 80)).toEqual({ transformOrigin: '40px 48px' });
    });
});

describe('the animated Vey (N8 follow-up)', () => {
    test('the mascot shows the character, not the plain mark', () => {
        const mascot = read('components', 'VeyMascot.tsx');
        expect(mascot).toContain('<VeyCharacter');
        expect(mascot).not.toContain('logo-mark');
    });

    test('the head and both arms move, and the character respects Reduce Motion', () => {
        const art = read('components', 'VeyCharacter.tsx');
        expect(art).toContain('Animated.loop');
        for (const part of ['head', 'leftArm', 'rightArm']) expect(art).toContain(`pivotStyle('${part}'`);
        expect(art).toContain('isReduceMotionEnabled');
        expect(art).toContain('reduceMotionChanged');
        // A decorative picture: the button around it carries the label.
        expect(art).toContain('no-hide-descendants');
    });

    test('animation runs on the native thread', () => {
        expect(read('components', 'VeyCharacter.tsx')).not.toContain('useNativeDriver: false');
    });
});
