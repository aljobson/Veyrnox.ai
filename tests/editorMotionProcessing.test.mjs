import test from 'node:test';
import assert from 'node:assert/strict';
import { grayscale, estimateBlockFlow, globalMotion, matchMotionPatch, meanLuminance, smoothMotionPath, trackMotionRegion, exposureStructureCorrelation, retainsExposureStructure } from '../app/veyrnox/_lib/editorMotionAnalysis.mjs';
import { applyExposure, interpolateMotionPictures, movementCrop, stabilizationZoom, trackedCrop, validateMotionOptions, warpPicture } from '../app/veyrnox/_lib/editorMotionProcessing.mjs';
function texture(width = 96, height = 64, seed = 1337) {
    const data = new Uint8ClampedArray(width * height * 4); let state = seed;
    for (let i = 0; i < width * height; i++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const v = 40 + (state >>> 24) * .65; data.set([v, v, v, 255], i * 4); }
    return { width, height, data };
}
function error(a, b, margin = 16) {
    let sum = 0, count = 0;
    for (let y = margin; y < a.height - margin; y++) for (let x = margin; x < a.width - margin; x++) { sum += Math.abs(a.data[(y * a.width + x) * 4] - b.data[(y * b.width + x) * 4]); count++; }
    return sum / count;
}
const rms = values => Math.sqrt(values.reduce((n, v) => n + v * v, 0) / values.length);
test('block motion recovers independent two-axis camera displacement through an exposure change', () => {
    const a = texture(), b = applyExposure(warpPicture(a, { translateX: 5, translateY: -3 }), 1.2);
    const flow = estimateBlockFlow(grayscale(a), grayscale(b)), motion = globalMotion(flow);
    assert.equal(motion.x, 5); assert.equal(motion.y, -3); assert.ok(motion.confidence > .65); assert.equal(motion.cut, false);
});
test('flat scenes, unrelated scene cuts and cancelled matching do not invent a reliable trajectory', () => {
    const flat = { width: 32, height: 24, data: new Float32Array(32 * 24).fill(.5) };
    assert.equal(matchMotionPatch(flat, flat, 12, 12).confidence, 0);
    assert.equal(globalMotion(estimateBlockFlow(flat, flat)).unknown, true);
    assert.equal(globalMotion(estimateBlockFlow(flat, flat)).cut, false, 'a blank scene is unknown motion, not proof of a cut');
    assert.equal(globalMotion(estimateBlockFlow(grayscale(texture()), grayscale(texture(96, 64, 900)))).cut, true);
    const controller = new AbortController(); controller.abort();
    assert.throws(() => estimateBlockFlow(flat, flat, { signal: controller.signal }), { name: 'AbortError' });
});
test('measured stabilization reduces translational frame jitter while retaining a smooth pan', () => {
    const source = texture(), jitter = [0, 3, -3, 4, -2, 3, -4, 2, 0, -3, 3, -2, 4, -4, 3, 0], samples = [{ x: 0, y: 0, luminance: .45 }]; let cumulative = 0, previous = source;
    for (let i = 1; i < jitter.length; i++) { const current = warpPicture(source, { translateX: jitter[i] }); const motion = globalMotion(estimateBlockFlow(grayscale(previous), grayscale(current))); cumulative += motion.x; samples.push({ x: cumulative, y: 0, luminance: .45, cut: motion.cut }); previous = current; }
    const corrected = smoothMotionPath(samples, 4), before = rms(jitter.slice(1).map((v, i) => v - jitter[i])), after = rms(corrected.slice(1).map((v, i) => v.smoothX - corrected[i].smoothX));
    assert.ok(after / before < .2, `${before} -> ${after}`);
    assert.ok(stabilizationZoom(corrected, 96, 64) > 1);
    const pan = smoothMotionPath(Array.from({ length: 25 }, (_, i) => ({ x: i, y: 0, luminance: .45 })), 4);
    assert.equal(pan[12].smoothX, 12); assert.equal(pan[12].correctionX, 0);
});
test('temporal exposure correction suppresses uniform alternating flicker without smearing a scene cut', () => {
    const a = texture(), frames = Array.from({ length: 21 }, (_, i) => applyExposure(a, i % 2 ? 1.2 : .8));
    assert.equal(globalMotion(estimateBlockFlow(grayscale(frames[0]), grayscale(frames[1]))).cut, false, 'uniform exposure changes retain a matching scene');
    const stats = frames.map(frame => ({ x: 0, y: 0, luminance: meanLuminance(grayscale(frame)) })), corrected = smoothMotionPath(stats, 4);
    const output = frames.map((frame, i) => meanLuminance(grayscale(applyExposure(frame, corrected[i].gain))));
    const variation = values => Math.max(...values) - Math.min(...values);
    assert.ok(variation(output.slice(4, -4)) / variation(stats.map(s => s.luminance)) < .2);
    const shots = smoothMotionPath([{ x: 0, y: 0, luminance: .2 }, { x: 0, y: 0, luminance: .2 }, { x: 0, y: 0, luminance: .7, cut: true }, { x: 0, y: 0, luminance: .7 }], 3);
    assert.ok(shots.every(s => Math.abs(s.gain - 1) < 1e-6));
});
test('coarse structure recognizes exposure changes after fine texture is lost, while unrelated and flat pictures remain cuts', () => {
    const original = grayscale(texture(160, 96)), exposed = { ...original, data: new Float32Array(original.data.length) };
    // A lossy transform retains only each 4x4 area's average, rather than each
    // original pixel. Normalized fine patch matching consequently loses confidence.
    for (let y = 0; y < 96; y += 4) for (let x = 0; x < 160; x += 4) {
        let mean = 0;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) mean += original.data[(y + dy) * 160 + x + dx] / 16;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) exposed.data[(y + dy) * 160 + x + dx] = mean * 1.25;
    }
    assert.equal(globalMotion(estimateBlockFlow(original, exposed)).cut, true);
    assert.ok(exposureStructureCorrelation(original, exposed) > .99);
    assert.equal(retainsExposureStructure(original, exposed), true);
    assert.equal(retainsExposureStructure(original, grayscale(applyExposure(texture(160, 96, 911), 1.25))), false);
    assert.equal(retainsExposureStructure(original, original), false, 'a luminance-preserving change cannot veto a cut');
    const flat = { width: 32, height: 24, data: new Float32Array(32 * 24).fill(.2) };
    assert.equal(exposureStructureCorrelation(flat, { ...flat, data: flat.data.map(() => .8) }), 0);
    assert.throws(() => exposureStructureCorrelation(flat, { ...flat, width: 31 }), /picture|matching/);
});
test('bidirectional optical flow synthesizes the actual intermediate position rather than two ghosts', () => {
    const a = texture(), b = warpPicture(a, { translateX: 8 }), truth = warpPicture(a, { translateX: 4 });
    const forward = estimateBlockFlow(grayscale(a), grayscale(b), { step: 8 }), backward = estimateBlockFlow(grayscale(b), grayscale(a), { step: 8 });
    const halfway = interpolateMotionPictures(a, b, forward, backward, .5), blended = { ...a, data: a.data.map((v, i) => (v + b.data[i]) / 2) };
    assert.ok(error(halfway, truth) < 2, String(error(halfway, truth)));
    assert.ok(error(halfway, truth) < error(blended, truth) * .1);
    assert.equal(interpolateMotionPictures(a, b, forward, backward, 0), a);
    assert.equal(interpolateMotionPictures(a, b, forward, backward, 1), b);
});
test('selected-region tracking follows its texture and explicitly reports an occlusion as lost', () => {
    const a = texture(), b = warpPicture(a, { translateX: 6, translateY: 2 }), region = { x: .3, y: .3, width: .2, height: .2 };
    const track = trackMotionRegion(grayscale(a), grayscale(b), region);
    assert.ok(track.tracked); assert.equal(track.x, region.x + 6 / a.width); assert.equal(track.y, region.y + 2 / a.height);
    const flat = { width: a.width, height: a.height, data: new Float32Array(a.width * a.height).fill(.5) };
    const lost = trackMotionRegion(grayscale(a), flat, region);
    assert.equal(lost.tracked, false); assert.equal(lost.x, region.x);
    const crop = trackedCrop(1920, 1080, 9 / 16, { x: track.x + track.width / 2, y: track.y + track.height / 2 });
    assert.ok(crop.x >= 0 && crop.x + crop.width <= 1920); assert.equal(crop.width / crop.height, 9 / 16);
    assert.ok(Math.abs(crop.x + crop.width / 2 - (track.x + track.width / 2) * 1920) < 1e-6);
});
test('camera movement produces a bounded evolving crop and processing options reject unbounded work', () => {
    const from = { x: .25, y: .5, zoom: 1.5 }, to = { x: .75, y: .5, zoom: 2 }, first = movementCrop(1920, 1080, from, to, 0), last = movementCrop(1920, 1080, from, to, 1);
    assert.ok(last.x > first.x); assert.ok(last.width < first.width);
    assert.equal(validateMotionOptions({ tool: 'optical-flow', height: 480, frameRate: 60 }), null);
    for (const options of [{ tool: 'optical-flow', height: 720 }, { tool: 'flicker', smoothing: 100 }, { tool: 'track-reframe', aspect: 1, region: { x: .9, y: 0, width: .5, height: .5 } }, { tool: 'camera-movement', from: { ...from, zoom: 500 }, to }]) assert.ok(validateMotionOptions(options));
    assert.throws(() => estimateBlockFlow({ width: 1e9, height: 1e9, data: [] }, {}));
});
test('local optical flow moves an independently moving foreground while the textured background stays still', () => {
    const background = texture(96, 64, 17), subject = texture(96, 64, 999);
    function position(left) { const frame = { ...background, data: new Uint8ClampedArray(background.data) }; for (let y = 18; y < 46; y++) for (let x = left; x < left + 32; x++) frame.data.set(subject.data.subarray((y * 96 + x - left + 20) * 4, (y * 96 + x - left + 20) * 4 + 4), (y * 96 + x) * 4); return frame; }
    const a = position(22), b = position(28), truth = position(25), forward = estimateBlockFlow(grayscale(a), grayscale(b), { step: 6, radius: 3 }), backward = estimateBlockFlow(grayscale(b), grayscale(a), { step: 6, radius: 3 });
    assert.equal(globalMotion(forward).x, 0, 'background camera motion must stay zero');
    const halfway = interpolateMotionPictures(a, b, forward, backward, .5);
    let innerError = 0, ghostError = 0, count = 0;
    for (let y = 27; y < 37; y++) for (let x = 36; x < 48; x++) { const p = (y * 96 + x) * 4; innerError += Math.abs(halfway.data[p] - truth.data[p]); ghostError += Math.abs((a.data[p] + b.data[p]) / 2 - truth.data[p]); count++; }
    assert.ok(innerError / count < 8, String(innerError / count)); assert.ok(innerError < ghostError * .25);
    for (let y = 8; y < 12; y++) for (let x = 8; x < 16; x++) assert.ok(Math.abs(halfway.data[(y * 96 + x) * 4] - background.data[(y * 96 + x) * 4]) < 2);
});
test('blank optical-flow pictures fall back to a nearest frame instead of inventing motion detail', () => {
    const a = { width: 32, height: 24, data: new Uint8ClampedArray(32 * 24 * 4).fill(60) }, b = { ...a, data: new Uint8ClampedArray(a.data.length).fill(140) };
    const forward = estimateBlockFlow(grayscale(a), grayscale(b)), backward = estimateBlockFlow(grayscale(b), grayscale(a));
    assert.deepEqual(interpolateMotionPictures(a, b, forward, backward, .25).data, a.data);
    assert.deepEqual(interpolateMotionPictures(a, b, forward, backward, .75).data, b.data);
});
test('motion-video preprocessing rejects bad sources, unsupported sizes and cancellation before opening media', async () => {
    const { processMotionVideo } = await import('../app/veyrnox/_lib/editorMotionVideo.mjs');
    await assert.rejects(processMotionVideo(new Blob(['not video'], { type: 'text/plain' }), { tool: 'flicker' }), /under 100 MiB/);
    await assert.rejects(processMotionVideo(new Blob(['video'], { type: 'video/mp4' }), { tool: 'optical-flow', height: 720 }), /480p/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(processMotionVideo(new Blob(['video'], { type: 'video/mp4' }), { tool: 'stabilize', signal: controller.signal }), { name: 'AbortError' });
    await assert.rejects(processMotionVideo(new Blob(['video'], { type: 'video/mp4' }), { tool: 'stabilize' }), /desktop Chrome/);
});
