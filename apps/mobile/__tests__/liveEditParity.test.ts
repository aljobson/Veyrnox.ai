/* eslint-disable @typescript-eslint/no-require-imports */
const { readFileSync } = require('node:fs');
declare const __dirname: string;
const { resolve } = require('node:path');
import { lookMatrix, LOOK_IDS } from '../src/lib/instantLooks';
import { MAKEUP, normalizeStack, history } from '../src/lib/liveEdit/engine';
import { assembleStack } from '../src/lib/liveEdit/stack';
import { regionFor } from '../src/lib/liveEdit/geometry';
import type { Inference } from '../src/lib/liveEdit/protocol';
const names = ['effects', 'makeup', 'hair', 'regions', 'looks', 'smoothing'];
test.each(names)('%s generated source and exported descriptor tables exactly match web', name => {
    const source = resolve(__dirname, '../../../packages/live-edit', `${name}.js`), target = resolve(__dirname, '../src/lib/liveEdit/shared', `${name}.js`);
    expect(readFileSync(target, 'utf8')).toBe(readFileSync(source, 'utf8'));
    const mobile = require(target), web = require(source);
    for (const key of Object.keys(web)) if (typeof web[key] !== 'function') expect(mobile[key]).toEqual(web[key]);
});
test('all nine existing mobile looks retain web matrix parity at every strength step', () => {
    const shared = require('../src/lib/liveEdit/shared/looks');
    for (const id of LOOK_IDS) for (const strength of [0, .1, .5, .8, 1]) expect(lookMatrix({ id, strength })).toEqual(shared.lookMatrix({ id, strength }));
});
const ids = { sourceId: 1, frameId: 2 };
const inference: Inference = { ...ids, count: 1, landmarks: new Float32Array(1434).fill(.5), hair: { width: 8, height: 8, hair: new Float32Array(64).fill(.9) } };
const stack = normalizeStack({ look: 'warm', strength: .8, smoothing: .5, makeup: Object.fromEntries(MAKEUP.map(d => [d.id, { strength: .5, shade: d.shades[0] }])) as never, hair: { strength: .8, mode: 'ombre', shade: 'copper', shade2: 'blonde' } });
test('one ordered stack includes every visible effect; stale, lost and multiple faces suppress local effects', () => {
    expect(assembleStack(stack, ids, inference).passes).toEqual(['look', 'smoothing', ...MAKEUP.map(d => d.id), 'hair']);
    for (const value of [null, { ...inference, frameId: 4 }, { ...inference, sourceId: 5 }, { ...inference, count: 0 as const }, { ...inference, count: 2 as const }]) expect(assembleStack(stack, ids, value).passes).toEqual(['look']);
    expect(assembleStack(stack, ids, { ...inference, hair: null }).passes).not.toContain('hair');
    expect(assembleStack(normalizeStack(), ids, inference).passes).toEqual([]);
});
test('undo redo is isolated, bounded and a new edit discards redo', () => {
    const h = history(); h.set(stack); const copy = h.value; copy.makeup.lips.strength = 0;
    expect(h.value.makeup.lips.strength).toBe(.5); h.undo(); expect(h.value.look).toBe('original'); h.redo(); expect(h.value.look).toBe('warm');
    h.undo(); h.set(normalizeStack({ look: 'cool' })); expect(h.canRedo).toBe(false);
});
test('every face effect has explicit mouth and eye holes; foundation/blush/smoothing also protect brows', () => {
    for (const id of [...MAKEUP.map(d => d.id), 'smoothing' as const]) {
        const region = regionFor(id, inference.landmarks, stack);
        expect(region.holes.length).toBe(['foundation', 'blush', 'smoothing'].includes(id) ? 5 : 3);
        expect(region.shapes.length).toBeGreaterThan(0);
    }
});
test('skin smoothing radius, sigmas and exclusions are shared by actual web and mobile renderers', () => {
    const { SKIN_SMOOTHING: S } = require('../src/lib/liveEdit/shared/smoothing');
    const { SMOOTH } = require('../src/lib/liveEdit/shaders');
    const { BILATERAL_GLSL } = require('../../../app/veyrnox/_lib/liveEdit/bilateral');
    expect(SMOOTH).toContain(`y=-${S.kernelRadius};y<=${S.kernelRadius}`);
    expect(SMOOTH).toContain(`-dot(d,d)*${S.spatialWeight}-dot(diff,diff)*${S.rangeWeight.toFixed(1)}`);
    expect(SMOOTH).toContain(`a*${S.strengthScale}`);
    expect(BILATERAL_GLSL).toContain(`pixel*${S.sampleStepPixels.toFixed(1)}`);
    expect(BILATERAL_GLSL).toContain(`*${S.rangeWeight.toFixed(1)}`);
    expect(BILATERAL_GLSL).toContain(`*${S.spatialWeight}`);
    const renderer = readFileSync(resolve(__dirname, '../src/lib/liveEdit/renderEffectStack.ts'), 'utf8');
    expect(renderer).toContain('const radius = SKIN_SMOOTHING.sampleStepPixels');
    const masks = readFileSync(resolve(__dirname, '../../../app/veyrnox/_lib/liveEdit/masks.js'), 'utf8');
    expect(masks).toContain('S.maskExclusions'); expect(masks).toContain('S.holeScale'); expect(masks).toContain('S.ovalScale');
    const region = regionFor('smoothing', inference.landmarks, stack);
    expect(region.holes).toHaveLength(S.maskExclusions.length);
});
