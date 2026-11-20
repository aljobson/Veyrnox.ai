/* eslint-disable @typescript-eslint/no-require-imports */
import { lightVertex, linearToSrgb, srgbToLinear, smoothNormals } from '../src/lib/liveEdit/wig3dLighting';
import { behindProxy, proxyRay, proxyClass } from '../src/lib/liveEdit/wig3dGeometry';
import type { SkImage } from '@shopify/react-native-skia';
import type { Wig3dJob } from '../src/lib/liveEdit/wig3dNative';
import type { Vec3 } from '../src/lib/liveEdit/wig3dLighting';
import { normalizeStack, WIG3D_IDS } from '../src/lib/liveEdit/engine';
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
let scratch: string | undefined;
// A CI regression ceiling, not a 60fps/device guarantee. Includes cold mesh
// setup and every synchronous native call, excluding test observers/assertions.
const MAX_TASK_STEP_MS = 100;
// Wall-clock bounds are only meaningful on a quiet machine: under a loaded full suite (or shared CI runners) a GC
// pause or CPU contention can stretch one step. The bound is asserted when WIG3D_TIMING_STRICT=1; timings are always reported.
const STRICT_TIMING = process.env.WIG3D_TIMING_STRICT === '1';
let mockSkia: any, kit: any, native: typeof import('../src/lib/liveEdit/wig3dNative');
let wig: typeof import('../src/lib/liveEdit/wig'), carve: typeof import('../src/lib/liveEdit/wig3dCarve');
let renderEffectStack: typeof import('../src/lib/liveEdit/renderEffectStack').renderEffectStack;
const { wigPoints } = require('../../../tests/fixtures/photo-studio-wig-fixture.mjs');
const { carveFace } = require('../../../app/veyrnox/_lib/liveEdit/wigCommon.js');
const { headFrame, wigMatrix } = require('../src/lib/liveEdit/shared/wig3d');
jest.mock('@shopify/react-native-skia', () => ({
    get Skia() { return mockSkia; },
    ...jest.requireActual('@shopify/react-native-skia/lib/commonjs/skia/types'),
}));
const types = require('@shopify/react-native-skia/lib/commonjs/skia/types');
const points = (yaw = 0, roll = 0): Float32Array => {
    const p = wigPoints(), a = yaw * Math.PI / 180, r = roll * Math.PI / 180;
    for (let i = 0; i < p.length; i += 3) {
        const x = (p[i] - .5) * Math.cos(a), y = p[i + 1] - .5;
        p[i] = .5 + x * Math.cos(r) - y * Math.sin(r);
        p[i + 1] = .5 + x * Math.sin(r) + y * Math.cos(r);
        p[i + 2] = -(p[i] - .5) * Math.tan(a);
    }
    return p;
};
const job = (style: Wig3dJob['wig']['style'] = '3d-bob', size = 1, offset = 0, yaw = 0, width = 256, roll = 0): Wig3dJob => ({
    wig: normalizeStack({ wig: { style, size, offset, strength: 1 } }).wig, landmarks: points(yaw, roll), width, height: width,
});
const pixels = (image: SkImage): Uint8Array => Uint8Array.from(image.readPixels(0, 0, {
    width: image.width(), height: image.height(), colorType: types.ColorType.RGBA_8888, alphaType: types.AlphaType.Unpremul,
}) as Uint8Array);
const inside = (poly: number[][], x: number, y: number) => {
    let yes = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) yes = !yes;
    }
    return yes;
};
const protectedCache = new Map<string, number[]>();
const protectedPixels = (p: Float32Array, width: number) => {
    const key = `${width}|${Array.from(p).join()}`;
    const cached = protectedCache.get(key); if (cached) return cached;
    const holes = carve.faceHoles(p), indices: number[] = [];
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++)
        if (holes.some(poly => inside(poly, (x + .5) / width, (y + .5) / width))) indices.push((y * width + x) * 4);
    protectedCache.set(key, indices); return indices;
};
const draw = (input: Wig3dJob, scale = 1) => {
    const source = mockSkia.Surface.Make(input.width, input.height);
    source.getCanvas().clear(mockSkia.Color('#806040')); source.flush();
    const photo = source.makeImageSnapshot();
    const inference = { sourceId: 1, frameId: 1, count: 1 as const, landmarks: input.landmarks, hair: null };
    const picture = renderEffectStack({ sourceId: 1, frameId: 1, image: photo }, normalizeStack({ wig: input.wig }), inference);
    const surface = mockSkia.Surface.Make(input.width * scale, input.height * scale);
    surface.getCanvas().scale(scale, scale); surface.getCanvas().drawPicture(picture); surface.flush();
    const image = surface.makeImageSnapshot();
    picture.dispose(); photo.dispose(); source.dispose(); surface.dispose();
    return image;
};
beforeAll(async () => {
    kit = await require('canvaskit-wasm/bin/full/canvaskit')({});
    mockSkia = require('@shopify/react-native-skia/lib/commonjs/skia/web/JsiSkia').JsiSkApi(kit);
    native = require('../src/lib/liveEdit/wig3dNative'); wig = require('../src/lib/liveEdit/wig');
    carve = require('../src/lib/liveEdit/wig3dCarve');
    ({ renderEffectStack } = require('../src/lib/liveEdit/renderEffectStack'));
    const proofRoot = process.env.WIG3D_PROOF_DIR;
    // Opt-in only: a caller-supplied existing directory, or '1' for os.tmpdir().
    // mkdtemp makes a private, collision-free directory; ordinary CI writes nothing.
    if (proofRoot) scratch = fs.mkdtempSync(join(proofRoot === '1' ? tmpdir() : proofRoot, 'wig3d-proof-'));
});
afterEach(() => wig.clearOverlays());

