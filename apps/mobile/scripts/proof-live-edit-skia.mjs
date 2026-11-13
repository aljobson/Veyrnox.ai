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
const { outputFiles } = await build({ stdin: { contents: `export { renderEffectStack } from './renderEffectStack'; export { normalizeStack, MAKEUP } from './engine'; export * as shaders from './shaders';`, resolveDir: fileURLToPath(new URL('../src/lib/liveEdit/', import.meta.url)), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false,
    plugins: [{ name: 'software-skia', setup(b) {
        b.onResolve({ filter: /^@shopify\/react-native-skia$/ }, () => ({ path: 'skia', namespace: 'software' }));
        b.onLoad({ filter: /.*/, namespace: 'software' }, () => ({ contents: 'export const {Skia,TileMode,FilterMode,MipmapMode,PaintStyle,ColorType,AlphaType}=globalThis.__liveEditSkia;' }));
    } }],
});
const module = { exports: {} }; new Function('module', 'exports', outputFiles[0].text)(module, module.exports);
const { renderEffectStack, normalizeStack, MAKEUP, shaders } = module.exports;
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
    console.log('Software Skia: 4 shaders compiled; 7 makeup layers visible; eye/mouth holes; orientation; zero strength; combined PNG/preview equality (0-byte tolerance); multiple-face suppression passed.');
} finally { image.dispose(); delete globalThis.__liveEditSkia; }
