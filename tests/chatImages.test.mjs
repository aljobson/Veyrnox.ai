// ADR-0068: the browser-side rules for chat images, kept pure so they can be tested without a DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scaledSize, isImageFile, addableCount, attachmentLabel, prepareImage } from '../app/veyrnox/_lib/chatImages.js';

test('a picture within the edge cap is left alone; a bigger one is scaled down, never up', () => {
    assert.deepEqual(scaledSize(1600, 900, 2048), { width: 1600, height: 900 });
    assert.deepEqual(scaledSize(2048, 2048, 2048), { width: 2048, height: 2048 });
    assert.deepEqual(scaledSize(4096, 2048, 2048), { width: 2048, height: 1024 });
    assert.deepEqual(scaledSize(3000, 4000, 2048), { width: 1536, height: 2048 });
    assert.deepEqual(scaledSize(100, 100, 2048), { width: 100, height: 100 });
});

test('scaling keeps the long edge at the cap and never produces a zero side', () => {
    const s = scaledSize(20000, 3, 2048);
    assert.equal(s.width, 2048);
    assert.ok(s.height >= 1);
    assert.deepEqual(scaledSize(0, 0, 2048), { width: 1, height: 1 });
});

test('only PNG, JPEG and WebP files count as images', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) assert.equal(isImageFile({ type }), true, type);
    for (const type of ['image/gif', 'image/svg+xml', 'image/heic', 'application/pdf', 'video/mp4', '', undefined]) assert.equal(isImageFile({ type }), false, String(type));
    assert.equal(isImageFile(null), false);
});

test('how many more files can be added is bounded by the cap', () => {
    assert.equal(addableCount(0, 4), 4);
    assert.equal(addableCount(3, 4), 1);
    assert.equal(addableCount(4, 4), 0);
    assert.equal(addableCount(9, 4), 0);
});

test('a sent attachment is labelled by its size, never a file name', () => {
    assert.equal(attachmentLabel({ type: 'image/png', width: 1600, height: 900 }), 'Image, 1600 by 900');
    assert.equal(attachmentLabel({ type: 'image/jpeg' }), 'Image');
});

// ── prepareImage always redraws, so the original file's EXIF (GPS, camera, time) never leaves the browser ──
function withCanvas(run, { bitmap = { width: 800, height: 600 }, ctx = true } = {}) {
    const saved = { createImageBitmap: globalThis.createImageBitmap, document: globalThis.document };
    const seen = { options: null, canvas: null, drawn: null, blobType: null, closed: false };
    globalThis.createImageBitmap = async (_file, options) => { seen.options = options; return { ...bitmap, close() { seen.closed = true; } }; };
    globalThis.document = { createElement: () => {
        const canvas = { width: 0, height: 0,
            getContext: () => (ctx ? { drawImage: (...a) => { seen.drawn = a; } } : null),
            toBlob: (cb, type) => { seen.blobType = type; cb(new Blob(['redrawn'], { type })); } };
        seen.canvas = canvas;
        return canvas;
    } };
    return Promise.resolve(run(seen)).finally(() => { globalThis.createImageBitmap = saved.createImageBitmap; globalThis.document = saved.document; });
}

test('a picture that already fits is still redrawn, so it is not the original file', () => withCanvas(async (seen) => {
    const original = new File(['exif+pixels'], 'holiday.jpg', { type: 'image/jpeg' });
    const out = await prepareImage(original, 2048);
    assert.notEqual(out, original, 'the original file, EXIF and all, is never uploaded');
    assert.equal(out.type, 'image/jpeg');
    assert.deepEqual([seen.canvas.width, seen.canvas.height], [800, 600], 'same size: nothing is scaled');
    assert.equal(seen.options.imageOrientation, 'from-image', 'rotation is applied before the tag is dropped');
    assert.equal(seen.closed, true);
}));

test('a bigger picture is redrawn at the cap, and PNG and WebP keep their type', () => withCanvas(async (seen) => {
    const out = await prepareImage(new File(['x'], 'a.png', { type: 'image/png' }), 2048);
    assert.deepEqual([seen.canvas.width, seen.canvas.height], [2048, 1024]);
    assert.equal(out.type, 'image/png');
    assert.equal((await prepareImage(new File(['x'], 'a.webp', { type: 'image/webp' }), 2048)).type, 'image/webp');
}, { bitmap: { width: 4096, height: 2048 } }));

test('a picture the browser cannot decode or draw is image_unreadable', async () => {
    await withCanvas(() => assert.rejects(prepareImage(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 2048), { message: 'image_unreadable' }), { ctx: false });
    const saved = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async () => { throw new Error('bad'); };
    try { await assert.rejects(prepareImage(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 2048), { message: 'image_unreadable' }); }
    finally { globalThis.createImageBitmap = saved; }
});