// Runs before any other renders so all four timing samples include cold meshes.
test('1024px cold render timings, longest task step, outer-edge AA, coverage and optional PNGs', () => {
    const panel = scratch ? mockSkia.Surface.Make(4 * 1024, 1024) : null;
    const paint = scratch ? mockSkia.Paint() : null;
    panel?.getCanvas().clear(mockSkia.Color('#b0c0d0'));
    const timings: object[] = [];
    try {
        for (const [column, style] of WIG3D_IDS.entries()) {
            const input = job(style, 1, 0, 0, 1024), stats = native.geometryStats(), start = performance.now();
            const task = native.nativeWigTask(input, { stats });
            let maxStepMs = 0, steps = 0, next: ReturnType<typeof task.next>;
            do {
                const stepStart = performance.now(); next = task.next();
                maxStepMs = Math.max(maxStepMs, performance.now() - stepStart); steps++;
            } while (!next.done);
            const result = next.value, ms = Math.round(performance.now() - start);
            timings.push({ style, ms, maxStepMs, steps, stepLimitMs: MAX_TASK_STEP_MS, ...stats });
            expect(result.status).toBe('ready'); expect(stats.maxBoundaryEdge).toBeLessThanOrEqual(1);
            const data = pixels(result.image!);
            let above = 0, below = 0, partialOuterEdge = 0;
            for (let y = 0; y < 1024; y++) {
                let left = -1, right = -1;
                for (let x = 0; x < 1024; x++) if (data[(y * 1024 + x) * 4 + 3]) {
                    if (left < 0) left = x; right = x;
                    if (y < 360) above++; if (y > 700) below++;
                }
                // First/last covered pixel on each row is the OUTER silhouette,
                // not the antialiased inner face-carve or an internal triangle seam.
                for (const x of [left, right]) if (x > 0 && x < 1023) {
                    const alpha = data[(y * 1024 + x) * 4 + 3];
                    if (alpha > 0 && alpha < 255) partialOuterEdge++;
                }
            }
            expect(partialOuterEdge).toBeGreaterThan(100);
            expect(above).toBeGreaterThan(1000);
            if (style === '3d-pixie') expect(below).toBe(0);
            if (style === '3d-long') expect(below).toBeGreaterThan(10000);
            if (scratch) {
                panel.getCanvas().drawImage(result.image, column * 1024, 0, paint);
                fs.writeFileSync(join(scratch, `${style}.png`), result.image!.encodeToBytes(types.ImageFormat.PNG));
            }
            wig.putOverlay(wig.overlayKey(input.wig, input.landmarks, 1024, 1024), result);
            const inference = { sourceId: 1, frameId: 1, count: 1 as const, landmarks: input.landmarks, hair: { width: 64, height: 64, hair: new Float32Array(4096) } };
            expect(wig.wigStatus(input.wig, normalizeStack().hair, inference, 1024, 1024)).toBe('ready');
            inference.hair.hair.fill(1);
            expect(wig.wigStatus(input.wig, normalizeStack().hair, inference, 1024, 1024)).toBe('uncovered');
            if (STRICT_TIMING) expect(maxStepMs).toBeLessThan(MAX_TASK_STEP_MS);
        }
        if (scratch) {
            panel.flush(); const image = panel.makeImageSnapshot();
            try { fs.writeFileSync(join(scratch, 'native-four-styles.png'), image.encodeToBytes(types.ImageFormat.PNG)); }
            finally { image.dispose(); }
        }
    } finally {
        console.log('Native wig CanvasKit proxy (not device timing):', JSON.stringify(timings));
        if (scratch) {
            fs.writeFileSync(join(scratch, 'timings.json'), JSON.stringify(timings, null, 2));
            console.log('Native-only PNGs (web visual parity unverified):', scratch);
        }
        panel?.dispose(); paint?.dispose();
    }
}, 120000);

