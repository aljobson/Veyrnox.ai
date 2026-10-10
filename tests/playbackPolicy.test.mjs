import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('Library clips play by the same policy as the landing tiles, never on their own', () => {
    const read = (p) => readFileSync(new URL(`../app/veyrnox/${p}`, import.meta.url), 'utf8');
    // They used to loop from page load with no way to stop them (WCAG 2.2.2).
    assert.doesNotMatch(read('app/library/page.js'), /autoPlay/);
    assert.match(read('app/library/page.js'), /<LibraryClip cardRef=\{card\} /);
    const clip = read('_components/LibraryClip.js');
    assert.match(clip, /useClipPlayback\(cardRef, videoRef\)/);
    assert.doesNotMatch(clip, /autoPlay|controls/);
    assert.match(read('_components/MediaTile.js'), /useClipPlayback\(rootRef, videoRef\)/);
    const hook = read('_lib/useClipPlayback.js');
    assert.match(hook, /playbackMode\(\{\s*reducedMotion: reducedQuery\.matches,\s*saveData: /);
    assert.match(hook, /window\.setTimeout\(stop, TOUCH_MAX_PLAY_MS\)/);
    assert.match(hook, /if \(mode === 'off'\) return undefined;/);
});
