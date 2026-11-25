import test from 'node:test';
import assert from 'node:assert/strict';
import { snapTextPosition, TEXT_GUIDES } from '../app/veyrnox/_lib/editorTextGuides.mjs';
test('text placement snaps independently to safe-edge and centre guides', () => {
    assert.deepEqual(TEXT_GUIDES, [0.1, 0.5, 0.9]);
    assert.deepEqual(snapTextPosition(0.486, 0.112), { x: 0.5, y: 0.1, guideX: 0.5, guideY: 0.1 });
    assert.deepEqual(snapTextPosition(0.3, 0.7), { x: 0.3, y: 0.7, guideX: null, guideY: null });
    assert.deepEqual(snapTextPosition(-1, 2), { x: 0, y: 1, guideX: null, guideY: null });
});
