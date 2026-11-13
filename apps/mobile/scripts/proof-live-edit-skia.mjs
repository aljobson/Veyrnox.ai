// Software Skia qualification, not a claim about iOS/Android rendering or frame cost.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { makeupFixture } from '../../../tests/fixtures/photo-studio-makeup-fixture.mjs';
const require = createRequire(import.meta.url);
const CanvasKit = await require('canvaskit-wasm/bin/full/canvaskit.js')({ locateFile: name => require.resolve(`canvaskit-wasm/bin/full/${name}`) });
const { JsiSkApi } = require('../node_modules/@shopify/react-native-skia/lib/commonjs/skia/web/JsiSkia.js');
const types = require('../node_modules/@shopify/react-native-skia/lib/commonjs/skia/types/index.js');
const Skia = JsiSkApi(CanvasKit);
globalThis.__liveEditSkia = { Skia, ...types };
const { outputFiles } = await build({ stdin: { contents: `export { renderEffectStack } from './renderEffectStack'; export { normalizeStack, MAKEUP, WIG_IDS, tintMatrix } from './engine'; export { planWig, drawWig, wigStatus, putOverlay, overlayKey, clearOverlays } from './wig'; export * as shaders from './shaders';`, resolveDir: fileURLToPath(new URL('../src/lib/liveEdit/', import.meta.url)), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false,
    plugins: [{ name: 'software-skia', setup(b) {
        b.onResolve({ filter: /^@shopify\/react-native-skia$/ }, () => ({ path: 'skia', namespace: 'software' }));
        b.onLoad({ filter: /.*/, namespace: 'software' }, () => ({ contents: 'export const {Skia,TileMode,FilterMode,MipmapMode,PaintStyle,ColorType,AlphaType,ClipOp}=globalThis.__liveEditSkia;' }));
    } }],
});
const module = { exports: {} }; new Function('module', 'exports', outputFiles[0].text)(module, module.exports);
const { renderEffectStack, normalizeStack, MAKEUP, shaders, WIG_IDS, tintMatrix, planWig, wigStatus, putOverlay, overlayKey, clearOverlays } = module.exports;
for (const [name, source] of Object.entries(shaders)) { const effect = Skia.RuntimeEffect.Make(source); assert.ok(effect, `${name} compiles`); effect.dispose(); }
// Same original synthetic fixture geometry as the web; no real person's image.
globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) };
const { points } = makeupFixture(); delete globalThis.document;
const w = 256, h = 256, bytes = new Uint8Array(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rgb = x < 16 && y < 16 ? [20, 40, 80] : x > 239 && y > 239 ? [180, 160, 140] : [128, 96, 64];
    if (x > 90 && x < 110 && y > 130 && y < 150) for (let i = 0; i < 3; i++) rgb[i] += (x + y) % 2 ? 12 : -12;
    bytes.set([...rgb, 255], (y * w + x) * 4);
}
const data = Skia.Data.fromBytes(bytes), image = Skia.Image.MakeImage({ width: w, height: h, colorType: types.ColorType.RGBA_8888, alphaType: types.AlphaType.Opaque }, data, w * 4); data.dispose();
assert.ok(image);
const source = { sourceId: 1, frameId: 1, image };
const hair = new Float32Array(64 * 64); for (let y = 2; y < 14; y++) for (let x = 16; x < 48; x++) hair[y * 64 + x] = .9;
const inference = { sourceId: 1, frameId: 1, count: 1, landmarks: points, hair: { width: 64, height: 64, hair } };
function draw(stack, result = inference) {
    const surface = Skia.Surface.Make(w, h), picture = renderEffectStack(source, stack, result);
    try {
        surface.getCanvas().drawPicture(picture); surface.flush();
        const snapshot = surface.makeImageSnapshot();
        try { return { pixels: Uint8Array.from(snapshot.readPixels()), png: snapshot.encodeToBytes(types.ImageFormat.PNG) }; }
        finally { snapshot.dispose(); }
    } finally { picture.dispose(); surface.dispose(); }
}
try {
    assert.deepEqual(draw(normalizeStack()).pixels, bytes, 'zero strength = identical pixels');
    const combined = normalizeStack({ look: 'warm', smoothing: .5, makeup: Object.fromEntries(MAKEUP.map(d => [d.id, { strength: .5, shade: d.shades[0] }])), hair: { strength: .8, shade: 'plum', shade2: 'blonde', mode: 'ombre' } });
    const preview = draw(combined), exported = draw(combined);
    assert.deepEqual(preview.pixels, exported.pixels, 'preview/export replay equality: tolerance 0');
    const encoded = Skia.Data.fromBytes(exported.png), decoded = Skia.Image.MakeImageFromEncoded(encoded); encoded.dispose();
    assert.deepEqual(Uint8Array.from(decoded.readPixels()), preview.pixels, 'PNG round trip equality'); decoded.dispose();
    assert.notDeepEqual(preview.pixels, bytes);
    const at = (pixels, x, y) => Array.from(pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
    for (const d of MAKEUP) {
        const only = normalizeStack({ makeup: { [d.id]: { strength: 1, shade: d.shades[0] } } });
        const out = draw(only).pixels;
        assert.notDeepEqual(out, bytes, `${d.id} changes pixels`);
        for (const [x, y] of [[84, 97], [171, 97], [128, 184], [3, 3], [250, 250]]) assert.deepEqual(at(out, x, y), at(bytes, x, y), `${d.id} protects eyes/mouth/background and orientation`);
    }
    const smooth = draw(normalizeStack({ smoothing: 1 })).pixels;
    assert.notDeepEqual(smooth, bytes, 'smoothing changes textured skin');
    assert.deepEqual(at(smooth, 84, 97), at(bytes, 84, 97), 'smoothing protects eye');
    const recoloured = draw(normalizeStack({ hair: { strength: 1, shade: 'teal', shade2: 'blonde', mode: 'solid' } })).pixels;
    assert.notDeepEqual(recoloured, bytes, 'confident hair changes colour');
    assert.deepEqual(at(recoloured, 3, 3), at(bytes, 3, 3), 'hair background confidence zero leaves pixels unchanged');
    assert.deepEqual(draw(combined, { ...inference, count: 2, hair: null }).pixels, draw(normalizeStack({ look: 'warm' })).pixels, 'multiple faces disable all face/hair effects');
    // ---- 2D wigs (S5b): real Skia rendering of the embedded art with the shared fit maths -------------------------------------
    const wigStack = (style, extra = {}) => normalizeStack({ wig: { style, strength: 1, ...extra }, ...extra.stack });
    assert.deepEqual(draw(wigStack('none')).pixels, bytes, 'no wig = identical pixels');
    const lumaOf = (pixels, x0, y0, x1, y1) => { let sum = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; sum += .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]; n++; } return sum / n; };
    const diffCount = (a, b, x0 = 0, y0 = 0, x1 = w, y1 = h) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) n++; } return n; };
    assert.equal(WIG_IDS.length, 6, 'six embedded wig styles');
    for (const style of WIG_IDS) {
        const planned = planWig(normalizeStack({ wig: { style, strength: 1 } }).wig, normalizeStack().hair, inference, w, h);
        assert.ok(planned.plan && planned.status === 'ready', `${style} is planned from the shared fit (${planned.status})`);
        const out = draw(wigStack(style)).pixels;
        assert.ok(diffCount(out, bytes) > 800, `${style} visibly changes the picture (${diffCount(out, bytes)} px)`);
        // Eyes, mouth and the middle of the face are never covered. (Long styles may legitimately hang to the frame corners here:
        // this synthetic face fills almost the whole frame, so the full protected-polygon check below is the real invariant.)
        for (const [x, y] of [[84, 97], [171, 97], [128, 184], [128, 150]]) assert.deepEqual(at(out, x, y), at(bytes, x, y), `${style} leaves (${x},${y}) alone`);
        if (style === 'pixie') { // orientation: a pixie sits on top of the head, so its changed pixels centre above the middle of the face
            let sum = 0, n = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (Math.abs(out[i] - bytes[i]) + Math.abs(out[i + 1] - bytes[i + 1]) + Math.abs(out[i + 2] - bytes[i + 2]) > 12) { sum += y; n++; } }
            assert.ok(n > 800 && sum / n < 100, `pixie sits above the face (mean y ${(sum / n).toFixed(1)})`);
        }
        // The invariant: no pixel strictly inside a protected polygon (face below the hairline, eyes, brows, mouth) ever changes.
        const insidePolygon = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = [poly[i][0] * w, poly[i][1] * h], [xj, yj] = [poly[j][0] * w, poly[j][1] * h]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
        const strictlyInside = (poly, x, y) => [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dy]) => insidePolygon(poly, x + dx, y + dy));
        let violations = 0, checked = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (!planned.plan.holes.some(poly => strictlyInside(poly, x, y))) continue;
            checked++; const i = (y * w + x) * 4; if (out[i] !== bytes[i] || out[i + 1] !== bytes[i + 1] || out[i + 2] !== bytes[i + 2]) violations++;
        }
        assert.ok(checked > 10000, `${style}: the protected area is large enough to mean something (${checked})`);
        assert.equal(violations, 0, `${style} changed ${violations} pixels inside the protected face/eyes/brows/mouth`);
        assert.deepEqual(draw(wigStack(style)).pixels, out, `${style} preview/export replay equality: tolerance 0`);
    }
    // Strength 0, a lost face, two faces and a stale frame draw no wig (exact pixels).
    assert.deepEqual(draw(wigStack('bob', { strength: 0 })).pixels, bytes, 'wig strength 0 = identical pixels');
    for (const lost of [{ ...inference, count: 0, hair: null }, { ...inference, count: 2, hair: null }, null]) assert.deepEqual(draw(wigStack('bob'), lost).pixels, bytes, 'no single face = no wig');
    assert.equal(planWig(normalizeStack({ wig: { style: 'bob', strength: 1 } }).wig, normalizeStack().hair, { ...inference, count: 0 }, w, h).status, 'face-required');
    // Head turned away: the depth-based pose proxy fades the wig out completely.
    const turned = Float32Array.from(points); for (let i = 0; i < 478; i++) turned[i * 3 + 2] = (turned[i * 3] - .5) * 3;
    assert.equal(planWig(normalizeStack({ wig: { style: 'bob', strength: 1 } }).wig, normalizeStack().hair, { ...inference, landmarks: turned }, w, h).status, 'angle');
    assert.deepEqual(draw(wigStack('bob'), { ...inference, landmarks: turned }).pixels, bytes, 'a head turned too far draws no wig');
    // Opacity and size are real controls.
    const full = draw(wigStack('bob')).pixels, half = draw(wigStack('bob', { strength: .5 })).pixels, big = draw(wigStack('bob', { size: 1.3 })).pixels, small = draw(wigStack('bob', { size: .75 })).pixels;
    assert.ok(diffCount(half, bytes) <= diffCount(full, bytes) && diffCount(half, full) > 200, 'half opacity differs from full');
    assert.ok(diffCount(big, bytes) > diffCount(small, bytes), 'a larger wig covers more of the frame than a smaller one');
    // Tint: hair colour tints the wig while keeping its own light and shade (matrix preserves luminance), and never touches transparent pixels.
    // No hair mask here, so the hair-recolour pass cannot touch the photographed hair: only the WIG is tinted.
    const noMask = { ...inference, hair: null };
    const plain = draw(wigStack('bob'), noMask).pixels, tinted = draw(normalizeStack({ wig: { style: 'bob', strength: 1 }, hair: { strength: 1, shade: 'teal', shade2: 'blonde', mode: 'solid' } }), noMask).pixels;
    assert.ok(diffCount(tinted, plain) > 800, 'the hair shade tints the wig');
    let spill = 0; for (let i = 0; i < bytes.length; i += 4) if (plain[i] === bytes[i] && plain[i + 1] === bytes[i + 1] && plain[i + 2] === bytes[i + 2] && Math.abs(tinted[i] - bytes[i]) + Math.abs(tinted[i + 1] - bytes[i + 1]) + Math.abs(tinted[i + 2] - bytes[i + 2]) > 6) spill++; // visible spill only: edge antialiasing may round by a level
    assert.equal(spill, 0, `tinting never reaches pixels the wig does not cover (${spill})`);
    const m = tintMatrix([0.1, 0.6, 0.6], 1);
    assert.equal(m.length, 20); assert.deepEqual(m.slice(15), [0, 0, 0, 1, 0], 'alpha row untouched');
    for (const sample of [[200, 40, 40], [30, 30, 30], [250, 250, 250]]) {
        const out = [0, 1, 2].map(r => m[r * 5] * sample[0] + m[r * 5 + 1] * sample[1] + m[r * 5 + 2] * sample[2]);
        const before = .2126 * sample[0] + .7152 * sample[1] + .0722 * sample[2], after = .2126 * out[0] + .7152 * out[1] + .0722 * out[2];
        assert.ok(Math.abs(before - after) < 1e-6 || after >= before - 1e-6, 'tint keeps luminance (or brightens when the gain was clamped)');
    }
    // Coverage hint (R4): the hair stays, and the app says when it sticks out past the wig. Relations only, no hand-derived pixels.
    const quiet = { ...inference, hair: { width: 64, height: 64, hair: new Float32Array(64 * 64) } };
    const outside = new Float32Array(64 * 64); for (let y = 52; y < 62; y++) for (let x = 4; x < 60; x++) outside[y * 64 + x] = .95; // hair far below any wig
    const standard = normalizeStack({ wig: { style: 'bob', strength: 1 } });
    assert.equal(wigStatus(standard.wig, standard.hair, quiet, w, h), 'ready', 'no hair to leave uncovered');
    assert.equal(wigStatus(standard.wig, standard.hair, { ...inference, hair: { width: 64, height: 64, hair: outside } }, w, h), 'uncovered', 'hair left outside the wig raises the hint');
    assert.equal(wigStatus(standard.wig, standard.hair, { ...inference, hair: null }, w, h), 'coverage-unknown', 'no hair mask = coverage unknown');
    assert.equal(wigStatus(normalizeStack().wig, standard.hair, inference, w, h), 'off');
    assert.deepEqual(draw(wigStack('bob'), { ...inference, hair: { width: 64, height: 64, hair: outside } }).pixels.length, bytes.length);
    // ---- 3D wigs (S9): the overlay is rendered elsewhere (three.js in the WebView); Skia only composites it, for preview and export alike ----
    {
        // A stand-in overlay (opaque band above the face, transparent below): proves the compositing path, not the wig's look (the browser proof does that).
        const overlay = new Uint8Array(w * h * 4); for (let y = 0; y < 90; y++) for (let x = 40; x < 216; x++) overlay.set([120, 70, 40, 255], (y * w + x) * 4);
        const overlayData = Skia.Data.fromBytes(overlay), raw = Skia.Image.MakeImage({ width: w, height: h, colorType: types.ColorType.RGBA_8888, alphaType: types.AlphaType.Unpremul }, overlayData, w * 4); overlayData.dispose();
        const png = raw.encodeToBase64(); raw.dispose();
        const stack3d = (extra = {}) => normalizeStack({ wig: { style: '3d-bob', strength: 1, ...extra } });
        const wig3d = stack3d().wig, hairShade = normalizeStack().hair;
        assert.equal(wig3d.style, '3d-bob', 'a 3D style survives stack normalization');
        assert.equal(planWig(wig3d, hairShade, inference, w, h).status, 'loading', 'no overlay yet = loading, nothing drawn');
        assert.deepEqual(draw(stack3d()).pixels, bytes, 'loading draws nothing');
        const key = overlayKey(wig3d, inference.landmarks, w, h);
        putOverlay(key, { status: 'ready', png, fade: 1 });
        assert.equal(planWig(wig3d, hairShade, inference, w, h).status, 'ready');
        const withWig = draw(stack3d()).pixels;
        assert.ok(diffCount(withWig, bytes) > 10000, 'the overlay is composited');
        for (let y = 100; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) assert.equal(withWig[(y * w + x) * 4 + c], bytes[(y * w + x) * 4 + c], 'below the overlay the photo is untouched');
        assert.deepEqual(draw(stack3d()).pixels, withWig, '3D preview/export replay equality: tolerance 0');
        const halfWig = draw(stack3d({ strength: .5 })).pixels;
        assert.ok(diffCount(halfWig, withWig) > 5000 && diffCount(halfWig, bytes) > 5000, 'opacity is a real control for 3D wigs');
        assert.deepEqual(draw(stack3d({ strength: 0 })).pixels, bytes, '3D strength 0 = identical pixels');
        for (const lost of [{ ...inference, count: 0, hair: null }, { ...inference, count: 2, hair: null }, null]) assert.deepEqual(draw(stack3d(), lost).pixels, bytes, 'no single face = no 3D wig');
        assert.equal(planWig(stack3d({ size: 1.1 }).wig, hairShade, inference, w, h).status, 'loading', 'a different size needs its own overlay (the key covers it)');
        const tinted3d = draw(normalizeStack({ wig: { style: '3d-bob', strength: 1 }, hair: { strength: 1, shade: 'teal', shade2: 'blonde', mode: 'solid' } }), { ...inference, hair: null }).pixels;
        assert.ok(diffCount(tinted3d, withWig) > 5000, 'the hair shade tints a 3D wig');
        for (let y = 100; y < h; y++) for (let x = 0; x < w; x++) assert.equal(tinted3d[(y * w + x) * 4], bytes[(y * w + x) * 4], 'tint never reaches pixels the overlay does not cover');
        putOverlay(key, { status: 'angle', fade: 0 });
        assert.equal(planWig(wig3d, hairShade, inference, w, h).status, 'angle', 'a head turned too far has no overlay');
        assert.deepEqual(draw(stack3d()).pixels, bytes, 'angle draws nothing');
        putOverlay(key, { status: 'unavailable' });
        assert.equal(planWig(wig3d, hairShade, inference, w, h).status, 'unavailable', 'a failed render says so');
        assert.deepEqual(draw(stack3d()).pixels, bytes, 'unavailable draws nothing');
        putOverlay(key, { status: 'ready', png, fade: .4 });
        assert.equal(planWig(wig3d, hairShade, inference, w, h).status, 'angle', 'a partial fade is reported as angle');
        // Contract: a head part-way through the fade draws the wig faded (like 2D); only a fully faded one (fade 0, above) draws nothing.
        const faded = draw(stack3d()).pixels;
        assert.ok(diffCount(faded, bytes) > 2000 && diffCount(faded, withWig) > 2000, 'a partial fade draws a fainter wig, not nothing and not full')
        clearOverlays();
        assert.equal(planWig(wig3d, hairShade, inference, w, h).status, 'loading', 'clearing forgets overlays');
        console.log('Software Skia 3D wigs: overlay composited for preview and export (replay equality, tolerance 0); loading/angle/unavailable/no-face/strength 0 draw nothing; opacity and tint are real; nothing below the overlay changes.');
    }
    console.log('Software Skia 2D wigs: 6 embedded styles; shared fit; protected face/eyes/brows/mouth never changed; pixie above the face; replay equality; strength 0 and no-face/turned-head identical; opacity, size, tint (alpha untouched); coverage hint relations passed.');
    console.log('Software Skia: 4 shaders compiled; 7 makeup layers visible; eye/mouth holes; orientation; zero strength; combined PNG/preview equality (0-byte tolerance); multiple-face suppression passed.');
} finally { image.dispose(); delete globalThis.__liveEditSkia; }
