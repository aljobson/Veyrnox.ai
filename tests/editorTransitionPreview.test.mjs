import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSITIONS } from '../app/veyrnox/_lib/editorEffects.mjs';
import { NEW_TRANSITION_IDS } from '../app/veyrnox/_lib/editorTransitionGeometry.mjs';
import { paintTransitionPreview } from '../app/veyrnox/_lib/editorTransitionPreviewPaint.mjs';
import { transitionPreview } from '../app/veyrnox/_lib/editorGuidance.mjs';

const recorder = () => {
    const calls = [];
    const g = new Proxy({}, { get: (_, name) => name === 'createRadialGradient' ? () => ({ addColorStop() {} }) : (...args) => { calls.push(name); return undefined; }, set: () => true });
    return { g, calls };
};

test('every new transition paints two pictures on the canvas preview', () => {
    for (const id of NEW_TRANSITION_IDS) {
        const { g, calls } = recorder();
        assert.equal(paintTransitionPreview(g, 192, 108, id, 0.5), true, id);
        assert.equal(calls.filter(name => name === 'fillRect').length >= 3, true, id);
    }
});

test('shape previews clip with the same path operations as the export', () => {
    for (const id of ['iris-open', 'iris-close', 'clock-wipe', 'barn-doors', 'blinds', 'pixel-dissolve']) {
        const { g, calls } = recorder();
        paintTransitionPreview(g, 192, 108, id, 0.5);
        assert.ok(calls.includes('clip'), id);
    }
});

test('light leak draws its sweep over the picture', () => {
    const { g, calls } = recorder();
    paintTransitionPreview(g, 192, 108, 'light-leak', 0.5);
    assert.ok(calls.includes('fillText'));
});

test('transitions handled by the original code are not painted here', () => {
    const { g } = recorder();
    for (const id of ['dissolve', 'wipe-left', 'slide-down', 'zoom', 'blur']) assert.equal(paintTransitionPreview(g, 192, 108, id, 0.5), false, id);
});

test('every catalogue transition has a preview of its own, never the dissolve fallback', () => {
    for (const { id } of TRANSITIONS) {
        if (NEW_TRANSITION_IDS.includes(id) || id === 'dissolve') continue;
        assert.notEqual(transitionPreview(id), transitionPreview('dissolve'), id);
    }
});
