import test from 'node:test';
import assert from 'node:assert/strict';
import { createFaceProcessor, validateLandmarks } from '../app/veyrnox/_lib/liveEdit/faceClient.mjs';
import { createPhotoEngine, validatePhoto } from '../app/veyrnox/_lib/liveEdit/engine.js';
import { DEFAULTS } from '../packages/live-edit/effects.js';
import { FACE_VISION_PATH } from '../app/veyrnox/_lib/editorVisionRuntime.mjs';
class FakeWorker {
    static instances = []; static reply = true;
    constructor(url, options) { this.url = url; this.options = options; this.terminated = 0; FakeWorker.instances.push(this); }
    postMessage(data) {
        if (data.op === 'init') queueMicrotask(() => this.onmessage({ data: { id: data.id, ready: true } }));
        else if (FakeWorker.reply) queueMicrotask(() => this.onmessage({ data: { id: data.id, count: 0, landmarks: new Float32Array() } }));
    }
    terminate() { this.terminated++; }
}
test('face worker is bounded, validates messages, and releases bitmaps and worker', async () => {
    let closes = 0, options;
    const processor = await createFaceProcessor({ WorkerClass: FakeWorker, bitmapFactory: async (_, opts) => { options = opts; return { close() { closes++; } }; } });
    assert.equal(FakeWorker.instances.at(-1).url, `${FACE_VISION_PATH}/worker.mjs`);
    const result = await processor.detect({ width: 2400, height: 1200 }); assert.equal(result.count, 0);
    assert.deepEqual([options.resizeWidth, options.resizeHeight], [384, 192]); assert.equal(closes, 1);
    processor.close(); processor.close(); assert.equal(FakeWorker.instances.at(-1).terminated, 1);
    assert.throws(() => validateLandmarks({ count: 2, landmarks: new Float32Array(1434) }));
    assert.throws(() => validateLandmarks({ count: 1, landmarks: new Float32Array(1434).fill(NaN) }));
    await assert.rejects(processor.detect({ width: 20, height: 20 }), { name: 'AbortError' });
});
test('worker timeout and source abort terminate inference and reject pending work', async () => {
    FakeWorker.reply = false;
    try {
        for (const abort of [false, true]) {
            const controller = new AbortController(); let closes = 0;
            const processor = await createFaceProcessor({ signal: controller.signal, WorkerClass: FakeWorker, timeoutMs: 10, bitmapFactory: async () => ({ close() { closes++; } }) });
            const result = processor.detect({ width: 20, height: 20 });
            if (abort) controller.abort();
            await assert.rejects(result, abort ? { name: 'AbortError' } : /timeout/);
            assert.equal(closes, 1); assert.equal(FakeWorker.instances.at(-1).terminated, 1);
        }
    } finally { FakeWorker.reply = true; }
});
test('engine closes late initialization, clears lost faces, and exports the edited stack while comparing', async () => {
    const oldRAF = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
    try {
        let resolveProcessor, rendererCloses = 0, processorCloses = 0;
        const instance = createPhotoEngine({}, {}, { rendererFactory: () => ({ close() { rendererCloses++; } }), processorFactory: () => new Promise(resolve => { resolveProcessor = resolve; }) });
        instance.close(); instance.close(); resolveProcessor({ close() { processorCloses++; } }); await instance.ready;
        assert.equal(rendererCloses, 1); assert.equal(processorCloses, 1);
        const calls = [], faces = [], flat = [];
        const active = createPhotoEngine({ width: 8, height: 6, toBlob(callback, type) { callback(new Blob(['pixels'], { type })); } }, {}, {
            rendererFactory: () => ({ draw(s) { calls.push(s); }, setLandmarks(p) { assert.equal(p.length, 0); }, close() {} }),
            processorFactory: async () => ({ detect: async () => ({ count: 2, landmarks: new Float32Array() }), close() {} }), onFace: status => faces.push(status),
            createFlatCanvas: () => { const ops = []; flat.push(ops); return { width: 0, height: 0, getContext: () => ({ set fillStyle(v) { ops.push(['fill', v]); }, fillRect: (...a) => ops.push(['rect', ...a]), drawImage: (c, ...a) => ops.push(['draw', ...a]) }), toBlob(callback, type) { callback(new Blob(['flat'], { type })); } }; },
        });
        await active.ready; assert.deepEqual(faces, ['detecting', 'multiple-faces']);
        active.setSettings({ ...DEFAULTS, brightness: 0.5 }); active.compare(true);
        const blob = await active.export('image/jpeg'); assert.equal(blob.type, 'image/jpeg'); assert.equal(calls.at(-1).brightness, 0.5);
        // JPEG is flattened onto opaque white before encoding; PNG goes straight from the render canvas.
        assert.equal(await blob.text(), 'flat'); assert.deepEqual(flat[0].slice(0, 2), [['fill', '#fff'], ['rect', 0, 0, 8, 6]]); assert.equal(flat[0][2][0], 'draw');
        assert.equal(await (await active.export('image/png')).text(), 'pixels'); assert.equal(flat.length, 1);
        active.close(); await assert.rejects(active.export(), /closed/);
    } finally { globalThis.requestAnimationFrame = oldRAF; globalThis.cancelAnimationFrame = oldCancel; }
});
test('photo decoding refuses unsupported, oversized and degenerate sources', () => {
    const file = { type: 'image/png', size: 200 };
    validatePhoto(file, 4000, 3000);
    for (const [w, h] of [[0, 100], [9000, 400], [6000, 6000], [NaN, 50]]) assert.throws(() => validatePhoto(file, w, h));
    assert.throws(() => validatePhoto({ ...file, type: 'image/svg+xml' }));
    assert.throws(() => validatePhoto({ ...file, size: 51 * 1024 * 1024 }));
});
test('photo decoding freezes a bitmap and closes a late bitmap after source cancellation', async () => {
    const { decodePhoto } = await import('../app/veyrnox/_lib/liveEdit/engine.js');
    const oldImage = globalThis.Image, oldBitmap = globalThis.createImageBitmap;
    let loaded, finishBitmap, closes = 0;
    globalThis.Image = class {
        naturalWidth = 100; naturalHeight = 100;
        set src(value) { if (value) loaded = () => this.onload?.(); }
    };
    globalThis.createImageBitmap = async () => new Promise(resolve => { finishBitmap = () => resolve({ close() { closes++; } }); });
    try {
        const controller = new AbortController();
        const promise = decodePhoto(new Blob(['data'], { type: 'image/png' }), controller.signal);
        const loading = loaded(); controller.abort();
        await assert.rejects(promise, { name: 'AbortError' });
        finishBitmap(); await loading; assert.equal(closes, 1);
    } finally { globalThis.Image = oldImage; globalThis.createImageBitmap = oldBitmap; }
});
