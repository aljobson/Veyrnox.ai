import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canvasAspectFromDimensions, canvasAspectRatio, canvasAspectSize, canvasPixelSize, canvasResolutionSize,
    customCanvasParts, formatCustomCanvasAspect, validCanvasAspect,
} from '../app/veyrnox/_lib/editorCanvasFormat.mjs';

test('custom canvas input is bounded, reduced, and persisted in one canonical spelling', () => {
    assert.equal(formatCustomCanvasAspect(10, 16), 'custom:5x8');
    assert.equal(formatCustomCanvasAspect('100', '25'), 'custom:4x1');
    assert.equal(formatCustomCanvasAspect(4, 16), 'custom:1x4');
    for (const input of [[0, 1], [1, 0], [101, 100], [1.5, 2], [1, 5], [5, 1], ['', 4]]) {
        assert.equal(formatCustomCanvasAspect(...input), null, String(input));
    }
    assert.deepEqual(customCanvasParts('custom:5x8'), { width: 5, height: 8 });
    for (const value of ['custom:10x16', 'custom:101x100', 'custom:1x5', 'custom:5:8', 'Custom:5x8']) assert.equal(customCanvasParts(value), null, value);
});

test('presets, custom ratios, and source dimensions share one sizing model', () => {
    for (const value of ['16:9', '9:16', '1:1', '4:5', 'custom:5x8']) assert.equal(validCanvasAspect(value), true, value);
    assert.equal(validCanvasAspect('source'), false);
    assert.equal(validCanvasAspect('source', { allowSource: true }), true);
    assert.equal(validCanvasAspect('custom:10x16'), false);
    assert.deepEqual(canvasAspectSize('4:5'), { width: 4, height: 5 });
    assert.equal(canvasAspectSize('toString'), null);
    assert.deepEqual(canvasAspectSize('source', 1000, 2000), { width: 1000, height: 2000 });
    assert.equal(canvasAspectRatio('custom:5x8'), 5 / 8);
    assert.deepEqual(canvasPixelSize('custom:5x8', 720, 1920), { width: 450, height: 720 });
    assert.deepEqual(canvasPixelSize('custom:4x1', 720, 1920), { width: 1920, height: 480 });
    assert.deepEqual(canvasResolutionSize('4:5', 1080), { width: 1080, height: 1350 });
    assert.deepEqual(canvasResolutionSize('source', 1080, 1000, 2000), { width: 1080, height: 2160 });
});

test('interchange dimensions recover presets first and otherwise a bounded custom ratio', () => {
    assert.equal(canvasAspectFromDimensions(1920, 1080), '16:9');
    assert.equal(canvasAspectFromDimensions(1080, 1350), '4:5');
    assert.equal(canvasAspectFromDimensions(1350, 2160), 'custom:5x8');
    assert.equal(canvasAspectFromDimensions(101, 100), null);
    assert.equal(canvasAspectFromDimensions(500, 100), null);
});
