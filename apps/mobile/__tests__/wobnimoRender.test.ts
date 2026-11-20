import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWobnimoRenderer, WobnimoEngine, wobnimoTarget, wobnimoFragmentPoint, wobnimoUniforms } from '../src/lib/wobnimoNative';
import { WOBNIMO_PROGRAMS } from '../src/lib/wobnimoPrograms.generated';
import { WOBNIMO_DATA } from '../src/lib/wobnimoData.generated';
import { WOBNIMO_CHARACTERS, type WobnimoId } from '../src/lib/veyCharacterChoice';
import { WOBNIMO_COLOR_GOLDENS, WOBNIMO_COLOR_POINTS } from './fixtures/wobnimoColorGoldens';
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit');
let Skia: any, ColorType: any, AlphaType: any, ImageFormat: any;
const artifacts = join(tmpdir(), 'veyrnox-s2b-proof');
const costs: Record<string, number> = {};

beforeAll(async () => {
    const kit = await CanvasKitInit({});
    ({ Skia, ColorType, AlphaType, ImageFormat } = require('@shopify/react-native-skia/lib/commonjs/mock').Mock(kit));
    mkdirSync(artifacts, { recursive: true });
});
afterAll(() => {
    console.info('Wobnimo CanvasKit CPU 128x128 draw + readback ms:', JSON.stringify(costs));
    writeFileSync(join(artifacts, 'frame-costs.json'), JSON.stringify(costs, null, 2));
});
function idle(character: WobnimoId, size: number) {
    const engine = new WobnimoEngine(character, 'idle', 0.5);
    for (let i = 0; i < 29; i++) engine.frame(size, 1 / 30);
    return engine.frame(size, 1 / 30);
}
function render(character: WobnimoId, size: number, save = false) {
    const renderer = createWobnimoRenderer(Skia, character, size);
    try {
        const values = idle(character, size);
        const start = performance.now();
        const image = renderer.draw(values);
        try {
            const pixels = image.readPixels(0, 0, { width: size, height: size, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
            const ms = performance.now() - start;
            expect([image.width(), image.height()]).toEqual([size, size]);
            expect(pixels).toBeTruthy();
            if (save) {
                costs[character] = Number(ms.toFixed(2));
                writeFileSync(join(artifacts, `${character}.png`), image.encodeToBytes(ImageFormat.PNG));
            }
            return pixels;
        } finally { image.dispose(); }
    } finally { renderer.dispose(); }
}
function bounds(pixels: Uint8Array, size: number) {
    let x0 = size, y0 = size, x1 = -1, y1 = -1, occupied = 0, transparent = 0;
    const colors = new Set<string>();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (pixels[i + 3] > 127) {
            x0 = Math.min(x, x0); y0 = Math.min(y, y0); x1 = Math.max(x, x1); y1 = Math.max(y, y1); occupied++;
            colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        }
        if (pixels[i + 3] === 0) transparent++;
    }
    expect(occupied).toBeGreaterThan(size * size * 0.03);
    expect(transparent).toBeGreaterThan(size * size * 0.1);
    expect(colors.size).toBeGreaterThan(30);
    return [x0 / size, y0 / size, (x1 + 1) / size, (y1 + 1) / size];
}

test('generated files match the pinned dist and the engine has no browser runtime', () => {
    execFileSync(process.execPath, ['scripts/sync-wobnimo-bundle.mjs', '--check'], { cwd: join(__dirname, '..') });
    const code = readFileSync(join(__dirname, '../src/lib/wobnimoEngine.generated.js'), 'utf8');
    expect(code).not.toMatch(/\b(document|window|customElements|requestAnimationFrame|eval|HTMLElement|matchMedia)\b/);
    for (const file of ['components/WobnimoView.tsx', 'lib/wobnimoNative.ts', 'lib/wobnimoEngine.generated.js', 'lib/wobnimoData.generated.ts', 'lib/wobnimoPrograms.generated.ts']) {
        expect(readFileSync(join(__dirname, '../src', file), 'utf8')).not.toContain('react-native-webview');
    }
});

test.each(WOBNIMO_CHARACTERS)('%s compiles, matches every renderer uniform, renders and keeps density framing', character => {
    const program = WOBNIMO_PROGRAMS[character];
    const effect = Skia.RuntimeEffect.Make(program.source);
    expect(effect).not.toBeNull();
    try {
        const data = WOBNIMO_DATA[character];
        const expected = { uResolution: 2, uTime: 1, uCamera: 4, uBound: 4, uBones: data.bones.length * 16,
            uScaleFix: 1, uFaceA: 4, uFaceB: 4, uFaceC: 4, uFaceD: 4, uGlow: 3, uShadow: 3,
            uFloor: 1, uLift: 1, uGlowPool: 1, uExposure: 1, uAlbedo: data.albedo.length,
            uFxA: 128, uFxB: 128, uFxC: 128, uFxCount: 1 };
        expect(Object.fromEntries(program.uniforms.map(u => [u.name, u.size]))).toEqual(expected);
        expect(Object.keys(idle(character, 128)).sort()).toEqual(Object.keys(expected).sort());
        expect(wobnimoUniforms(character, effect, idle(character, 128))).toHaveLength(effect.getUniformFloatCount());
    } finally { effect.dispose(); }
    // The gamma expression is intentionally unchanged, including the original vec3 spelling.
    expect(program.source).toContain('pow(aces(shade(m, p, n, -rd) * uExposure), vec3(1.0 / 2.2))');
    expect(program.source).toContain('vec2(fragCoord.x, uResolution.y - fragCoord.y)');
    expect(program.uniforms.find(u => u.name === 'uFxCount')).toEqual({ name: 'uFxCount', size: 1, integer: false });
    const density2 = render(character, wobnimoTarget(64, 2).size, true);
    const b2 = bounds(density2, 128);
    // Representative robot, animal and fruit silhouettes exercise the shared coordinate path.
    for (const density of (['volt', 'berry', 'ember'].includes(character) ? [1, 3] : [])) {
        const { size } = wobnimoTarget(64, density);
        expect(size).toBe(density === 1 ? 64 : 128);
        const pixels = render(character, size);
        const box = bounds(pixels, size);
        box.forEach((coordinate, i) => expect(Math.abs(coordinate - b2[i])).toBeLessThan(0.035));
        if (density === 3) expect(pixels).toEqual(density2);
    }
    const golden = WOBNIMO_COLOR_GOLDENS[character as keyof typeof WOBNIMO_COLOR_GOLDENS];
    if (golden) WOBNIMO_COLOR_POINTS.forEach(([x, y], point) => {
        const actual = density2.slice((y * 128 + x) * 4, (y * 128 + x + 1) * 4);
        golden[point].forEach((value, channel) => expect(Math.abs(actual[channel] - value)).toBeLessThanOrEqual(2));
    });
}, 60000);

test('pixel centres map from Skia top-left to WebGL bottom-left', () => {
    for (const density of [1, 2, 3]) {
        const { size, scale } = wobnimoTarget(63, density);
        expect(size).toBe(Math.round(63 * Math.min(density, 2)));
        expect(scale).toBe(size / 63);
        expect(wobnimoFragmentPoint(size / 2, size / 2, size)).toEqual([size / 2, size / 2]);
        expect(wobnimoFragmentPoint(0.5, 0.5, size)).toEqual([0.5, size - 0.5]);
    }
    expect(() => wobnimoTarget(0, 2)).toThrow();
    expect(() => wobnimoTarget(64, NaN)).toThrow();
});

test('all characters and states produce finite poses, with bounded FX and the same seeded behaviour', () => {
    const states = ['idle', 'thinking', 'listening', 'speaking', 'sleeping', 'working', 'error', 'surprised', 'celebrating', 'sad'] as const;
    for (const character of WOBNIMO_CHARACTERS) {
        const engine = new WobnimoEngine(character, 'idle', 0.5);
        for (const state of states) {
            engine.configure(state, false);
            let values = engine.frame(128, 1 / 30);
            for (let i = 0; i < 20; i++) values = engine.frame(128, 1 / 30);
            for (const value of Object.values(values)) {
                expect((typeof value === 'number' ? [value] : Array.from(value)).every(Number.isFinite)).toBe(true);
            }
            expect(values.uFxCount).toBeGreaterThanOrEqual(0);
            expect(values.uFxCount).toBeLessThanOrEqual(32);
        }
        expect(idle(character, 128)).toEqual(idle(character, 128));
        engine.configure('sleeping', true);
        expect(engine.frame(128, 1 / 30)).toMatchObject({ uTime: 0, uFxCount: 0 });
        engine.frame(128, 1 / 30); expect(engine.settled).toBe(true);
        engine.configure('thinking', true); expect(engine.settled).toBe(false);
    }
});

test('renderer rejects compile and allocation failure and disposes failed frame resources', () => {
    expect(() => createWobnimoRenderer({ ...Skia, RuntimeEffect: { Make: () => null } }, 'volt', 128)).toThrow('shader failed');
    const effect = Skia.RuntimeEffect.Make(WOBNIMO_PROGRAMS.volt.source);
    const dispose = jest.spyOn(effect, 'dispose');
    expect(() => createWobnimoRenderer({ ...Skia, RuntimeEffect: { Make: () => effect }, Surface: { MakeOffscreen: () => null } }, 'volt', 128)).toThrow('surface unavailable');
    // A failed view allocation must not dispose the shared compiled effect.
    expect(dispose).not.toHaveBeenCalled();
    const renderer = createWobnimoRenderer(Skia, 'volt', 128);
    expect(() => renderer.draw({ ...idle('volt', 128), uTime: NaN })).toThrow('Invalid Wobnimo uniform');
    renderer.dispose(); renderer.dispose();
    expect(() => renderer.draw(idle('volt', 128))).toThrow('disposed');
});
