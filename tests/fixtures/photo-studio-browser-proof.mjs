import { proveHair } from './photo-studio-hair-proof.mjs';
import { proveMakeup } from './photo-studio-makeup-proof.mjs';
import { MAKEUP_PRESETS } from '../../packages/live-edit/makeup.js';
// Original synthetic colours/geometry only; no person photo or third-party fixture.
import { createPhotoRenderer } from '../../app/veyrnox/_lib/liveEdit/renderer.js';
import { createPhotoEngine } from '../../app/veyrnox/_lib/liveEdit/engine.js';
import { createVisionProcessor } from '../../app/veyrnox/_lib/editorVisionWorkerClient.mjs';
import { createFaceProcessor } from '../../app/veyrnox/_lib/liveEdit/faceClient.mjs';
import { DEFAULTS } from '../../packages/live-edit/effects.js';
import { OVAL, LEFT_EYE, RIGHT_EYE, LIPS, INNER_LIPS, LEFT_BROW, RIGHT_BROW } from '../../packages/live-edit/regions.js';
const checks = [];
const assert = (value, label) => { if (!value) throw new Error(label); };
const canvas = () => document.createElement('canvas');
const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
const maxDifference = (a, b) => a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i])), 0);
let renderer, engine, oldClient, hairClient, faceClient, decodedSource;
try {
    let blocked = false;
    try { await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])); } catch { blocked = true; }
    assert(blocked, 'Page WASM must be blocked'); checks.push('page-wasm-blocked');
    checks.push(...proveMakeup());
    checks.push(...await proveHair());
    const source = canvas(); source.width = 192; source.height = 128;
    const ctx = source.getContext('2d');
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        const noise = ((x * 17 + y * 31) % 23) - 11;
        ctx.fillStyle = `rgb(${90 + x / 3 + noise},${70 + y / 2 + noise},${80 + noise})`; ctx.fillRect(x, y, 1, 1);
    }
    decodedSource = await createImageBitmap(source, { premultiplyAlpha: 'none' });
    const target = canvas(); renderer = createPhotoRenderer(target, decodedSource); renderer.draw(DEFAULTS);
    const original = pixels(source);
    assert(maxDifference(original, pixels(target)) === 0, 'Strength zero exact decoded pixels'); checks.push('zero-identical');
    const points = new Float32Array(478 * 3);
    const ellipse = (indices, cx, cy, rx, ry) => indices.forEach((index, i) => { const angle = i / indices.length * 2 * Math.PI; points[index * 3] = cx + Math.cos(angle) * rx; points[index * 3 + 1] = cy + Math.sin(angle) * ry; });
    ellipse(OVAL,.5,.5,.4,.45); ellipse(LEFT_EYE,.35,.4,.06,.035); ellipse(RIGHT_EYE,.65,.4,.06,.035);
    ellipse(LEFT_BROW,.35,.3,.07,.02); ellipse(RIGHT_BROW,.65,.3,.07,.02); ellipse(LIPS,.5,.7,.12,.04); ellipse(INNER_LIPS,.5,.7,.08,.02);
    renderer.setLandmarks(points); renderer.draw({ ...DEFAULTS, smoothing: 1 });
    const smoothed = pixels(target), at = (x,y) => (Math.round(y * 128) * 192 + Math.round(x * 192)) * 4;
    for (const [x,y] of [[.35,.4],[.65,.4],[.5,.7],[.02,.02]]) for (let c = 0; c < 3; c++) assert(Math.abs(smoothed[at(x,y)+c] - original[at(x,y)+c]) <= 1, 'Smoothing excludes eyes/mouth/background');
    assert(maxDifference(original, smoothed) > 1, 'Smoothing must change skin pixels'); checks.push('skin-holes');
    renderer.setLandmarks(null); renderer.draw({ ...DEFAULTS, smoothing: 1, blemish: 1, teeth: 1, eyes: 1 });
    assert(maxDifference(original, pixels(target)) <= 1, 'No face must disable face effects'); checks.push('face-off');
    renderer.draw({ ...DEFAULTS, brightness: 0.2 }); const brighter = pixels(target);
    for (let i = 0; i < original.length; i += 4) for (let c = 0; c < 3; c++) assert(Math.abs(brighter[i+c] - Math.min(255, original[i+c] + 25.5)) <= 1, 'Brightness/orientation reference');
    checks.push('webgl-orientation-reference'); renderer.close(); renderer = undefined;
    engine = createPhotoEngine(target, decodedSource, { processorFactory: async () => ({ detect: async () => ({ count: 1, landmarks: points }), close() {} }), hairProcessorFactory: async () => ({ segment: async () => ({ width:8,height:8,hair:new Float32Array(64) }), close() {} }) });
    await engine.ready;
    engine.setSettings({ ...DEFAULTS, makeup: { ...MAKEUP_PRESETS.glam, foundation: { strength: .4, shade: 'sand' } }, warmth: .3, grain: .2, smoothing: .4, lut: 'film', lutStrength: .4, stickers: [{ kind: 'heart', x: .5, y: .5, size: .15 }] });
    await new Promise(requestAnimationFrame); const preview = pixels(target).slice(); engine.compare(true);
    const blob = await engine.export('image/png'); const image = await createImageBitmap(blob); const decoded = canvas(); decoded.width = image.width; decoded.height = image.height; decoded.getContext('2d').drawImage(image, 0, 0); image.close();
    assert(decoded.width === source.width && decoded.height === source.height, 'Source resolution export');
    assert(maxDifference(preview, pixels(decoded)) === 0, 'Combined-stack PNG export must equal preview'); checks.push('export-equality', 'makeup-export-equality');
    engine.close(); engine = undefined;
    engine = createPhotoEngine(target, decodedSource, { processorFactory: async () => ({ detect: async () => ({ count: 2, landmarks: points }), close() {} }) });
    await engine.ready; engine.setSettings({ ...DEFAULTS, makeup: MAKEUP_PRESETS.glam });
    await new Promise(requestAnimationFrame);
    assert(maxDifference(original, pixels(target)) === 0, 'Multiple faces disable makeup even if stale points are supplied');
    checks.push('makeup-multiple-faces'); engine.close(); engine = undefined;
    oldClient = await createVisionProcessor(); const segmentation = await oldClient.segment(source, 1);
    assert(segmentation.face.length === segmentation.width * segmentation.height && segmentation.background.length > 0, 'Old client must process through retained prefix');
    checks.push('retained-person-client'); oldClient.close(); oldClient = undefined;
    hairClient = await createVisionProcessor({ hair:true }); const hairResult = await hairClient.segment(source,1);
    assert(hairResult.hair instanceof Float32Array && hairResult.hair.length === hairResult.width * hairResult.height && hairResult.hair.every(v=>v>=0 && v<=1), 'New hair Worker confidence channel');
    checks.push('hair-worker-channel'); hairClient.close(); hairClient=undefined;
    faceClient = await createFaceProcessor(); const result = await faceClient.detect(source);
    assert(result.count === 0 && result.landmarks.length === 0, 'Synthetic gradient must return no face'); checks.push('face-worker-no-face');
    window.photoProof = { checks };
} catch (error) { window.photoProof = { checks, error: error.message }; }
finally { renderer?.close(); engine?.close(); oldClient?.close(); hairClient?.close(); faceClient?.close(); decodedSource?.close(); }
