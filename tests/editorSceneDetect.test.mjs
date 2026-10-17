import test from 'node:test';
import assert from 'node:assert/strict';
import { frameSignature, signatureDistance, detectScenes, scoreCuts, SCENE_DEFAULTS } from '../app/veyrnox/_lib/editorSceneDetect.mjs';

const W = 32, H = 18, FPS = 30;

// A deterministic picture: a luma ramp plus a rectangle, so the histogram and the edges both depend on the seed.
function picture(seed, brightness = 0) {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const inBox = x >= (seed * 5) % 20 && x < ((seed * 5) % 20) + 9 && y >= (seed * 3) % 9 && y < ((seed * 3) % 9) + 7;
        const v = Math.max(0, Math.min(255, (inBox ? 230 - seed * 17 : 30 + ((x + seed * 40) * 4) % 90) + brightness));
        px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
    return px;
}
const sig = (seed, brightness) => frameSignature(picture(seed, brightness), W, H);

// Frames for a list of shots: [seed, frames]. A tiny drift inside a shot stands in for sensor noise and slow motion.
function shots(list) {
    const out = [];
    let t = 0;
    for (const [seed, frames] of list) {
        for (let f = 0; f < frames; f++, t++) out.push({ time: t / FPS, signature: sig(seed, f % 3) });
    }
    return out;
}
const times = (r) => r.cuts.map((c) => Number(c.time.toFixed(2)));

test('a signature of the same picture is identical and of different pictures is far apart', () => {
    assert.equal(signatureDistance(sig(1), sig(1)), 0);
    assert.ok(signatureDistance(sig(1), sig(4)) > SCENE_DEFAULTS.hardFloor);
    assert.ok(signatureDistance(sig(1, 0), sig(1, 2)) < 0.1, 'slight brightness drift stays small');
});

test('frameSignature refuses pixels that do not match the stated size', () => {
    assert.throws(() => frameSignature(new Uint8ClampedArray(10), W, H));
    assert.throws(() => frameSignature(null, W, H));
});

test('hard cuts between different shots are found at the first frame of the new shot', () => {
    const r = detectScenes(shots([[1, 60], [4, 60], [7, 60]]));
    assert.deepEqual(times(r), [2, 4]);
    assert.ok(r.cuts.every((c) => c.kind === 'hard'));
});

test('a clip with one continuous shot has no cuts', () => {
    assert.deepEqual(detectScenes(shots([[2, 150]])).cuts, []);
});

test('a two-frame flash inside one shot is not a cut', () => {
    const frames = shots([[2, 150]]);
    const white = frameSignature(new Uint8ClampedArray(W * H * 4).fill(255), W, H);
    frames[60] = { ...frames[60], signature: white };
    frames[61] = { ...frames[61], signature: white };
    assert.deepEqual(detectScenes(frames).cuts, []);
});

test('shots shorter than the minimum keep only the stronger cut', () => {
    const r = detectScenes(shots([[1, 40], [4, 3], [7, 40]]), { minShotSeconds: 0.5 });
    assert.equal(r.cuts.length, 1);
});

test('too few frames give no cuts instead of an error', () => {
    assert.deepEqual(detectScenes([]).cuts, []);
    assert.deepEqual(detectScenes(shots([[1, 2]])).cuts, []);
});

test('a dissolve over two thirds of a second is found once as a gradual cut', () => {
    const a = shots([[1, 60]]);
    const b = shots([[7, 60]]).map((f) => ({ ...f, time: f.time + 2 + 20 / FPS }));
    // A smooth blend of the two signatures, which is what a dissolve looks like to the detector.
    const from = sig(1), to = sig(7), mix = [];
    for (let k = 0; k < 20; k++) {
        const w = (k + 1) / 21;
        mix.push({
            time: 2 + k / FPS,
            signature: {
                hist: from.hist.map((v, i) => v * (1 - w) + to.hist[i] * w),
                edges: from.edges.map((v, i) => Math.round(v * (1 - w) + to.edges[i] * w)),
            },
        });
    }
    // The test pictures differ by 0.48, far less than two real shots, so the floor is lowered to match.
    const options = { gradualFloor: 0.25 };
    const r = detectScenes([...a, ...mix, ...b], options);
    assert.equal(r.cuts.length, 1);
    assert.equal(r.cuts[0].kind, 'gradual');
    assert.ok(Math.abs(r.cuts[0].time - (2 + 10 / FPS)) < 0.25);
    assert.equal(detectScenes([...a, ...mix, ...b], { ...options, gradual: false }).cuts.length, 0);
});

test('scoreCuts counts a detection once and only inside the tolerance', () => {
    const s = scoreCuts([4.1, 8, 20], [4, 8, 12], 0.25);
    assert.equal(s.hits, 2);
    assert.equal(s.precision, 2 / 3);
    assert.equal(s.recall, 2 / 3);
    assert.deepEqual(scoreCuts([], []), { hits: 0, detected: 0, truth: 0, precision: 1, recall: 1 });
    assert.equal(scoreCuts([4, 4.05], [4]).hits, 1, 'one mark cannot be matched twice');
});
