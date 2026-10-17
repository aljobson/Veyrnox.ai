import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSITIONS, TRANSITION_TYPES } from '../app/veyrnox/_lib/editorEffects.mjs';
import { NEW_TRANSITION_IDS, transitionParams, shapeClipOps, shapeContains, shapeCoverage } from '../app/veyrnox/_lib/editorTransitionGeometry.mjs';
import { emptySequence, addSequenceMedia, addSequenceClip, setSequenceTransition } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { sequenceLayers, paintSequence } from '../app/veyrnox/_lib/editorSequenceRender.mjs';

const SHAPES = ['iris-open', 'iris-close', 'clock-wipe', 'barn-doors', 'blinds', 'pixel-dissolve'];
const MOVES = ['push', 'spin', 'whip-pan', 'glitch', 'light-leak', 'cross-zoom'];
const media = { id: 'm', kind: 'video', frames: 300, width: 640, height: 360, hasAudio: false, name: 'm.mp4' };
const two = () => {
    let tl = addSequenceClip(addSequenceMedia(emptySequence(), media), 'video', 'm', { len: 90 });
    tl = addSequenceClip(tl, 'video', 'm', { len: 90 });
    return tl;
};
const ok = tl => { assert.equal(tl.error, undefined, tl.error); assert.equal(validateSequence(tl), null); return tl; };

test('the twelve new transitions are in the catalogue and accepted by the validator', () => {
    assert.deepEqual([...NEW_TRANSITION_IDS].sort(), [...SHAPES, ...MOVES].sort());
    assert.equal(TRANSITIONS.length, 25);
    for (const id of NEW_TRANSITION_IDS) {
        assert.ok(TRANSITIONS.some(item => item.id === id), id);
        assert.ok(TRANSITION_TYPES.includes(id), id);
        const tl = two();
        ok(setSequenceTransition(tl, 'v2', id, 15));
    }
    assert.equal(new Set(TRANSITIONS.map(item => item.id)).size, TRANSITIONS.length);
});

test('every catalogue entry has a name and a category', () => {
    for (const item of TRANSITIONS) assert.ok(item.name && item.category, item.id);
});

test('shape transitions start with nothing revealed, end with everything, and only grow', () => {
    for (const kind of SHAPES) {
        const at = p => shapeCoverage(transitionParams(kind, p, 3).incoming.shape);
        assert.ok(at(0.001) < 0.05, `${kind} start ${at(0.001)}`);
        assert.ok(at(1) > 0.97, `${kind} end ${at(1)}`);
        let last = -1;
        for (let step = 1; step <= 20; step++) {
            const value = at(step / 20);
            assert.ok(value >= last - 1e-9, `${kind} must not shrink at ${step}`);
            last = value;
        }
    }
});

test('shape clip operations match the analytic shape', () => {
    const size = { x: -320, y: -180, w: 640, h: 360 }, radius = Math.hypot(640, 360) / 2;
    const iris = shapeClipOps({ kind: 'iris-open', progress: 0.5 }, size.x, size.y, size.w, size.h);
    assert.equal(iris.at(-1).op, 'arc');
    assert.ok(Math.abs(iris.at(-1).args[2] - radius * 0.5) < 1e-6);
    const close = shapeClipOps({ kind: 'iris-close', progress: 0.25 }, size.x, size.y, size.w, size.h);
    assert.equal(close.some(op => op.op === 'rect'), true);
    assert.ok(Math.abs(close.find(op => op.op === 'arc').args[2] - radius * 0.75) < 1e-6);
    assert.equal(close.evenodd, true);
    const blinds = shapeClipOps({ kind: 'blinds', progress: 0.5 }, size.x, size.y, size.w, size.h);
    assert.equal(blinds.filter(op => op.op === 'rect').length, 8);
    for (const op of blinds) assert.ok(Math.abs(op.args[3] - (360 / 8) * 0.5) < 1e-6);
    const barn = shapeClipOps({ kind: 'barn', progress: 0.5 }, size.x, size.y, size.w, size.h);
    assert.deepEqual(barn, Object.assign([{ op: 'rect', args: [-160, -180, 320, 360] }], {}));
});

