import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { grayscale, trackMotionRegion } from '../app/veyrnox/_lib/editorMotionAnalysis.mjs';
import { warpPicture } from '../app/veyrnox/_lib/editorMotionProcessing.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/editorAdvancedMotion.json', import.meta.url)));
const swift = readFileSync(new URL('../apps/mobile/modules/editor-media/ios/EditorAdvancedMotion.swift', import.meta.url), 'utf8');

function texture({ width, height, seed }) {
    const data = new Uint8ClampedArray(width * height * 4); let state = seed;
    for (let i = 0; i < width * height; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const value = 40 + (state >>> 24) * .65;
        data.set([value, value, value, 255], i * 4);
    }
    return { width, height, data };
}

function smooth(samples, radius, frameRate) {
    const averaged = samples.map((sample, index) => {
        const window = samples.slice(Math.max(0, index - radius), Math.min(samples.length, index + radius + 1));
        return { ...sample, x: window.reduce((sum, value) => sum + value.x, 0) / window.length,
            y: window.reduce((sum, value) => sum + value.y, 0) / window.length };
    });
    const maximumStep = 1.5 / frameRate, result = averaged.map(value => ({ ...value }));
    for (let index = 1; index < result.length; index++) {
        const dx = averaged[index].x - result[index - 1].x, dy = averaged[index].y - result[index - 1].y;
        const distance = Math.hypot(dx, dy), scale = distance > maximumStep ? maximumStep / distance : 1;
        result[index].x = Math.max(0, Math.min(1, result[index - 1].x + dx * scale));
        result[index].y = Math.max(0, Math.min(1, result[index - 1].y + dy * scale));
    }
    return result;
}

test('the native region fixture is produced by the canonical web tracker', () => {
    const original = texture(fixture.regionTrack.frame), moved = warpPicture(original, {
        translateX: fixture.regionTrack.translation.x, translateY: fixture.regionTrack.translation.y,
    });
    const tracked = trackMotionRegion(grayscale(original), grayscale(moved), fixture.regionTrack.region);
    assert.equal(tracked.tracked, true);
    assert.deepEqual({ x: tracked.x, y: tracked.y, width: tracked.width, height: tracked.height }, fixture.regionTrack.expectedRegion);
    assert.deepEqual({ x: tracked.x + tracked.width / 2, y: tracked.y + tracked.height / 2 }, fixture.regionTrack.expectedCentre);
});

test('the shared smoothing fixture is frame-rate bounded and a lost subject holds its last verified centre', () => {
    const samples = fixture.smoothing.rawX.map((x, index) => ({ x, y: fixture.smoothing.rawY[index], tracked: true, confidence: 1, lostFrames: 0 }));
    const close = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12));
    close(smooth(samples, fixture.smoothing.radius, 60).map(value => value.x), fixture.smoothing.expected60X);
    close(smooth(samples, fixture.smoothing.radius, 24).map(value => value.x), fixture.smoothing.expected24X);
    const held = Array.from({ length: fixture.lostSubject.heldCentres }, (_, index) => ({
        ...fixture.lostSubject.verifiedCentre, tracked: false, confidence: 0, lostFrames: index + 1,
    }));
    assert.ok(held.every(value => value.x === fixture.lostSubject.verifiedCentre.x && value.y === fixture.lostSubject.verifiedCentre.y));
});

test('the isolated native seam admits real local flow without widening lifecycle limits', () => {
    assert.match(swift, /VNGenerateOpticalFlowRequest/);
    assert.equal((swift.match(/opticalFlow\(from:/g) ?? []).length, 3, 'definition plus forward and backward calls');
    assert.match(swift, /forwardAtBackward/);
    assert.match(swift, /reverseAtForward/);
    assert.doesNotMatch(swift, /CIDissolveTransition|translation\(/);
    assert.match(swift, /VNTrackObjectRequest/);
    assert.match(swift, /maximumLostFrames = 8/);
    assert.match(swift, /static let minimumIOS = "16\.4"/);
    assert.match(swift, /static let batchSize = 8/);
    assert.match(swift, /static let maximumFrames = 1_800/);
    assert.match(swift, /height <= maximumOpticalHeight/);
    assert.match(swift, /try check\(cancelled\)/);
    assert.deepEqual(fixture.limits, { maximumFrames: 1800, batchSize: 8, maximumOpticalHeight: 480, maximumLostFrames: 8 });
});
