import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolvePictures } from '../app/veyrnox/_lib/editorRender.mjs';
import { semanticMaskConfidence, semanticMaskedPicture } from '../app/veyrnox/_lib/editorSequenceRender.mjs';

test('web renderer resolves static and dynamic semantic masks at their canonical times', async () => {
    const layers = { visuals: [
        { k: 0, time: 2, offset: 30, clip: { semanticMask: { mediaId: 'static-mask' } } },
        { k: 1, time: 3, offset: 50, clip: { semanticMask: { mediaId: 'dynamic-mask', dynamic: { fps: 25 } } } },
    ] };
    const calls = [], pictures = await resolvePictures(layers, async (k, time, mediaId) => {
        calls.push([k, time, mediaId]); return mediaId ?? `visual-${k}`;
    });
    assert.deepEqual(pictures, { visuals: ['visual-0', 'visual-1'], backgrounds: [null, null], masks: ['static-mask', 'dynamic-mask'] });
    assert.deepEqual(calls, [[0, 2, undefined], [1, 3, undefined], [0, 0, 'static-mask'], [1, 2, 'dynamic-mask']]);
});

test('web alpha/luminance conversion matches the shared semantic-mask pixel fixture', async () => {
    const fixture = JSON.parse(await readFile(new URL('./fixtures/editorSemanticMaskPixels.json', import.meta.url), 'utf8'));
    for (const item of fixture.cases) {
        const [red, green, blue, alpha] = item.rgba;
        assert.equal(semanticMaskConfidence(red, green, blue, alpha), item.expected, item.name);
    }
});

test('web compositor turns mask confidence into alpha before destination-in clipping', () => {
    const canvases = [], previous = globalThis.OffscreenCanvas;
    class FakeCanvas {
        constructor(width, height) {
            this.width = width; this.height = height;
            const operations = [], context = { operations, pixels: new Uint8ClampedArray([0, 0, 0, 0]),
                drawImage(source) { operations.push(['draw', this.globalCompositeOperation]); if (source.pixels) this.pixels = Uint8ClampedArray.from(source.pixels); },
                getImageData() { return { data: Uint8ClampedArray.from(this.pixels) }; },
                putImageData(image) { this.pixels = Uint8ClampedArray.from(image.data); }, globalCompositeOperation: 'source-over' };
            this.context = context; canvases.push(this);
        }
        getContext() { return this.context; }
    }
    globalThis.OffscreenCanvas = FakeCanvas;
    try {
        const output = semanticMaskedPicture({ width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 },
            { width: 1, height: 1, pixels: [255, 0, 0, 255] }, { x: 0, y: 0, width: 1, height: 1 }, 1, 1);
        assert.equal(output, canvases[0]); assert.deepEqual(Array.from(canvases[1].context.pixels), [255, 255, 255, 54]);
        assert.deepEqual(canvases[0].context.operations, [['draw', 'source-over'], ['draw', 'destination-in']]);
    } finally { globalThis.OffscreenCanvas = previous; }
});
