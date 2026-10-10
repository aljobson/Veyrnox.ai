import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewer } from '../app/veyrnox/_lib/editorPreview.mjs';
import { emptyTimeline, addText } from '../app/veyrnox/_lib/editorTimeline.mjs';
import { emptySequence } from '../app/veyrnox/_lib/editorSequence.mjs';

test('the preview reports a painted legacy frame without throwing during decoder cleanup', async () => {
    let painted = 0;
    const context = { fillRect() { painted++; }, strokeText() {}, fillText() {} };
    const canvas = { width: 1280, height: 720, getContext: () => context };
    const preview = createPreviewer(new Map());
    try {
        const timeline = addText(emptyTimeline(), { text: 'Legacy title', start: 0, len: 90, x: .5, y: .5, size: 6 });
        assert.equal(await preview.draw(timeline, 30, canvas), true);
        assert.equal(painted, 1);
        assert.equal(await preview.draw(emptyTimeline(), 0, canvas), true);
        assert.equal(painted, 2);
    } finally { preview.dispose(); }
    assert.equal(await preview.draw(emptyTimeline(), 0, canvas), false);
});

test('the same preview lifecycle accepts the empty multitrack frame', async () => {
    let painted = 0;
    const context = { save() {}, restore() {}, fillRect() { painted++; } };
    const preview = createPreviewer(new Map());
    try { assert.equal(await preview.draw(emptySequence(), 0, { width: 1280, height: 720, getContext: () => context }), true); assert.equal(painted, 1); }
    finally { preview.dispose(); }
});
