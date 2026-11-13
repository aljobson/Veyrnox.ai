import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createVisionProcessor, validateMasks } from '../app/veyrnox/_lib/editorVisionWorkerClient.mjs';
import { EDITOR_VISION_PATH, HAIR_VISION_PATH } from '../app/veyrnox/_lib/editorVisionRuntime.mjs';
import { VISION_RELEASES, VISION_COMBINED_BUDGET_BYTES, visionDigest } from '../scripts/editor-vision-assets.mjs';
const labels = ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'];
const masks = () => ({ width: 8, height: 8, background: new Float32Array(64), body: new Float32Array(64), face: new Float32Array(64), categories: new Uint8Array(64) });
test('legacy masks remain valid; hair is mandatory only for the opted-in protocol and always bounded', () => {
    validateMasks(masks()); assert.throws(() => validateMasks(masks(), true), /hair confidence/);
    for (const hair of [new Float32Array(63), new Float32Array(64).fill(NaN), new Float32Array(64).fill(-.1), new Float32Array(64).fill(1.01), new Uint8Array(64)]) {
        assert.throws(() => validateMasks({ ...masks(), hair }, true));
        assert.throws(() => validateMasks({ ...masks(), hair }));
    }
    validateMasks({ ...masks(), hair: new Float32Array(64).fill(.5) }, true);
});
test('new worker copies HAIR class 1, transfers bounded buffers and closes all SDK/bitmap owners', async () => {
    const source = await readFile('scripts/editor-vision-hair-worker.mjs', 'utf8');
    let resultCloses = 0, bitmapCloses = 0, sent, dimensions = 8;
    const channels = Array.from({ length: 6 }, (_, i) => new Float32Array(64).fill(i / 6));
    class Bitmap { width = 8; height = 8; close() { bitmapCloses++; } }
    const self = { location: { href: `https://veyrnox.ai${HAIR_VISION_PATH}/worker.mjs` }, postMessage: (...args) => { sent = args; } };
    const sdk = { FilesetResolver: { forVisionTasks: async () => ({}) }, ImageSegmenter: { createFromOptions: async () => ({
        getLabels: () => labels,
        segmentForVideo: () => ({ confidenceMasks: channels.map(data => ({ getAsFloat32Array: () => data })), categoryMask: { width: dimensions, height: 8, getAsUint8Array: () => new Uint8Array(64) }, close() { resultCloses++; } }),
    }) } };
    // Execute the actual Worker envelope; substitute only its fixed dynamic SDK import.
    vm.runInNewContext(source.replace("await import('./vision_bundle.mjs')", 'await sdk'), { self, sdk, URL, ImageBitmap: Bitmap, Float32Array, Uint8Array });
    await self.onmessage({ data: { id: 1, op: 'init' } }); assert.equal(sent[0].ready, true);
    await self.onmessage({ data: { id: 2, op: 'segment', timestamp: 1, bitmap: new Bitmap() } });
    validateMasks(sent[0], true); assert.deepEqual(sent[0].hair, channels[1]); assert.notEqual(sent[0].hair.buffer, channels[1].buffer);
    assert.equal(sent[1].length, 5); assert.ok(sent[1].includes(sent[0].hair.buffer));
    assert.equal(resultCloses, 1); assert.equal(bitmapCloses, 1);
    channels[1][0] = NaN;
    await self.onmessage({ data: { id: 3, op: 'segment', timestamp: 2, bitmap: new Bitmap() } }); assert.ok(sent[0].error);
    dimensions = 513;
    await self.onmessage({ data: { id: 4, op: 'segment', timestamp: 3, bitmap: new Bitmap() } }); assert.ok(sent[0].error);
    assert.equal(resultCloses, 3); assert.equal(bitmapCloses, 3);
});
test('person default remains old prefix, Photo Studio opts in, and decoding supports its 8192 edge bound', async () => {
    const original = { Worker: globalThis.Worker, createImageBitmap: globalThis.createImageBitmap };
    const urls = [], sizes = []; let closed = 0, terminated = 0;
    globalThis.Worker = class {
        constructor(url) { urls.push(url); }
        postMessage(r) { queueMicrotask(() => this.onmessage({ data: r.op === 'init' ? { id: r.id, ready: true, labels } : { ...masks(), id: r.id, hair: new Float32Array(64).fill(.6) } })); }
        terminate() { terminated++; }
    };
    globalThis.createImageBitmap = async (_, size) => { sizes.push(size); return { close() { closed++; } }; };
    try {
        const person = await createVisionProcessor(); await person.segment({ width: 16, height: 16 }, 1); person.close();
        const hair = await createVisionProcessor({ hair: true }); await hair.segment({ width: 8192, height: 2048 }, 1); hair.close();
        assert.deepEqual(urls, [`${EDITOR_VISION_PATH}/worker.mjs`, `${HAIR_VISION_PATH}/worker.mjs`]);
        assert.deepEqual([sizes[1].resizeWidth, sizes[1].resizeHeight], [384,96]); assert.equal(closed,2); assert.equal(terminated,2);
    } finally { Object.assign(globalThis, original); }
});
test('retained worker bytes and manifest provenance remain exactly pinned; only one previous segmentation release', async () => {
    assert.equal(VISION_RELEASES.filter(r => r.model.endsWith('.tflite')).length, 2);
    const old = VISION_RELEASES[0], worker = old.assets.find(f => f.path === 'worker.mjs');
    assert.equal(worker.source, 'scripts/editor-vision-worker.mjs');
    assert.equal(visionDigest(await readFile(worker.source)), '3208a143547fc9000de7f351dd56612be2cfaf2ece41eebfbeb1a4c0f0935ca0');
    // Reconstructed from origin/main 290437f9f's inventory, source blobs and
    // prepare script: freezes every v1 source/path/size/hash and manifest byte.
    assert.equal(visionDigest(JSON.stringify({ version: old.version, files: old.assets }, null, 2) + '\n'),
        '4ddc36005488fb2fde13b2af9f8e4a5a499979dc956aa91253ade23d7ab98310');
});
test('exactly three releases fit the documented proposed cap, counting every declared asset byte', async () => {
    assert.equal(VISION_RELEASES.length, 3, 'current hair + current face + exactly one previous segmentation');
    assert.equal(new Set(VISION_RELEASES.map(r => r.version)).size, 3);
    assert.equal(VISION_RELEASES.filter(r => r.model === 'selfie_multiclass_256x256.tflite').length, 2);
    const totals = VISION_RELEASES.map(release => {
        assert.equal(release.assets.length, 7);
        return release.assets.reduce((total, file) => {
            assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0, `Declare bytes for ${release.version}/${file.path}`);
            assert.match(file.sha256, /^[a-f0-9]{64}$/);
            return total + file.bytes;
        }, 0);
    });
    assert.deepEqual(totals, [28624644, 16009877, 28625163]);
    const total = totals.reduce((sum, bytes) => sum + bytes, 0);
    assert.equal(total, 73259684); assert.equal(VISION_COMBINED_BUDGET_BYTES, 72 * 1024 * 1024);
    assert.ok(total <= VISION_COMBINED_BUDGET_BYTES);
    const adr = await readFile('docs/adr/0335-local-photo-studio.md', 'utf8');
    assert.match(adr, /72 MiB/); assert.match(adr, /proposed, pending owner approval/);
    assert.ok(adr.includes('73,259,684'));
});
test('each Worker manifest source is its actual pinned build input, without a source override', async () => {
    for (const release of VISION_RELEASES) {
        const worker = release.assets.find(file => file.path === 'worker.mjs');
        const bytes = await readFile(worker.source);
        assert.equal(bytes.length, worker.bytes, worker.source);
        assert.equal(visionDigest(bytes), worker.sha256, worker.source);
    }
});
