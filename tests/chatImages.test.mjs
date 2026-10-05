// ADR-0068: the browser-side rules for chat images, kept pure so they can be tested without a DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scaledSize, isImageFile, addableCount, attachmentLabel } from '../app/veyrnox/_lib/chatImages.js';

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
