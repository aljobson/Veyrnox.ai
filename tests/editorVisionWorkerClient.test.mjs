import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisionProcessor } from '../app/veyrnox/_lib/editorVisionWorkerClient.mjs';
const labels = ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'];
async function withWorker(handle, run) {
    const original = { Worker: globalThis.Worker, createImageBitmap: globalThis.createImageBitmap }, workers = [], bitmaps = [];
    class FakeWorker {
        constructor(url, options) { this.url = url; this.options = options; this.terminated = false; workers.push(this); }
        postMessage(request) { handle(this, request); }
        terminate() { this.terminated = true; }
        reply(message) { queueMicrotask(() => this.onmessage?.({ data: message })); }
    }
    globalThis.Worker = FakeWorker;
    globalThis.createImageBitmap = async (_picture, options) => { const bitmap = { width: options.resizeWidth, height: options.resizeHeight, closed: false, close() { this.closed = true; } }; bitmaps.push(bitmap); return bitmap; };
    try { await run({ workers, bitmaps }); }
    finally { globalThis.Worker = original.Worker; globalThis.createImageBitmap = original.createImageBitmap; }
}
test('cancelling while the real worker would initialize rejects the pending job and terminates its heap owner', async () => {
    await withWorker(() => {}, async ({ workers }) => {
        const controller = new AbortController(), pending = createVisionProcessor({ signal: controller.signal });
        controller.abort();
        await assert.rejects(pending, error => error.name === 'AbortError');
        assert.equal(workers[0].terminated, true);
    });
});
test('cancelled frame inference closes transferred image resources and cannot return a late mask', async () => {
    let frameRequest;
    await withWorker((worker, request) => { if (request.op === 'init') worker.reply({ id: request.id, ready: true, labels }); else frameRequest = request; }, async ({ workers, bitmaps }) => {
        const controller = new AbortController(), processor = await createVisionProcessor({ signal: controller.signal });
        const pending = processor.segment({ width: 1920, height: 1080 }, 1);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(bitmaps[0].width, 384); assert.equal(bitmaps[0].height, 216);
        controller.abort();
        workers[0].reply({ id: frameRequest.id, width: 8, height: 8 });
        await assert.rejects(pending, error => error.name === 'AbortError');
        assert.equal(workers[0].terminated, true); assert.equal(bitmaps[0].closed, true);
        await assert.rejects(() => processor.segment({ width: 16, height: 16 }, 2), error => error.name === 'AbortError');
    });
});
test('unmatched replies are ignored and nonfinite model confidence is refused before picture compositing', async () => {
    await withWorker((worker, request) => {
        if (request.op === 'init') { worker.reply({ id: request.id + 1, ready: true, labels: [] }); worker.reply({ id: request.id, ready: true, labels }); }
        else { const background = new Float32Array(64); background[3] = NaN; worker.reply({ id: request.id, width: 8, height: 8, background, body: new Float32Array(64), face: new Float32Array(64), categories: new Uint8Array(64) }); }
    }, async ({ workers, bitmaps }) => {
        const processor = await createVisionProcessor();
        await assert.rejects(() => processor.segment({ width: 8, height: 8 }, 1), /invalid mask confidence/);
        assert.equal(bitmaps[0].closed, true); processor.close(); assert.equal(workers[0].terminated, true);
    });
});