test('pixel dissolve is deterministic and covers each cell exactly once', () => {
    const a = shapeClipOps({ kind: 'pixels', progress: 0.4 }, 0, 0, 640, 360);
    const b = shapeClipOps({ kind: 'pixels', progress: 0.4 }, 0, 0, 640, 360);
    assert.deepEqual(a, b);
    assert.ok(a.length > 30 && a.length < 130);
    assert.equal(new Set(a.map(op => op.args.join(','))).size, a.length);
    assert.equal(shapeClipOps({ kind: 'pixels', progress: 1 }, 0, 0, 640, 360).length, 144);
});

test('shapeContains agrees with the clip operations at sample points', () => {
    for (const kind of ['barn', 'blinds', 'pixels']) {
        const shape = { kind, progress: 0.55 };
        const rects = shapeClipOps(shape, 0, 0, 640, 360).filter(op => op.op === 'rect');
        for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
            const u = (i + 0.37) / 40, v = (j + 0.37) / 40, x = u * 640, y = v * 360;
            const inside = rects.some(op => x >= op.args[0] && x <= op.args[0] + op.args[2] && y >= op.args[1] && y <= op.args[1] + op.args[3]);
            assert.equal(shapeContains(shape, u, v), inside, `${kind} ${i},${j}`);
        }
    }
});

test('moving transitions animate both pictures in opposite senses', () => {
    const push = transitionParams('push', 0.25, 2);
    assert.equal(push.incoming.alpha, 1);
    assert.ok(Math.abs(push.incoming.slideX - 0.75) < 1e-9);
    assert.ok(Math.abs(push.outgoing.slideX + 0.25) < 1e-9);
    const cross = transitionParams('cross-zoom', 0.5, 2);
    assert.ok(cross.incoming.zoom > 1 && cross.outgoing.zoom > 1 && cross.incoming.transitionBlur > 0);
    const spin = transitionParams('spin', 0.5, 2);
    assert.ok(spin.incoming.spin !== 0 && spin.incoming.alpha === 0.5);
    assert.ok(transitionParams('light-leak', 0.5, 2).incoming.leak > 0.9);
    assert.equal(transitionParams('light-leak', 1, 2).incoming.alpha, 1);
});

test('glitch jitter is deterministic per frame and the cut happens at the halfway point', () => {
    assert.deepEqual(transitionParams('glitch', 0.3, 7), transitionParams('glitch', 0.3, 7));
    assert.equal(transitionParams('glitch', 0.3, 7).incoming.alpha, 0);
    assert.equal(transitionParams('glitch', 0.7, 7).incoming.alpha, 1);
    assert.notEqual(transitionParams('glitch', 0.3, 7).incoming.slideX, transitionParams('glitch', 0.3, 8).incoming.slideX);
});

test('unknown and existing transition ids are left to the original code', () => {
    for (const id of ['dissolve', 'wipe-left', 'slide-up', 'zoom', 'nope']) assert.equal(transitionParams(id, 0.5, 1), null);
});

test('sequenceLayers carries the new parameters on the incoming and outgoing pictures', () => {
    for (const id of NEW_TRANSITION_IDS) {
        const tl = ok(setSequenceTransition(two(), 'v2', id, 20));
        const layers = sequenceLayers(tl, 90 + 9);
        assert.equal(layers.visuals.length, 2, id);
        const [under, over] = layers.visuals;
        const expected = transitionParams(id, 10 / 20, 9);
        assert.equal(over.clip.id, 'v2');
        for (const [key, value] of Object.entries(expected.incoming)) assert.deepEqual(over[key], value, `${id} incoming ${key}`);
        for (const [key, value] of Object.entries(expected.outgoing || {})) assert.deepEqual(under[key], value, `${id} outgoing ${key}`);
    }
});

test('paintSequence clips the incoming picture with the shape, the same code for preview and export', () => {
    for (const id of SHAPES) {
        const tl = ok(setSequenceTransition(two(), 'v2', id, 20));
        const calls = [];
        const g = new Proxy({}, { get: (_, name) => name === 'filter' || name === 'globalAlpha' ? 1 : (...args) => { calls.push([name, args]); } , set: () => true });
        const picture = { width: 640, height: 360 };
        const layers = sequenceLayers(tl, 90 + 9);
        paintSequence(g, 640, 360, layers, { visuals: [picture, picture], backgrounds: [] });
        const clips = calls.filter(([name]) => name === 'clip').length;
        assert.ok(clips >= 1, `${id} must clip`);
    }
});
