import test from 'node:test';
import assert from 'node:assert/strict';
import { createWigLayer } from '../app/veyrnox/_lib/liveEdit/wigLayer.js';
import { createPhotoEngine } from '../app/veyrnox/_lib/liveEdit/engine.js';
import { DEFAULTS } from '../app/veyrnox/_lib/liveEdit/settings.js';
import { wigPoints } from './fixtures/photo-studio-wig-fixture.mjs';

test('wig assets load lazily, fail locally, and cancel pending images on source close', async () => {
    const saved = [globalThis.document, globalThis.Image];
    const requests = [], instances = [];
    globalThis.document = { createElement: () => ({ getContext: () => ({}), width: 0, height: 0 }) };
    globalThis.Image = class {
        constructor() { instances.push(this); this.naturalWidth = 512; this.naturalHeight = 640; }
        set src(value) { if (value) requests.push(value); }
    };
    try {
        let changes = 0;
        const layer = createWigLayer(256, 256, () => changes++);
        assert.equal(requests.length, 0);
        const load = layer.prepare('bob'); assert.equal(layer.prepare('bob'), load); instances.at(-1).onload(); await load;
        assert.deepEqual(requests, ['/photo-studio/wigs/bob.svg']); assert.equal(changes, 1);
        assert.equal(layer.render({ ...DEFAULTS.wig, style: 'bob', strength: 0 }, wigPoints()).status, 'off');
        assert.equal(layer.render({ ...DEFAULTS.wig, style: 'bob' }, null).status, 'face-required');
        const failed = layer.prepare('curls'); instances.at(-1).onerror(); await assert.rejects(failed, /wig-unavailable/);
        const cancelled = layer.prepare('long'), image = instances.at(-1), before = changes;
        layer.close(); await assert.rejects(cancelled, { name: 'AbortError' });
        assert.equal(image.onload, null); assert.equal(image.onerror, null); assert.equal(changes, before);
    } finally { [globalThis.document, globalThis.Image] = saved; }
});

test('export waits for wig assets, snapshots settings, fails on load error and cancels on close', async () => {
    const saved = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
    globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
    try {
        for (const mode of ['ready', 'failed', 'closed']) {
            let resolve, reject, prepared; const draws = [];
            const engine = createPhotoEngine({ toBlob: cb => cb(new Blob(['pixels'])) }, {}, {
                rendererFactory: () => ({ setLandmarks() {}, setHairMask() {}, close() {}, draw: s => draws.push(s),
                    prepareWig: s => { prepared = s; return new Promise((a,b) => { resolve = a; reject = b; }); } }),
                processorFactory: async () => ({ detect: async () => ({ count: 0, landmarks: new Float32Array() }), close() {} }),
            });
            await engine.ready;
            const edited = { ...DEFAULTS, wig: { ...DEFAULTS.wig, style: 'bob' } };
            engine.setSettings(edited); engine.compare(true); const pending = engine.export();
            assert.equal(prepared.wig.style, 'bob'); assert.equal(draws.length, 0);
            engine.setSettings({ ...edited, wig: { ...edited.wig, style: 'long' } });
            if (mode === 'failed') { reject(new Error('wig-unavailable')); await assert.rejects(pending, /wig-unavailable/); }
            else if (mode === 'closed') { engine.close(); resolve(); await assert.rejects(pending, { name: 'AbortError' }); }
            else { resolve(); await pending; assert.equal(draws.at(-1).wig.style, 'bob'); }
            engine.close();
        }
    } finally { [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = saved; }
});