test('lighting is deterministic, bounded, two-sided, with standard sRGB transfer and area-weighted normals', () => {
    expect(linearToSrgb(0)).toBe(0); expect(linearToSrgb(1)).toBeCloseTo(1, 10);
    expect(linearToSrgb(.0031308)).toBeCloseTo(.040449936, 9);
    expect(linearToSrgb(.21404114048223255)).toBeCloseTo(.5, 10);
    expect(srgbToLinear(.5)).toBeCloseTo(.21404114048223255, 10);
    expect(srgbToLinear(.04045)).toBeCloseTo(.00313080495356, 12);
    const base: Vec3 = [.5, .27, .13];
    for (const n of [[0, 0, 1], [0, 1, 0], [1, 1, 1], [-1, 2, -3]] as Vec3[]) {
        const c = lightVertex(n, base);
        expect(c).toEqual(lightVertex(n, base)); expect(c.every(v => v >= 0 && v <= 1)).toBe(true);
    }
    expect(lightVertex([0, 0, 1], base).map(v => +v.toFixed(9))).toEqual([.626434489, .482356686, .359739340]);
    expect(lightVertex([0, 1, 0], base).map(v => +v.toFixed(9))).toEqual([.474260765, .354418158, .246931619]);
    expect(lightVertex([0, 0, -1], base)).toEqual(lightVertex([0, 0, 1], base));
    expect(smoothNormals(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), Uint32Array.of(0, 1, 2))).toEqual(Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1));
});

// Both APIs below use CanvasKit. This checks equivalent draw calls and their
// software pixels; it does NOT establish parity with a browser canvas backend.
test('face carve agrees with web draw calls through CanvasKit Canvas2D, not browser canvas parity', () => {
    for (const yaw of [0, 30]) {
        const p = points(yaw, 12), surface = mockSkia.Surface.Make(256, 256);
        surface.getCanvas().clear(mockSkia.Color('#806040'));
        carve.carveNativeFace(surface.getCanvas(), 256, 256, p); surface.flush();
        const image = surface.makeImageSnapshot(), actual = pixels(image);
        const web = kit.MakeCanvas(256, 256), ctx = web.getContext('2d');
        ctx.fillStyle = '#806040'; ctx.fillRect(0, 0, 256, 256);
        carveFace(ctx, { width: 256, height: 256 }, p);
        const expected = ctx.getImageData(0, 0, 256, 256).data;
        expect(actual).toEqual(Uint8Array.from(expected));
        web.dispose(); image.dispose(); surface.dispose();
    }
});

