/* eslint-disable @typescript-eslint/no-require-imports */
declare const __dirname: string;
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
import { normalizeStack, normalizeWig, history, tintMatrix, WIG_IDS, WIG_RANGE, DEFAULT_STACK } from '../src/lib/liveEdit/engine';
const { WIGS } = require('../src/lib/liveEdit/shared/wigs');
const { WIG_PNG } = require('../src/lib/liveEdit/shared/wigAssets');
const root = resolve(__dirname, '../../../');

test('every embedded wig is the current web art: manifest hash, pixel size and a real PNG', () => {
    expect(WIG_IDS).toEqual(WIGS.map((wig: { id: string }) => wig.id));
    expect(Object.keys(WIG_PNG).sort()).toEqual([...WIG_IDS].sort());
    for (const wig of WIGS) {
        const svg = readFileSync(resolve(root, 'public' + wig.file));
        expect(createHash('sha256').update(svg).digest('hex')).toBe(wig.sha256); // the web art itself is unchanged
        const entry = WIG_PNG[wig.id];
        expect(entry.svgSha256).toBe(wig.sha256); // and the embedded PNG was rendered from exactly that art
        const png = Buffer.from(entry.base64, 'base64');
        expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([entry.width, entry.height]);
        expect(entry.width / entry.height).toBeCloseTo(wig.dimensions[0] / wig.dimensions[1], 6); // same aspect as the web art
    }
});

test('the wig setting is bounded, defaults to none, and an unknown style can never be saved', () => {
    expect(DEFAULT_STACK.wig).toEqual({ style: 'none', size: 1, offset: 0, strength: 1 });
    expect(normalizeWig({ style: 'bob', size: 99, offset: -9, strength: 7 })).toEqual({ style: 'bob', size: WIG_RANGE.size[1], offset: WIG_RANGE.offset[0], strength: 1 });
    expect(normalizeWig({ style: 'bob', size: -1, offset: 9, strength: -3 })).toEqual({ style: 'bob', size: WIG_RANGE.size[0], offset: WIG_RANGE.offset[1], strength: 0 });
    for (const style of ['', 'wizard', 'constructor', '__proto__', undefined, null, 4]) expect(normalizeWig({ style } as never).style).toBe('none');
    expect(normalizeWig({ style: 'bob', size: NaN, offset: Infinity, strength: 'x' } as never)).toEqual({ style: 'bob', size: 1, offset: 0, strength: 1 });
    expect(normalizeStack({ wig: { style: 'curls' } as never }).wig.style).toBe('curls');
    expect(WIG_RANGE.size).toEqual([0.75, 1.3]); expect(WIG_RANGE.offset).toEqual([-0.15, 0.15]); // the slider ranges are the clamps
});

test('wig changes are part of undo/redo like every other effect', () => {
    const h = history();
    h.set(normalizeStack({ wig: { style: 'pixie', strength: 1 } as never })); h.set(normalizeStack({ wig: { style: 'long', strength: .5 } as never }));
    expect(h.value.wig).toMatchObject({ style: 'long', strength: .5 });
    h.undo(); expect(h.value.wig.style).toBe('pixie'); h.undo(); expect(h.value.wig.style).toBe('none'); h.redo(); expect(h.value.wig.style).toBe('pixie');
});

test('the tint matrix keeps alpha and, where nothing clips, keeps the wig luminance', () => {
    const luma = (rgb: number[]) => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    const apply = (m: number[], rgb: number[]) => [0, 1, 2].map(r => m[r * 5] * rgb[0] + m[r * 5 + 1] * rgb[1] + m[r * 5 + 2] * rgb[2]);
    for (const tint of [[0.5, 0.5, 0.5], [0.3, 0.6, 0.5], [0.7, 0.4, 0.3], [0.2, 0.5, 0.8]]) {
        const m = tintMatrix(tint, 1);
        expect(m).toHaveLength(20); expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]); // alpha row: transparent pixels are never tinted
        for (const c of [0, 1, 2]) expect(m[c * 5 + 3]).toBe(0); expect(m[4]).toBe(0); expect(m[9]).toBe(0); expect(m[14]).toBe(0);
        for (const sample of [[.4, .4, .4], [.2, .15, .1], [.8, .7, .6]]) expect(luma(apply(m, sample))).toBeCloseTo(luma(sample), 9);
    }
    const none = tintMatrix([0.1, 0.6, 0.6], 0); // amount 0 = identity on colour
    expect(apply(none, [.3, .5, .7]).map(v => +v.toFixed(9))).toEqual([.3, .5, .7]);
    expect(tintMatrix([0.2, 0.2, 0.2], 9)).toEqual(tintMatrix([0.2, 0.2, 0.2], 1)); // amount is clamped
    expect(tintMatrix([0, 0, 0], 1).every(Number.isFinite)).toBe(true); // a black shade cannot produce NaN
});
