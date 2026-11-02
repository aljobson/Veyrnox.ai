import test from 'node:test';
import assert from 'node:assert/strict';
import { ratioOf, nearestOption, nearestShape } from '../lib/aspectShapes.mjs';
import { draftForTemplate } from '../app/veyrnox/_lib/templateDraft.js';

test('ratios read from "w / h" and "w:h" and nothing else', () => {
    assert.equal(ratioOf('9:16'), 9 / 16);
    assert.equal(ratioOf('600 / 1066'), 600 / 1066);
    for (const bad of [null, undefined, '', 'wide', '0 / 5', '5 / 0', 7]) assert.equal(ratioOf(bad), null, String(bad));
});

test('the nearest option by ratio, not by text', () => {
    assert.equal(nearestOption('9:16', ['16:9', '4:5', '1:1']), '4:5');
    assert.equal(nearestOption('600 / 1066', ['16:9', '9:16']), '9:16');
    assert.equal(nearestOption('21 / 9', ['16:9', '9:16', '1:1']), '16:9');
    assert.equal(nearestOption('9:16', []), null);
    assert.equal(nearestOption('9:16', ['auto', 'wide']), null);
    assert.equal(nearestOption('wide', ['16:9']), null);
    assert.equal(nearestShape('406 / 720'), '9:16');
});

test('a template with no recorded aspect takes its preview shape; a recorded one wins', () => {
    const base = { id: 'x', model: 'Kling 3.0 · I2V', prompt: 'p' };
    assert.equal(draftForTemplate({ ...base, previewAspect: '600 / 1066' }, 'kling-3.0-i2v').aspect, '600 / 1066');
    assert.equal(draftForTemplate({ ...base, clip: { aspectRatio: '600 / 338' }, previewAspect: '9 / 16' }, 'kling-3.0-i2v').aspect, '600 / 338');
    assert.equal(draftForTemplate({ ...base, previewAspect: 'wide' }, 'kling-3.0-i2v').aspect, null);
    assert.equal(draftForTemplate({ ...base, aspect: '1:1', previewAspect: '9 / 16' }, 'kling-3.0-i2v').aspect, '1:1');
    assert.equal(draftForTemplate(base, 'kling-3.0-i2v').aspect, null);
});

test('the preview ratio is kept until the model options are known, so it never snaps to the wrong shape first', () => {
    const base = { id: 'x', model: 'Kling 3.0 · I2V', prompt: 'p' };
    // A 4:5 preview must reach a model that offers 4:5, not be squared to 1:1 on the way.
    const fourFive = draftForTemplate({ ...base, previewAspect: '4 / 5' }, 'kling-3.0-i2v').aspect;
    assert.equal(nearestOption(fourFive, ['16:9', '1:1', '4:5']), '4:5');
    // A 270 / 360 portrait must reach 9:16, not 16:9 via a snap to 1:1.
    const portrait = draftForTemplate({ ...base, previewAspect: '270 / 360' }, 'kling-3.0-i2v').aspect;
    assert.equal(nearestOption(portrait, ['16:9', '9:16']), '9:16');
});