test.each(WIG3D_IDS)('%s protects all face pixels in overlay, preview and PNG export at control extremes and rotated poses', (style) => {
    for (const [size, offset] of [[1, 0], [.75, -.15], [.75, .15], [1.3, -.15], [1.3, .15]]) {
        for (const yaw of [0, 30]) {
            const input = job(style, size, offset, yaw, 256, yaw ? 12 : 0), stats = native.geometryStats();
            const result = native.renderNativeWig(input, { stats });
            expect(result.status).toBe('ready'); expect(result.fade).toBe(1);
            expect(stats.boundaryLeaves).toBeGreaterThan(0); expect(stats.maxBoundaryEdge).toBeLessThanOrEqual(1);
            const alpha = pixels(result.image!), protectedIndices = protectedPixels(input.landmarks, 256);
            expect(protectedIndices.length).toBeGreaterThan(4000);
            const violations = protectedIndices.filter(i => alpha[i + 3] !== 0);
            if (violations.length) throw Error(JSON.stringify({ style, size, offset, yaw, violations: violations.map(i => [i / 4 % 256, Math.floor(i / 4 / 256), alpha[i + 3]]) }));
            expect(alpha.filter((v, i) => i % 4 === 3 && v > 0).length).toBeGreaterThan(1000);
            wig.putOverlay(wig.overlayKey(input.wig, input.landmarks, 256, 256), result);
            const preview = draw(input), previewPixels = pixels(preview);
            const exported = draw(input, 2), encoded = mockSkia.Data.fromBytes(exported.encodeToBytes(types.ImageFormat.PNG));
            const decoded = mockSkia.Image.MakeImageFromEncoded(encoded), exportPixels = pixels(decoded);
            expect(protectedIndices.filter(i => previewPixels[i] !== 128 || previewPixels[i + 1] !== 96 || previewPixels[i + 2] !== 64)).toEqual([]);
            const exportProtected = protectedPixels(input.landmarks, 512);
            expect(exportProtected.filter(i => exportPixels[i] !== 128 || exportPixels[i + 1] !== 96 || exportPixels[i + 2] !== 64)).toEqual([]);
            expect(Buffer.from(exportPixels).equals(Buffer.from(pixels(exported)))).toBe(true);
            for (const image of [preview, exported, decoded, encoded]) image.dispose();
            wig.clearOverlays();
        }
    }
}, 120000);

