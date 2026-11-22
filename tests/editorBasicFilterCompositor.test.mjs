import test from 'node:test';
import assert from 'node:assert/strict';
import { paintSequence } from '../app/veyrnox/_lib/editorSequenceRender.mjs';

function context() {
    const draws = [], fills = [], stack = [];
    let filter = 'initial', alpha = .25, composite = 'difference', fillStyle = '#ffffff';
    return {
        draws, fills,
        save() { stack.push({ filter, alpha, composite, fillStyle }); },
        restore() {
            const state = stack.pop();
            if (state) ({ filter, alpha, composite, fillStyle } = state);
        },
        translate() {}, rotate() {}, scale() {}, beginPath() {}, rect() {}, clip() {},
        drawImage(source) { draws.push({ source, filter, alpha, composite }); },
        fillRect() { fills.push({ filter, alpha, composite, fillStyle }); },
        set filter(value) { filter = value; }, get filter() { return filter; },
        set globalAlpha(value) { alpha = value; }, get globalAlpha() { return alpha; },
        set globalCompositeOperation(value) { composite = value; }, get globalCompositeOperation() { return composite; },
        set fillStyle(value) { fillStyle = value; }, get fillStyle() { return fillStyle; },
    };
}

test('basic filters keep canonical order on the foreground and never affect its clip background', () => {
    const foreground = { width: 640, height: 360, id: 'foreground' };
    const background = { width: 320, height: 640, id: 'background' };
    const clip = {
        id: 'v1', fit: 'contain', blend: 'multiply',
        filter: { brightness: .7, contrast: 1.2, saturate: .4, hue: -30, blur: 2.5 },
        background: { type: 'image', color: '#123456', blur: 18, mediaId: 'bg' },
    };
    const g = context();

    paintSequence(g, 640, 360, { background: '#010203', visuals: [{ clip, offset: 0 }], texts: [] }, {
        visuals: [foreground], backgrounds: [background],
    });

    assert.equal(g.draws.length, 2);
    assert.deepEqual(g.draws[0], { source: background, filter: 'none', alpha: 1, composite: 'source-over' });
    assert.deepEqual(g.draws[1], {
        source: foreground,
        filter: 'brightness(0.7) contrast(1.2) saturate(0.4) hue-rotate(-30deg) blur(2.5px)',
        alpha: 1,
        composite: 'multiply',
    });
    assert.ok(g.fills.length >= 2);
    assert.ok(g.fills.every(fill => fill.filter === 'none'), 'timeline and clip backgrounds must remain outside the foreground filter');
});
