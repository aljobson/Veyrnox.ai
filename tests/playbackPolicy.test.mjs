import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackMode, TOUCH_MAX_PLAY_MS } from '../app/veyrnox/_lib/playbackPolicy.js';

const base = { reducedMotion: false, saveData: false, effectiveType: '4g', canHover: true };

test('a mouse device plays on hover', () => {
    assert.equal(playbackMode(base), 'hover');
});

test('a touch device on a fast connection plays in view', () => {
    assert.equal(playbackMode({ ...base, canHover: false }), 'inview');
});

test('an unknown connection type is treated as fast', () => {
    assert.equal(playbackMode({ ...base, canHover: false, effectiveType: undefined }), 'inview');
});

test('reduced motion and data-saver switch playback off on every device', () => {
    for (const canHover of [true, false]) {
        assert.equal(playbackMode({ ...base, canHover, reducedMotion: true }), 'off');
        assert.equal(playbackMode({ ...base, canHover, saveData: true }), 'off');
    }
});

test('a slow connection switches touch playback off', () => {
    for (const effectiveType of ['slow-2g', '2g', '3g']) {
        assert.equal(playbackMode({ ...base, canHover: false, effectiveType }), 'off', effectiveType);
    }
});

test('a slow connection does not block hover: nothing plays until the user asks', () => {
    assert.equal(playbackMode({ ...base, effectiveType: '3g' }), 'hover');
});

test('touch autoplay stops within the WCAG 2.2.2 five second line', () => {
    assert.ok(TOUCH_MAX_PLAY_MS <= 5000);
});