test('raw turned-head silhouette keeps front hair and removes rear hair; interval classifier catches crossings with agreeing vertices', () => {
    const input = job('3d-long', 1, 0, 30), matrix = wigMatrix(headFrame(input.landmarks, 256, 256), input.wig), ray = proxyRay(matrix);
    // All three vertices miss the unit sphere but their interior crosses it.
    const triangle: Vec3[] = [[-2, .3, -2], [2, .3, -2], [0, 2, -2]];
    expect(triangle.every(p => !behindProxy(p, [0, 0, 1]))).toBe(true);
    expect(proxyClass(triangle, [0, 0, 1])).toBe(0);
    expect(behindProxy([0, .3, -1.2], ray)).toBe(true);
    expect(behindProxy([0, .3, 1.2], ray)).toBe(false);
    let raw: Uint8Array = new Uint8Array();
    const stats = native.geometryStats(), result = native.renderNativeWig(input, { stats, beforeCarve: image => { raw = pixels(image); } });
    expect(result.status).toBe('ready');
    // Independent screen ray -> local inverse and analytic ellipsoid silhouette.
    // Below the local hairline, points well inside the proxy should be empty;
    // at the near-side silhouette just outside it the side skirt must survive.
    const inverse = (x: number, y: number, z: number): Vec3 => [0, 4, 8].map(j =>
        (matrix[j] * (x - matrix[12]) + matrix[j + 1] * (y - matrix[13]) + matrix[j + 2] * (z - matrix[14]))
        / (matrix[j] ** 2 + matrix[j + 1] ** 2 + matrix[j + 2] ** 2)) as Vec3;
    let faceChecked = 0, outsidePainted = 0;
    for (let y = 120; y < 160; y++) for (let x = 60; x < 195; x++) {
        const p = inverse(x + .5, y + .5, matrix[14]);
        const q = [(p[0]) / .96, (p[1] - .3) / .6, (p[2] + .08) / .98];
        const b = q.reduce((s, v, k) => s + v * ray[k], 0), d = 1 - q.reduce((s, v, k) => s + (v - b * ray[k]) ** 2, 0);
        if (d > .3 && x > 100 && x < 145) { faceChecked++; expect(raw[(y * 256 + x) * 4 + 3]).toBe(0); }
        if (d < -.02 && d > -.4 && x > 128 && raw[(y * 256 + x) * 4 + 3] > 0) outsidePainted++;
    }
    expect(faceChecked).toBeGreaterThan(100); expect(outsidePainted).toBeGreaterThan(20);
    expect(stats.maxBoundaryEdge).toBeLessThanOrEqual(1); result.image?.dispose();
});

test('no frame, fade zero, allocation failure and geometry cancellation settle', () => {
    const invalid = job(); invalid.landmarks[0] = NaN;
    expect(native.renderNativeWig(invalid).status).toBe('face-required');
    expect(native.renderNativeWig({ ...job(), landmarks: new Float32Array(1434) }).status).toBe('face-required');
    expect(native.renderNativeWig(job('3d-bob', 1, 0, 70)).status).toBe('angle');
    expect(native.overlaySize(4000, 3000)).toEqual({ width: 1024, height: 768 });
    const make = jest.spyOn(mockSkia.Surface, 'Make').mockReturnValueOnce(null);
    expect(native.renderNativeWig(job()).status).toBe('unavailable'); make.mockRestore();
    const task = native.nativeWigTask(job()); expect(task.next().done).toBe(false);
    task.return({ status: 'unavailable', image: null, fade: 1 }); expect(task.next().done).toBe(true);
});

test('readback failure and cancellation release both supersample and downsample objects', () => {
    const originalMake = mockSkia.Surface.Make.bind(mockSkia.Surface);
    const released: jest.SpyInstance[] = [], snapshotReleased: jest.SpyInstance[] = [];
    const make = jest.spyOn(mockSkia.Surface, 'Make').mockImplementation((...args: unknown[]) => {
        const surface = originalMake(...args); released.push(jest.spyOn(surface, 'dispose'));
        const snapshot = surface.makeImageSnapshot.bind(surface);
        jest.spyOn(surface, 'makeImageSnapshot').mockImplementation(() => {
            const image = snapshot(); snapshotReleased.push(jest.spyOn(image, 'dispose'));
            jest.spyOn(image, 'makeNonTextureImage').mockReturnValue(null); return image;
        });
        return surface;
    });
    try {
        expect(native.renderNativeWig(job()).status).toBe('unavailable');
        expect(released).toHaveLength(2); expect(snapshotReleased).toHaveLength(2);
        for (const dispose of [...released, ...snapshotReleased]) expect(dispose).toHaveBeenCalledTimes(1);
        const task = native.nativeWigTask(job());
        while (make.mock.calls.length < 4) expect(task.next().done).toBe(false);
        task.return({ status: 'unavailable', image: null, fade: 1 });
        for (const dispose of [...released, ...snapshotReleased]) expect(dispose).toHaveBeenCalledTimes(1);
    } finally { make.mockRestore(); }
});

